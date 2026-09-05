import { Cron } from "croner";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDb, LOGS_DIR } from "@/lib/db";
import type { SmallSoftwareManifest } from "@/lib/engine/types";

export interface AppRow {
  id: string;
  slug: string;
  name: string;
  kind: "static" | "job" | "service";
  owner_email: string;
  purpose: string;
  status: string;
  tier: number;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  app_id: string;
  label: string;
  source_dir: string;
  manifest_json: string;
  manifest_digest: string;
  submitted_by: string;
  status: string;
  risk_score: number | null;
  risk_tier: 1 | 2 | 3 | null;
  risk_reasons_json: string | null;
  packet_md: string | null;
  anomalies_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckRow {
  key: string;
  title: string;
  status: "pass" | "warn" | "fail" | "error";
  severity: "info" | "warn" | "critical";
  details: string;
  evidence_json: string | null;
}

export interface ReviewRow {
  role: string;
  actor_label: string;
  decision: "approved" | "rejected";
  note: string | null;
  auto: number;
  at: string;
}

export interface DeploymentRow {
  id: string;
  app_id: string;
  version_id: string;
  kind: string;
  desired_state: string;
  actual_state: string;
  port: number | null;
  cron_spec: string | null;
  timezone: string | null;
  pid: number | null;
  artifact_dir: string;
  health_json: string | null;
  failure_count: number;
  restarts_this_hour: number;
  updated_at: string;
}

export interface RunRow {
  id: string;
  deployment_id: string;
  trigger_type: string;
  status: string;
  exit_code: number | null;
  log_file: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface LeaseRow {
  token: string;
  scopes_json: string;
  purpose: string;
  issued_at: string;
  expires_at: string;
}

export interface AuditRow {
  ts: string;
  actor_role: string;
  actor_label: string;
  action: string;
  subject_type: string;
  subject_id: string;
  summary: string;
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function manifestOf(v: VersionRow | null): SmallSoftwareManifest | null {
  return parse<SmallSoftwareManifest | null>(v?.manifest_json, null);
}

export function nextCronRuns(spec: string | null, timezone: string | null, count: number): Date[] {
  if (!spec) return [];
  try {
    const job = new Cron(spec, { timezone: timezone ?? "UTC" });
    const out: Date[] = [];
    let cur = new Date();
    for (let i = 0; i < count; i++) {
      const d = job.nextRun(cur);
      if (!d) break;
      out.push(d);
      cur = d;
    }
    return out;
  } catch {
    return [];
  }
}

export interface DashboardStats {
  liveApps: number;
  pendingReviews: number;
  blocked: number;
  runs24h: { total: number; success: number; failed: number };
  funnel: Record<string, number>;
  recentAudit: AuditRow[];
}

const FUNNEL_ORDER = ["submitted", "validating", "needs_review", "approved", "deploying", "live"];
export const FUNNEL_STEPS = FUNNEL_ORDER;

export function getDashboardStats(): DashboardStats {
  const db = getDb();
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const liveApps = one("SELECT COUNT(DISTINCT app_id) AS n FROM deployments WHERE actual_state='running'");
  const pendingReviews = one("SELECT COUNT(*) AS n FROM versions WHERE status='needs_review'");
  const blocked = one(
    "SELECT COUNT(*) AS n FROM apps a JOIN versions v ON v.id=a.current_version_id WHERE v.status='blocked'",
  );
  const runs24h = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN status='success' THEN 1 ELSE 0 END),0) AS success,
         COALESCE(SUM(CASE WHEN status IN ('failed','timeout') THEN 1 ELSE 0 END),0) AS failed
       FROM runs WHERE started_at >= datetime('now','-1 day')`,
    )
    .get() as { total: number; success: number; failed: number };
  const funnelRows = db
    .prepare(
      "SELECT v.status AS s, COUNT(*) AS n FROM apps a JOIN versions v ON v.id=a.current_version_id GROUP BY v.status",
    )
    .all() as Array<{ s: string; n: number }>;
  const funnel: Record<string, number> = {};
  for (const r of funnelRows) funnel[r.s] = r.n;
  return {
    liveApps,
    pendingReviews,
    blocked,
    runs24h,
    funnel,
    recentAudit: getAudit({ limit: 12 }),
  };
}

export function listApps(filters: { kind?: string; status?: string } = {}): Array<{
  app: AppRow;
  versionStatus: string | null;
  versionLabel: string | null;
  riskScore: number | null;
}> {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.kind && ["static", "job", "service"].includes(filters.kind)) {
    clauses.push("a.kind = ?");
    params.push(filters.kind);
  }
  if (filters.status) {
    clauses.push("v.status = ?");
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT a.*, v.status AS vs, v.label AS vl, v.risk_score AS vr
       FROM apps a LEFT JOIN versions v ON v.id = a.current_version_id
       ${where} ORDER BY a.updated_at DESC`,
    )
    .all(...params) as Array<{
    id: string; slug: string; name: string; kind: string; owner_email: string; purpose: string; status: string;
    tier: number; current_version_id: string | null; created_at: string; updated_at: string;
    vs: string | null; vl: string | null; vr: number | null;
  }>;
  return rows.map((r) => ({
    app: { ...(r as unknown as AppRow), kind: r.kind as AppRow["kind"] },
    versionStatus: r.vs,
    versionLabel: r.vl,
    riskScore: r.vr,
  }));
}

