import ts from "typescript";
import { emptyObservedProfile, type ObservedProfile } from "../types";

/**
 * Static behavior extraction over TypeScript's own parser (no execution).
 * Produces the OBSERVED profile that the declared-vs-observed comparison and
 * the risk scorer consume. Pure analysis: nothing here executes user code.
 */

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

const CONNECTION_SCHEMES: Record<string, string> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",
  rediss: "redis",
  amqp: "amqp",
};

const FS_WRITE_METHODS = /^(\+ )?(writeFileSync?|appendFileSync?|rm(Sync)?|unlink(Sync)?|rmdir(Sync)?|mkdtempSync|createWriteStream)$/;

function isCode(path: string): boolean {
  return CODE_EXTENSIONS.test(path) && !/(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)/.test(path);
}

function extractHostFromConnectionString(raw: string): { scheme: string; host: string } | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const type = CONNECTION_SCHEMES[scheme];
  if (!type) return null;
  let rest = m[2];
  const at = rest.lastIndexOf("@");
  if (at !== -1) rest = rest.slice(at + 1);
  const hostPart = rest.split(/[/?]/)[0];
  const host = hostPart.split(":")[0].toLowerCase();
  if (!host) return null;
  return { scheme: type, host };
}

export function analyzeSource(files: { path: string; content: string }[]): ObservedProfile {
  const profile = emptyObservedProfile();

  for (const file of files) {
    if (!isCode(file.path)) continue;
    profile.filesScanned++;
    const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);

    let importsChildProcess = false;
    /** module-scope string consts, so write/read targets behind identifiers are still resolved */
    const stringConsts = new Map<string, string>();
    const FS_WRITE_METHODS = new Set(["writeFile", "writeFileSync", "appendFile", "appendFileSync", "rm", "rmSync", "unlink", "unlinkSync", "rmdir", "rmdirSync"]);
    const resolveTarget = (arg: ts.Expression): string | null => {
      if (ts.isStringLiteral(arg)) return arg.text;
      if (ts.isIdentifier(arg)) return stringConsts.get(arg.text) ?? null;
      return null;
    };

    const walk = (node: ts.Node): void => {
      // import declarations
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (/^(node:)?child_process$/.test(spec)) importsChildProcess = true;
        if (/^(node:)?(net|dns|tls)$/.test(spec)) profile.socketHosts.push(`<module:${spec}>`);
      }
      // require('child_process')
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        /^(node:)?child_process$/.test((node.arguments[0] as ts.StringLiteral).text)
      ) {
        importsChildProcess = true;
      }

      // eval / new Function
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval") {
        profile.evalUses.push(`${file.path}@${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
        profile.evalUses.push(`${file.path}@${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }

      // dynamic import()
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        profile.dynamicImports.push((node.arguments[0] as ts.StringLiteral).text);
      }

      // exec-family calls when child_process is in scope
      if (
        importsChildProcess &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /^(exec|execSync|execFile|execFileSync|spawn|spawnSync)$/.test(node.expression.text)
      ) {
        profile.processExecCalls.push(`${node.expression.text}@${file.path}`);
      }

      // string literals: urls, connection strings, fs targets
      if (ts.isStringLiteral(node)) {
        const text = node.text;
        if (/^https?:\/\//i.test(text)) {
          try {
            profile.urlHosts.push(new URL(text).hostname.toLowerCase());
          } catch {
            /* malformed url literal; ignore */
          }
        } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
          const conn = extractHostFromConnectionString(text);
          if (conn) {
            profile.connectionStrings.push({ type: conn.scheme, host: conn.host, raw: text });
            profile.socketHosts.push(conn.host);
          }
        }
      }

      // const X = 'literal' — record for target resolution
      if (
        ts.isVariableStatement(node) &&
        (node.declarationList.flags & ts.NodeFlags.Const) !== 0
      ) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && ts.isStringLiteral(decl.initializer)) {
            stringConsts.set(decl.name.text, (decl.initializer as ts.StringLiteral).text);
          }
        }
      }

      // fs.write-family calls with resolvable first argument
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.name) &&
        FS_WRITE_METHODS.has(node.expression.name.text)
      ) {
        const obj = node.expression.expression;
        const isFs =
          (ts.isIdentifier(obj) && obj.text === "fs") ||
          (ts.isPropertyAccessExpression(obj) && ts.isIdentifier(obj.name) && obj.name.text === "promises" && ts.isIdentifier(obj.expression) && obj.expression.text === "fs");
        if (isFs && node.arguments.length >= 1) {
          const target = resolveTarget(node.arguments[0]);
          if (target && /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(target)) {
            profile.fsWritesOutsideWorkspace.push(target);
          }
        }
      }

      // process.env.X / process.env['X']
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
        const obj = node.expression;
        if (ts.isPropertyAccessExpression(obj) && ts.isIdentifier(obj.name) && obj.name.text === "env") {
          const base = obj.expression;
          const isProcess =
            ts.isIdentifier(base) && base.text === "process";
          if (isProcess && node.name.text !== "env") profile.envVarsRead.push(node.name.text);
        }
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.name) &&
        node.expression.name.text === "env" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "process" &&
        node.argumentExpression &&
        ts.isStringLiteral(node.argumentExpression)
      ) {
        profile.envVarsRead.push((node.argumentExpression as ts.StringLiteral).text);
      }

      ts.forEachChild(node, walk);
    };

    walk(sf);

    // absolute reads (UNC shares, absolute POSIX)
    const readAbsRe = /readFileSync?\s*\(\s*['"`](\/\/[^'"`]+|[a-zA-Z]:\\[^'"`]+|\\\\[^'"`]+)['"`]/g;
    let rm: RegExpExecArray | null;
    while ((rm = readAbsRe.exec(file.content)) !== null) {
      profile.fsReadsAbsolute.push(rm[1]);
    }
  }

  // dedupe, preserve order
  const dedupe = (arr: string[]): string[] => [...new Set(arr)];
  return {
    ...profile,
    socketHosts: dedupe(profile.socketHosts),
    urlHosts: dedupe(profile.urlHosts),
    envVarsRead: dedupe(profile.envVarsRead),
    connectionStrings: profile.connectionStrings.filter(
      (c, i, a) => a.findIndex((x) => x.type === c.type && x.host === c.host) === i,
    ),
    fsWritesOutsideWorkspace: dedupe(profile.fsWritesOutsideWorkspace),
    fsReadsAbsolute: dedupe(profile.fsReadsAbsolute),
  };
}
