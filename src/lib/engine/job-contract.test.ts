import { describe, expect, it } from "vitest";
import { evaluateJobContract } from "./job-contract";
import { emptyObservedProfile, type Finding, type SmallSoftwareManifest } from "./types";

const manifest = (): SmallSoftwareManifest => ({
  apiVersion: "smallsoftware/v0.1",
  kind: "job",
  metadata: { name: "local-report", owner: "owner@example.test", purpose: "Produce a report from local fictional activity data." },
  spec: { job: { entrypoint: "index.mjs", startCommand: "node index.mjs", timeoutSeconds: 10, concurrencyPolicy: "forbid" } },
});
const passed: Finding = { key: "tests", title: "Tests passed", status: "pass", severity: "critical", details: "Command: node test.mjs" };
const source = [
  { path: "index.mjs", content: 'import {readFileSync, writeFileSync} from "node:fs"; import {report} from "./report.mjs"; writeFileSync("report.txt", report(JSON.parse(readFileSync("data.json", "utf8"))));' },
  { path: "report.mjs", content: 'export function report(rows) { return String(rows.length); }' },
  { path: "data.json", content: '[{"website":"https://example.test"}]' },
  { path: "README.md", content: 'Documentation: https://example.test' },
];
function check(options: { manifest?: SmallSoftwareManifest; files?: typeof source; findings?: Finding[]; observed?: ReturnType<typeof emptyObservedProfile> } = {}) {
  return evaluateJobContract({ manifest: options.manifest ?? manifest(), sourceFiles: options.files ?? source, findings: options.findings ?? [passed], observed: options.observed ?? emptyObservedProfile() });
}

