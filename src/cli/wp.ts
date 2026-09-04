/**
 * wp — command-line client for Waypoint.
 *
 * The console GUI and this CLI are both thin clients over the same spine
 * (service.ts + engine + supervisor). Anything the GUI can drive, this drives;
 * anything this drives, the GUI reflects. Enterprise note: the same functions
 * back a future REST/gRPC API consumed by GitLab CI or pipelines.
 *
 * Usage examples:
 *   npm run wp -- submit samples/customer-export
 *   npm run wp -- apps
 *   npm run wp -- show invoice-reconciler
 *   npm run wp -- approve alteryx-parity-checker --as security_reviewer --note "ok"
 *   npm run wp -- deploy weekly-ops-report
 *   npm run wp -- run invoice-reconciler && npm run wp -- log invoice-reconciler
 *   npm run wp -- audit --limit 20
 */
import { getDb } from "@/lib/db";
import {
  actOnVersion,
  requestDeploy,
  stopDeployment,
  rollback,
  submitFromSource,
} from "@/server/service";
import { triggerManualRun } from "@/server/supervisor/main";
import { Cron } from "croner";

type Role =
  | "owner"
  | "platform_reviewer"
  | "security_reviewer"
  | "auditor"
  | "platform_admin";

const ACTOR: Record<Role, string> = {
  owner: "Owner",
  platform_reviewer: "Pia Platform",
  security_reviewer: "Sam Security",
  auditor: "Auditor",
  platform_admin: "Ada Admin",
};

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function die(msg: string): never {
  console.error(`wp: ${msg}`);
  process.exit(1);
}

function pad(s: string | number, n: number): string {
  return String(s).slice(0, n).padEnd(n);
}

function resolveApp(slugOrPrefix: string): { appId: string; slug: string } {
  const db = getDb();
  const all = db.prepare("SELECT id, slug FROM apps WHERE slug LIKE ?").all(`${slugOrPrefix}%`) as Array<{ id: string; slug: string }>;
  if (all.length === 0) die(`no app matches "${slugOrPrefix}"`);
  if (all.length > 1) die(`ambiguous prefix "${slugOrPrefix}": ${all.map((a) => a.slug).join(", ")}`);
  return { appId: all[0].id, slug: all[0].slug };
}

function currentVersion(appId: string): {
  id: string; status: string; risk_score: number | null; label: string;
} {
  const db = getDb();
  const v = db.prepare("SELECT id, status, risk_score, label FROM versions WHERE id = (SELECT current_version_id FROM apps WHERE id=?)").get(appId) as
    | { id: string; status: string; risk_score: number | null; label: string }
    | undefined;
  if (!v) die("app has no version");
  return v;
}

