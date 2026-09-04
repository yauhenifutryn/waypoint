import Link from "next/link";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBox,
  IconCheck,
  IconChevronRight,
  IconFileText,
  IconInbox,
  IconRotateCcw,
  IconShield,
  IconSquare,
  IconZap,
} from "@/components/icons";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, Card, Dot, EmptyState, MICRO_LABEL, relTime } from "@/components/ui";
import { FUNNEL_STEPS, getAuditFacets, getDashboardStats } from "@/server/queries";

export const dynamic = "force-dynamic";

const ACTION_ICON: Record<string, typeof IconBox> = {
  version_submitted: IconBox,
  seed_submit: IconBox,
  approval_recorded: IconCheck,
  version_approved: IconCheck,
  version_rejected: IconSquare,
  deploy_requested: IconZap,
  deployment_stopped: IconSquare,
  rollback: IconRotateCcw,
  demoted: IconAlertTriangle,
};

const STEP_LABELS: Record<string, string> = {
  submitted: "Submitted",
  validating: "Validating",
  needs_review: "Review",
  approved: "Approved",
  deploying: "Deploying",
  live: "Live",
};

function StatCard({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: number | string;
  sub?: React.ReactNode;
  tone?: "emerald" | "amber" | "red" | "blue" | "slate";
}) {
  const ring = {
    emerald: "bg-emerald-600",
    amber: "bg-amber-500",
    red: "bg-red-600",
    blue: "bg-blue-600",
    slate: "bg-stone-300",
  }[tone];
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <p className={MICRO_LABEL}>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${ring}`} aria-hidden />
          {label}
        </span>
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-stone-900">{value}</p>
      {sub ? <div className="mt-1 text-[12px] leading-relaxed text-stone-500">{sub}</div> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const stats = getDashboardStats();
  const facets = getAuditFacets();
  const funnelSteps = [...FUNNEL_STEPS.filter((s) => s !== "deploying"), ...(stats.funnel["deploying"] ? ["deploying"] : [])];
  const exits = ["blocked", "rejected"].filter((s) => (stats.funnel[s] ?? 0) > 0);
  const otherExits = Object.entries(stats.funnel)
    .filter(([s]) => !FUNNEL_STEPS.includes(s) && !["blocked", "rejected"].includes(s))
    .map(([s]) => ({ s, n: stats.funnel[s] }));
  const ratio = stats.runs24h.total > 0 ? Math.round((stats.runs24h.success / stats.runs24h.total) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Fleet overview</h1>
          <p className="mt-0.5 text-[13px] text-stone-500">The governed path from local build to managed runtime.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/reviews" className={BTN_SECONDARY}>
            <IconInbox size={14} /> Review queue
            {stats.pendingReviews > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-amber-800">
                {stats.pendingReviews}
              </span>
            )}
          </Link>
          <Link href="/submit" className={BTN_PRIMARY}>
            Submit an app <IconArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live apps" value={stats.liveApps} tone="emerald" sub={`${Object.keys(stats.funnel).length} apps tracked`} />
        <StatCard label="Pending reviews" value={stats.pendingReviews} tone={stats.pendingReviews ? "amber" : "slate"} />
        <StatCard label="Blocked" value={stats.blocked} tone={stats.blocked ? "red" : "slate"} />
        <StatCard
          label="Runs · 24h"
          value={stats.runs24h.total}
          tone="blue"
          sub={
            ratio === null ? (
              "no runs yet"
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                  <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${ratio}%` }} />
                </span>
                {ratio}% ok{stats.runs24h.failed ? ` · ${stats.runs24h.failed} failed` : ""}
              </span>
            )
          }
        />
      </div>

      <Card title="Promotion pipeline" subtitle="Current versions per lifecycle state; hard exits leave the path">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3">
          {funnelSteps.map((step, i) => {
            const n = stats.funnel[step] ?? 0;
            return (
              <div key={step} className="flex items-center gap-1.5">
                {i > 0 && <IconChevronRight size={14} className="text-stone-300" aria-hidden />}
                <div
                  className={`min-w-[86px] rounded-md border px-2.5 py-1.5 ${
                    step === "live"
                      ? "border-emerald-200 bg-emerald-50"
                      : step === "needs_review"
                        ? "border-amber-200 bg-amber-50/70"
                        : "border-stone-200 bg-white"
                  }`}
                >
                  <p className="text-lg font-semibold leading-6 tabular-nums text-stone-900">{n}</p>
                  <p className="text-[11px] leading-3.5 text-stone-500">{STEP_LABELS[step]}</p>
                </div>
              </div>
            );
          })}
          {(exits.length > 0 || otherExits.length > 0) && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5 border-l border-dashed border-red-200 pl-3">
              {exits.map((e) => (
                <Badge key={e} tone="red">
                  <Dot tone="red" /> {e}: {stats.funnel[e]}
                </Badge>
              ))}
              {otherExits.map(({ s, n }) => (
                <Badge key={s} tone="slate">
                  {s}: {n}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <p className="mt-3 border-t border-stone-100 pt-2.5 text-[11.5px] leading-relaxed text-stone-400">
          Auto-approval fires only for tier 1 shapes with every check green. Repeated failed runs revoke pre-authorization and pull a live app back to review.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Recent audit activity"
          subtitle="Append-only evidence trail"
          className="lg:col-span-2"
          bodyClassName="px-0 py-0"
          actions={
            <Link href="/audit" className="text-[12px] font-medium text-emerald-700 transition-colors duration-150 ease-out hover:text-emerald-800">
              View all
            </Link>
          }
        >
          {stats.recentAudit.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No events recorded yet" />
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {stats.recentAudit.map((e, i) => {
                const Icon = ACTION_ICON[e.action] ?? IconFileText;
                return (
                  <li key={i} className="flex items-center gap-3 px-4 py-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-stone-500">
                      <Icon size={12.5} />
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[13px] text-stone-700" title={e.summary}>
                      {e.summary}
                    </p>
                    <span className="hidden shrink-0 text-[11.5px] text-stone-400 sm:inline">
                      {e.actor_label} · {e.actor_role.replace("_", " ")}
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-stone-400">{relTime(e.ts)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Quick links">
            <ul className="divide-y divide-stone-100 text-[13px]">
              {[
                { href: "/submit", label: "Submit a new app", desc: "Intake through the deterministic gate" },
                { href: "/runtimes", label: "Mission control", desc: "Jobs, services, and static sites" },
                { href: `/audit?action=${encodeURIComponent(facets.actions.includes("demoted") ? "demoted" : facets.actions[0] ?? "")}`, label: "Demotions", desc: "Where pre-authorization was revoked" },
                { href: "/policy", label: "Policy pack", desc: "Effective rules, owned via PR" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="group flex items-center justify-between gap-2 py-2 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:ring-offset-1 rounded-sm">
                    <span>
                      <span className="font-medium text-stone-800 group-hover:text-emerald-800">{l.label}</span>
                      <span className="block text-[11.5px] text-stone-400">{l.desc}</span>
                    </span>
                    <IconChevronRight size={14} className="shrink-0 text-stone-300 transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-emerald-700 motion-reduce:transition-none" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Deterministic gate">
            <p className="text-[12.5px] leading-relaxed text-stone-600">
              Every submission is scored by fixed rules, not opinions:
            </p>
            <ul className="mt-2 space-y-1.5 text-[12.5px] text-stone-600">
              {["Manifest schema (strict)", "Entrypoints resolve", "Secret scan", "Declared vs observed resources", "Egress allowlist", "SBOM + licenses"].map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <IconCheck size={13} className="shrink-0 text-emerald-600" />
                  {c}
                </li>
              ))}
            </ul>
            <Link href="/policy" className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 hover:text-emerald-800">
              <IconShield size={13} /> Read the policy pack
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
