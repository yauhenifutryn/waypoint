import { describe, it, expect } from "vitest";
import { requiredApprovers, evaluateApprovals, canAutoApprove } from "./promotion";
import type { ApprovalRecord, Finding } from "./types";

describe("requiredApprovers", () => {
  it("tier 1 needs nobody, tier 2 platform, tier 3 platform+security", () => {
    expect(requiredApprovers(1)).toEqual([]);
    expect(requiredApprovers(2)).toEqual(["platform_reviewer"]);
    expect(requiredApprovers(3)).toEqual(["platform_reviewer", "security_reviewer"]);
  });
});

describe("evaluateApprovals", () => {
  it("tier 2 satisfied by single platform approval", () => {
    const approvals: ApprovalRecord[] = [
      { role: "platform_reviewer", actorLabel: "Pia", decision: "approved", auto: false, at: "2026-08-26T00:00:00Z" },
    ];
    const r = evaluateApprovals(2, approvals);
    expect(r.satisfied).toBe(true);
  });

  it("tier 3 requires both roles", () => {
    const one: ApprovalRecord[] = [
      { role: "platform_reviewer", actorLabel: "Pia", decision: "approved", auto: false, at: "x" },
    ];
    expect(evaluateApprovals(3, one).satisfied).toBe(false);
    const both: ApprovalRecord[] = [...one, { role: "security_reviewer", actorLabel: "Sam", decision: "approved", auto: false, at: "x" }];
    expect(evaluateApprovals(3, both).satisfied).toBe(true);
  });

  it("any rejection blocks immediately", () => {
    const approvals: ApprovalRecord[] = [
      { role: "platform_reviewer", actorLabel: "Pia", decision: "rejected", auto: false, at: "x", note: "no" },
    ];
    const r = evaluateApprovals(1, approvals);
    expect(r.satisfied).toBe(false);
    expect(r.rejected).toBe(true);
  });
});

describe("canAutoApprove", () => {
  const okFinding = (over: Partial<Finding>): Finding => ({
    key: "k", title: "k", status: "pass", severity: "info", details: "", ...over,
  });

  it("tier 1 with green checks and tolerated warnings auto-approves", () => {
    const findings = [
      okFinding({ status: "warn", key: "stale-declaration", severity: "warn" }),
    ];
    expect(canAutoApprove(1, false, findings)).toBe(true);
  });

  it("tier 1 with an untolerated warning does NOT auto-approve", () => {
    const findings = [okFinding({ status: "warn", key: "undeclared-env-read", severity: "warn" })];
    expect(canAutoApprove(1, false, findings)).toBe(false);
  });

  it("tier 2 never auto-approves even when clean", () => {
    expect(canAutoApprove(2, false, [])).toBe(false);
  });

  it("anything blocked never auto-approves", () => {
    expect(canAutoApprove(1, true, [])).toBe(false);
  });
});