describe("local-node-file-job/v1 eligibility", () => {
  it("accepts a tested standard-library job with bundled JSON and documentation URLs, without optional package metadata", () => {
    const result = check();
    expect(result.eligible).toBe(true);
    expect(result.applicability).toBe("eligible");
    expect(result.finding.status).toBe("pass");
  });

  it.each(["static", "service"] as const)("routes %s to out-of-scope review even with passing tests", (kind) => {
    const m = manifest(); m.kind = kind;
    expect(check({ manifest: m })).toMatchObject({ eligible: false, applicability: "out_of_scope" });
  });

  it.each([
    ["python entrypoint", { entrypoint: "index.py", startCommand: "node index.py" }, "out_of_scope"],
    ["shell suffix", { startCommand: "node index.mjs && echo done" }, "out_of_scope"],
    ["node options", { startCommand: "node --import other.mjs index.mjs" }, "out_of_scope"],
    ["different executable", { startCommand: "node report.mjs" }, "out_of_scope"],
    ["build", { buildCommand: "npm run build" }, "out_of_scope"],
    ["absolute entrypoint", { entrypoint: "/tmp/index.mjs", startCommand: "node /tmp/index.mjs" }, "out_of_scope"],
    ["traversal entrypoint", { entrypoint: "../index.mjs", startCommand: "node ../index.mjs" }, "out_of_scope"],
    ["missing entrypoint", { entrypoint: "absent.mjs", startCommand: "node absent.mjs" }, "missing_evidence"],
    ["missing timeout", { timeoutSeconds: undefined }, "missing_evidence"],
    ["unbounded timeout", { timeoutSeconds: Infinity }, "contract_exception"],
    ["long timeout", { timeoutSeconds: 61 }, "contract_exception"],
    ["zero timeout", { timeoutSeconds: 0 }, "contract_exception"],
    ["missing concurrency", { concurrencyPolicy: undefined }, "missing_evidence"],
    ["overlapping runs", { concurrencyPolicy: "allow" }, "contract_exception"],
  ])("withholds approval for %s", (_label, override, applicability) => {
    const m = manifest(); Object.assign(m.spec.job!, override);
    expect(check({ manifest: m })).toMatchObject({ eligible: false, applicability });
  });

  it("requires the exact entrypoint, not a same-suffix file", () => {
    const files = source.map((file) => file.path === "index.mjs" ? { ...file, path: "other/index.mjs" } : file);
    expect(check({ files })).toMatchObject({ eligible: false, applicability: "missing_evidence" });
  });

  it.each([[], [{ ...passed, status: "fail" }], [{ ...passed, key: "tests-absent", status: "warn" }]].map((findings) => ({ findings: findings as Finding[] })))("requires an actual recorded passing test result: $findings", ({ findings }) => {
    expect(check({ findings })).toMatchObject({ eligible: false, applicability: "missing_evidence" });
  });

  it.each([
    { resources: [{ name: "api", type: "http-api", access: "read" }] },
    { egress: [{ host: "example.test" }] },
    { env: [{ name: "MODE", value: "demo" }] },
    { blastRadius: { writesSharedState: true } },
    { blastRadius: { audience: "company" } },
    { riskAttestation: { pii: true } },
    { riskAttestation: { externallyVisible: true } },
  ])("withholds approval for external or high-risk declarations %j", (extra) => {
    expect(check({ manifest: { ...manifest(), ...extra } as SmallSoftwareManifest })).toMatchObject({ eligible: false, applicability: "contract_exception" });
  });

  it.each(["evalUses", "dynamicImports", "processExecCalls", "socketHosts", "urlHosts", "fsWritesOutsideWorkspace", "fsReadsAbsolute", "envVarsRead"] as const)("withholds approval for observed %s", (key) => {
    const observed = emptyObservedProfile(); observed[key].push("evidence");
    expect(check({ observed })).toMatchObject({ eligible: false, applicability: "contract_exception" });
  });

  it.each([
    ['import x from "unknown-package";', "missing_evidence"],
    ['export {x} from "./absent.mjs";', "missing_evidence"],
    ['const x = require("./absent.cjs");', "missing_evidence"],
    ['import x from "./helper.py";', "out_of_scope"],
    ['import x from "../outside.mjs";', "out_of_scope"],
    ['const x = import(name);', "contract_exception"],
    ['const x = require(name);', "contract_exception"],
    ['import https from "node:https";', "contract_exception"],
    ['const cp = require("node:child_process");', "contract_exception"],
    ['import {createRequire} from "node:module";', "contract_exception"],
    ['import {runInNewContext} from "node:vm";', "contract_exception"],
    ['fetch(destination);', "contract_exception"],
    ['const env = process.env;', "contract_exception"],
    ['globalThis["fetch"](destination);', "contract_exception"],
    ['Function("return 1")();', "contract_exception"],
    ['const {readFileSync} = require("node:fs"); readFileSync("/etc/passwd");', "contract_exception"],
    ['import {writeFileSync} from "node:fs"; writeFileSync("../outside.txt", "data");', "contract_exception"],
    ['import {readFileSync} from "node:fs"; readFileSync(inputPath);', "missing_evidence"],
    ['export const = ;', "missing_evidence"],
  ])("checks executable source even when the existing observed profile is empty: %s", (content, applicability) => {
    expect(check({ files: [{ path: "index.mjs", content }] })).toMatchObject({ eligible: false, applicability });
  });

  it.each(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])("rejects declared %s even if not imported", (field) => {
    const files = [...source, { path: "package.json", content: JSON.stringify({ [field]: { anything: "1.0.0" } }) }];
    expect(check({ files })).toMatchObject({ eligible: false, applicability: "out_of_scope" });
  });

  it("reports invalid package metadata as missing evidence", () => {
    expect(check({ files: [...source, { path: "package.json", content: "{broken" }] })).toMatchObject({ eligible: false, applicability: "missing_evidence" });
  });

  it("accepts empty dependency metadata and CommonJS standard-library jobs", () => {
    const m = manifest(); Object.assign(m.spec.job!, { entrypoint: "index.cjs", startCommand: "node index.cjs", timeoutSeconds: 60 });
    const files = [{ path: "index.cjs", content: 'const fs = require("fs"); const data = require("./data.json"); fs.writeFileSync("report.txt", String(data.length));' }, { path: "data.json", content: "[]" }, { path: "package.json", content: '{"dependencies":{}}' }];
    expect(check({ manifest: m, files }).eligible).toBe(true);
  });

  it.each([
    ['const {readFileSync: read} = require("fs"); read("/etc/passwd");', "contract_exception"],
    ['import fs from "node:fs"; const read = fs.readFileSync; read("/etc/passwd");', "missing_evidence"],
    ['const {env} = process; console.log(env);', "contract_exception"],
    ['const p = process; console.log(p.env);', "contract_exception"],
    ['console.log(process[key]);', "contract_exception"],
    ['const value: number = 1;', "out_of_scope"],
  ])("does not let unsupported aliases or syntax inherit eligibility from valid file I/O: %s", (extra, applicability) => {
    const files = source.map((file) => file.path === "index.mjs" ? { ...file, content: `${file.content}\n${extra}` } : file);
    expect(check({ files })).toMatchObject({ eligible: false, applicability });
  });

  it.each([1, -1, 0.5, Infinity, NaN])("requires review for maxRetries=%s", (maxRetries) => {
    const m = manifest(); m.spec.job!.maxRetries = maxRetries;
    expect(check({ manifest: m })).toMatchObject({ eligible: false, applicability: "contract_exception" });
  });

  it.each([0, undefined])("accepts zero retries, including the runtime default: %s", (maxRetries) => {
    const m = manifest(); m.spec.job!.maxRetries = maxRetries;
    expect(check({ manifest: m }).eligible).toBe(true);
  });

  it.each([
    'const business = {writeFile(value) {return value;}}; business.writeFile("report.txt");',
    'function open(value) {return value;} open("report.txt");',
  ])("does not invent local filesystem evidence from business methods: %s", (content) => {
    expect(check({ files: [{ path: "index.mjs", content }] })).toMatchObject({ eligible: false, applicability: "missing_evidence" });
  });

  it("does not invalidate real local I/O because a business method accepts a number", () => {
    const files = source.map((file) => file.path === "index.mjs" ? { ...file, content: file.content + '\nconst business = {writeFile(value) {return value;}}; business.writeFile(42);' } : file);
    expect(check({ files }).eligible).toBe(true);
  });

  it.each([
    'import * as files from "node:fs"; files.writeFileSync("report.txt", "ok");',
    'import files from "node:fs/promises"; await files.writeFile("report.txt", "ok");',
    'const files = require("node:fs"); files.promises.writeFile("report.txt", "ok");',
    'const {writeFileSync: save} = require("node:fs"); save("report.txt", "ok");',
  ])("recognizes actual filesystem bindings: %s", (content) => {
    expect(check({ files: [{ path: "index.mjs", content }] }).eligible).toBe(true);
  });

  it("requires review for a computed filesystem method whose operation is unknown", () => {
    const files = source.map((file) => file.path === "index.mjs" ? { ...file, content: file.content + '\nimport fs from "node:fs"; fs[method]("report.txt");' } : file);
    expect(check({ files })).toMatchObject({ eligible: false, applicability: "missing_evidence" });
  });

  it.each([
    'import fs from "node:fs"; const other = fs; other.writeFileSync("/tmp/outside", "data");',
    'const save = writeFileSync; save("/tmp/outside", "data");',
  ])("requires review when known filesystem bindings escape direct analysis: %s", (extra) => {
    const files = source.map((file) => file.path === "index.mjs" ? { ...file, content: file.content + "\n" + extra } : file);
    expect(check({ files })).toMatchObject({ eligible: false, applicability: "missing_evidence" });
  });

  it.each([
    'import {watch} from "node:fs"; watch("/etc", () => {});',
    'import fs from "node:fs"; fs.watch("/etc", () => {});',
    'import {watch as monitor} from "node:fs/promises"; monitor("/etc");',
    'import fs from "node:fs"; fs.promises.watch("/etc");',
    'const {watch: monitor} = require("fs"); monitor("/etc", () => {});',
    'require("fs").watch("/etc", () => {});',
    'import fs from "node:fs"; fs.opendirSync("/etc");',
    'import fs from "node:fs"; const directory = fs.constants;',
    'import fs from "node:fs"; const p = fs.promises; p.watch("/etc");',
  ])("requires review for filesystem APIs outside modeled file operations: %s", (extra) => {
    const files = source.map((file) => file.path === "index.mjs" ? { ...file, content: file.content + "\n" + extra } : file);
    expect(check({ files })).toMatchObject({ eligible: false, applicability: "missing_evidence" });
  });

  it("does not treat an unrelated business watch method as an unsupported filesystem API", () => {
    const files = source.map((file) => file.path === "index.mjs" ? { ...file, content: file.content + '\nconst business = {watch(value) {return value;}}; business.watch(42);' } : file);
    expect(check({ files }).eligible).toBe(true);
  });
});
