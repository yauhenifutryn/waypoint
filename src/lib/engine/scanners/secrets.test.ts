import { describe, it, expect } from "vitest";
import { scanForSecrets } from "./secrets";

describe("scanForSecrets", () => {
  it("flags an AWS access key with file and line evidence", () => {
    const files = [{ path: "src/index.ts", content: "const a = 1;\nconst cfg = 'AKIAIOSFODNN7EXAMPLE';" }];
    const f = scanForSecrets(files);
    expect(f.length).toBe(1);
    expect(f[0].evidence?.[0]).toContain("src/index.ts:2");
    expect(f[0].severity).toBe("critical");
    // value redacted in evidence
    expect(f[0].details).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("flags github / slack / google patterns", () => {
    // Synthetic shape-only fixtures, generated here rather than storing token-like literals.
    const github = 'ghp_' + '0'.repeat(36);
    const slack = ['xoxb', '0'.repeat(12), '0'.repeat(13), 'a'.repeat(24)].join('-');
    const google = 'AIza' + '0'.repeat(35);
    const files = [
      {
        path: "a.ts",
        content:
          `token = '${github}'\nslack='${slack}'\ngk='${google}'`,
      },
    ];
    const f = scanForSecrets(files);
    expect(f.length).toBe(3);
  });

  it("flags private key blocks", () => {
    const files = [
      { path: "key.pem", content: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\n-----END RSA PRIVATE KEY-----" },
    ];
    const f = scanForSecrets(files);
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag process.env reads or placeholders", () => {
    const files = [
      {
        path: "b.ts",
        content:
          "const pw = process.env.DB_PASSWORD;\nconst placeholder = 'your-api-key-here';\nconst tpl = `\${secrets.dbPassword}`;",
      },
    ];
    expect(scanForSecrets(files)).toHaveLength(0);
  });

  it("flags high-entropy generic assignments", () => {
    const files = [
      { path: "c.ts", content: "const cfg = { password: '9f86d081884c7d659a2feaa0c55ad015' };" },
    ];
    const f = scanForSecrets(files);
    expect(f.length).toBe(1);
    expect(f[0].key).toMatch(/generic/);
  });

  it("ignores low-signal generic assignments (short/low entropy)", () => {
    const files = [{ path: "d.ts", content: "const mode = 'password';\nlet label = 'secret-name';" }];
    expect(scanForSecrets(files)).toHaveLength(0);
  });
});
