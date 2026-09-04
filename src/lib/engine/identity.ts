import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Demo workload-identity issuer. Mints short-lived HS256 JWTs bound to an app
 * version's manifest digest with scopes derived ONLY from declared resources.
 * Enterprise build swaps the issuer for Vault/OpenBao or cloud OIDC
 * federation; the contract (claims shape, TTLs, deny-by-default scope check)
 * is what this module fixes.
 */

const DEMO_SECRET =
  process.env.WAYPOINT_DEMO_VAULT_SECRET ?? "waypoint-demo-vault-secret-rotate-in-enterprise-build";

interface LeaseClaims {
  appId: string;
  versionId: string;
  commitSha?: string;
  manifestDigest: string;
  scopes: string[];
  environment: "prod";
}

interface MintOptions extends LeaseClaims {
  ttlSeconds: number;
  issuedAt?: number;
  jti?: string;
}

export interface LeaseToken {
  token: string;
  jti: string;
  expiresAt: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function mintLease(claims: MintOptions): LeaseToken {
  const iat = claims.issuedAt ?? Math.floor(Date.now() / 1000);
  const exp = iat + claims.ttlSeconds;
  const jti = claims.jti ?? randomUUID();
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: "waypoint-demo-vault",
      sub: claims.appId,
      ver: claims.versionId,
      csha: claims.commitSha,
      mdg: claims.manifestDigest,
      scopes: claims.scopes,
      env: claims.environment,
      iat,
      exp,
      jti,
    }),
  );
  const sig = createHmac("sha256", DEMO_SECRET).update(`${header}.${payload}`).digest("base64url");
  return { token: `${header}.${payload}.${sig}`, jti, expiresAt: exp };
}

export type VerifyResult =
  | { ok: true; claims: LeaseClaims & { exp: number; iat: number; jti: string } }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "app-mismatch" };

export function verifyLease(token: string, opts?: { expectedAppId?: string; now?: number }): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts;
  const expectedSig = createHmac("sha256", DEMO_SECRET).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(s);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let claimsJson: Record<string, unknown>;
  try {
    claimsJson = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  if (typeof claimsJson.exp !== "number" || now >= claimsJson.exp) return { ok: false, reason: "expired" };
  if (opts?.expectedAppId && claimsJson.sub !== opts.expectedAppId) return { ok: false, reason: "app-mismatch" };
  return {
    ok: true,
    claims: {
      appId: String(claimsJson.sub),
      versionId: String(claimsJson.ver),
      commitSha: claimsJson.csha ? String(claimsJson.csha) : undefined,
      manifestDigest: String(claimsJson.mdg),
      scopes: (claimsJson.scopes as string[]) ?? [],
      environment: "prod",
      exp: claimsJson.exp as number,
      iat: claimsJson.iat as number,
      jti: String(claimsJson.jti),
    },
  };
}

/** Scope strings derived strictly from the manifest declaration. */
export function scopesFromManifest(m: import("./types").SmallSoftwareManifest): string[] {
  const scopes: string[] = [];
  for (const r of m.resources ?? []) scopes.push(`resource:${r.name}:${r.access}`);
  for (const e of m.egress ?? []) scopes.push(`egress:${e.host}`);
  return scopes;
}
