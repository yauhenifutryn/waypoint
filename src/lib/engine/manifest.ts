import { createHash } from "node:crypto";
import { z } from "zod";
import YAML from "yaml";
import { Cron } from "croner";

const SECRETISH_ENV_NAME = /password|passwd|secret|token|api_?key|private|credential|bearer/i;

const envEntry = z
  .object({
    name: z.string().min(1),
    value: z.string().optional(),
    valueFromResource: z.string().optional(),
    source: z.literal("minted").optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const usesValue = v.value !== undefined;
    const usesMintedOrResource = v.source === "minted" || v.valueFromResource !== undefined;
    if (!usesValue && !usesMintedOrResource) {
      ctx.addIssue({ code: "custom", message: `env ${v.name}: needs value, source: minted, or valueFromResource` });
    }
    if (usesValue && SECRETISH_ENV_NAME.test(v.name)) {
      ctx.addIssue({
        code: "custom",
        message: `env ${v.name}: secret-named variables cannot carry inline values; use "source: minted"`,
      });
    }
    if (usesValue && usesMintedOrResource) {
      ctx.addIssue({ code: "custom", message: `env ${v.name}: ambiguous, value and minted/resource are exclusive` });
    }
  });

export const manifestSchema = z
  .object({
    apiVersion: z.literal("smallsoftware/v0.1"),
    kind: z.enum(["static", "job", "service"]),
    metadata: z
      .object({
        name: z.string().min(2).max(80),
        owner: z.string().email(),
        coOwners: z.array(z.string().email()).optional(),
        purpose: z.string().min(40),
        provenance: z
          .object({ builtWith: z.string().optional(), migratedFrom: z.string().optional() })
          .strict()
          .optional(),
      })
      .strict(),
    spec: z
      .object({
        job: z
          .object({
            entrypoint: z.string().min(1),
            startCommand: z.string().min(1),
            buildCommand: z.string().optional(),
            schedule: z
              .object({ cron: z.string().min(9), timezone: z.string().min(1) })
              .strict()
              .optional(),
            concurrencyPolicy: z.enum(["allow", "forbid", "replace"]).optional(),
            timeoutSeconds: z.number().int().min(1).max(86400).optional(),
            maxRetries: z.number().int().min(0).max(10).optional(),
            historyLimit: z.number().int().min(1).max(200).optional(),
          })
          .strict()
          .optional(),
        service: z
          .object({
            entrypoint: z.string().min(1),
            startCommand: z.string().min(1),
            buildCommand: z.string().optional(),
            port: z.number().int().min(1).max(65535),
            healthCheckPath: z.string().startsWith("/"),
            restartPolicy: z.enum(["always", "on-failure", "never"]).optional(),
            gracePeriodSeconds: z.number().int().min(1).max(120).optional(),
          })
          .strict()
          .optional(),
        static: z.object({ publishPath: z.string().min(1) }).strict().optional(),
      })
      .strict(),
    resources: z
      .array(
        z
          .object({
            name: z.string().min(1),
            type: z.enum(["file-share", "postgres", "mysql", "mongodb", "redis", "http-api", "sftp"]),
            classification: z.string().optional(),
            access: z.enum(["read", "write"]),
            endpoint: z.string().optional(),
            path: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    egress: z
      .array(z.object({ host: z.string().min(1), protocol: z.string().optional() }).strict())
      .optional(),
    env: z.array(envEntry).optional(),
    blastRadius: z
      .object({
        audience: z.enum(["self", "team", "department", "company"]).optional(),
        writesSharedState: z.boolean().optional(),
      })
      .strict()
      .optional(),
    riskAttestation: z
      .object({
        pii: z.boolean().optional(),
        externallyVisible: z.boolean().optional(),
        downtimeTolerance: z.string().optional(),
      })
      .strict()
      .optional(),
    tests: z.object({ required: z.boolean().optional(), command: z.string().optional() }).strict().optional(),
  })
  .strict();

export type ParseResult =
  | { ok: true; manifest: import("./types").SmallSoftwareManifest }
  | { ok: false; errors: string[] };

function isValidCron(expr: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new Cron(expr, { paused: true });
    return true;
  } catch {
    return false;
  }
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseManifest(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    return { ok: false, errors: [`YAML parse failed: ${(e as Error).message}`] };
  }

  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }

  const m = parsed.data as import("./types").SmallSoftwareManifest;
  const errors: string[] = [];

  // kind/spec coherence
  const section = m.kind === "job" ? m.spec.job : m.kind === "service" ? m.spec.service : m.spec.static;
  if (!section) errors.push(`spec.${m.kind}: manifest kind is "${m.kind}" but the spec.${m.kind} section is missing`);

  // schedule validation
  const sched = m.spec.job?.schedule;
  if (sched) {
    if (!isValidCron(sched.cron)) errors.push(`spec.job.schedule.cron: "${sched.cron}" is not a valid cron expression`);
    if (!isValidTimeZone(sched.timezone))
      errors.push(`spec.job.schedule.timezone: "${sched.timezone}" is not a known IANA timezone`);
  }

  if (m.kind === "static" && m.spec.static && m.spec.static.publishPath.startsWith("/")) {
    errors.push("spec.static.publishPath: must be a relative path inside the workspace");
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: m };
}

/** Stable canonical digest binding reviews/identity to exact validated content. */
export function digestManifest(m: import("./types").SmallSoftwareManifest): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = canonical((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonical(m))).digest("hex");
}