async function main(): Promise<void> {
  const [cmd, target] = process.argv.slice(2);
  const db = getDb();

  switch (cmd) {
    case "submit": {
      if (!target) die("usage: wp submit <sourcePath> [--slug name]");
      const r = await submitFromSource({
        sourcePath: target,
        slug: arg("--slug"),
        actorLabel: ACTOR[(arg("--as") as Role) ?? "owner"],
      });
      const verdict =
        r.outcomeStatus === "blocked"
          ? "BLOCKED by deterministic gate"
          : r.outcomeStatus === "approved"
            ? `AUTO-APPROVED (tier ${r.tier}, standard-change path)`
            : `awaiting review (tier ${r.tier})`;
      console.log(`${r.slug}: tier ${r.tier} -> ${verdict}`);
      break;
    }

    case "apps": {
      const rows = db
        .prepare(
          `SELECT a.slug, a.kind, a.tier, v.status AS vs, d.actual_state AS ds
           FROM apps a
           LEFT JOIN versions v ON v.id = a.current_version_id
           LEFT JOIN deployments d ON d.app_id = a.id
           ORDER BY a.slug`,
        )
        .all() as Array<{ slug: string; kind: string; tier: number; vs: string | null; ds: string | null }>;
      console.log(pad("SLUG", 26) + pad("KIND", 9) + pad("TIER", 5) + pad("VERSION", 14) + "RUNTIME");
      for (const r of rows) {
        console.log(pad(r.slug, 26) + pad(r.kind, 9) + pad(`T${r.tier}`, 5) + pad(r.vs ?? "-", 14) + (r.ds ?? "-"));
      }
      break;
    }

    case "show": {
      if (!target) die("usage: wp show <slug>");
      const { appId, slug } = resolveApp(target);
      const app = db.prepare("SELECT kind, owner_email, purpose, status, tier FROM apps WHERE id=?").get(appId) as {
        kind: string; owner_email: string; purpose: string; status: string; tier: number;
      };
      const v = currentVersion(appId);
      console.log(`${slug}  (${app.kind}, T${app.tier}, owner ${app.owner_email})`);
      console.log(`purpose : ${app.purpose}`);
      console.log(`version : ${v.label} [${v.status}] risk score ${v.risk_score ?? "-"}`);
      const checks = db.prepare("SELECT key,title,status FROM checks WHERE version_id=? ORDER BY status DESC").all(v.id) as Array<{ key: string; title: string; status: string }>;
      const icon: Record<string, string> = { pass: "+", warn: "~", fail: "x", error: "!" };
      for (const c of checks) console.log(`  [${icon[c.status] ?? "?"}] ${pad(c.key, 24)} ${c.title}`);
      const approvals = db.prepare("SELECT role,actor_label,decision,auto FROM reviews WHERE version_id=?").all(v.id) as Array<{ role: string; actor_label: string; decision: string; auto: number }>;
      for (const a of approvals) console.log(`  review: ${a.decision.toUpperCase()} by ${a.actor_label} (${a.role}${a.auto ? ", automatic" : ""})`);
      break;
    }

    case "approve":
    case "reject": {
      if (!target) die(`usage: wp ${cmd} <slug> [--as platform_reviewer|security_reviewer|platform_admin] [--note "..."]`);
      const role = (arg("--as") ?? "platform_reviewer") as Role;
      if (!["platform_reviewer", "security_reviewer", "platform_admin"].includes(role)) {
        die(`role ${role} cannot review`);
      }
      const { appId } = resolveApp(target);
      actOnVersion({
        versionId: currentVersion(appId).id,
        action: cmd,
        role,
        actorLabel: `${ACTOR[role]} (cli)`,
        note: arg("--note"),
      });
      console.log(`${target}: ${cmd} recorded as ${ACTOR[role]}`);
      break;
    }

    case "deploy": {
      if (!target) die("usage: wp deploy <slug>");
      const { appId } = resolveApp(target);
      await requestDeploy({ versionId: currentVersion(appId).id, role: "platform_admin", actorLabel: "Ada Admin (cli)" });
      console.log(`${target}: deploy requested; supervisor reconciles within ~2s`);
      break;
    }

    case "stop": {
      if (!target) die("usage: wp stop <slug>");
      const { appId } = resolveApp(target);
      stopDeployment({ appId, role: "platform_admin", actorLabel: "Ada Admin (cli)" });
      console.log(`${target}: desired state -> stopped`);
      break;
    }

    case "rollback": {
      if (!target) die("usage: wp rollback <slug>");
      const { appId, slug } = resolveApp(target);
      try {
        const r = rollback({ appId, role: "platform_admin", actorLabel: "Ada Admin (cli)" });
        console.log(`${slug}: rolled back to version ${r.rolledBackTo.slice(0, 8)}`);
      } catch (e) {
        die((e as Error).message);
      }
      break;
    }

    case "run": {
      if (!target) die("usage: wp run <slug>");
      const { appId } = resolveApp(target);
      const dep = db.prepare("SELECT id, desired_state FROM deployments WHERE app_id=?").get(appId) as { id: string; desired_state: string } | undefined;
      if (!dep) die("app has no deployment; deploy first");
      try {
        const runId = triggerManualRun(dep.id);
        console.log(`${target}: manual run ${runId.slice(0, 8)} started`);
        // wait briefly for completion like the seed does
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const run = db.prepare("SELECT status, exit_code FROM runs WHERE id=?").get(runId) as { status: string; exit_code: number | null };
          if (["success", "failed", "timeout"].includes(run.status)) {
            console.log(`${target}: run ${run.status}${run.exit_code !== null ? ` (exit ${run.exit_code})` : ""}`);
            process.exit(run.status === "success" ? 0 : 2);
          }
          await new Promise((r2) => setTimeout(r2, 500));
        }
        console.log(`${target}: run still active; check wp log`);
      } catch (e) {
        die((e as Error).message);
      }
      break;
    }

    case "log": {
      if (!target) die("usage: wp log <slug> [--run <id-prefix>]");
      const { appId } = resolveApp(target);
      const dep = db.prepare("SELECT id FROM deployments WHERE app_id=?").get(appId) as { id: string };
      let runRow: { log_file: string | null; status: string; started_at: string } | undefined;
      const runFilter = arg("--run");
      if (runFilter) {
        runRow = db.prepare("SELECT log_file, status, started_at FROM runs WHERE deployment_id=? AND id LIKE ? ORDER BY started_at DESC LIMIT 1").get(dep.id, `${runFilter}%`) as typeof runRow;
      } else {
        runRow = db.prepare("SELECT log_file, status, started_at FROM runs WHERE deployment_id=? ORDER BY started_at DESC LIMIT 1").get(dep.id) as typeof runRow;
      }
      if (!runRow?.log_file) die("no runs yet");
      console.log(`--- run ${runFilter ?? "latest"} [${runRow.status}] ${runRow.started_at} ---`);
      const { readFileSync } = await import("node:fs");
      try {
        console.log(readFileSync(runRow.log_file!, "utf8"));
      } catch {
        die("log file unreadable");
      }
      break;
    }

    case "runs": {
      if (!target) die("usage: wp runs <slug>");
      const { appId, slug } = resolveApp(target);
      const rows = db
        .prepare(
          `SELECT r.status, r.exit_code, r.trigger_type, r.started_at FROM runs r JOIN deployments d ON d.id=r.deployment_id WHERE d.app_id=? ORDER BY r.started_at DESC LIMIT 10`,
        )
        .all(appId) as Array<{ status: string; exit_code: number | null; trigger_type: string; started_at: string }>;
      console.log(pad("STARTED", 21) + pad("TRIGGER", 9) + pad("STATUS", 9) + "EXIT");
      for (const r of rows) console.log(pad(r.started_at, 21) + pad(r.trigger_type, 9) + pad(r.status, 9) + (r.exit_code ?? "-"));
      void slug;
      break;
    }

    case "next": {
      if (!target) die("usage: wp next <slug>   # next scheduled fire times");
      const { appId, slug } = resolveApp(target);
      const dep = db.prepare("SELECT cron_spec, timezone FROM deployments WHERE app_id=?").get(appId) as { cron_spec: string | null; timezone: string | null };
      if (!dep?.cron_spec) die("not a scheduled job");
      const job = new Cron(dep.cron_spec, { timezone: dep.timezone ?? "UTC", paused: true });
      console.log(`${slug}: ${dep.cron_spec} (${dep.timezone})`);
      for (const t of job.nextRuns(3)) console.log(`  ${t.toISOString()} local=${t.toLocaleString()}`);
      break;
    }

    case "audit": {
      const limit = Number(arg("--limit") ?? 25);
      const rows = db.prepare("SELECT ts, actor_role, action, subject_type, subject_id, summary FROM audit_events ORDER BY id DESC LIMIT ?").all(limit) as Array<{ ts: string; actor_role: string; action: string; subject_type: string; subject_id: string; summary: string }>;
      for (const r of rows) {
        console.log(`${r.ts}  ${pad(r.actor_role, 17)} ${pad(r.action, 22)} ${r.summary}`);
      }
      break;
    }

    case "policy": {
      console.log(`Waypoint effective policy pack baseline-v0.1
  secret scan          gitleaks-subset rules + Shannon entropy >= 3.5 (all text files)
  licenses             MIT, Apache-2.0, BSD-2/3, ISC, 0BSD; unknown = warn
  egress               deny-by-default; undeclared host observed = hard block
  data classes         pii -> floor T3; finance/confidential/restricted -> +2 score
  shared-state writes  floor T2 (+3 score, charged once)
  dangerous behavior   eval/exec/outside-writes -> floor T3
  auto-approve         tier 1 only, zero fails, warnings limited to stale-declaration
  demotion             3 consecutive failed runs -> pre-authorization revoked
  ai assist            advisory only; structurally cannot gate`);
      break;
    }

    case "whoami":
      console.log("wp CLI acting roles are per-command (--as); no session state.");
      break;

    default:
      console.error(`wp — waypoint CLI

  submit <path> [--slug s]              validate + gate a repo directory
  apps                                  list fleet
  show <slug>                           version, findings, reviews
  approve|reject <slug> --as ROLE       record a review decision
  deploy <slug>                         request deployment (platform roles implied)
  stop <slug>                           set desired stopped
  rollback <slug>                       restore last promoted version
  run <slug>                            trigger manual job run, waits for result
  runs <slug> | log <slug> | next <slug>  run history / tail log / next fire times
  audit [--limit N]                     append-only event stream
  policy                                effective policy pack`);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("wp error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
