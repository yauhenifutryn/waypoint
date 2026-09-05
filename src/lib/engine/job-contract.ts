import { posix } from "node:path";
import ts from "typescript";
import type { Finding, ObservedProfile, SmallSoftwareManifest } from "./types";

export type JobContractApplicability = "eligible" | "out_of_scope" | "missing_evidence" | "contract_exception";
export interface JobContractAssessment {
  contractId: "local-node-file-job/v1";
  eligible: boolean;
  applicability: JobContractApplicability;
  finding: Finding;
}

const RUNNABLE = /\.(?:js|mjs|cjs)$/;
const OTHER_CODE = /\.(?:ts|tsx|jsx|py|sh|bash|rb|go|rs|java|php|ps1|wasm|node)$/i;
// Deliberately bounded MVP support. Additional built-ins need a contract review.
const SUPPORTED_BUILTINS = new Set(["assert", "assert/strict", "buffer", "console", "crypto", "events", "fs", "fs/promises", "path", "path/posix", "path/win32", "perf_hooks", "querystring", "stream", "stream/promises", "stream/consumers", "string_decoder", "timers", "timers/promises", "url", "util", "util/types", "zlib", "test", "test/reporters"]);
const UNSUPPORTED_BUILTINS = /^(?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|cluster|worker_threads|vm|module|process|inspector)(?:\/|$)/;
const FILE_OPERATIONS = /^(?:readFile|writeFile|appendFile|createReadStream|createWriteStream|readdir|mkdir|rm|unlink|rmdir|stat|lstat|access|exists|open|truncate|chmod|chown|realpath|readlink|mkdtemp|copyFile|cp|rename|link|symlink)(?:Sync)?$/;
const TWO_PATH_OPERATIONS = /^(?:copyFile|cp|rename|link|symlink)(?:Sync)?$/;

function relativeFile(path: string): boolean {
  return !!path && !/^(?:\/|[a-z]:|\\)/i.test(path) && !path.includes("\\") && !path.includes("\0") && path.split("/").every((part) => part !== "..");
}

