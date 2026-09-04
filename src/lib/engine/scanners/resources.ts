import type { Finding, SmallSoftwareManifest, ObservedProfile } from "../types";

export interface DeclaredVsObservedResult {
  hardViolations: Finding[];
  warnings: Finding[];
  observedEvidence: {
    resourcesSeen: Set<string>;
    egressSeen: Set<string>;
    envSeen: Set<string>;
  };
}

function hostOf(endpoint: string): string {
  return endpoint.split(":")[0].trim().toLowerCase();
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * The core trust check: the manifest is a declaration of intent; this compares
 * it against what static analysis actually observed in the code. Mismatch in
 * the "did more than declared" direction is always a hard violation.
 */
export function compareDeclaredVsObserved(
  manifest: SmallSoftwareManifest,
  observed: Partial<
    Pick<
      ObservedProfile,
      | "connectionStrings"
      | "urlHosts"
      | "socketHosts"
      | "envVarsRead"
      | "fsWritesOutsideWorkspace"
      | "fsReadsAbsolute"
    >
  >,
): DeclaredVsObservedResult {
  const connections = observed.connectionStrings ?? [];
  const urlHostsObs = observed.urlHosts ?? [];
  const socketHostsObs = observed.socketHosts ?? [];
  const envVars = observed.envVarsRead ?? [];
  const fsWrites = observed.fsWritesOutsideWorkspace ?? [];
  const fsReads = observed.fsReadsAbsolute ?? [];
  const hardViolations: Finding[] = [];
  const warnings: Finding[] = [];
  const resourcesSeen = new Set<string>();
  const egressSeen = new Set<string>();
  const envSeen = new Set<string>();

  const declaredResources = manifest.resources ?? [];
  const declaredEgress = (manifest.egress ?? []).map((e) => e.host.toLowerCase());
  const declaredEnv = new Set((manifest.env ?? []).map((e) => e.name));

  // --- undeclared database/service connections ---
  for (const conn of connections) {
    const match = declaredResources.find(
      (r) => r.type === conn.type && r.endpoint && hostOf(r.endpoint) === conn.host,
    );
    if (match) resourcesSeen.add(match.name);
    else {
      hardViolations.push({
        key: "undeclared-resource",
        title: `Connection to undeclared ${conn.type} host`,
        status: "fail",
        severity: "critical",
        details:
          `The code opens a ${conn.type} connection to "${conn.host}" but the manifest declares no such resource. ` +
          `Every data dependency must be declared so access can be scoped, reviewed and audited.`,
        evidence: [`${conn.type}://${conn.host}`],
      });
    }
  }

  // --- file share reads/writes vs declared paths ---
  const writablePaths = declaredResources.filter((r) => r.access === "write" && r.path).map((r) => normPath(r.path!));
  for (const abs of fsWrites) {
    const target = normPath(abs);
    const match = writablePaths.find((p) => target.startsWith(p));
    if (match) {
      const res = declaredResources.find((r) => normPath(r.path!) === match);
      if (res) resourcesSeen.add(res.name);
    } else {
      hardViolations.push({
        key: "undeclared-write",
        title: "Write outside workspace to undeclared location",
        status: "fail",
        severity: "critical",
        details: `The code writes to "${abs}", which is not covered by any resource declared with access: write. Undeclared writes are exactly how small tools become invisible load-bearing systems.`,
        evidence: [abs],
      });
    }
  }
  for (const abs of fsReads) {
    const target = normPath(abs);
    const match = declaredResources.find((r) => r.path && target.startsWith(normPath(r.path)));
    if (match) resourcesSeen.add(match.name);
  }

  // --- egress hosts ---
  const observedHosts = new Set([...urlHostsObs, ...socketHostsObs].map((h) => h.toLowerCase()));
  for (const host of observedHosts) {
    if (host.startsWith("<module:") || host.includes("*")) continue;
    const allowed =
      declaredEgress.some((d) => host === d || host.endsWith(`.${d}`)) ||
      declaredResources.some(
        (r) => r.type === "http-api" && r.endpoint && (host === hostOf(r.endpoint) || host.endsWith(`.${hostOf(r.endpoint)}`)),
      );
    if (allowed) {
      const viaEgress = declaredEgress.find((d) => host === d || host.endsWith(`.${d}`));
      if (viaEgress) egressSeen.add(viaEgress);
      const viaRes = declaredResources.find(
        (r) => r.type === "http-api" && r.endpoint && host === hostOf(r.endpoint),
      );
      if (viaRes) resourcesSeen.add(viaRes.name);
    } else {
      hardViolations.push({
        key: "undeclared-egress",
        title: `Network call to undeclared host "${host}"`,
        status: "fail",
        severity: "critical",
        details:
          `The code contacts "${host}", which is absent from the manifest egress allowlist. ` +
          `Declare it (or remove the call) so reviewers can judge every place data can leave.`,
        evidence: [host],
      });
    }
  }

  // --- environment variables ---
  for (const name of envVars) {
    if (declaredEnv.has(name)) envSeen.add(name);
    else {
      warnings.push({
        key: "undeclared-env-read",
        title: `Reads undeclared environment variable ${name}`,
        status: "warn",
        severity: "warn",
        details: `"${name}" is read at runtime but not declared under env. It will be absent when the platform runs this app with a minimal environment.`,
        evidence: [name],
      });
    }
  }

  // --- stale declarations (declared but never observed) ---
  for (const r of declaredResources) {
    if (!resourcesSeen.has(r.name)) {
      warnings.push({
        key: "stale-declaration",
        title: `Declared resource "${r.name}" was never referenced`,
        status: "warn",
        severity: "warn",
        details:
          `The manifest declares ${r.type} resource "${r.name}" but no reference was found in the code. ` +
          `Either the declaration is stale or usage is dynamic; confirm which.`,
      });
    }
  }
  for (const host of declaredEgress) {
    if (!egressSeen.has(host) && ![...observedHosts].some((h) => h === host || h.endsWith(`.${host}`))) {
      warnings.push({
        key: "stale-declaration",
        title: `Declared egress "${host}" was never contacted`,
        status: "warn",
        severity: "info",
        details: `Egress host "${host}" is declared but no network call to it was found. Remove stale entries to keep the declaration meaningful.`,
      });
    }
  }

  return { hardViolations, warnings, observedEvidence: { resourcesSeen, egressSeen, envSeen } };
}
