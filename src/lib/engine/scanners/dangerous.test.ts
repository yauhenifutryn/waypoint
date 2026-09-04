import { describe, it, expect } from "vitest";
import { analyzeSource } from "./dangerous";

describe("analyzeSource", () => {
  it("counts eval and new Function uses", () => {
    const p = analyzeSource([
      { path: "a.ts", content: "eval('1+1'); const f = new Function('return 1');" },
    ]);
    expect(p.evalUses.length).toBe(2);
    expect(p.filesScanned).toBe(1);
  });

  it("captures outbound URL hosts", () => {
    const p = analyzeSource([
      { path: "a.ts", content: "await fetch('https://rates.example.invalid/latest?from=EUR');" },
    ]);
    expect(p.urlHosts).toContain("rates.example.invalid");
  });

  it("extracts connection strings with type and host, never raw secret material in profile", () => {
    const p = analyzeSource([
      {
        path: "db.ts",
        content:
          "const client = postgres('postgres://demo_user:demo_password@example.invalid:5432/invoices');",
      },
    ]);
    expect(p.connectionStrings.length).toBe(1);
    expect(p.connectionStrings[0].type).toBe("postgres");
    expect(p.connectionStrings[0].host).toBe("example.invalid");
  });

  it("detects child_process exec usage", () => {
    const p = analyzeSource([
      { path: "x.ts", content: "import { exec } from 'node:child_process'; exec('rm -rf /');" },
    ]);
    expect(p.processExecCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("detects absolute fs writes outside workspace", () => {
    const p = analyzeSource([
      {
        path: "w.ts",
        content:
          "import fs from 'node:fs';\nfs.writeFileSync('/etc/hosts', 'x');\nfs.writeFileSync('./out/report.csv', 'y');",
      },
    ]);
    expect(p.fsWritesOutsideWorkspace).toEqual(["/etc/hosts"]);
  });

  it("collects env var names read", () => {
    const p = analyzeSource([
      { path: "e.ts", content: "const a = process.env.SETTLEMENTS_DIR; const b = process.env['MY_TOKEN'];" },
    ]);
    expect(p.envVarsRead.sort()).toEqual(["MY_TOKEN", "SETTLEMENTS_DIR"]);
  });

  it("scans js/mjs files too and skips non-code extensions", () => {
    const p = analyzeSource([
      { path: "run.mjs", content: "eval('2')" },
      { path: "readme.md", content: "eval('should not count')" },
      { path: "data.json", content: '{"eval":"no"}' },
    ]);
    expect(p.filesScanned).toBe(1);
    expect(p.evalUses.length).toBe(1);
  });
});

describe("analyzeSource alias resolution", () => {
  it("resolves const-string aliases for fs write targets", () => {
    const p = analyzeSource([
      {
        path: "x.mjs",
        content:
          "const TARGET = '/srv/shared/export.csv';\nimport fs from 'node:fs';\nfs.writeFileSync(TARGET, 'data');",
      },
    ]);
    expect(p.fsWritesOutsideWorkspace).toEqual(["/srv/shared/export.csv"]);
  });

  it("resolves fs.promises.writeFile with alias", () => {
    const p = analyzeSource([
      { path: "y.mjs", content: "const P = '/etc/passwd';\nimport { writeFile } from 'node:fs/promises';\nawait fs.promises.writeFile(P, 'x');" },
    ]);
    expect(p.fsWritesOutsideWorkspace).toEqual(["/etc/passwd"]);
  });
});
