import { describe, it, expect } from "vitest";
import { assessRisk } from "./risk";
import type { SmallSoftwareManifest, Finding, ObservedProfile } from "./types";
import { emptyObservedProfile } from "./types";

const baseManifest: SmallSoftwareManifest = {
  apiVersion: "smallsoftware/v0.1",
  kind: "static",
  metadata: { name: "info-page", owner: "a@b.c", purpose: "Static informational page listing team on-call rotations." },
  spec: { static: { publishPath: "dist" } },
};

const finding = (over: Partial<Finding>): Finding => ({
  key: "x",
  title: "x",
  status: "pass",
  severity: "info",
  details: "",
  ...over,
});

describe("assessRisk", () => {
  it("clean static page scores tier 1", () => {
    const r = assessRisk(baseManifest, emptyObservedProfile(), []);
    expect(r.tier).toBe(1);
    expect(r.hardBlocked).toBe(false);
  });

  it("job with finance-classified write resource reaches at least tier 2", () => {
    const m: SmallSoftwareManifest = {
      ...baseManifest,
      kind: "job",
      metadata: { ...baseManifest.metadata, name: "rec" },
      spec: { job: { entrypoint: "i.ts", startCommand: "node i.mjs" } },
      resources: [{ name: "fin", type: "file-share", access: "write", classification: "finance", path: "//fs/fin" }],
      blastRadius: { writesSharedState: true },
    };
    const r = assessRisk(m, emptyObservedProfile(), []);
    expect(r.tier).toBeGreaterThanOrEqual(2);
    expect(r.reasons.join(" ")).toMatch(/writes shared state/i);
  });

  it("pii resource forces tier 3 regardless of score", () => {
    const m: SmallSoftwareManifest = {
      ...baseManifest,
      kind: "job",
      spec: { job: { entrypoint: "i.ts", startCommand: "node i.mjs" } },
      resources: [{ name: "hr", type: "postgres", access: "read", classification: "pii", endpoint: "db:5432" }],
    };
    const r = assessRisk(m, emptyObservedProfile(), []);
    expect(r.tier).toBe(3);
  });

  it("dangerous behavior (eval / exec / outside writes) raises floor to 3", () => {
    const obs: ObservedProfile = {
      ...emptyObservedProfile(),
      evalUses: ["a.ts@1"],
      processExecCalls: ["exec@a.ts"],
      fsWritesOutsideWorkspace: ["/etc"],
    };
    const r = assessRisk(baseManifest, obs, []);
    expect(r.tier).toBe(3);
  });

  it("critical failed finding blocks hard", () => {
    const r = assessRisk(baseManifest, emptyObservedProfile(), [
      finding({ status: "fail", severity: "critical", key: "secret-aws-access-key" }),
    ]);
    expect(r.hardBlocked).toBe(true);
    expect(r.blockingKeys).toContain("secret-aws-access-key");
  });

  it("company-wide externally visible service accumulates score into tier 3", () => {
    const m: SmallSoftwareManifest = {
      ...baseManifest,
      kind: "service",
      spec: { service: { entrypoint: "s.ts", startCommand: "node s.mjs", port: 8080, healthCheckPath: "/healthz" } },
      blastRadius: { audience: "company" },
      riskAttestation: { externallyVisible: true },
      egress: [{ host: "a.example" }, { host: "b.example" }, { host: "c.example" }, { host: "d.example" }],
    };
    const r = assessRisk(m, emptyObservedProfile(), []);
    expect(r.score).toBeGreaterThanOrEqual(10);
    expect(r.tier).toBe(3);
  });
});
