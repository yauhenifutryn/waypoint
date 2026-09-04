import path from "node:path";
import { SubmitForm, type SampleCard } from "@/components/submit-form";
import { IconCheck } from "@/components/icons";
import { MICRO_LABEL } from "@/components/ui";

export const dynamic = "force-dynamic";

const GATE_CHIPS = [
  { k: "manifest", t: "Manifest schema", d: "strict zod parse of smallsoftware.yaml" },
  { k: "entry", t: "Entrypoints resolve", d: "declared files and commands exist" },
  { k: "secrets", t: "Secret scan", d: "entropy + ruleset; any hit hard-blocks" },
  { k: "resources", t: "Declared vs observed", d: "undeclared usage blocks; stale declarations warn" },
  { k: "egress", t: "Egress allowlist", d: "default-deny at review time" },
  { k: "sbom", t: "SBOM + licenses", d: "CycloneDX 1.6 against the allowlist" },
];

const SAMPLES: Array<Omit<SampleCard, "dir">> = [
  {
    slug: "weekly-ops-report",
    name: "weekly-ops-report",
    kind: "static",
    oneLiner: "Weekly one-page delivery metrics for the ops standup.",
    note: "T1 · auto-approved shape",
  },
  {
    slug: "invoice-reconciler",
    name: "invoice-reconciler",
    kind: "job",
    oneLiner: "Weekday reconciliation of invoices vs bank settlement CSV.",
    note: "T3 · dual-approved, live on cron",
  },
  {
    slug: "stock-lookup-api",
    name: "stock-lookup-api",
    kind: "service",
    oneLiner: "Read-only internal stock price lookup with FX conversion.",
    note: "T2 · platform-approved service",
  },
  {
    slug: "customer-export",
    name: "customer-export",
    kind: "job",
    oneLiner: "Hourly customer count export for the sales dashboard.",
    note: "Blocked · undeclared secrets in code",
  },
  {
    slug: "alteryx-parity-checker",
    name: "alteryx-parity-checker",
    kind: "job",
    oneLiner: "Proves the migrated ledger pipeline matches legacy Alteryx.",
    note: "T2 · waiting in review queue",
  },
];

export default function SubmitPage() {
  const samples: SampleCard[] = SAMPLES.map((s) => ({ ...s, dir: path.join(process.cwd(), "samples", s.slug) }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Submit an app</h1>
        <p className="mt-0.5 max-w-2xl text-[13px] text-stone-500">
          Intake runs the deterministic gate before anything is reviewed. Nothing reaches a runtime until approvals are satisfied.
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white px-5 py-4">
        <p className={MICRO_LABEL}>What the deterministic gate checks</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {GATE_CHIPS.map((c) => (
            <li key={c.k} className="flex items-start gap-1.5">
              <IconCheck size={13} className="mt-0.5 shrink-0 text-emerald-600" />
              <span className="text-[12.5px] leading-snug text-stone-700">
                <span className="font-medium text-stone-900">{c.t}</span>
                <span className="block text-[11px] text-stone-400">{c.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <SubmitForm samples={samples} />

      <section aria-label="What happens next" className="rounded-xl border border-stone-200 bg-stone-50/70 px-5 py-4">
        <p className={MICRO_LABEL}>What happens next</p>
        <ol className="mt-2 grid gap-2 text-[12.5px] leading-relaxed text-stone-600 sm:grid-cols-4">
          <li>
            <span className="font-mono text-[11px] font-semibold text-emerald-700">01</span> Snapshot copied into the artifact store; manifest digest recorded.
          </li>
          <li>
            <span className="font-mono text-[11px] font-semibold text-emerald-700">02</span> Gate scores risk deterministically and assigns the tier floor.
          </li>
          <li>
            <span className="font-mono text-[11px] font-semibold text-emerald-700">03</span> T1 green shapes auto-approve; others wait in the review queue.
          </li>
          <li>
            <span className="font-mono text-[11px] font-semibold text-emerald-700">04</span> Approved versions deploy under a short-lived scoped identity.
          </li>
        </ol>
      </section>
    </div>
  );
}
