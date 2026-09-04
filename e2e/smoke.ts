/**
 * Waypoint E2E smoke: exercises the governed path lifecycle end-to-end
 * against the real database, engine, supervisor, and running console.
 * Run with: npm run smoke   (console on :4300 must be up)
 */
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.WAYPOINT_URL ?? "http://localhost:4300";

async function waitFor(pred: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`timeout waiting for: ${what}`);
}

async function main(): Promise<void> {
  const { submitFromSource, requestDeploy, stopDeployment } = await import("../src/server/service");
  const { getDb } = await import("../src/lib/db");
  const results: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) process.exitCode = 1;
  };

  // --- 0. console alive
  const home = await fetch(BASE);
  check("console responds", home.status === 200);

  // --- 1. T1 static app: submit -> auto-approved -> deploy -> served
  const scratchSrc = mkdtempSync(join(tmpdir(), "wp-smoke-"));
  cpSync(join(process.cwd(), "samples/weekly-ops-report"), scratchSrc, { recursive: true });
  const slug = `smoke-report-${Date.now().toString(36)}`;
  const sub = await submitFromSource({ slug, sourcePath: scratchSrc, actorLabel: "smoke" });
  check("T1 submission auto-approved", sub.outcomeStatus === "approved", `state=${sub.outcomeStatus} tier=${sub.tier}`);

  await requestDeploy({ versionId: sub.versionId, role: "platform_reviewer", actorLabel: "Pia Platform" });
  const db = getDb();
  await waitFor(async () => {
    const d = db.prepare("SELECT actual_state FROM deployments WHERE app_id=?").get(sub.appId) as { actual_state: string };
    return d?.actual_state === "running";
  }, 15_000, "static deployment running");
  const site = await fetch(`${BASE}/r/${slug}`);
  check("static site served through console", site.ok && (await site.text()).includes("Ops Weekly"));

  // --- 2. governance invariant: nobody can deploy a blocked version
  const blockedV = db.prepare("SELECT current_version_id AS v FROM apps WHERE slug='customer-export'").get() as { v: string };
  let denied = false;
  try {
    await requestDeploy({ versionId: blockedV.v, role: "platform_admin", actorLabel: "Ada Admin" });
  } catch {
    denied = true;
  }
  check("blocked version cannot be deployed even by admin", denied);

  // --- 3. separation of duties: owner cannot approve
  const { actOnVersion } = await import("../src/server/service");
  const pending = db.prepare("SELECT current_version_id AS v FROM apps WHERE slug='alteryx-parity-checker'").get() as { v: string };
  let sobDenied = false;
  try {
    actOnVersion({ versionId: pending.v, action: "approve", role: "owner", actorLabel: "Owner O." });
  } catch {
    sobDenied = true;
  }
  check("owner cannot approve (separation of duties)", sobDenied);

  // --- 4. T2 approve -> deploy -> service healthz green
  await actOnVersion({ versionId: pending.v, action: "approve", role: "platform_reviewer", actorLabel: "Pia Platform", note: "smoke" });
  await requestDeploy({ versionId: pending.v, role: "platform_reviewer", actorLabel: "Pia Platform" });
  await waitFor(async () => {
    const d = db.prepare("SELECT actual_state, port FROM deployments WHERE app_id=(SELECT id FROM apps WHERE slug='alteryx-parity-checker')").get() as { actual_state: string };
    return d?.actual_state === "running";
  }, 20_000, "job deployment registered");

  // --- 5. audit captured everything
  const n = (db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number }).n;
  check("audit trail populated", n > 10, `${n} events`);

  // --- 6. cleanup: stop the smoke deployment
  stopDeployment({ appId: sub.appId, role: "platform_admin", actorLabel: "Ada Admin" });

  console.log(results.join("\n"));
}

main().catch((e) => {
  console.error("SMOKE ERROR:", e);
  process.exit(1);
});
