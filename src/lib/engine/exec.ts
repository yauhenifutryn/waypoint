import { exec } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Honest isolation: child_process execution with timeout and minimal env.
 *  NOT a sandbox. Docker-hardened mode is an optional backend for the
 *  enterprise build; the UI labels this executor accordingly. */

export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
}

const TAIL = 8000;

export function runCommand(opts: {
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = exec(opts.command, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 60_000,
      killSignal: "SIGTERM",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        CI: "1",
        ...opts.env,
      } as NodeJS.ProcessEnv,
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    const finish = (exitCode: number | null, timedOut: boolean) =>
      resolve({
        exitCode,
        timedOut,
        stdoutTail: out.slice(-TAIL),
        stderrTail: err.slice(-TAIL),
        durationMs: Date.now() - started,
      });
    child.on("error", () => finish(null, false));
    child.on("close", (code) => finish(code, (Date.now() - started) >= (opts.timeoutMs ?? 60_000) - 50 && code === null));
  });
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "out", ".next"]);
const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|zip|tar|gz|bz2|7z|pdf|docx?|xlsx?|pptx?|dylib|so|exe|dll|node|wasm|class|jar)$/i;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 2000;

/**
 * Collects every text file (not just code) so the secret scanner sees .env,
 * .yaml, .json, .sh, .sql etc. The AST analyzer filters to code internally.
 */
export function collectSourceFiles(dir: string, baseDir: string = dir): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const walk = (d: string): void => {
    if (results.length >= MAX_FILES) return;
    for (const entry of readdirSync(d)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (!BINARY_EXTENSIONS.test(entry) && st.size <= MAX_FILE_BYTES) {
        try {
          results.push({ path: relative(baseDir, full), content: readFileSync(full, "utf8") });
        } catch {
          /* unreadable or binary-content file skipped */
        }
      }
    }
  };
  walk(dir);
  return results;
}