export interface AppDetail {
  app: AppRow;
  currentVersion: VersionRow | null;
  manifest: SmallSoftwareManifest | null;
  checks: CheckRow[];
  reviews: ReviewRow[];
  versions: VersionRow[];
  deployment: DeploymentRow | null;
  runs: RunRow[];
  leases: LeaseRow[];
}

export function getAppDetail(slug: string): AppDetail | null {
  const db = getDb();
  const app = db.prepare("SELECT * FROM apps WHERE slug = ?").get(slug) as AppRow | undefined;
  if (!app) return null;
  const versions = db
    .prepare("SELECT * FROM versions WHERE app_id = ? ORDER BY created_at DESC")
    .all(app.id) as VersionRow[];
  const currentVersion = versions.find((v) => v.id === app.current_version_id) ?? versions[0] ?? null;
  let checks: CheckRow[] = [];
  let reviews: ReviewRow[] = [];
  if (currentVersion) {
    checks = db.prepare("SELECT key,title,status,severity,details,evidence_json FROM checks WHERE version_id=? ORDER BY id").all(currentVersion.id) as CheckRow[];
    reviews = db.prepare("SELECT role,actor_label,decision,note,auto,at FROM reviews WHERE version_id=? ORDER BY at").all(currentVersion.id) as ReviewRow[];
  }
  const deployment = (db.prepare("SELECT * FROM deployments WHERE app_id=?").get(app.id) as DeploymentRow | undefined) ?? null;
  const runs = deployment
    ? (db.prepare("SELECT * FROM runs WHERE deployment_id=? ORDER BY started_at DESC LIMIT 25").all(deployment.id) as RunRow[])
    : [];
  const leases = db
    .prepare("SELECT token,scopes_json,purpose,issued_at,expires_at FROM leases WHERE app_id=? ORDER BY issued_at DESC LIMIT 10")
    .all(app.id) as LeaseRow[];
  return {
    app,
    currentVersion,
    manifest: manifestOf(currentVersion),
    checks,
    reviews,
    versions,
    deployment,
    runs,
    leases,
  };
}

export function requiredApproverRoles(tier: number): Array<"platform_reviewer" | "security_reviewer"> {
  if (tier >= 3) return ["platform_reviewer", "security_reviewer"];
  if (tier === 2) return ["platform_reviewer"];
  return [];
}

export interface ReviewQueueItem {
  versionId: string;
  versionLabel: string;
  status: string;
  riskScore: number | null;
  packetMd: string | null;
  submittedBy: string;
  createdAt: string;
  appId: string;
  appName: string;
  appSlug: string;
  appKind: string;
  tier: number;
  checkCounts: { pass: number; warn: number; fail: number; error: number };
  failKeys: string[];
  reviews: ReviewRow[];
  requiredRoles: Array<"platform_reviewer" | "security_reviewer">;
}

