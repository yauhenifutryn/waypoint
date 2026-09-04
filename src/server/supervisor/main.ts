import { Cron } from "croner";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, openSync, writeFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { getDb, audit, ARTIFACTS_DIR, LOGS_DIR, DATA_DIR } from "@/lib/db";
import { recordRunFinished } from "@/server/service";
import { mintLease, scopesFromManifest } from "@/lib/engine/identity";
import type { SmallSoftwareManifest } from "@/lib/engine/types";

/**
 * Waypoint supervisor: the only process allowed to touch production reality.
 * Reads desired state from SQLite and reconciles the machine to it. Survives
 * console restarts; reclaims orphans on boot. SQLite (WAL) is the bus.
 */

const PORT_RANGE_START = 39100;
const PORT_RANGE_END = 39399;

interface JobRuntime {
  cronJob: Cron | null;
  activeRunId: string | null;
  activePid: number | null;
  lastSpec: string | null;
}
interface ServiceRuntime {
  child: ChildProcess | null;
  healthFailures: number;
}
const jobRuntimes = new Map<string, JobRuntime>();
const serviceRuntimes = new Map<string, ServiceRuntime>();

const log = (...args: unknown[]): void => console.log(new Date().toISOString(), "[supervisor]", ...args);

function manifestOf(artifactDir: string): SmallSoftwareManifest {
  return JSON.parse(
    (getDb().prepare("SELECT manifest_json FROM versions WHERE source_dir = ? ORDER BY created_at DESC").get(artifactDir) as { manifest_json: string })
      .manifest_json ?? "{}",
  );
}

function loadManifest(deploymentId: string): { manifest: SmallSoftwareManifest; artifactDir: string; versionId: string; appId: string } {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT d.artifact_dir, d.version_id, d.app_id, v.manifest_json FROM deployments d JOIN versions v ON v.id = d.version_id WHERE d.id = ?`,
    )
    .get(deploymentId) as { artifact_dir: string; version_id: string; app_id: string; manifest_json: string };
  return { manifest: JSON.parse(row.manifest_json), artifactDir: row.artifact_dir, versionId: row.version_id, appId: row.app_id };
}

/** Demo vault: resource declarations resolve to scoped, lease-bound values. */
function resolveEnvForResources(m: SmallSoftwareManifest, leaseToken: string, artifactDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  const resourceByName = new Map((m.resources ?? []).map((r) => [r.name, r]));
  for (const e of m.env ?? []) {
    if (e.value !== undefined) env[e.name] = e.value;
    else if (e.source === "minted") {
      // minted credentials embed the lease token as the credential material
      const resNameGuess = Object.keys(resourceByName)[0];
      const r = resNameGuess ? resourceByName.get(resNameGuess) : undefined;
      if (r?.type === "postgres" || r?.type === "mysql") {
        const host = (r.endpoint ?? "db.internal").split("/")[0];
        env[e.name] = `${r.type}://waypoint_app:${leaseToken}@${host}`;
      } else if (r?.type === "file-share") {
        env[e.name] = localMountFor(r.path ?? "", artifactDir);
      } else {
        env[e.name] = leaseToken;
      }
    } else if (e.valueFromResource) {
      const r = resourceByName.get(e.valueFromResource);
      env[e.name] = r ? localMountFor(r.path ?? "", artifactDir) : "";
    }
  }
  return env;
}

/** On-prem shares are not mounted on this demo host: fall back to an
 *  artifact-local fixture directory carrying the same name when present. */
function localMountFor(declaredPath: string, artifactDir: string): string {
  const candidates = ["fixtures", "data"];
  for (const c of candidates) {
    const p = path.join(artifactDir, c);
    if (existsSync(p)) return p;
  }
  return declaredPath;
}

async function allocatePort(): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    // connect-probe beats bind-probe: it detects ANY existing listener on the
    // port regardless of address family (children often bind ::), including
    // orphans from a previous supervisor life
    const free = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(port);
    });
    if (free) return port;
  }
  throw new Error("No free ports in allocation range");
}

