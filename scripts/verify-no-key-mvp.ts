import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = process.argv[2] === "--worker";
const workerData = worker ? process.env.WAYPOINT_DATA_DIR : undefined;
const safePath = `${path.dirname(process.execPath)}:/usr/bin:/bin`;
// No provider keys or inherited credentials reach either preflight or jobs.
for (const key of Object.keys(process.env)) delete process.env[key];
process.env.PATH = safePath;
process.env.WAYPOINT_DATA_DIR = workerData ?? mkdtempSync(path.join(tmpdir(), "waypoint-no-key-"));
const evidenceDir = process.env.WAYPOINT_DATA_DIR;
const { getDb } = await import("../src/lib/db");
const { submitFromSource, requestDeploy, stopDeployment } = await import("../src/server/service");
const { triggerManualRun } = await import("../src/server/supervisor/main");
const db = getDb();

if (worker) {
  try { console.log(triggerManualRun(process.argv[3])); }
  catch (error) { console.error((error as Error).message); process.exitCode = 2; }
} else {
  const children = new Set<ChildProcess>();
  const ownedJobPids = new Set<number>();
  const results: Array<{scenario:string; passed:boolean; detail?:string}> = [];
  const waitFor = async <T>(read: () => T | undefined | false, timeout = 7000): Promise<T> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = read(); if (value) return value; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error("Timed out awaiting observed state");
  };
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const runRow = (id: string) => db.prepare("SELECT * FROM runs WHERE id=?").get(id) as {status:string;pid:number;log_file:string;version_id:string};
  const finished = (id: string) => waitFor(() => { const r = runRow(id); return !["running", "queued"].includes(r.status) && r; });
  const run = (deploymentId: string) => { const id = triggerManualRun(deploymentId); const row = db.prepare("SELECT pid FROM deployments WHERE id=?").get(deploymentId) as {pid:number}; if (row.pid) ownedJobPids.add(row.pid); return id; };
  const child = (args: string[]) => {
    const p = spawn(process.execPath, ["--import", "tsx", ...args], {cwd:root,env:{PATH:safePath,NODE_ENV:"test",WAYPOINT_DATA_DIR:evidenceDir},stdio:["ignore","pipe","pipe"]});
    children.add(p); p.on("close", () => children.delete(p)); return p;
  };
  const scenario = async (name:string, action:()=>Promise<void>) => {
    try {await action();results.push({scenario:name,passed:true});console.log(`PASS ${name}`);}
    catch(error) {results.push({scenario:name,passed:false,detail:(error as Error).message});console.error(`FAIL ${name}: ${(error as Error).stack}`);}
  };
  const fixture = (code: string, timeout = 5, concurrencyPolicy = "forbid") => {
    const appId=randomUUID(),versionId=randomUUID(),sourceDir=path.join(evidenceDir,"fixtures",appId);
    mkdirSync(sourceDir,{recursive:true});writeFileSync(path.join(sourceDir,"index.mjs"),code);
    const manifest={kind:"job",spec:{job:{entrypoint:"index.mjs",startCommand:"node index.mjs",timeoutSeconds:timeout,concurrencyPolicy}}};
    db.prepare("INSERT INTO apps(id,slug,name,kind,owner_email,purpose) VALUES (?,?,?,'job','demo@example.test','Trusted regression fixture')").run(appId,appId,appId);
    db.prepare("INSERT INTO versions(id,app_id,label,source_dir,manifest_json,manifest_digest,submitted_by,status) VALUES (?,?,?, ?,?,'fixture','verifier','approved')").run(versionId,appId,versionId,sourceDir,JSON.stringify(manifest));
    return {appId,versionId,sourceDir,...requestDeploy({versionId,role:"platform_admin",actorLabel:"verifier"})};
  };
  try {
    await scenario("real report: validate, auto-approve, owner deploy, execute, audit",async()=>{
      const f=await submitFromSource({sourcePath:path.join(root,"samples/team-report-job"),actorLabel:"demo-owner"});
      assert.equal(f.tier,1);assert.equal(f.outcomeStatus,"approved");
      const {deploymentId}=requestDeploy({versionId:f.versionId,role:"owner",actorLabel:"demo-owner"});
      const id=run(deploymentId), result=await finished(id);assert.equal(result.status,"success");assert.equal(result.version_id,f.versionId);
      const v=db.prepare("SELECT source_dir,status FROM versions WHERE id=?").get(f.versionId) as {source_dir:string;status:string};
      assert.equal(v.status,"live");assert.equal(readFileSync(path.join(v.source_dir,"report.txt"),"utf8"),"Team activity report\nTeams: 3\nCompleted tasks: 22\n");
      assert.match(readFileSync(result.log_file,"utf8"),/Completed tasks: 22/);
      assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE action='run_finished' AND subject_id=?").get(id));
    });
    await scenario("timeout kills the child and frees the run guard",async()=>{
      const f=fixture('process.on("SIGTERM",()=>{}); setInterval(()=>{},1000);',1),id=run(f.deploymentId);
      const pid=(db.prepare("SELECT pid FROM deployments WHERE id=?").get(f.deploymentId) as {pid:number}).pid;
      assert.equal((await finished(id)).status,"timeout");await waitFor(()=>!alive(pid));
    });
    for (const reason of ["timeout", "stop"] as const) {
      await scenario(`${reason} keeps the claim until a TERM-resistant background child dies`,async()=>{
        const f=fixture('import {writeFileSync} from "node:fs"; process.on("SIGTERM",()=>{}); writeFileSync("child.pid",String(process.pid)); setInterval(()=>{},1000);',reason === "timeout" ? 1 : 10);
        writeFileSync(path.join(f.sourceDir,"runner.sh"),'#!/bin/sh\nnode index.mjs &\nwait\n');
        const m=JSON.parse((db.prepare("SELECT manifest_json FROM versions WHERE id=?").get(f.versionId) as {manifest_json:string}).manifest_json);
        m.spec.job.startCommand="sh runner.sh";
        db.prepare("UPDATE versions SET manifest_json=? WHERE id=?").run(JSON.stringify(m),f.versionId);
        const id=run(f.deploymentId);
        const descendant=await waitFor(()=>{try{return Number(readFileSync(path.join(f.sourceDir,"child.pid"),"utf8"));}catch{return false;}});
        if(reason === "stop") stopDeployment({appId:f.appId,role:"owner",actorLabel:"verifier"});
        const result=await finished(id);
        assert.equal(alive(descendant),false,"run claim was released while a background child was still alive");
        assert.equal(result.status,reason === "timeout" ? "timeout" : "failed");
      });
    }
    await scenario("stop terminates a job started in another process",async()=>{
      const f=fixture('setInterval(()=>{},1000);',20);
      const p=child(["scripts/verify-no-key-mvp.ts","--worker",f.deploymentId]);
      await waitFor(()=>{const r=db.prepare("SELECT pid FROM deployments WHERE id=?").get(f.deploymentId) as {pid:number};if(r.pid) {ownedJobPids.add(r.pid);return r.pid;}return false;});
      stopDeployment({appId:f.appId,role:"owner",actorLabel:"verifier"});
      await waitFor(()=>p.exitCode !== null);
      const row=db.prepare("SELECT status FROM runs WHERE deployment_id=?").get(f.deploymentId) as {status:string};assert.equal(row.status,"failed");
    });
    await scenario("post-spawn persistence failure kills the child before releasing the claim",async()=>{
      const f=fixture('import {writeFileSync} from "node:fs";process.on("SIGTERM",()=>{});writeFileSync("child.pid",String(process.pid));setInterval(()=>{},1000);');
      db.exec(`CREATE TEMP TRIGGER reject_fixture_run_log BEFORE UPDATE OF log_file ON runs WHEN NEW.deployment_id='${f.deploymentId}' BEGIN SELECT RAISE(ABORT,'fixture post-spawn failure'); END`);
      try {
        assert.throws(()=>run(f.deploymentId),/fixture post-spawn failure/);
        const row=db.prepare("SELECT id,pid FROM runs WHERE deployment_id=?").get(f.deploymentId) as {id:string;pid:number|null};
        if(row.pid) ownedJobPids.add(row.pid);
        await finished(row.id);
        if(row.pid) assert.equal(alive(row.pid),false,"post-spawn failure released a live group leader");
        await new Promise((r)=>setTimeout(r,100));
        let childPid:number|undefined;
        try {childPid=Number(readFileSync(path.join(f.sourceDir,"child.pid"),"utf8"));ownedJobPids.add(childPid);}catch{}
        assert.ok(!childPid || !alive(childPid),"post-spawn failure released a live child");
      } finally {db.exec("DROP TRIGGER reject_fixture_run_log");}
    });
    await scenario("atomic claim rejects a concurrent run from another process",async()=>{
      const f=fixture('setTimeout(()=>{},2000);',5);run(f.deploymentId);
      const p=child(["scripts/verify-no-key-mvp.ts","--worker",f.deploymentId]);await waitFor(()=>p.exitCode !== null);
      assert.equal(p.exitCode,2);assert.equal((db.prepare("SELECT COUNT(*) AS n FROM runs WHERE deployment_id=?").get(f.deploymentId) as {n:number}).n,1);
    });
    await scenario("unsupported concurrency fails closed without execution",async()=>{
      const f=fixture('console.log("must not run");',5,"replace");assert.throws(()=>run(f.deploymentId),/concurrency/i);
    });
    await scenario("late success cannot promote a changed deployment version",async()=>{
      const f=fixture('setTimeout(()=>console.log("old complete"),500);'),id=run(f.deploymentId);
      const replacement=fixture('console.log("new");');
      db.prepare("UPDATE deployments SET version_id=?, actual_state='stopped' WHERE id=?").run(replacement.versionId,f.deploymentId);
      assert.equal((await finished(id)).status,"success");
      assert.equal((db.prepare("SELECT status FROM versions WHERE id=?").get(replacement.versionId) as {status:string}).status,"approved");
    });
    await scenario("failure is real, attributed, and visible as failed health",async()=>{
      const f=fixture('console.error("fixture failure");process.exitCode=7;'),id=run(f.deploymentId);
      assert.equal((await finished(id)).status,"failed");
      const d=db.prepare("SELECT actual_state,failure_count FROM deployments WHERE id=?").get(f.deploymentId);assert.deepEqual(d,{actual_state:"failed",failure_count:1});
    });
    await scenario("supervisor boot and shutdown preserve a run owned by another live process",async()=>{
      const f=fixture('setTimeout(()=>{},4000);',10);
      const owner=child(["scripts/verify-no-key-mvp.ts","--worker",f.deploymentId]);
      const row=await waitFor(()=>db.prepare("SELECT id,pid FROM runs WHERE deployment_id=? AND status='running'").get(f.deploymentId) as {id:string;pid:number} | undefined);
      if(row.pid) ownedJobPids.add(row.pid);
      const supervisor=child(["src/server/supervisor/main.ts"]);
      let output="";supervisor.stdout?.on("data",(chunk)=>output+=chunk.toString());
      await waitFor(()=>output.includes("boot reconcile complete"));
      assert.equal(runRow(row.id).status,"running");
      supervisor.kill("SIGTERM");await waitFor(()=>supervisor.exitCode !== null || supervisor.signalCode !== null);
      await new Promise((r)=>setTimeout(r,150));
      assert.equal(runRow(row.id).status,"running");
      assert.equal((await finished(row.id)).status,"success");await waitFor(()=>owner.exitCode !== null);
    });
    await scenario("boot recovers dead orphans and scheduled jobs can execute again",async()=>{
      const f=fixture('console.log("scheduled recovery");'),orphanId=randomUUID();
      db.prepare("INSERT INTO runs(id,deployment_id,version_id,owner_pid,trigger_type,status) VALUES (?,?,?,2147483647,'manual','running')").run(orphanId,f.deploymentId,f.versionId);
      db.prepare("UPDATE deployments SET cron_spec='* * * * * *',timezone='UTC' WHERE id=?").run(f.deploymentId);
      const supervisor=child(["src/server/supervisor/main.ts"]);
      const scheduled=await waitFor(()=>db.prepare("SELECT id FROM runs WHERE deployment_id=? AND trigger_type='schedule' AND status='success'").get(f.deploymentId) as {id:string} | undefined);
      assert.equal(runRow(orphanId).status,"failed");assert.equal(runRow(scheduled.id).version_id,f.versionId);
      stopDeployment({appId:f.appId,role:"owner",actorLabel:"verifier"});
      supervisor.kill("SIGTERM");await waitFor(()=>supervisor.exitCode !== null || supervisor.signalCode !== null);
    });
    await scenario("boot retains the claim for an orphan group whose shell leader is dead",async()=>{
      const f=fixture('import {writeFileSync} from "node:fs";process.on("SIGTERM",()=>{});writeFileSync("child.pid",String(process.pid));setInterval(()=>{},1000);',20);
      writeFileSync(path.join(f.sourceDir,"runner.sh"),'#!/bin/sh\nnode index.mjs &\nwait\n');
      const m=JSON.parse((db.prepare("SELECT manifest_json FROM versions WHERE id=?").get(f.versionId) as {manifest_json:string}).manifest_json);
      m.spec.job.startCommand="sh runner.sh";
      db.prepare("UPDATE versions SET manifest_json=? WHERE id=?").run(JSON.stringify(m),f.versionId);
      const owner=child(["scripts/verify-no-key-mvp.ts","--worker",f.deploymentId]);
      const descendant=await waitFor(()=>{try{return Number(readFileSync(path.join(f.sourceDir,"child.pid"),"utf8"));}catch{return false;}});
      const row=db.prepare("SELECT id,pid FROM runs WHERE deployment_id=?").get(f.deploymentId) as {id:string;pid:number};
      ownedJobPids.add(row.pid);
      owner.kill("SIGKILL");await waitFor(()=>owner.signalCode !== null);
      process.kill(row.pid,"SIGTERM");await waitFor(()=>!alive(row.pid));
      assert.equal(alive(descendant),true);
      const supervisor=child(["src/server/supervisor/main.ts"]);
      let output="";supervisor.stdout?.on("data",(chunk)=>output+=chunk.toString());
      await waitFor(()=>output.includes("boot reconcile complete"));
      assert.equal(runRow(row.id).status,"running","boot released a claim while the orphan group remained alive");
      assert.throws(()=>run(f.deploymentId),/already active/);
      process.kill(-row.pid,"SIGKILL");await waitFor(()=>!alive(descendant));
      supervisor.kill("SIGTERM");await waitFor(()=>supervisor.exitCode !== null || supervisor.signalCode !== null);
    });
  } finally {
    // The group may outlive its leader during a failing regression.
    for(const pid of ownedJobPids) {try {process.kill(-pid,"SIGKILL");}catch{}}
    for(const p of children) p.kill("SIGTERM");
    writeFileSync(path.join(evidenceDir,"verification.json"),JSON.stringify({results},null,2));
    console.log(`Evidence: ${evidenceDir}`);
  }
  if(results.some((r)=>!r.passed)) process.exitCode=1;
}
