import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Set before importing the database singleton. Never touch the user's .data.
const dataDir = mkdtempSync(path.join(tmpdir(), "waypoint-service-test-"));
process.env.WAYPOINT_DATA_DIR = dataDir;
let db: ReturnType<typeof import("@/lib/db").getDb>;
let service: typeof import("./service");
beforeAll(async () => {
  db = (await import("@/lib/db")).getDb();
  service = await import("./service");
});
afterAll(() => db.close());

function fixture(tier = 1, auto = true) {
  const appId = randomUUID(), versionId = randomUUID();
  db.prepare("INSERT INTO apps (id,slug,name,kind,owner_email,purpose,tier) VALUES (?,?,?,'job','owner@example.test','report',?)").run(appId, appId, appId, tier);
  db.prepare("INSERT INTO versions (id,app_id,label,source_dir,manifest_json,manifest_digest,submitted_by,status,risk_score) VALUES (?,?,? ,? ,?,'digest','owner','approved',?)")
    .run(versionId, appId, versionId, dataDir, JSON.stringify({kind: "job", spec: {job: {startCommand: "node index.mjs", concurrencyPolicy: "forbid"}}}), tier === 1 ? 2 : 6);
  db.prepare("UPDATE versions SET risk_tier=? WHERE id=?").run(tier,versionId);
  if (auto) db.prepare("INSERT INTO reviews (id,version_id,role,actor_label,decision,auto) VALUES (?,?,'platform_reviewer','policy-engine','approved',1)").run(randomUUID(), versionId);
  db.prepare("INSERT INTO checks (version_id,key,title,status,severity,details) VALUES (?,'tests','Tests','pass','critical','real test')").run(versionId);
  return { appId, versionId };
}

describe("owner standard-change deployment", () => {
  it("allows the owner only with T1 automatic approval evidence", () => {
    const f = fixture();
    expect(service.requestDeploy({...f, role: "owner", actorLabel: "owner"}).deploymentId).toBeTruthy();
  });
  it("rejects an owner without automatic approval or with a higher tier", () => {
    for (const f of [fixture(1, false), fixture(2, true)]) {
      expect(() => service.requestDeploy({...f, role: "owner", actorLabel: "owner"})).toThrow();
    }
  });
  it("rejects stale automatic approval when current checks contain a failure", () => {
    const f = fixture();
    db.prepare("UPDATE checks SET status='fail' WHERE version_id=?").run(f.versionId);
    expect(() => service.requestDeploy({...f, role: "owner", actorLabel: "owner"})).toThrow();
  });
  it("fails closed for legacy versions without a recorded tier", () => {
    const f=fixture();
    db.prepare("UPDATE versions SET risk_tier=NULL WHERE id=?").run(f.versionId);
    expect(()=>service.requestDeploy({...f,role:"owner",actorLabel:"owner"})).toThrow();
  });
  it("uses the approved version's tier after a newer submission changes app tier", () => {
    const f=fixture(1,true);
    db.prepare("UPDATE apps SET tier=3 WHERE id=?").run(f.appId);
    expect(service.requestDeploy({...f,role:"owner",actorLabel:"owner"}).deploymentId).toBeTruthy();
  });
});

it("redeploying the same version cannot reset its consecutive failure breaker", () => {
  const f=fixture();
  const {deploymentId}=service.requestDeploy({...f,role:"owner",actorLabel:"owner"});
  for(let count=1;count<=3;count++) {
    const runId=randomUUID();
    db.prepare("INSERT INTO runs(id,deployment_id,version_id,trigger_type,status) VALUES (?,?,?,'manual','running')").run(runId,deploymentId,f.versionId);
    service.recordRunFinished({runId,status:"failed",exitCode:1});
    if(count<3) service.requestDeploy({...f,role:"owner",actorLabel:"owner"});
    expect(db.prepare("SELECT failure_count FROM deployments WHERE id=?").get(deploymentId)).toEqual({failure_count:count});
  }
  expect(db.prepare("SELECT status FROM versions WHERE id=?").get(f.versionId)).toEqual({status:"needs_review"});
  expect(()=>service.requestDeploy({...f,role:"owner",actorLabel:"owner"})).toThrow();
});

it("binds completion to the run version and leaves a replacement deployment untouched", () => {
  const old = fixture();
  const {deploymentId} = service.requestDeploy({...old, role: "platform_admin", actorLabel: "test"});
  const runId = randomUUID();
  db.prepare("INSERT INTO runs (id,deployment_id,version_id,trigger_type,status) VALUES (?,?,?,'manual','running')").run(runId, deploymentId, old.versionId);
  const fresh = fixture();
  db.prepare("UPDATE deployments SET version_id=?,actual_state='stopped',failure_count=2 WHERE id=?").run(fresh.versionId, deploymentId);
  service.recordRunFinished({runId, status: "success", exitCode: 0});
  expect(db.prepare("SELECT status FROM versions WHERE id=?").get(fresh.versionId)).toEqual({status: "approved"});
  expect(db.prepare("SELECT actual_state,failure_count FROM deployments WHERE id=?").get(deploymentId)).toEqual({actual_state: "stopped",failure_count: 2});
  expect(db.prepare("SELECT payload_json FROM audit_events WHERE subject_id=? AND action='run_finished'").get(runId)).toBeTruthy();
});

it("records failed health and applies a run completion exactly once", () => {
  const f = fixture();
  const {deploymentId} = service.requestDeploy({...f, role: "platform_admin", actorLabel: "test"});
  const runId = randomUUID();
  db.prepare("INSERT INTO runs (id,deployment_id,version_id,trigger_type,status) VALUES (?,?,?,'manual','running')").run(runId, deploymentId, f.versionId);
  service.recordRunFinished({runId,status: "failed",exitCode: 1});
  service.recordRunFinished({runId,status: "failed",exitCode: 1});
  expect(db.prepare("SELECT actual_state,failure_count FROM deployments WHERE id=?").get(deploymentId)).toEqual({actual_state:"failed",failure_count:1});
});

it("a committed stop takes precedence over a success arriving before the stop watcher", () => {
  const f = fixture();
  const {deploymentId} = service.requestDeploy({...f, role:"platform_admin",actorLabel:"test"});
  const runId=randomUUID();
  db.prepare("INSERT INTO runs(id,deployment_id,version_id,trigger_type,status) VALUES (?,?,?,'manual','running')").run(runId,deploymentId,f.versionId);
  service.stopDeployment({appId:f.appId,role:"owner",actorLabel:"test"});
  service.recordRunFinished({runId,status:"success",exitCode:0});
  expect(db.prepare("SELECT status FROM runs WHERE id=?").get(runId)).toEqual({status:"failed"});
  expect(db.prepare("SELECT status FROM versions WHERE id=?").get(f.versionId)).toEqual({status:"approved"});
  const health=(db.prepare("SELECT health_json FROM deployments WHERE id=?").get(deploymentId) as {health_json:string}).health_json;
  expect(JSON.parse(health).healthy).toBe(false);
});
