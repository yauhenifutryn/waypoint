import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getDb, audit, ARTIFACTS_DIR } from "@/lib/db";
import { validateSource } from "@/lib/engine/pipeline";
import { canAutoApprove, canTransition, evaluateApprovals, type VersionState } from "@/lib/engine/promotion";
import { mintLease, scopesFromManifest } from "@/lib/engine/identity";
import type { Role, SmallSoftwareManifest, Tier } from "@/lib/engine/types";

function setState(versionId: string, next: VersionState): void {
  const db = getDb();
  const cur = db.prepare("SELECT status FROM versions WHERE id = ?").get(versionId) as { status: VersionState };
  if (!canTransition(cur.status, next)) {
    throw new Error(`Illegal transition ${cur.status} -> ${next} for version ${versionId}`);
  }
  db.prepare("UPDATE versions SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, versionId);
}

export interface SubmitResult {
  appId: string;
  versionId: string;
  slug: string;
  outcomeStatus: VersionState;
  tier: Tier;
}

/** Intake: copy source into artifact store, validate deterministically, persist. */
export async function submitFromSource(params: {
  slug?: string;
  name?: string;
  sourcePath: string;
  actorLabel: string;
}): Promise<SubmitResult> {
  const db = getDb();
  const outcome = await validateSource(params.sourcePath);
  if (!outcome.ok || !outcome.manifest || !outcome.risk || !outcome.digest) {
    throw Object.assign(new Error("Validation failed"), { validationErrors: outcome.errors ?? ["unknown"] });
  }
  const m = outcome.manifest;
  const slug =
    params.slug ??
    m.metadata.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  let appId = (db.prepare("SELECT id FROM apps WHERE slug = ?").get(slug) as { id: string } | undefined)?.id;
  if (!appId) {
    appId = randomUUID();
    db.prepare(
      "INSERT INTO apps (id, slug, name, kind, owner_email, purpose, status, tier) VALUES (?,?,?,?,?,?,?,?)",
    ).run(appId, slug, params.name ?? m.metadata.name, m.kind, m.metadata.owner, m.metadata.purpose, "active", outcome.risk.tier);
  }

  // artifact copy (version snapshot)
  const versionId = randomUUID();
  const versionDir = path.join(ARTIFACTS_DIR, slug, versionId.slice(0, 8));
  mkdirSync(path.dirname(versionDir), { recursive: true });
  cpSync(params.sourcePath, versionDir, { recursive: true });

  db.prepare(
    `INSERT INTO versions (id, app_id, label, source_dir, manifest_json, manifest_digest, submitted_by,
      status, risk_score, risk_reasons_json, packet_md, anomalies_json)
     VALUES (?,?,?,?,?,?,?, 'submitted', ?,?,?,?)`,
  ).run(
    versionId,
    appId,
    new Date().toISOString().slice(0, 10) + "-" + versionId.slice(0, 4),
    versionDir,
    JSON.stringify(m),
    outcome.digest,
    params.actorLabel,
    outcome.risk.score,
    JSON.stringify(outcome.risk.reasons),
    outcome.packetMd ?? null,
    JSON.stringify(outcome.anomalies ?? []),
  );
  // rows start at 'submitted'; validation begins immediately
  setState(versionId, "validating");

  const insertCheck = db.prepare(
    "INSERT INTO checks (version_id, key, title, status, severity, details, evidence_json) VALUES (?,?,?,?,?,?,?)",
  );
  for (const f of outcome.findings) {
    insertCheck.run(versionId, f.key, f.title, f.status, f.severity, f.details, JSON.stringify(f.evidence ?? []));
  }

  // decide post-validation state
  let nextState: VersionState;
  if (outcome.risk.hardBlocked) {
    nextState = "blocked";
  } else if (canAutoApprove(outcome.risk.tier, false, outcome.findings)) {
    nextState = "approved";
    db.prepare(
      "INSERT INTO reviews (id, version_id, role, actor_label, decision, note, auto) VALUES (?,?,?,?,?,?,1)",
    ).run(randomUUID(), versionId, "platform_reviewer", "policy-engine", "approved", "Standard-change template match: all checks green, tier 1 pre-authorized.");
  } else {
    nextState = "needs_review";
  }
  setState(versionId, nextState);

  // keep app tier in lockstep with the freshest validation — a resubmission
  // that crosses a class floor must re-derive approval requirements
  db.prepare("UPDATE apps SET current_version_id = ?, kind = ?, tier = ?, updated_at = datetime('now') WHERE id = ?").run(versionId, m.kind, outcome.risk.tier, appId);
  audit({
    actorRole: "owner",
    actorLabel: params.actorLabel,
    action: "version_submitted",
    subjectType: "version",
    subjectId: versionId,
    summary: `${slug}: submitted, tier ${outcome.risk.tier}, score ${outcome.risk.score} -> ${nextState}`,
    payload: { findings: outcome.findings.map((f) => ({ key: f.key, status: f.status })) },
  });

  return { appId, versionId, slug, outcomeStatus: nextState, tier: outcome.risk.tier };
}

export function actOnVersion(params: {
  versionId: string;
  action: "approve" | "reject";
  role: Role;
  actorLabel: string;
  note?: string;
}): void {
  const db = getDb();
  const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(params.versionId) as
    | { id: string; app_id: string; status: VersionState; manifest_json: string }
    | undefined;
  if (!v) throw new Error("Version not found");

  if (params.role === "owner" || params.role === "auditor") {
    throw new Error("Separation of duties: owners cannot review their own submissions");
  }
  const approverRole = params.role === "security_reviewer" ? "security_reviewer" : "platform_reviewer";

  const decision = params.action === "approve" ? "approved" : "rejected";
  db.prepare(
    "INSERT INTO reviews (id, version_id, role, actor_label, decision, note, auto) VALUES (?,?,?,?,?,?,0)",
  ).run(randomUUID(), v.id, approverRole, params.actorLabel, decision, params.note ?? null);

  if (params.action === "reject") {
    setState(v.id, "rejected");
    audit({
      actorRole: params.role, actorLabel: params.actorLabel, action: "version_rejected",
      subjectType: "version", subjectId: v.id, summary: `${v.id}: rejected. ${params.note ?? ""}`,
    });
    return;
  }

  const approvals = db.prepare("SELECT * FROM reviews WHERE version_id = ?").all(v.id) as Array<{
    role: string; decision: string; actor_label: string; auto: number; at: string;
  }>;
  const appTier = (db.prepare("SELECT tier FROM apps WHERE id = ?").get(v.app_id) as { tier: Tier }).tier;
  const mapped = approvals.map((a) => ({
    role: a.role as "platform_reviewer" | "security_reviewer",
    actorLabel: a.actor_label,
    decision: a.decision as "approved" | "rejected",
    auto: Boolean(a.auto),
    at: a.at,
  }));
  const evaluation = evaluateApprovals(appTier, mapped);
  if (evaluation.satisfied) {
    setState(v.id, "approved");
    audit({
      actorRole: params.role, actorLabel: params.actorLabel, action: "version_approved",
      subjectType: "version", subjectId: v.id, summary: `${v.id}: all required approvals satisfied`,
    });
  } else {
    audit({
      actorRole: params.role, actorLabel: params.actorLabel, action: "approval_recorded",
      subjectType: "version", subjectId: v.id,
      summary: `${v.id}: awaiting ${evaluation.missingRoles.join(", ")}`,
    });
  }
}

// re-export for API-layer convenience
export { evaluateApprovals };

function digestManifestJson(manifestJson: string): string {
  return createHash("sha256").update(manifestJson).digest("hex");
}

export function requestDeploy(params: { versionId: string; role: Role; actorLabel: string }): { deploymentId: string } {
  const db = getDb();
  const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(params.versionId) as
    | { id: string; app_id: string; status: VersionState; source_dir: string; manifest_json: string }
    | undefined;
  if (!v) throw new Error("Version not found");
  if (!["approved", "live"].includes(v.status)) throw new Error(`Cannot deploy from state "${v.status}"`);
  if (!["platform_admin", "platform_reviewer"].includes(params.role)) {
    // deployment is a platform act; owners attest at submission and review time
    throw new Error("Only platform roles may deploy");
  }

  const m = JSON.parse(v.manifest_json) as SmallSoftwareManifest;
  const existing = db.prepare("SELECT * FROM deployments WHERE app_id = ?").get(v.app_id) as
    | { id: string; version_id: string; desired_state: string; artifact_dir: string }
    | undefined;

  let deploymentId: string;
  if (existing && existing.desired_state !== "retired") {
    // previous live version gets superseded
    if (existing.version_id !== v.id) {
      db.prepare("UPDATE versions SET status='superseded', updated_at=datetime('now') WHERE id=? AND status='live'").run(existing.version_id);
    }
    db.prepare(
      `UPDATE deployments SET version_id=?, desired_state='running', artifact_dir=?, cron_spec=?, timezone=?, kind=?, failure_count=0, updated_at=datetime('now') WHERE id=?`,
    ).run(v.id, v.source_dir, m.spec.job?.schedule?.cron ?? null, m.spec.job?.schedule?.timezone ?? null, m.kind, existing.id);
    deploymentId = existing.id;
  } else {
    deploymentId = randomUUID();
    db.prepare(
      `INSERT INTO deployments (id, app_id, version_id, kind, desired_state, actual_state, artifact_dir, cron_spec, timezone)
       VALUES (?,?,?,?,'running','stopped',?,?,?)`,
    ).run(deploymentId, v.app_id, v.id, m.kind, v.source_dir, m.spec.job?.schedule?.cron ?? null, m.spec.job?.schedule?.timezone ?? null);
  }

  // mint deploy lease bound to this version
  const lease = mintLease({
    appId: v.app_id,
    versionId: v.id,
    manifestDigest: digestManifestJson(v.manifest_json),
    scopes: scopesFromManifest(m),
    environment: "prod",
    ttlSeconds: 3600,
  });
  db.prepare("INSERT INTO leases (id, app_id, version_id, token, scopes_json, purpose, expires_at) VALUES (?,?,?,?,?,?,datetime('now','+1 hour'))")
    .run(randomUUID(), v.app_id, v.id, lease.token, JSON.stringify(scopesFromManifest(m)), "deploy");

  audit({
    actorRole: params.role, actorLabel: params.actorLabel, action: "deploy_requested",
    subjectType: "deployment", subjectId: deploymentId,
    summary: `deployment ${deploymentId.slice(0, 8)} -> version ${v.id.slice(0, 8)}, lease issued (${scopesFromManifest(m).length} scopes)`,
  });
  return { deploymentId };
}

export function stopDeployment(params: { appId: string; role: Role; actorLabel: string }): void {
  const db = getDb();
  const d = db.prepare("SELECT * FROM deployments WHERE app_id = ?").get(params.appId) as { id: string } | undefined;
  if (!d) throw new Error("No deployment for app");
  db.prepare("UPDATE deployments SET desired_state='stopped', updated_at=datetime('now') WHERE id=?").run(d.id);
  audit({
    actorRole: params.role, actorLabel: params.actorLabel, action: "deployment_stopped",
    subjectType: "deployment", subjectId: d.id, summary: `desired state -> stopped`,
  });
}

/** Rollback: redeploy the most recent PREVIOUSLY PROMOTED version. Hard-blocked
 *  or never-approved versions are not rollback targets — an emergency path
 *  cannot become a promotion bypass. Post-hoc ratification is recorded. */
const ROLLBACK_ELIGIBLE = "('live', 'superseded', 'approved')";
export function rollback(params: { appId: string; role: Role; actorLabel: string }): { rolledBackTo: string } {
  const db = getDb();
  if (!["platform_admin", "platform_reviewer"].includes(params.role)) {
    throw new Error("Only platform roles may roll back");
  }
  const app = db.prepare("SELECT * FROM apps WHERE id = ?").get(params.appId) as { current_version_id: string; slug: string };
  const candidates = db
    .prepare(
      `SELECT id, source_dir, status FROM versions WHERE app_id = ? AND id != ? AND status IN ${ROLLBACK_ELIGIBLE} ORDER BY created_at DESC`,
    )
    .all(params.appId, app.current_version_id) as Array<{ id: string; source_dir: string; status: string }>;
  const target = candidates.find((c) => existsSync(c.source_dir));
  if (!target) throw new Error("No previously promoted artifact available for rollback");

  // emergency change record: the rollback itself is the authorization event,
  // recorded as a non-auto review requiring post-hoc acknowledgement
  db.prepare(
    "INSERT INTO reviews (id, version_id, role, actor_label, decision, note, auto) VALUES (?,?,?,?,?,?,0)",
  ).run(randomUUID(), target.id, "platform_reviewer", params.actorLabel, "approved", `EMERGENCY ROLLBACK by ${params.role}: restore last known-good. Requires post-hoc ratification at next review.`);

  if (target.status !== "approved") {
    setState(target.id, "needs_review");
    setState(target.id, "approved");
  }
  audit({
    actorRole: params.role, actorLabel: params.actorLabel, action: "rollback",
    subjectType: "app", subjectId: params.appId,
    summary: `${app.slug}: rolled back to version ${target.id.slice(0, 8)} (post-hoc ratification required)`,
  });
  requestDeploy({ versionId: target.id, role: params.role, actorLabel: params.actorLabel });
  return { rolledBackTo: target.id };
}

export function recordRunFinished(params: {
  runId: string;
  status: "success" | "failed" | "timeout";
  exitCode: number | null;
}): void {
  const db = getDb();
  db.prepare("UPDATE runs SET status=?, exit_code=?, finished_at=datetime('now') WHERE id=?")
    .run(params.status, params.exitCode, params.runId);

  const run = db.prepare("SELECT d.* FROM runs r JOIN deployments d ON d.id = r.deployment_id WHERE r.id=?").get(params.runId) as
    | { id: string; app_id: string; version_id: string; desired_state: string }
    | undefined;
  if (!run) return;

  if (params.status === "success") {
    db.prepare("UPDATE deployments SET failure_count=0, actual_state='running', updated_at=datetime('now') WHERE id=?").run(run.id);
    db.prepare("UPDATE versions SET status='live', updated_at=datetime('now') WHERE id=? AND status IN ('deploying','approved')").run(run.version_id);
  } else {
    const failures = ((db.prepare("SELECT failure_count FROM deployments WHERE id=?").get(run.id) as { failure_count: number }).failure_count ?? 0) + 1;
    db.prepare("UPDATE deployments SET failure_count=?, updated_at=datetime('now') WHERE id=?").run(failures, run.id);
    if (failures >= 3 && run.desired_state === "running") {
      // standard-change revocation: repeated failure pulls pre-authorization
      db.prepare("UPDATE deployments SET desired_state='stopped', updated_at=datetime('now') WHERE id=?").run(run.id);
      try {
        setState(run.version_id, "needs_review");
      } catch {
        /* already in compatible state */
      }
      audit({
        actorRole: "policy-engine", actorLabel: "waypoint", action: "demoted",
        subjectType: "app", subjectId: run.app_id,
        summary: `3 consecutive failed runs: pre-authorization revoked, deployment stopped, human review required`,
      });
    }
  }
}
