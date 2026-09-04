import { Badge, Card, Mono } from "@/components/ui";
import { IconLock, IconShield } from "@/components/icons";

export const dynamic = "force-dynamic";

function Row({ k, v, children }: { k: string; v?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-stone-100 py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-52 shrink-0 text-[12.5px] font-medium text-stone-700">{k}</dt>
      <dd className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-stone-600">
        {v ?? children}
      </dd>
    </div>
  );
}

export default function PolicyPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Policy pack · baseline-v0.1</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-stone-500">
            The effective rule set the deterministic gate enforces on every submission. Read-only in the console.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200"
          title="Policy packs are versioned YAML owned by the platform admin; edits land by pull request"
        >
          <IconShield size={12} /> owned by platform admin · changes via PR
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Gate enforcement">
          <dl>
            <Row k="Secret scan" v={<span>entropy threshold <Mono className="font-semibold">3.5</Mono>, gitleaks-subset ruleset; any hit is a hard block at any tier.</span>} />
            <Row k="Licenses" v={<span>allowlist <Mono>MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD</Mono>; unknown licenses warn, denied ones block.</span>} />
            <Row k="Egress" v={<span>default-deny. Allowlist templates <Mono>*.example.invalid</Mono>, <Mono>rates.example.invalid</Mono>. Enforced at review time in MVP; network-enforced in enterprise build.</span>} />
            <Row k="Resources" v={<span>declared-vs-observed diff. Observed-but-undeclared usage hard-blocks; declared-but-unobserved warns as <Mono>stale-declaration</Mono>.</span>} />
            <Row k="SBOM" v={<span>CycloneDX 1.6 validated against CISA 2026 minimum elements; impossible SBOM is a hard block.</span>} />
            <Row k="Tests" v={<span>required from tier 2 up (<Mono>minTierWithTests: 2</Mono>); failing tests block promotion.</span>} />
          </dl>
        </Card>

        <div className="space-y-4">
          <Card title="Tiering and approvals">
            <dl>
              <Row k="Data classes" v={<span><Mono>pii</Mono> requires tier 3 floor; <Mono>finance</Mono> requires tier 2 floor.</span>} />
              <Row k="T1 trivial" v="All checks green → automatic approval by policy-engine (standard-change catalog). Owner attestation recorded." />
              <Row k="T2 standard" v="One independent platform reviewer." />
              <Row k="T3 elevated" v="Platform reviewer plus security reviewer; data-access owner notified." />
              <Row
                k="Tolerated warnings"
                v={
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone="amber">stale-declaration</Badge>
                    <span>only this warning class does not disqualify auto-approval.</span>
                  </span>
                }
              />
            </dl>
          </Card>

          <Card title="Runtime discipline">
            <dl>
              <Row k="Demotion" v={<span>3 failed runs within 24h revoke pre-authorization: deployment stops, version returns to needs_review, event audited.</span>} />
              <Row k="Rollback" v="Emergency path deploys the prior artifact first; reviewer ratifies after the fact (audited)." />
              <Row k="Separation of duties" v="Submitting owners can never approve their own work; deployer must differ from developer." />
            </dl>
          </Card>

          <Card title="AI assist boundary">
            <p className="text-[12.5px] leading-relaxed text-stone-600">
              Advisory outputs attach to review packets only. The approval state machine has no input port for them:
              <span className="mt-1.5 flex items-center gap-1.5 font-medium text-stone-800">
                <IconLock size={13} /> advisoryOnly: true, structurally enforced
              </span>
            </p>
          </Card>
        </div>
      </div>

      <p className="rounded-xl border border-stone-200 bg-stone-50/70 px-4 py-2.5 text-[11.5px] leading-relaxed text-stone-400">
        Evaluation follows explicit-permit semantics: forbid overrides permit, evaluation fails closed on over-scope. This page mirrors engine defaults compiled into the running binary; the versioned YAML source of truth lives with the platform team.
      </p>
    </div>
  );
}
