import { describe, it, expect } from "vitest";
import { validateSource } from "./pipeline";
import { join } from "node:path";

const SAMPLES = join(process.cwd(), "samples");

describe("validateSource against the sample fleet", () => {
  it("weekly-ops-report: Tier 1 static site requires review outside the local job contract", async () => {
    const r = await validateSource(join(SAMPLES, "weekly-ops-report"));
    expect(r.ok).toBe(true);
    expect(r.risk?.tier).toBe(1);
    expect(r.autoApproveEligible).toBe(false);
    expect(r.findings.find((f) => f.key === "job-contract")).toMatchObject({ status: "warn" });
    expect(r.findings.find((f) => f.key === "job-contract")?.details).toContain("Out of scope");
    expect(r.risk?.hardBlocked).toBe(false);
  }, 60_000);

  it("team-report-job: recorded passing tests and local-file contract permit automatic approval", async () => {
    const r = await validateSource(join(SAMPLES, "team-report-job"));
    expect(r.ok).toBe(true);
    expect(r.risk?.hardBlocked).toBe(false);
    expect(r.autoApproveEligible).toBe(true);
    expect(r.findings.find((f) => f.key === "tests")?.status).toBe("pass");
    expect(r.findings.find((f) => f.key === "job-contract")?.status).toBe("pass");
  }, 60_000);

  it("invoice-reconciler: Tier 2, not blocked, tests pass", async () => {
    const r = await validateSource(join(SAMPLES, "invoice-reconciler"));
    expect(r.ok).toBe(true);
    expect(r.risk?.hardBlocked).toBe(false);
    expect(r.risk?.tier).toBeGreaterThanOrEqual(2);
    const tests = r.findings.find((f) => f.key === "tests");
    expect(tests?.status).toBe("pass");
    // finance classification present in reasons
    expect(r.risk?.reasons.join(" ")).toMatch(/finance/);
  }, 90_000);

  it("stock-lookup-api: Tier >= 2 with egress declared and observed consistently", async () => {
    const r = await validateSource(join(SAMPLES, "stock-lookup-api"));
    expect(r.ok).toBe(true);
    expect(r.risk?.hardBlocked).toBe(false);
    expect(["pass", undefined]).toContain(r.findings.find((f) => f.key === "undeclared-egress")?.status ?? "pass");
    expect(r.risk?.tier).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it("customer-export: hard-blocked with secret, undeclared resource/egress/write findings", async () => {
    const r = await validateSource(join(SAMPLES, "customer-export"));
    expect(r.ok).toBe(true);
    expect(r.risk?.hardBlocked).toBe(true);
    const keys = new Set(r.findings.filter((f) => f.status === "fail").map((f) => f.key));
    expect(keys.has("secret-aws-access-key")).toBe(true);
    expect(keys.has("undeclared-resource")).toBe(true);
    expect(keys.has("undeclared-egress")).toBe(true);
    expect(keys.has("undeclared-write")).toBe(true);
    expect(r.anomalies?.length).toBeGreaterThanOrEqual(1);
  }, 90_000);

  it("alteryx-parity-checker: parses with provenance, parity tests pass", async () => {
    const r = await validateSource(join(SAMPLES, "alteryx-parity-checker"));
    expect(r.ok).toBe(true);
    expect(r.manifest?.metadata.provenance?.migratedFrom).toBe("alteryx/yxmd");
    expect(r.risk?.hardBlocked).toBe(false);
    expect(r.findings.find((f) => f.key === "tests")?.status).toBe("pass");
    expect(r.packetMd).toMatch(/Provenance/);
  }, 90_000);
});
