import type {
  ApprovalRecord,
  Finding,
  ObservedProfile,
  RiskAssessment,
  SmallSoftwareManifest,
  Tier,
} from "./types";

/**
 * Deterministic risk rubric. Every point is traceable to a reason string so
 * the review UI can show WHY a tier was assigned. Floors exist for classes of
 * concern that raw score should never be able to talk its way out of.
 */

const PII_CLASSES = new Set(["pii", "personal", "hr", "health"]);
const SENSITIVE_CLASSES = new Set(["finance", "confidential", "restricted"]);

export function assessRisk(
  manifest: SmallSoftwareManifest,
  observed: ObservedProfile,
  findings: Finding[],
): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];
  const floors: Array<{ tier: Tier; why: string }> = [];

  // runtime kind baseline
  if (manifest.kind === "job") {
    score += 2;
    reasons.push("+2 scheduled job runs unattended");
  } else if (manifest.kind === "service") {
    score += 2;
    reasons.push("+2 long-running service");
    if ((manifest.spec.service?.restartPolicy ?? "on-failure") === "always") {
      score += 1;
      reasons.push("+1 always-on restart policy");
    }
  }

  // data sensitivity
  let hasWriteAccess = false;
  for (const r of manifest.resources ?? []) {
    const cls = (r.classification ?? "").toLowerCase();
    if (PII_CLASSES.has(cls)) {
      score += 4;
      reasons.push(`+4 resource "${r.name}" classified ${cls}`);
    } else if (SENSITIVE_CLASSES.has(cls)) {
      score += 2;
      reasons.push(`+2 resource "${r.name}" classified ${cls}`);
    }
    if (r.access === "write") hasWriteAccess = true;
  }

  // blast radius
  const br = manifest.blastRadius ?? {};
  // shared-state writes are ONE concern charged once, whether declared via
  // blastRadius or implied by resource-level write access
  if (br.writesSharedState || hasWriteAccess) {
    score += 3;
    reasons.push("+3 writes shared state");
    floors.push({ tier: 2, why: "writes shared state" });
  }
  if (br.audience === "department") {
    score += 1;
    reasons.push("+1 department-wide audience");
  } else if (br.audience === "company") {
    score += 3;
    reasons.push("+3 company-wide audience");
  }
  if (manifest.riskAttestation?.externallyVisible) {
    score += 3;
    reasons.push("+3 externally visible");
  }

  // autonomy: schedule frequency
  const cron = manifest.spec.job?.schedule?.cron;
  if (cron) {
    score += 1;
    reasons.push("+1 scheduled autonomy");
    const parts = cron.trim().split(/\s+/);
    if (parts.length === 5 && parts.slice(0, 2).some((p) => p === "*" || p.startsWith("*/"))) {
      score += 1;
      reasons.push("+1 sub-daily frequency");
    }
  }

  // egress surface
  const egressCount = manifest.egress?.length ?? 0;
  if (egressCount > 0) {
    score += 1;
    reasons.push(`+1 declares ${egressCount} egress host${egressCount > 1 ? "s" : ""}`);
    if (egressCount > 3) {
      score += 1;
      reasons.push("+1 broad egress (>3 hosts)");
    }
  }

  // observed dangerous behavior
  if (observed.evalUses.length > 0 || observed.dynamicImports.length > 0) {
    score += 3;
    reasons.push("+3 dynamic code evaluation observed");
  }
  if (observed.processExecCalls.length > 0) {
    score += 2;
    reasons.push("+2 shell execution observed");
  }
  if (observed.fsWritesOutsideWorkspace.length > 0) {
    score += 2;
    reasons.push("+2 writes outside its workspace");
  }

  // tier from score
  const scoreTier: Tier = score >= 10 ? 3 : score >= 4 ? 2 : 1;

  // class floors that score cannot override
  const hasPii = (manifest.resources ?? []).some((r) => PII_CLASSES.has((r.classification ?? "").toLowerCase()));
  if (hasPii) floors.push({ tier: 3, why: "pii-classified data present" });
  if (
    observed.evalUses.length > 0 ||
    observed.processExecCalls.length > 0 ||
    observed.fsWritesOutsideWorkspace.length > 0
  ) {
    floors.push({ tier: 3, why: "dangerous runtime behavior observed" });
  }
  if (manifest.kind === "service" && ((manifest.resources?.length ?? 0) > 0 || egressCount > 0)) {
    floors.push({ tier: 2, why: "service with declared dependencies" });
  }

  const floorTier = floors.reduce<Tier>((max, f) => (f.tier > max ? f.tier : max), 1);
  const floorReason = floors.find((f) => f.tier === floorTier)?.why;

  // hard blocks
  const blockingKeys = findings.filter((f) => f.status === "fail").map((f) => f.key);
  const hardBlocked = blockingKeys.length > 0;

  return {
    score,
    tier: Math.max(scoreTier, floorTier) as Tier,
    reasons: floorReason && floorTier > scoreTier ? [...reasons, `floor: ${floorReason}`] : reasons,
    hardBlocked,
    blockingKeys: [...new Set(blockingKeys)],
  };
}

const TOLERATED_WARNINGS = new Set(["stale-declaration"]);

/** Standard-change pre-authorization: green-only shapes at tier 1. */
export function canAutoApprove(tier: Tier, hardBlocked: boolean, findings: Finding[]): boolean {
  if (tier !== 1 || hardBlocked) return false;
  return findings.every(
    (f) =>
      f.status !== "fail" &&
      f.status !== "error" &&
      (f.status !== "warn" || TOLERATED_WARNINGS.has(f.key)),
  );
}
