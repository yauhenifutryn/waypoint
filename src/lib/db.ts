import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.WAYPOINT_DATA_DIR ?? path.join(process.cwd(), ".data");
export const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const DB_PATH = path.join(DATA_DIR, "waypoint.db");

mkdirSync(ARTIFACTS_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(d: Database.Database): void {
  d.transaction(() => {
  d.exec(`
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('static','job','service')),
  owner_email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  tier INTEGER NOT NULL DEFAULT 1,
  current_version_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id),
  label TEXT NOT NULL,
  source_dir TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  risk_score INTEGER,
  risk_reasons_json TEXT,
  packet_md TEXT,
  anomalies_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id TEXT NOT NULL REFERENCES versions(id),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','warn','fail','error')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
  details TEXT NOT NULL,
  evidence_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_version ON checks(version_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  role TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  note TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  kind TEXT NOT NULL,
  desired_state TEXT NOT NULL DEFAULT ('stopped'),
  actual_state TEXT NOT NULL DEFAULT ('stopped'),
  port INTEGER,
  cron_spec TEXT,
  timezone TEXT,
  pid INTEGER,
  artifact_dir TEXT NOT NULL,
  health_json TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  restarts_this_hour INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(app_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','schedule')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','success','failed','timeout')),
  exit_code INTEGER,
  log_file TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_deployment ON runs(deployment_id);

CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id),
  version_id TEXT NOT NULL,
  token TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  purpose TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  actor_role TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
  // Historical runs cannot be truthfully rebound to a deployment's current
  // version. Leave their attribution null; all new claims bind it atomically.
  const columns = new Set((d.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map((c) => c.name));
  for (const [name, type] of [["version_id", "TEXT REFERENCES versions(id)"], ["owner_pid", "INTEGER"], ["pid", "INTEGER"]]) {
    if (!columns.has(name)) d.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
  }
  const versionColumns = new Set((d.prepare("PRAGMA table_info(versions)").all() as Array<{name:string}>).map((c)=>c.name));
  if (!versionColumns.has("risk_tier")) d.exec("ALTER TABLE versions ADD COLUMN risk_tier INTEGER CHECK (risk_tier IN (1,2,3))");
  }).immediate();
}

export function audit(entry: {
  actorRole: string;
  actorLabel: string;
  action: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  payload?: unknown;
}): void {
  getDb()
    .prepare(
      `INSERT INTO audit_events (actor_role, actor_label, action, subject_type, subject_id, summary, payload_json)
       VALUES (@actorRole, @actorLabel, @action, @subjectType, @subjectId, @summary, @payloadJson)`,
    )
    .run({ ...entry, payloadJson: entry.payload ? JSON.stringify(entry.payload) : null });
}

export function resetAll(): void {
  const d = getDb();
  d.exec(`DELETE FROM runs; DELETE FROM leases; DELETE FROM deployments; DELETE FROM reviews;
          DELETE FROM checks; DELETE FROM versions; DELETE FROM apps; DELETE FROM audit_events; DELETE FROM meta;`);
}