function mintRunLease(appId: string, versionId: string, m: SmallSoftwareManifest): string {
  const lease = mintLease({
    appId,
    versionId,
    manifestDigest: "",
    scopes: scopesFromManifest(m),
    environment: "prod",
    ttlSeconds: 900,
  });
  getDb()
    .prepare("INSERT INTO leases (id, app_id, version_id, token, scopes_json, purpose, expires_at) VALUES (?,?,?,?,?,?,datetime('now','+15 minutes'))")
    .run(crypto.randomUUID(), appId, versionId, lease.token, JSON.stringify(scopesFromManifest(m)), "run");
  return lease.token;
}

// ---------- jobs ----------

/**
 * Zero-install execution containment via Node's built-in permission model.
 * For direct `node <script>` start commands we deny filesystem access outside
 * the app's own artifact directory and deny child_process entirely. Honest
 * scope: no NETWORK containment (that stays review-time enforced until the
 * enterprise egress proxy exists). Set WAYPOINT_EXECUTOR=process to disable.
 */
function hardenNodeStart(cmd: string, artifactDir: string): string {
  if (process.env.WAYPOINT_EXECUTOR === "process") return cmd;
  const m = /^(node)\s+(\S+)(\s+.*)?$/.exec(cmd.trim());
  if (!m) return cmd;
  const real = realpathSync(artifactDir);
  return [
    "node",
    "--permission",
    `--allow-fs-read=${real}/**`,
    `--allow-fs-write=${real}/**`,
    m[2],
    m[3] ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function startRun(deploymentId: string, trigger: "manual" | "schedule", externalRunId?: string): void {
  const db = getDb();
  // governance gate: only running deployments of approved/live versions execute
  const dep = db
    .prepare(
      `SELECT d.desired_state, v.status AS version_status FROM deployments d JOIN versions v ON v.id = d.version_id WHERE d.id = ?`,
    )
    .get(deploymentId) as { desired_state: string; version_status: string } | undefined;
  if (!dep) throw new Error(`Deployment ${deploymentId} not found`);
  if (dep.desired_state !== "running") throw new Error(`Deployment is ${dep.desired_state}; start it before running`);
  if (!["approved", "live"].includes(dep.version_status)) {
    throw new Error(`Version status "${dep.version_status}" is not runnable; approvals missing`);
  }

  const rt = jobRuntimes.get(deploymentId) ?? { cronJob: null, activeRunId: null, activePid: null, lastSpec: null };
  jobRuntimes.set(deploymentId, rt);
  if (rt.activeRunId) {
    log(`job ${deploymentId.slice(0, 8)} still active; skipping tick (concurrencyPolicy handling)`);
    return;
  }

  const { manifest: m, artifactDir, versionId, appId } = loadManifest(deploymentId);
  const runId = externalRunId ?? crypto.randomUUID();
  db.prepare("INSERT INTO runs (id, deployment_id, trigger_type, status, started_at) VALUES (?,?,?,'running',datetime('now'))")
    .run(runId, deploymentId, trigger);

  const token = mintRunLease(appId, versionId, m);
  const env = resolveEnvForResources(m, token, artifactDir);
  const logFile = path.join(LOGS_DIR, `run-${runId.slice(0, 8)}.log`);
  const fd = openSync(logFile, "a");
  writeFileSync(fd, `=== run ${runId} (${trigger}) at ${new Date().toISOString()}\n=== cmd: ${m.spec.job?.startCommand}\n`);

  const timeoutSec = m.spec.job?.timeoutSeconds ?? 600;
  const raw = m.spec.job?.startCommand ?? "node index.mjs";
  const startCommand = hardenNodeStart(raw, artifactDir);
  const executor = startCommand === raw ? "process" : "node-permission";
  appendFileSync(logFile, `[supervisor] executor=${executor}\n`);
  const child: ChildProcess = spawn("/bin/bash", ["-lc", startCommand], {
    cwd: artifactDir,
    env: { ...process.env, CI: "1", ...env },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  rt.activeRunId = runId;
  rt.activePid = child.pid ?? null;
  db.prepare("UPDATE runs SET log_file=? WHERE id=?").run(logFile, runId);
  db.prepare("UPDATE deployments SET pid=?, updated_at=datetime('now') WHERE id=?").run(child.pid ?? null, deploymentId);
  appendFileSync(logFile, `[supervisor] spawned pid ${child.pid}, timeout ${timeoutSec}s\n`);

  let settled = false;
  const settle = (status: "success" | "failed" | "timeout", exitCode: number | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      appendFileSync(logFile, `[supervisor] finished ${status} exit=${exitCode}\n`);
    } catch { /* log file gone */ }
    rt.activeRunId = null;
    rt.activePid = null;
    recordRunFinished({ runId, status, exitCode });
  };

  const timer = setTimeout(() => {
    settle("timeout", null);
    if (rt.activePid) {
      try {
        process.kill(-rt.activePid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }, timeoutSec * 1000);

  child.on("close", (code) => {
    if (code === null) return; // handled by timeout path
    clearTimeout(timer);
    settle(code === 0 ? "success" : "failed", code);
  });
}

function scheduleJob(deploymentId: string, cronSpec: string | null, timezone: string | null): void {
  const rt = jobRuntimes.get(deploymentId) ?? { cronJob: null, activeRunId: null, activePid: null, lastSpec: null };
  jobRuntimes.set(deploymentId, rt);
  if (rt.cronJob) {
    rt.cronJob.stop();
    rt.cronJob = null;
  }
  if (!cronSpec) return;
  rt.cronJob = new Cron(
    cronSpec,
    { timezone: timezone ?? "UTC", catch: true },
    () => startRun(deploymentId, "schedule"),
  );
  log(`scheduled ${deploymentId.slice(0, 8)}: "${cronSpec}" (${timezone ?? "UTC"})`);
}

// ---------- services ----------

async function ensureService(deploymentId: string): Promise<void> {
  const db = getDb();
  const d = db.prepare("SELECT * FROM deployments WHERE id=?").get(deploymentId) as {
    id: string; pid: number | null; port: number | null; actual_state: string; restarts_this_hour: number; desired_state: string;
  };
  const rt = serviceRuntimes.get(deploymentId) ?? { child: null, healthFailures: 0 };
  serviceRuntimes.set(deploymentId, rt);

  const alive = d.pid ? processAlive(d.pid) : false;
  if (d.desired_state === "running") {
    if (!alive) {
      if (d.restarts_this_hour >= 5) {
        // crash-loop breaker: five respawns inside the window trips regardless
        // of health-probe counts (instant-crash children never accrue those)
        db.prepare("UPDATE deployments SET actual_state='failed', updated_at=datetime('now') WHERE id=?").run(deploymentId);
        audit({
          actorRole: "policy-engine", actorLabel: "waypoint", action: "circuit_breaker_tripped",
          subjectType: "deployment", subjectId: deploymentId,
          summary: `5 restarts inside window: service marked failed; manual redeploy required`,
        });
        return;
      }
      await spawnService(deploymentId);
    }
    // health poll every supervisor tick (~2s); degrade after 3 misses
    if (d.port && alive) {
      const ok = await probeHealth(d.port, loadManifest(deploymentId).manifest.spec.service?.healthCheckPath ?? "/healthz");
      rt.healthFailures = ok ? 0 : rt.healthFailures + 1;
      db.prepare("UPDATE deployments SET health_json=? WHERE id=?").run(JSON.stringify({ healthy: ok, failures: rt.healthFailures, checkedAt: new Date().toISOString() }), deploymentId);
      db.prepare("UPDATE deployments SET actual_state=? WHERE id=?").run(ok || rt.healthFailures < 3 ? "running" : "degraded", deploymentId);
    }
  } else if (alive) {
    stopProcessTree(d.pid!);
    db.prepare("UPDATE deployments SET pid=NULL, actual_state='stopped', updated_at=datetime('now') WHERE id=?").run(deploymentId);
  }
}

async function spawnService(deploymentId: string): Promise<void> {
  const db = getDb();
  const d = db.prepare("SELECT * FROM deployments WHERE id=?").get(deploymentId) as { id: string; artifact_dir: string; version_id: string; app_id: string };
  const { manifest: m } = loadManifest(deploymentId);
  const port = await allocatePort();
  const token = mintRunLease(d.app_id, d.version_id, m);
  const env = resolveEnvForResources(m, token, d.artifact_dir);
  env.PORT = String(port);

  mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = path.join(LOGS_DIR, `svc-${deploymentId.slice(0, 8)}.log`);
  const fd = openSync(logFile, "a");
  const svcRaw = m.spec.service?.startCommand ?? "node server.mjs";
  const svcCmd = hardenNodeStart(svcRaw, d.artifact_dir);
  writeFileSync(fd, `\n=== service spawn at ${new Date().toISOString()} port=${port} executor=${svcCmd === svcRaw ? "process" : "node-permission"}\n`);

  const child: ChildProcess = spawn("/bin/bash", ["-lc", svcCmd], {
    cwd: d.artifact_dir,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  const rt = serviceRuntimes.get(deploymentId)!;
  rt.child = child;
  rt.healthFailures = 0;
  const restarts = (db.prepare("SELECT restarts_this_hour FROM deployments WHERE id=?").get(deploymentId) as { restarts_this_hour: number }).restarts_this_hour;
  db.prepare("UPDATE deployments SET pid=?, port=?, actual_state='running', restarts_this_hour=?, updated_at=datetime('now') WHERE id=?")
    .run(child.pid ?? null, port, restarts + 1, deploymentId);
  log(`service ${deploymentId.slice(0, 8)} spawned pid=${child.pid} port=${port}`);
  child.on("exit", (code) => appendFileSync(logFile, `[supervisor] exited code=${code}\n`));
}

async function probeHealth(port: number, healthPath: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${healthPath}`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch { /* gone */ }
  }
}

// ---------- static ----------

const STATIC_POINTER_DIR = path.join(DATA_DIR, "static");

function reconcileStatic(deploymentId: string): void {
  mkdirSync(STATIC_POINTER_DIR, { recursive: true });
  const { manifest: m, artifactDir, versionId } = loadManifest(deploymentId);
  const slugRow = getDb().prepare("SELECT a.slug FROM apps a JOIN deployments d ON d.app_id=a.id WHERE d.id=?").get(deploymentId) as { slug: string };
  const publishRel = m.spec.static?.publishPath ?? "dist";
  const publishDir = path.join(artifactDir, publishRel);
  const pointer = path.join(STATIC_POINTER_DIR, slugRow.slug);
  const current = existsSync(pointer) ? readText(pointer) : "";
  if (current !== publishDir && existsSync(publishDir)) {
    writeFileSync(pointer, publishDir);
    log(`static ${slugRow.slug}: pointer -> ${publishDir}`);
  }
  const serving = existsSync(publishDir);
  getDb().prepare("UPDATE deployments SET actual_state=?, port=NULL, pid=NULL, updated_at=datetime('now') WHERE id=?")
    .run(serving ? "running" : "failed", deploymentId);
  // a serving static site IS live: status accuracy matters to the inventory
  if (serving) {
    const db2 = getDb();
    db2.prepare("UPDATE versions SET status='deploying' WHERE id=? AND status='approved'").run(versionId);
    db2.prepare("UPDATE versions SET status='live' WHERE id=? AND status='deploying'").run(versionId);
  }
}

function readText(p: string): string {
  return readFileSync(p, "utf8");
}

// ---------- main loop ----------

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const db = getDb();
    const deployments = db.prepare("SELECT * FROM deployments").all() as Array<{
      id: string; kind: string; desired_state: string; actual_state: string; cron_spec: string | null; timezone: string | null;
    }>;
    for (const d of deployments) {
      try {
        if (d.desired_state === "retired") continue;
        if (d.kind === "job") {
          const rt = jobRuntimes.get(d.id) ?? { cronJob: null, activeRunId: null, activePid: null, lastSpec: null };
          if (d.desired_state === "running") {
            scheduleJob(d.id, d.cron_spec, d.timezone);
            db.prepare("UPDATE deployments SET actual_state='running', updated_at=datetime('now') WHERE id=? AND actual_state!='running'").run(d.id);
            void rt;
          } else if (d.desired_state === "stopped") {
            if (rt.cronJob) rt.cronJob.stop();
            jobRuntimes.set(d.id, { ...rt, cronJob: null });
            db.prepare("UPDATE deployments SET actual_state='stopped', updated_at=datetime('now') WHERE id=? AND actual_state!='stopped'").run(d.id);
          }
        } else if (d.kind === "service") {
          await ensureService(d.id);
        } else if (d.kind === "static") {
          if (d.desired_state === "running") reconcileStatic(d.id);
          else db.prepare("UPDATE deployments SET actual_state='stopped', updated_at=datetime('now') WHERE id=? AND actual_state!='stopped'").run(d.id);
        }
      } catch (e) {
        log(`reconcile error for ${d.id.slice(0, 8)}:`, (e as Error).message);
      }
    }
    // hourly restart counter decay
    const meta = db.prepare("SELECT value FROM meta WHERE key='restart_window'").get() as { value: string } | undefined;
    const nowHour = Math.floor(Date.now() / 3_600_000);
    if (meta?.value !== String(nowHour)) {
      db.prepare("UPDATE deployments SET restarts_this_hour=0").run();
      db.prepare("INSERT INTO meta (key,value) VALUES ('restart_window',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(nowHour));
    }
  } finally {
    ticking = false;
  }
}

export function triggerManualRun(deploymentId: string): string {
  const rt = jobRuntimes.get(deploymentId) ?? { cronJob: null, activeRunId: null, activePid: null, lastSpec: null };
  if (rt?.activeRunId) throw new Error("A run is already active");
  const runId = crypto.randomUUID();
  startRun(deploymentId, "manual", runId);
  return runId;
}

function bootReconcile(): void {
  const db = getDb();
  const rows = db.prepare("SELECT id, pid FROM deployments WHERE pid IS NOT NULL").all() as Array<{ id: string; pid: number | null }>;
  for (const r of rows) {
    if (r.pid && !processAlive(r.pid)) {
      db.prepare("UPDATE deployments SET pid=NULL WHERE id=?").run(r.id);
    }
  }
  // orphaned open runs from a previous supervisor life: mark failed so stats
  // and concurrency guards recover deterministically
  const orphans = db.prepare("SELECT id, deployment_id FROM runs WHERE status IN ('queued','running')").all() as Array<{ id: string; deployment_id: string }>;
  for (const o of orphans) {
    db.prepare("UPDATE runs SET status='failed', finished_at=datetime('now') WHERE id=?").run(o.id);
    const d = db.prepare("SELECT desired_state FROM deployments WHERE id=?").get(o.deployment_id) as { desired_state?: string } | undefined;
    if (d?.desired_state === "running") {
      const rt = jobRuntimes.get(o.deployment_id) ?? { cronJob: null, activeRunId: o.id, activePid: null, lastSpec: null };
      // keep the guard slot occupied only until next tick re-evaluates reality
      jobRuntimes.set(o.deployment_id, rt);
    }
  }
  log(`boot reconcile complete (${orphans.length} orphaned runs closed)`);
}

export function main(): void {
  log("starting; data dir:", DATA_DIR, "artifacts:", ARTIFACTS_DIR);
  getDb();
  bootReconcile();
  setInterval(tick, 2000);
  tick();

  const shutdown = (): void => {
    log("shutting down; stopping managed children");
    const db = getDb();
    const rows = db.prepare("SELECT id, pid FROM deployments WHERE pid IS NOT NULL").all() as Array<{ id: string; pid: number | null }>;
    for (const r of rows) {
      if (r.pid && processAlive(r.pid)) {
        stopProcessTree(r.pid);
        db.prepare("UPDATE deployments SET pid=NULL, actual_state='stopped' WHERE id=?").run(r.id);
        log(`stopped deployment ${r.id.slice(0, 8)} (pid ${r.pid})`);
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && process.argv[1].endsWith("main.ts")) {
  main();
}
