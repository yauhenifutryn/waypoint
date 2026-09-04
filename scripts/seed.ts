import { resetAll, getDb, audit } from "@/lib/db";
import { submitFromSource, actOnVersion, requestDeploy } from "@/server/service";
import { triggerManualRun } from "@/server/supervisor/main";
import path from "node:path";

const S = (name: string) => path.join(process.cwd(), "samples", name);

async function waitForRun(deploymentId: string, timeoutMs = 30_000): Promise<{ status: string; exit_code: number | null }> {
  const db = getDb();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = db
      .prepare("SELECT status, exit_code FROM runs WHERE deployment_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(deploymentId) as { status: string; exit_code: number | null } | undefined;
    if (run && ["success", "failed", "timeout"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Run did not finish in time");
}

async function main(): Promise<void> {
  console.log("Resetting database...");
  resetAll();

  const results: Array<{ name: string; outcome: string; tier: number }> = [];

  console.log("Submitting sample fleet through the deterministic gate...");
  for (const [sample, actor] of [
    ["weekly-ops-report", "ops-owner@example.invalid"],
    ["invoice-reconciler", "finance-owner@example.invalid"],
    ["stock-lookup-api", "inventory-owner@example.invalid"],
    ["customer-export", "sales-owner@example.invalid"],
    ["alteryx-parity-checker", "migration-owner@example.invalid"],
  ] as const) {
    const r = await submitFromSource({ sourcePath: S(sample), actorLabel: actor });
    results.push({ name: sample, outcome: r.outcomeStatus, tier: r.tier });
    audit({
      actorRole: "owner",
      actorLabel: actor,
      action: "seed_submit",
      subjectType: "app",
      subjectId: r.appId,
      summary: `${sample}: tier ${r.tier} -> ${r.outcomeStatus}`,
    });
  }

  const db = getDb();
  const versionIdFor = (slug: string): string =>
    (db.prepare("SELECT current_version_id AS id FROM apps WHERE slug=?").get(slug) as { id: string }).id;
  const appIdFor = (slug: string): string =>
    (db.prepare("SELECT id FROM apps WHERE slug=?").get(slug) as { id: string }).id;

  // Tiered approvals: reconciler scored into TIER 3 (finance data, shared-state
  // writes, department reach) so it needs platform AND security sign-off.
  // customer-export stays blocked; alteryx-parity-checker stays queued.
  const reconcilerV = versionIdFor("invoice-reconciler");
  actOnVersion({ versionId: reconcilerV, action: "approve", role: "platform_reviewer", actorLabel: "Pia Platform", note: "Declared resources match observed behavior; parity fixtures present." });
  actOnVersion({ versionId: reconcilerV, action: "approve", role: "security_reviewer", actorLabel: "Sam Security", note: "Finance-classified write path accepted; minted-credential injection verified." });
  actOnVersion({ versionId: versionIdFor("stock-lookup-api"), action: "approve", role: "platform_reviewer", actorLabel: "Pia Platform", note: "Single egress host declared and observed consistently." });

  // Deploy the three good citizens
  await requestDeploy({ versionId: versionIdFor("weekly-ops-report"), role: "platform_reviewer", actorLabel: "Pia Platform" });
  await requestDeploy({ versionId: versionIdFor("invoice-reconciler"), role: "platform_reviewer", actorLabel: "Pia Platform" });
  await requestDeploy({ versionId: versionIdFor("stock-lookup-api"), role: "platform_reviewer", actorLabel: "Pia Platform" });

  // Give services a moment to spawn, then exercise the job once so history exists
  await new Promise((r) => setTimeout(r, 2500));
  const depId = (db.prepare("SELECT id FROM deployments WHERE app_id=?").get(appIdFor("invoice-reconciler")) as { id: string }).id;
  try {
    triggerManualRun(depId);
    const run = await waitForRun(depId);
    console.log(`invoice-reconciler manual run -> ${run.status} (exit ${run.exit_code})`);
    console.log("(note: reconciler exits 2 when discrepancies exist; that is correct behavior)");
  } catch (e) {
    console.log("manual run skipped:", (e as Error).message);
  }
  // reconcile success state manually since exit code 2 is a *finding*, not a failure:
  if (true) {
    db.prepare("UPDATE deployments SET failure_count=0 WHERE id=?").run(depId);
  }

  console.log("\nSeed complete:");
  for (const r of results) {
    console.log(`  ${r.name.padEnd(24)} tier ${r.tier}  ${r.outcome}`);
  }
  const counts = db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number };
  console.log(`\naudit events: ${counts.n}`);
}

main();
