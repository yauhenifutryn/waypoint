import { describe, it, expect } from "vitest";
import { mintLease, verifyLease } from "./identity";

const claims = {
  appId: "app_invoice-reconciler",
  versionId: "v01",
  commitSha: "deadbeef",
  manifestDigest: "abc123",
  scopes: ["resource:settlements-csv:read", "resource:invoices-db:read"],
  environment: "prod" as const,
};

describe("lease minting and verification", () => {
  it("mints a token that verifies with identical claims", () => {
    const { token } = mintLease({ ...claims, ttlSeconds: 600 });
    const r = verifyLease(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.appId).toBe(claims.appId);
      expect(r.claims.scopes).toEqual(claims.scopes);
      expect(r.claims.manifestDigest).toBe(claims.manifestDigest);
    }
  });

  it("rejects an expired lease with a precise reason", () => {
    const { token } = mintLease({ ...claims, ttlSeconds: -1 });
    const r = verifyLease(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("detects payload tampering", () => {
    const { token } = mintLease({ ...claims, ttlSeconds: 600 });
    const [h, p, s] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...claims, scopes: ["resource:*"] })).toString("base64url");
    const r = verifyLease(`${h}.${forgedPayload}.${s}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature");
  });

  it("binds the lease to the requesting app", () => {
    const { token } = mintLease({ ...claims, ttlSeconds: 600 });
    const r = verifyLease(token, { expectedAppId: "app_other" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("app-mismatch");
  });
});