/** A conservative applicability check, not a sandbox or proof of business correctness. */
export function evaluateJobContract(input: {
  manifest: SmallSoftwareManifest;
  sourceFiles: Array<{ path: string; content: string }>;
  observed: ObservedProfile;
  findings: Finding[];
}): JobContractAssessment {
  const { manifest, sourceFiles, observed, findings } = input;
  const issues: Array<{ category: Exclude<JobContractApplicability, "eligible">; reason: string }> = [];
  const issue = (category: Exclude<JobContractApplicability, "eligible">, reason: string) => issues.push({ category, reason });
  const files = new Map(sourceFiles.map((file) => [file.path, file.content]));
  const job = manifest.spec.job;
  if (manifest.kind !== "job") issue("out_of_scope", `Runtime ${manifest.kind} is outside the local Node.js file-job contract.`);
  else if (!job) issue("missing_evidence", "The job specification is missing.");
  else {
    const entry = job.entrypoint;
    if (!relativeFile(entry) || !/^(?:\.\/)?[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(entry) || !RUNNABLE.test(entry)) {
      issue("out_of_scope", "Entrypoint must be a relative .js, .mjs or .cjs file inside the submitted source.");
    } else if (!files.has(entry.replace(/^\.\//, ""))) issue("missing_evidence", `Exact entrypoint ${entry} was not included in the analyzed source.`);
    if (job.startCommand !== `node ${entry}`) issue("out_of_scope", "Start command must be exactly node <entrypoint>, without options, arguments or shell operations.");
    if (job.buildCommand !== undefined) issue("out_of_scope", "Build commands are outside this contract; submit runnable JavaScript.");
    if (job.timeoutSeconds === undefined) issue("missing_evidence", "An explicit timeout of at most 60 seconds is required.");
    else if (!Number.isFinite(job.timeoutSeconds) || !Number.isInteger(job.timeoutSeconds) || job.timeoutSeconds <= 0 || job.timeoutSeconds > 60) issue("contract_exception", "Runtime must be a positive whole number of seconds, at most 60.");
    if (job.concurrencyPolicy === undefined) issue("missing_evidence", "Explicit concurrencyPolicy: forbid is required.");
    else if (job.concurrencyPolicy !== "forbid") issue("contract_exception", "Overlapping or replacing runs are outside this contract; concurrencyPolicy must be forbid.");
    if (job.maxRetries !== undefined && job.maxRetries !== 0) issue("contract_exception", "Automatic retries are outside this contract; maxRetries must be zero or omitted (the runtime default).");
  }
  if (!findings.some((finding) => finding.key === "tests" && finding.status === "pass") || findings.some((finding) => finding.key === "tests" && finding.status !== "pass")) issue("missing_evidence", "No unambiguous passing test execution was recorded for this validation.");
  if (manifest.resources?.length || manifest.egress?.length || manifest.env?.length) issue("contract_exception", "Declared resources, egress or environment variables require review; this contract has none.");
  if (manifest.blastRadius?.writesSharedState || ["department", "company"].includes(manifest.blastRadius?.audience ?? "") || manifest.riskAttestation?.pii || manifest.riskAttestation?.externallyVisible) issue("contract_exception", "Shared state, broad audiences, personal data or external visibility are outside this contract.");
  for (const [key, value] of Object.entries(observed)) {
    if (Array.isArray(value) && value.length) issue("contract_exception", `Existing source analysis observed ${key}; local-only behavior is not established.`);
  }

  for (const file of sourceFiles) {
    if (/(^|\/)package\.json$/.test(file.path)) {
      try {
        const pkg: unknown = JSON.parse(file.content);
        if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("expected object");
        const metadata = pkg as Record<string, unknown>;
        for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies", "bundleDependencies"]) {
          const deps = metadata[field];
          if (deps !== undefined && (!deps || typeof deps !== "object")) issue("missing_evidence", `${file.path}: ${field} metadata cannot be accounted for.`);
          else if (deps && Object.keys(deps).length) issue("out_of_scope", `${file.path} declares ${field}; automatic eligibility supports zero third-party dependencies only.`);
        }
        if (metadata.imports || metadata.workspaces) issue("out_of_scope", `${file.path}: package import maps and workspaces need dependency resolution outside this contract.`);
      } catch { issue("missing_evidence", `${file.path} is not valid package metadata.`); }
    }
    if (OTHER_CODE.test(file.path)) issue("out_of_scope", `${file.path}: executable language or binary is not supported by the JavaScript contract.`);
  }

  let localFileOperation = false;
  for (const file of sourceFiles) {
    if (!RUNNABLE.test(file.path)) continue;
    const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if ((sf as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) issue("missing_evidence", `${file.path}: JavaScript could not be fully parsed.`);
    const stringConsts = new Map<string, string>();
    const fsAliases = new Map<string, string>();
    const fsNamespaces = new Set<string>();
    const literal = (node: ts.Node | undefined): string | undefined => {
      if (!node) return undefined;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
      return ts.isIdentifier(node) ? stringConsts.get(node.text) : undefined;
    };
    const isFsRequire = (node: ts.Node): boolean => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && /^(?:node:)?fs(?:\/promises)?$/.test(node.arguments[0].text);
    const propertyName = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined => ts.isPropertyAccessExpression(node) ? node.name.text : literal(node.argumentExpression);
    const isFsNamespace = (node: ts.Node): boolean => (ts.isIdentifier(node) && fsNamespaces.has(node.text)) || isFsRequire(node) || ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && propertyName(node) === "promises" && isFsNamespace(node.expression));
    const bindFsName = (local: string, imported: string): void => {
      if (imported === "promises") fsNamespaces.add(local);
      else {
        fsAliases.set(local, imported);
        if (!FILE_OPERATIONS.test(imported)) issue("missing_evidence", `${file.path}: filesystem API ${imported} is outside modeled file operations.`);
      }
    };
    // Collect bindings before walking bodies, since ESM imports are hoisted.
    const collectFsBindings = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^(?:node:)?fs(?:\/promises)?$/.test(node.moduleSpecifier.text)) {
        if (node.importClause?.name) fsNamespaces.add(node.importClause.name.text);
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) fsNamespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) bindFsName(binding.name.text, (binding.propertyName ?? binding.name).text);
      }
      if (ts.isVariableDeclaration(node) && node.initializer && isFsRequire(node.initializer)) {
        if (ts.isIdentifier(node.name)) fsNamespaces.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) for (const binding of node.name.elements) if (ts.isIdentifier(binding.name)) bindFsName(binding.name.text, binding.propertyName && ts.isIdentifier(binding.propertyName) ? binding.propertyName.text : literal(binding.propertyName) ?? binding.name.text);
      }
      ts.forEachChild(node, collectFsBindings);
    };
    collectFsBindings(sf);
    const checkImport = (specifier: string) => {
      if (UNSUPPORTED_BUILTINS.test(specifier)) { issue("contract_exception", `${file.path}: ${specifier} exposes external, environment or dynamic execution behavior.`); return; }
      if (SUPPORTED_BUILTINS.has(specifier.replace(/^node:/, ""))) return;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) { issue("missing_evidence", `${file.path}: import ${specifier} is not an accounted-for supported standard-library or local module.`); return; }
      const target = posix.normalize(posix.join(posix.dirname(file.path), specifier));
      if (!relativeFile(target)) { issue("out_of_scope", `${file.path}: import ${specifier} leaves the submitted source.`); return; }
      if (!RUNNABLE.test(target) && !target.endsWith(".json")) { issue("out_of_scope", `${file.path}: import ${specifier} needs unsupported executable or module resolution.`); return; }
      if (!files.has(target)) issue("missing_evidence", `${file.path}: imported local file ${target} is missing from the analyzed source.`);
      else if (target.endsWith(".json")) {
        try { JSON.parse(files.get(target)!); localFileOperation = true; }
        catch { issue("missing_evidence", `${target}: imported JSON cannot be parsed.`); }
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) issue("out_of_scope", `${file.path}: TypeScript-only syntax is not runnable under this JavaScript contract.`);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) {
        const value = literal(node.initializer);
        if (value !== undefined) stringConsts.set(node.name.text, value);
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          checkImport(node.moduleSpecifier.text);
        }
      }
      if (ts.isIdentifier(node) && ["fetch", "WebSocket", "XMLHttpRequest", "EventSource", "eval", "Function", "Deno", "Bun"].includes(node.text)) issue("contract_exception", `${file.path}: ${node.text} exposes network or dynamic execution behavior.`);
      if (ts.isIdentifier(node) && node.text === "process" && !((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node)) issue("contract_exception", `${file.path}: indirect process access needs review.`);
      if (ts.isIdentifier(node) && (fsNamespaces.has(node.text) || fsAliases.has(node.text))) {
        const parent = node.parent;
        const declaration = ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isBindingElement(parent) || (ts.isVariableDeclaration(parent) && parent.name === node);
        const propertyKey = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
        const directUse = fsNamespaces.has(node.text) ? ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) : ts.isCallExpression(parent) && parent.expression === node;
        if (!declaration && !propertyKey && !directUse) issue("missing_evidence", `${file.path}: filesystem binding ${node.text} escapes direct file-target analysis.`);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const name = ts.isPropertyAccessExpression(node) ? node.name.text : literal(node.argumentExpression);
        const base = node.expression;
        if (ts.isIdentifier(base) && base.text === "process" && (name === undefined || ["env", "binding", "dlopen", "getBuiltinModule", "mainModule"].includes(name))) issue("contract_exception", `${file.path}: process.${name ?? "<computed>"} exposes environment or dynamic execution behavior.`);
        if (ts.isIdentifier(base) && ["global", "globalThis"].includes(base.text) && (name === undefined || ["fetch", "WebSocket", "eval", "Function", "process"].includes(name))) issue("contract_exception", `${file.path}: indirect global access needs review.`);
        if (isFsNamespace(base)) {
          const directCall = ts.isCallExpression(node.parent) && node.parent.expression === node;
          const namespaceAccess = name === "promises" && (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node;
          if (!namespaceAccess && (name === undefined || !FILE_OPERATIONS.test(name) || !directCall)) issue("missing_evidence", `${file.path}: filesystem API ${name ?? "<computed>"} is unmodeled or escapes direct file-target analysis.`);
        }
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) issue("contract_exception", `${file.path}: dynamic import needs review.`);
        if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          const arg = node.arguments[0];
          if (node.arguments.length !== 1 || !arg || !ts.isStringLiteral(arg)) issue("contract_exception", `${file.path}: computed require needs review.`);
          else checkImport(arg.text);
        }
        const name = ts.isIdentifier(node.expression) ? fsAliases.get(node.expression.text) : (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && isFsNamespace(node.expression.expression) ? propertyName(node.expression) : undefined;
        if (name && FILE_OPERATIONS.test(name)) {
          const count = TWO_PATH_OPERATIONS.test(name) ? 2 : 1;
          for (let index = 0; index < count; index++) {
            const target = literal(node.arguments[index]);
            if (target === undefined) issue("missing_evidence", `${file.path}: ${name} file target is not a static local path.`);
            else if (!relativeFile(target) || /^[a-z][a-z0-9+.-]*:/i.test(target)) issue("contract_exception", `${file.path}: ${name} accesses a path outside the local-file contract.`);
            else localFileOperation = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (!localFileOperation) issue("missing_evidence", "No supported local file input/output operation was established from source.");
  const applicability: JobContractApplicability = ["out_of_scope", "contract_exception", "missing_evidence"].find((category) => issues.some((entry) => entry.category === category)) as JobContractApplicability ?? "eligible";
  const eligible = applicability === "eligible";
  const labels = { eligible: "Eligible", out_of_scope: "Out of scope", missing_evidence: "Missing evidence", contract_exception: "Contract exception" };
  return {
    contractId: "local-node-file-job/v1",
    eligible,
    applicability,
    finding: {
      key: "job-contract",
      title: `Local Node.js file-job contract: ${labels[applicability]}`,
      status: eligible ? "pass" : "warn",
      severity: eligible ? "info" : "warn",
      details: (eligible ? "The submitted source and recorded passing tests fit local-node-file-job/v1: standard-library JavaScript, local file I/O, no declared or observed external services, explicit timeout <=60 seconds, zero retries and no overlapping runs." : [...new Set(issues.map((entry) => `[${labels[entry.category]}] ${entry.reason}`))].join("\n")) + "\nThis is conservative static eligibility evidence, not a sandbox, security certification or proof of business correctness. Existing security and risk findings still apply.",
    },
  };
}
