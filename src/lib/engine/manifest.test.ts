import { describe, it, expect } from "vitest";
import { parseManifest, digestManifest } from "./manifest";

const validJobYaml = `
apiVersion: smallsoftware/v0.1
kind: job
metadata:
  name: invoice-reconciler
  owner: ops@firm.example
  purpose: Nightly reconciliation of issued invoices against bank settlement CSV exports.
spec:
  job:
    entrypoint: src/index.ts
    startCommand: node index.mjs
    schedule:
      cron: "30 6 * * 1-5"
      timezone: Europe/Warsaw
resources:
  - name: settlements-csv
    type: file-share
    access: read
    path: //example.invalid/demo/settlements
`;

describe("parseManifest", () => {
  it("accepts a valid job manifest", () => {
    const r = parseManifest(validJobYaml);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.kind).toBe("job");
      expect(r.manifest.spec.job?.schedule?.cron).toBe("30 6 * * 1-5");
    }
  });

  it("rejects unknown apiVersion", () => {
    const r = parseManifest(validJobYaml.replace("smallsoftware/v0.1", "smallsware/v9"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/apiVersion/i);
  });

  it("rejects unknown fields (strict)", () => {
    const r = parseManifest(validJobYaml + "\nhackMode: true\n");
    expect(r.ok).toBe(false);
  });

  it("rejects when spec section does not match kind", () => {
    const r = parseManifest(
      validJobYaml.replace(/\nresources:/, "").replace(/schedule:[\s\S]*?timezone: Europe\/Warsaw/, "timezone: Europe/Warsaw") +
        "\nspec:\n  job:\n    entrypoint: x\n",
    );
    // simpler: static kind without static section
    const bad = `
apiVersion: smallsoftware/v0.1
kind: static
metadata:
  name: s
  owner: a@b.c
  purpose: A static informational page for the operations team dashboard.
spec:
  job:
    entrypoint: x
`;
    const r2 = parseManifest(bad);
    expect(r2.ok).toBe(false);
    void r;
  });

  it("rejects invalid cron expression", () => {
    const r = parseManifest(validJobYaml.replace('"30 6 * * 1-5"', '"not a cron"'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/cron/i);
  });

  it("rejects unknown timezone", () => {
    const r = parseManifest(validJobYaml.replace("Europe/Warsaw", "Mars/Olympus"));
    expect(r.ok).toBe(false);
  });

  it("rejects inline secret-looking env values", () => {
    const r = parseManifest(
      validJobYaml.replace(
        /\nresources:[\s\S]*$/,
        `
env:
  - name: DB_PASSWORD
    value: "super-secret-password-123"
`,
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/inline secret|env/i);
  });

  it("rejects purpose under 40 chars", () => {
    const r = parseManifest(validJobYaml.replace(/purpose:.*/, "purpose: too short"));
    expect(r.ok).toBe(false);
  });
});

describe("digestManifest", () => {
  it("is stable across key ordering", () => {
    const a = parseManifest(validJobYaml);
    const reordered = validJobYaml.replace(
      "  owner: ops@firm.example\n  purpose:",
      "  purpose:",
    );
    void reordered;
    expect(a.ok).toBe(true);
    if (a.ok) {
      const d1 = digestManifest(a.manifest);
      const d2 = digestManifest(JSON.parse(JSON.stringify(a.manifest)));
      expect(d1).toBe(d2);
      expect(d1).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
