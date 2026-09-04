import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../types";

/**
 * Dependency vulnerability audit against OSV.dev querybatch (no auth needed).
 * Network-unreachable environments degrade to an explicit "unverified" state
 * surfaced in the review packet rather than silently passing.
 */

interface OsvEntry {
  id: string;
  summary?: string;
}

async function osvBatch(packages: Array<{ name: string; version?: string }>): Promise<Map<string, OsvEntry[]>> {
  const results = new Map<string, OsvEntry[]>();
  const CHUNK = 500;
  for (let i = 0; i < packages.length; i += CHUNK) {
    const chunk = packages.slice(i, i + CHUNK);
    const body = {
      queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })),
    };
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`osv.dev responded ${res.status}`);
    const json = (await res.json()) as { results: Array<{ vulns?: OsvEntry[] }> };
    json.results.forEach((r, idx) => {
      if (r.vulns?.length) results.set(`${chunk[idx].name}@${chunk[idx].version}`, r.vulns);
    });
  }
  return results;
}

export async function dependencyAudit(sourceDir: string): Promise<Finding | null> {
  const lockPath = join(sourceDir, "package-lock.json");
  if (!existsSync(lockPath)) return null; // sbomFinding already reports the absence

  let packages: Array<{ name: string; version?: string }> = [];
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    packages = Object.entries((lock.packages ?? {}) as Record<string, { version?: string }>)
      .filter(([k]) => k !== "")
      .map(([k, v]) => ({ name: k.replace(/^node_modules\//, ""), version: v.version }));
  } catch {
    return null;
  }
  if (packages.length === 0)
    return { key: "deps-audit", title: "Dependency audit: nothing to audit", status: "pass", severity: "info", details: "No third-party packages." };

  try {
    const vulnMap = await osvBatch(packages);
    const totalVulns = [...vulnMap.values()].reduce((n, v) => n + v.length, 0);
    if (totalVulns === 0) {
      return {
        key: "deps-audit",
        title: `Dependency audit clean (OSV.dev, ${packages.length} packages)`,
        status: "pass",
        severity: "info",
        details: "No known vulnerabilities matched via OSV.dev batch query.",
      };
    }
    const worst: Array<string> = [];
    for (const [pkgKey, vulns] of vulnMap) {
      for (const v of vulns.slice(0, 3)) worst.push(`${pkgKey}: ${v.id}${v.summary ? ` — ${v.summary}` : ""}`);
    }
    return {
      key: "deps-audit",
      title: `${totalVulns} known vulnerabilities in dependencies`,
      status: "fail",
      severity: "critical",
      details: `OSV.dev matches:\n${worst.join("\n")}`,
    };
  } catch (e) {
    return {
      key: "deps-audit",
      title: "Dependency audit could not run",
      status: "error",
      severity: "warn",
      details: `OSV.dev unreachable (${(e as Error).message}). Audit is UNVERIFIED, not clean; rerun when connectivity allows.`,
    };
  }
}
