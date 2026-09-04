export type RuntimeKind = "static" | "job" | "service";
export type Tier = 1 | 2 | 3;
export type CheckStatus = "pass" | "warn" | "fail" | "error";
export type Severity = "info" | "warn" | "critical";

export interface Finding {
  key: string;
  title: string;
  status: CheckStatus;
  severity: Severity;
  details: string;
  evidence?: string[];
}

export interface ManifestResource {
  name: string;
  type: "file-share" | "postgres" | "mysql" | "mongodb" | "redis" | "http-api" | "sftp";
  classification?: string;
  access: "read" | "write";
  endpoint?: string;
  path?: string;
}

export interface ManifestEgress {
  host: string;
  protocol?: string;
}

export interface SmallSoftwareManifest {
  apiVersion: "smallsoftware/v0.1";
  kind: RuntimeKind;
  metadata: {
    name: string;
    owner: string;
    coOwners?: string[];
    purpose: string;
    provenance?: { builtWith?: string; migratedFrom?: string };
  };
  spec: {
    job?: {
      entrypoint: string;
      startCommand: string;
      buildCommand?: string;
      schedule?: { cron: string; timezone: string };
      concurrencyPolicy?: "allow" | "forbid" | "replace";
      timeoutSeconds?: number;
      maxRetries?: number;
      historyLimit?: number;
    };
    service?: {
      entrypoint: string;
      startCommand: string;
      buildCommand?: string;
      port: number;
      healthCheckPath: string;
      restartPolicy?: "always" | "on-failure" | "never";
      gracePeriodSeconds?: number;
    };
    static?: {
      publishPath: string;
    };
  };
  resources?: ManifestResource[];
  egress?: ManifestEgress[];
  env?: Array<{
    name: string;
    value?: string;
    valueFromResource?: string;
    source?: "minted";
  }>;
  blastRadius?: {
    audience?: "self" | "team" | "department" | "company";
    writesSharedState?: boolean;
  };
  riskAttestation?: {
    pii?: boolean;
    externallyVisible?: boolean;
    downtimeTolerance?: string;
  };
  tests?: { required?: boolean; command?: string };
}

/** Behavioral profile extracted from source by static analysis. */
export interface ObservedProfile {
  filesScanned: number;
  evalUses: string[];
  dynamicImports: string[];
  processExecCalls: string[];
  socketHosts: string[];
  connectionStrings: Array<{ type: string; host: string; raw: string }>;
  urlHosts: string[];
  fsWritesOutsideWorkspace: string[];
  fsReadsAbsolute: string[];
  envVarsRead: string[];
}

export const emptyObservedProfile = (): ObservedProfile => ({
  filesScanned: 0,
  evalUses: [],
  dynamicImports: [],
  processExecCalls: [],
  socketHosts: [],
  connectionStrings: [],
  urlHosts: [],
  fsWritesOutsideWorkspace: [],
  fsReadsAbsolute: [],
  envVarsRead: [],
});

export interface RiskAssessment {
  score: number;
  tier: Tier;
  reasons: string[];
  hardBlocked: boolean;
  blockingKeys: string[];
}

export type VersionStatus =
  | "submitted"
  | "validating"
  | "blocked"
  | "needs_review"
  | "rejected"
  | "approved"
  | "deploying"
  | "live"
  | "retired"
  | "superseded";

export type Role = "owner" | "platform_reviewer" | "security_reviewer" | "auditor" | "platform_admin";

export interface ApprovalRecord {
  role: Exclude<Role, "owner" | "auditor" | "platform_admin">;
  actorLabel: string;
  decision: "approved" | "rejected";
  note?: string;
  auto: boolean;
  at: string;
}
