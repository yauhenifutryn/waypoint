import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

it("executes the trusted no-key lifecycle with isolated data and real child processes", async () => {
  const result = await new Promise<{code:number|null;output:string}>((resolve,reject) => {
    const child = spawn(process.execPath,["--import","tsx","scripts/verify-no-key-mvp.ts"], {
      cwd:process.cwd(),env:{PATH:`${path.dirname(process.execPath)}:/usr/bin:/bin`,NODE_ENV:"test"},stdio:["ignore","pipe","pipe"],
    });
    let output="";
    child.stdout.on("data",(chunk)=>output+=chunk.toString());
    child.stderr.on("data",(chunk)=>output+=chunk.toString());
    child.on("error",reject);
    child.on("close",(code)=>resolve({code,output}));
  });
  expect(result.output).toContain("Evidence:");
  expect(result.code,result.output).toBe(0);
}, 45000);
