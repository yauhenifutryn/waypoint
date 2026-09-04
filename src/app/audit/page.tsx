import Link from "next/link";
import { Badge, cn, EmptyState, FlashError, fmtDateTime, MICRO_LABEL, Mono, relTime } from "@/components/ui";
import { IconFileText, IconLock } from "@/components/icons";
import { getAudit, getAuditFacets } from "@/server/queries";

export const dynamic = "force-dynamic";

const ROLE_TONE: Record<string, "slate" | "emerald" | "amber" | "red" | "blue" | "sky" | "rose"> = {
  owner: "slate",
  platform_reviewer: "sky",
  security_reviewer: "rose",
  auditor: "slate",
  platform_admin: "emerald",
  "policy-engine": "blue",
};

const ACTION_LABELS: Record<string, string> = {
  version_submitted: "submitted",
  seed_submit: "seed submit",
  approval_recorded: "approval recorded",
  version_approved: "approved",
  version_rejected: "rejected",
  deploy_requested: "deploy requested",
  deployment_stopped: "deployment stopped",
  rollback: "rollback",
  demoted: "demoted",
};

function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40",
        active ? "border-stone-300 bg-stone-100 text-stone-900" : "border-stone-200 bg-white text-stone-500 hover:bg-stone-50",
      )}
    >
      {children}
    </Link>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; role?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const rows = getAudit({ limit: 100, action: sp.action, role: sp.role });
  const facets = getAuditFacets();

  const qs = (patch: { action?: string; role?: string }) => {
    const p = new URLSearchParams();
    const a = patch.action !== undefined ? patch.action : sp.action;
    const r = patch.role !== undefined ? patch.role : sp.role;
    if (a) p.set("action", a);
    if (r) p.set("role", r);
    const q = p.toString();
    return q ? `/audit?${q}` : "/audit";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Audit log</h1>
          <p className="mt-0.5 text-[13px] text-stone-500">
            Every governance event, append-only. Rows shown: {rows.length} (newest first).
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200"
          title="The log accepts inserts only; corrections appear as new compensating events"
        >
          <IconLock size={11} /> append-only · export via SQL
        </span>
      </div>

      <FlashError message={sp.error} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={MICRO_LABEL}>Action</span>
          <FilterPill href={qs({ action: undefined })} active={!sp.action}>
            all
          </FilterPill>
          {facets.actions.map((a) => (
            <FilterPill key={a} href={qs({ action: a })} active={sp.action === a}>
              {ACTION_LABELS[a] ?? a}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={MICRO_LABEL}>Role</span>
          <FilterPill href={qs({ role: undefined })} active={!sp.role}>
            all
          </FilterPill>
          {facets.roles.map((r) => (
            <FilterPill key={r} href={qs({ role: r })} active={sp.role === r}>
              {r.replace("_", " ")}
            </FilterPill>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No events match" body="Loosen the filters above." icon={<IconFileText size={20} />} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="px-4 pb-2 text-[11.5px] font-medium text-stone-500">When</th>
                <th className="px-3 pb-2 text-[11.5px] font-medium text-stone-500">Actor</th>
                <th className="px-3 pb-2 text-[11.5px] font-medium text-stone-500">Action</th>
                <th className="hidden px-3 pb-2 text-[11.5px] font-medium text-stone-500 lg:table-cell">Subject</th>
                <th className="px-4 pb-2 text-[11.5px] font-medium text-stone-500">Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i} className="h-10 border-b border-stone-100 transition-colors duration-150 ease-out last:border-0 hover:bg-stone-50/60">
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-stone-500">
                    <span title={fmtDateTime(e.ts)}>{relTime(e.ts)}</span>
                    <span className="ml-2 hidden font-mono text-[10.5px] text-stone-300 xl:inline">{fmtDateTime(e.ts).slice(11)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge tone={ROLE_TONE[e.actor_role] ?? "slate"}>{e.actor_role.replace("_", " ")}</Badge>
                    <span className="ml-2 hidden whitespace-nowrap font-mono text-[11px] text-stone-500 md:inline">{e.actor_label}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Mono className="text-stone-600">{ACTION_LABELS[e.action] ?? e.action}</Mono>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-[11px] text-stone-400 lg:table-cell">
                    {e.subject_type}:{e.subject_id.slice(0, 8)}
                  </td>
                  <td className="max-w-[420px] truncate px-4 py-2 text-stone-700" title={e.summary}>
                    {e.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
