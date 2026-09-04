import { describe, it, expect } from "vitest";
import type { SmallSoftwareManifest } from "../types";
import { compareDeclaredVsObserved } from "./resources";

const baseManifest: SmallSoftwareManifest = {
  apiVersion: "smallsoftware/v0.1",
  kind: "job",
  metadata: {
    name: "reconciler",
    owner: "ops@firm.example",
    purpose: "Nightly reconciliation of issued invoices against settlement exports.",
  },
  spec: { job: { entrypoint: "src/index.ts", startCommand: "node index.mjs" } },
  resources: [
    { name: "settlements", type: "file-share", access: "read", path: "//example.invalid/demo/settlements" },
    { name: "invoices-db", type: "postgres", access: "read", endpoint: "postgres.example.invalid:5432" },
  ],
  egress: [{ host: "hooks.example.invalid" }],
  env: [
    { name: "SETTLEMENTS_DIR", valueFromResource: "settlements" },
    { name: "INVOICES_DB_URL", source: "minted" },
    { name: "LOG_LEVEL", value: "info" },
  ],
};

describe("compareDeclaredVsObserved", () => {
  it("passes clean when observed usage is a subset of declarations", () => {
    const r = compareDeclaredVsObserved(baseManifest, {
      connectionStrings: [{ type: "postgres", host: "postgres.example.invalid", raw: "x" }],
      fsReadsAbsolute: ["//example.invalid/demo/settlements/2026-08/invoices.csv"],
      urlHosts: ["hooks.example.invalid"],
      envVarsRead: ["INVOICES_DB_URL", "LOG_LEVEL"],
    });
    expect(r.hardViolations).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("hard-fails on undeclared database connection", () => {
    const r = compareDeclaredVsObserved(baseManifest, {
      connectionStrings: [{ type: "postgres", host: "shadow-db.firm.example", raw: "x" }],
    });
    expect(r.hardViolations.map((v) => v.key)).toContain("undeclared-resource");
  });

  it("hard-fails on undeclared egress host", () => {
    const r = compareDeclaredVsObserved(baseManifest, { urlHosts: ["api.stripe.com"] });
    expect(r.hardViolations.map((v) => v.key)).toContain("undeclared-egress");
  });

  it("warns on undeclared env reads", () => {
    const r = compareDeclaredVsObserved(baseManifest, { envVarsRead: ["MY_TOKEN"] });
    expect(r.warnings.map((v) => v.key)).toContain("undeclared-env-read");
  });

  it("hard-fails on file writes outside workspace when none declared writable", () => {
    const r = compareDeclaredVsObserved(baseManifest, {
      fsWritesOutsideWorkspace: ["/srv/shared/report.csv"],
    });
    expect(r.hardViolations.map((v) => v.key)).toContain("undeclared-write");
  });

  it("warns on stale declarations (declared but never observed)", () => {
    const r = compareDeclaredVsObserved(baseManifest, {});
    expect(r.warnings.map((v) => v.key)).toContain("stale-declaration");
  });
});