export function getReviewQueue(): ReviewQueueItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.*, a.name AS an, a.slug AS asl, a.kind AS ak, a.tier AS at_ FROM versions v JOIN apps a ON a.id=v.app_id
       WHERE v.status='needs_review' ORDER BY v.created_at ASC`,
    )
    .all() as Array<VersionRow & { an: string; asl: string; ak: string; at_: number }>;
  return rows.map((r) => {
    const checks = db.prepare("SELECT status,key FROM checks WHERE version_id=?").all(r.id) as Array<{ status: string; key: string }>;
    const counts = { pass: 0, warn: 0, fail: 0, error: 0 };
    for (const c of checks) counts[c.status as keyof typeof counts] = (counts[c.status as keyof typeof counts] ?? 0) + 1;
    const reviews = db.prepare("SELECT role,actor_label,decision,note,auto,at FROM reviews WHERE version_id=? ORDER BY at").all(r.id) as ReviewRow[];
    return {
      versionId: r.id,
      versionLabel: r.label,
      status: r.status,
      riskScore: r.risk_score,
      packetMd: r.packet_md,
      submittedBy: r.submitted_by,
      createdAt: r.created_at,
      appId: r.app_id,
      appName: r.an,
      appSlug: r.asl,
      appKind: r.ak,
      tier: r.at_,
      checkCounts: counts,
      failKeys: checks.filter((c) => c.status === "fail").map((c) => c.key),
      reviews,
      requiredRoles: requiredApproverRoles(r.at_),
    };
  });
}

export interface RuntimeRow {
  deploymentId: string;
  appId: string;
  appSlug: string;
  appName: string;
  kind: string;
  desiredState: string;
  actualState: string;
  port: number | null;
  cronSpec: string | null;
  timezone: string | null;
  pid: number | null;
  failureCount: number;
  health: { healthy?: boolean; failures?: number; checkedAt?: string } | null;
  versionLabel: string | null;
  versionStatus: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  updatedAt: string;
  publicPath: string | null;
}

export function getRuntimes(): Record<"job" | "service" | "static", RuntimeRow[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.*, a.slug AS sl, a.name AS an, v.label AS vl, v.status AS vst,
        (SELECT MAX(started_at) FROM runs r WHERE r.deployment_id=d.id) AS lra,
        (SELECT status FROM runs r WHERE r.deployment_id=d.id ORDER BY started_at DESC LIMIT 1) AS lrs
       FROM deployments d JOIN apps a ON a.id=d.app_id LEFT JOIN versions v ON v.id=d.version_id
       ORDER BY a.name`,
    )
    .all() as Array<DeploymentRow & { sl: string; an: string; vl: string | null; vst: string | null; lra: string | null; lrs: string | null }>;
  const out: Record<"job" | "service" | "static", RuntimeRow[]> = { job: [], service: [], static: [] };
  for (const r of rows) {
    const kind = (r.kind in out ? r.kind : "job") as "job" | "service" | "static";
    out[kind].push({
      deploymentId: r.id,
      appId: r.app_id,
      appSlug: r.sl,
      appName: r.an,
      kind,
      desiredState: r.desired_state,
      actualState: r.actual_state,
      port: r.port,
      cronSpec: r.cron_spec,
      timezone: r.timezone,
      pid: r.pid,
      failureCount: r.failure_count,
      health: parse(r.health_json, null),
      versionLabel: r.vl,
      versionStatus: r.vst,
      lastRunAt: r.lra,
      lastRunStatus: r.lrs,
      updatedAt: r.updated_at,
      publicPath:
        kind === "static" ? `/r/${r.sl}` : kind === "service" ? `/s/${r.sl}/healthz` : null,
    });
  }
  return out;
}

export function getAudit(opts: { limit?: number; action?: string; role?: string } = {}): AuditRow[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.action) {
    clauses.push("action = ?");
    params.push(opts.action);
  }
  if (opts.role) {
    clauses.push("actor_role = ?");
    params.push(opts.role);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT ts,actor_role,actor_label,action,subject_type,subject_id,summary FROM audit_events ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
    .all(...params, limit) as AuditRow[];
}

export function getAuditFacets(): { actions: string[]; roles: string[] } {
  const db = getDb();
  const actions = (db.prepare("SELECT DISTINCT action FROM audit_events ORDER BY action").all() as Array<{ action: string }>).map((r) => r.action);
  const roles = (db.prepare("SELECT DISTINCT actor_role FROM audit_events ORDER BY actor_role").all() as Array<{ actor_role: string }>).map((r) => r.actor_role);
  return { actions, roles };
}

export function supervisorHeartbeat(): { secondsAgo: number | null } {
  const db = getDb();
  const row = db.prepare("SELECT MAX(updated_at) AS m FROM deployments").get() as { m: string | null };
  if (!row.m) return { secondsAgo: null };
  const t = Date.parse(row.m.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return { secondsAgo: null };
  return { secondsAgo: Math.max(0, Math.round((Date.now() - t) / 1000)) };
}

export function getRunLog(runId: string): { log: string; truncated: boolean; logFile: string | null } | null {
  const db = getDb();
  const run = db.prepare("SELECT log_file FROM runs WHERE id=?").get(runId) as { log_file: string | null } | undefined;
  if (!run || !run.log_file) return null;
  const resolved = path.resolve(run.log_file);
  if (!resolved.startsWith(path.resolve(LOGS_DIR) + path.sep)) return { log: "Refused: log path outside .data/logs.", truncated: false, logFile: null };
  if (!existsSync(resolved)) return { log: "Log file not found on disk.", truncated: false, logFile: resolved };
  const buf = readFileSync(resolved, "utf8");
  const cap = 80_000;
  return buf.length <= cap
    ? { log: buf, truncated: false, logFile: resolved }
    : { log: buf.slice(-cap), truncated: true, logFile: resolved };
}

export function countRollbackCandidates(appId: string, currentVersionId: string | null): number {
  const db = getDb();
  // must mirror service.ts ROLLBACK_ELIGIBLE: only previously promoted versions
  const rows = db
    .prepare(
      "SELECT source_dir FROM versions WHERE app_id=? AND id != ? AND status IN ('live','superseded','approved') ORDER BY created_at DESC",
    )
    .all(appId, currentVersionId ?? "") as Array<{ source_dir: string }>;
  return rows.filter((r) => existsSync(r.source_dir)).length;
}
