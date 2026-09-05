import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, digestManifest } from "./manifest";
import { analyzeSource } from "./scanners/dangerous";
import { scanForSecrets } from "./scanners/secrets";
import { compareDeclaredVsObserved } from "./scanners/resources";
import { sbomFinding } from "./scanners/sbom";
import { dependencyAudit } from "./scanners/deps";
import { runCommand, collectSourceFiles } from "./exec";
import { assessRisk } from "./risk";
import { buildReviewPacket } from "./packet";
import { evaluateJobContract, type JobContractAssessment } from "./job-contract";
import type { Finding, ObservedProfile, RiskAssessment, SmallSoftwareManifest } from "./types";

export interface ValidationOutcome {
  ok: boolean; // manifest parsed
  errors?: string[];
  manifest?: SmallSoftwareManifest;
  digest?: string;
  observed?: ObservedProfile;
  findings: Finding[];
  risk?: RiskAssessment;
  autoApproveEligible?: boolean;
  jobContract?: JobContractAssessment;
  packetMd?: string;
  anomalies?: Array<{ note: string; basis: string; severity: "advisory" }>;
}

/**
 * The deterministic boundary. Everything that gates promotion happens here,
 * synchronously, from the artifact on disk. AI material is generated alongside
 * but structurally cannot influence the verdict.
 */
export async function validateSource(sourceDir: string): Promise<ValidationOutcome> {
  const findings: Finding[] = [];
  const manifestPathCandidates = ["smallsoftware.yaml", "smallsoftware.yml", "waypoint.yaml"];
  const manifestFile = manifestPathCandidates.map((p) => join(sourceDir, p)).find(existsSync);
  if (!manifestFile) {
    return { ok: false, findings, errors: ["No smallsoftware.yaml manifest found at repository root"] };
  }
  const { readFile } = await import("node:fs/promises");
  const parsed = parseManifest(await readFile(manifestFile, "utf8"));
  if (!parsed.ok) return { ok: false, findings, errors: parsed.errors };

  const manifest = parsed.manifest;
  const digest = digestManifest(manifest);

  // static behavior analysis + secret scan over source files
  const sourceFiles = collectSourceFiles(sourceDir);
  const observed = analyzeSource(sourceFiles);
  findings.push(...scanForSecrets(sourceFiles));

  // declared vs observed
  const declared = compareDeclaredVsObserved(manifest, observed);
  findings.push(...declared.hardViolations, ...declared.warnings);

  // structural existence checks
  const specSection = manifest.kind === "job" ? manifest.spec.job : manifest.kind === "service" ? manifest.spec.service : undefined;
  if (specSection) {
    const entryOk =
      existsSync(join(sourceDir, specSection.entrypoint)) ||
      sourceFiles.some((f) => f.path.endsWith(specSection.entrypoint));
    if (!entryOk) {
      findings.push({
        key: "entrypoint-missing",
        title: `Entrypoint "${specSection.entrypoint}" not found`,
        status: "fail",
        severity: "critical",
        details: "The declared entrypoint does not exist in the submitted source.",
      });
    }
  }

  // SBOM + dependency audit
  const sbom = sbomFinding(sourceDir);
  if (sbom) findings.push(sbom);
  const deps = await dependencyAudit(sourceDir);
  if (deps) findings.push(deps);

  // test execution (the only place submitted code runs pre-approval)
  const testsRequired = manifest.tests?.required ?? false;
  const testCommand = manifest.tests?.command ?? (testsRequired ? guessTestCommand(sourceDir) : undefined);
  if (manifest.kind !== "static") {
    if (testCommand) {
      const result = await runCommand({ command: testCommand, cwd: sourceDir, timeoutMs: 90_000 });
      const passed = !result.timedOut && result.exitCode === 0;
      findings.push({
        key: "tests",
        title: passed ? `Tests pass (${result.durationMs}ms)` : result.timedOut ? "Tests timed out" : `Tests failed (exit ${result.exitCode})`,
        status: passed ? "pass" : "fail",
        severity: "critical",
        details: passed ? `Command: ${testCommand}` : `Command: ${testCommand}\nstdout:\n${result.stdoutTail}\nstderr:\n${result.stderrTail}`,
      });
    } else if (testsRequired) {
      findings.push({
        key: "tests-absent",
        title: "No test command available",
        status: "warn",
        severity: "warn",
        details:
          manifest.tests?.required
            ? "Manifest requires tests but no command was provided."
            : "No tests found. Small software ships without tests too often; at this risk tier a reviewer must accept that explicitly.",
      });
    }
  }

  // risk assessment + tiering + auto-approval eligibility
  const jobContract = evaluateJobContract({ manifest, sourceFiles, observed, findings });
  findings.push(jobContract.finding);
  const risk = assessRisk(manifest, observed, findings);
  const { canAutoApprove } = await import("./risk");
  const autoApproveEligible = jobContract.eligible && canAutoApprove(risk.tier, risk.hardBlocked, findings);

  const packet = buildReviewPacket({ manifest, observed, findings });

  return {
    ok: true,
    manifest,
    digest,
    observed,
    findings,
    risk,
    autoApproveEligible,
    jobContract,
    packetMd: packet.explanationMd,
    anomalies: packet.anomalies,
  };
}

function guessTestCommand(sourceDir: string): string | undefined {
  if (existsSync(join(sourceDir, "package.json"))) {
    try {
      const pkg = JSON.parse(require("node:fs").readFileSync(join(sourceDir, "package.json"), "utf8"));
      if (pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\" && exit 1") return "npm test --silent";
    } catch {
      /* fallthrough */
    }
  }
  return undefined;
}
