import type { Finding, ObservedProfile, SmallSoftwareManifest } from "./types";

export interface ReviewPacket {
  explanationMd: string;
  anomalies: Array<{ note: string; basis: string; severity: "advisory" }>;
  generatedBy: "heuristic-v0";
}

const CADENCE_WORDS: Array<{ re: RegExp; minHours: number }> = [
  { re: /\bhourly\b|\bevery hour\b/i, minHours: 1 },
  { re: /\bdaily\b|\bevery day\b|\bnightly\b/i, minHours: 24 },
  { re: /\bweekly\b|\bevery week\b/i, minHours: 168 },
  { re: /\bmonthly\b|\bevery month\b/i, minHours: 720 },
];

function declaredCadenceHours(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return NaN;
  const [min, hour] = parts;
  if (min === "*" || hour === "*") return min.startsWith("*/") ? parseInt(min.slice(2)) || 1 : 1;
  return 24; // daily-at-fixed-time shape
}

/**
 * AI-assist material, heuristic implementation. The LLM adapter interface
 * (generateExplanation/generateAnomalies) would be swapped in behind the SAME
 * non-gating contract in the enterprise build: output attaches to the packet,
 * never to the decision.
 */
export function buildReviewPacket(params: {
  manifest: SmallSoftwareManifest;
  observed: ObservedProfile;
  findings: Finding[];
}): ReviewPacket {
  const { manifest: m, observed } = params;
  const anomalies: ReviewPacket["anomalies"] = [];

  // purpose-vs-schedule cadence mismatch
  const cron = m.spec.job?.schedule?.cron;
  if (cron) {
    const declaredH = declaredCadenceHours(cron);
    for (const { re, minHours } of CADENCE_WORDS) {
      if (re.test(m.metadata.purpose)) {
        if (Math.abs(declaredH - minHours) > minHours * 0.5 && !(minHours <= declaredH)) {
          anomalies.push({
            note: `Purpose says "${m.metadata.purpose.match(re)?.[0]}" but the cron schedule fires roughly every ${declaredH}h.`,
            basis: `purpose text vs spec.job.schedule.cron "${cron}"`,
            severity: "advisory",
          });
        }
        break;
      }
    }
    if (!CADENCE_WORDS.some(({ re }) => re.test(m.metadata.purpose))) {
      anomalies.push({
        note: "Schedule is declared but the purpose text names no cadence; confirm the frequency is intentional.",
        basis: "spec.job.schedule.cron without cadence wording in purpose",
        severity: "advisory",
      });
    }
  }

  // behavior contradicts stated intent
  if (/\bread[- ]only\b|\breport\b/i.test(m.metadata.purpose)) {
    if (observed.fsWritesOutsideWorkspace.length > 0) {
      anomalies.push({
        note: `Purpose describes a read-only report, yet the code writes outside its workspace (${observed.fsWritesOutsideWorkspace.join(", ")}).`,
        basis: "metadata.purpose vs observed fs writes",
        severity: "advisory",
      });
    }
    if (observed.evalUses.length > 0) {
      anomalies.push({
        note: "Purpose describes simple reporting, but dynamic code evaluation (eval/new Function) was found.",
        basis: "metadata.purpose vs observed eval uses",
        severity: "advisory",
      });
    }
  }

  if (m.kind === "static" && (observed.processExecCalls.length > 0 || observed.socketHosts.length > 0)) {
    anomalies.push({
      note: "Declared as a static site, but the code performs process/socket operations. Verify the runtime kind.",
      basis: "kind=static vs observed process/socket usage",
      severity: "advisory",
    });
  }

  const undeclaredEnv = params.findings.filter((f) => f.key === "undeclared-env-read");
  if (undeclaredEnv.length >= 2) {
    anomalies.push({
      note: `${undeclaredEnv.length} environment variables are read but undeclared. This app will likely misbehave under platform-managed environments.`,
      basis: "env reads vs manifest.env",
      severity: "advisory",
    });
  }

  const explanationMd = renderExplanation(m, observed);
  return { explanationMd, anomalies, generatedBy: "heuristic-v0" };
}

function renderExplanation(m: SmallSoftwareManifest, observed: ObservedProfile): string {
  const lines: string[] = [];
  lines.push(`### What this app does`);
  lines.push(`> ${m.metadata.purpose.trim()}`);
  lines.push("");
  lines.push(`**Runtime:** \`${m.kind}\``);
  if (m.spec.job?.schedule) lines.push(`**Schedule:** \`${m.spec.job.schedule.cron}\` (${m.spec.job.schedule.timezone})`);
  if (m.spec.service) lines.push(`**Serves:** port ${m.spec.service.port}, health at \`${m.spec.service.healthCheckPath}\``);
  if (m.spec.static) lines.push(`**Publishes:** \`${m.spec.static.publishPath}/\``);

  if (m.resources?.length) {
    lines.push("", "### Declared data access");
    for (const r of m.resources) {
      const where = r.endpoint ?? r.path ?? "(unspecified)";
      lines.push(`- \`${r.name}\` (${r.type}, **${r.access}**, ${r.classification ?? "unclassified"}) at \`${where}\``);
    }
  } else {
    lines.push("", "### Declared data access", "- None declared.");
  }

  if (m.egress?.length) {
    lines.push("", "### Declared network egress");
    for (const e of m.egress) lines.push(`- \`${e.host}\`${e.protocol ? ` (${e.protocol})` : ""}`);
  }

  lines.push("", "### What static analysis saw");
  lines.push(`- ${observed.filesScanned} source files scanned`);
  if (observed.connectionStrings.length)
    lines.push(`- connections: ${observed.connectionStrings.map((c) => `${c.type}://${c.host}`).join(", ")}`);
  if (observed.urlHosts.length) lines.push(`- outbound hosts: ${observed.urlHosts.join(", ")}`);
  if (observed.processExecCalls.length) lines.push(`- shell execution calls: ${observed.processExecCalls.length}`);
  if (observed.evalUses.length) lines.push(`- dynamic evaluation sites: ${observed.evalUses.length}`);
  if (!observed.connectionStrings.length && !observed.urlHosts.length && !observed.processExecCalls.length && !observed.evalUses.length)
    lines.push("- no network, database, shell, or dynamic-code activity found");

  const provenance = m.metadata.provenance;
  if (provenance?.migratedFrom || provenance?.builtWith) {
    lines.push(
      "",
      "### Provenance",
      `- built with: ${provenance.builtWith ?? "unknown"}${provenance.migratedFrom ? `, migrated from ${provenance.migratedFrom}` : ""}`,
    );
  }
  return lines.join("\n");
}
