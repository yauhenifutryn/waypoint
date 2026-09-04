import Link from "next/link";
import { IconBox, IconTerminal, IconZap } from "@/components/icons";
import { Badge, cn, EmptyState, MICRO_LABEL, relTime, StatusPill, TierBadge, BTN_SECONDARY } from "@/components/ui";
import { listApps } from "@/server/queries";

export const dynamic = "force-dynamic";

const KIND_ICON = { static: IconBox, job: IconZap, service: IconTerminal };

const KINDS = ["static", "job", "service"];
const STATUSES = ["submitted", "validating", "needs_review", "approved", "live", "blocked", "rejected", "superseded"];

function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40",
        active ? "border-stone-300 bg-stone-100 text-stone-900" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50",
      )}
    >
      {children}
    </Link>
  );
}

export default async function AppsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind && KINDS.includes(sp.kind) ? sp.kind : undefined;
  const status = sp.status ?? undefined;
  const rows = listApps({ kind, status });

  const qs = (patch: { kind?: string; status?: string }) => {
    const p = new URLSearchParams();
    const k = patch.kind ?? kind;
    const s = patch.status ?? status;
    if (k) p.set("kind", k);
    if (s) p.set("status", s);
    const q = p.toString();
    return q ? `/apps?${q}` : "/apps";
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Apps</h1>
        <p className="mt-0.5 text-[13px] text-stone-500">Every repo on the governed path, at its current version.</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={MICRO_LABEL}>Kind</span>
          <FilterPill href={qs({ kind: undefined })} active={!kind}>
            All
          </FilterPill>
          {KINDS.map((k) => (
            <FilterPill key={k} href={qs({ kind: k })} active={kind === k}>
              {k}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={MICRO_LABEL}>Status</span>
          <FilterPill href={qs({ status: undefined })} active={!status}>
            All
          </FilterPill>
          {STATUSES.map((s) => (
            <FilterPill key={s} href={qs({ status: s })} active={status === s}>
              {s.replace("_", " ")}
            </FilterPill>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No apps match these filters"
          body="Adjust the filters above, or submit a new app through the intake gate."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="px-4 pb-2 text-[11.5px] font-medium text-stone-500">App</th>
                <th className="hidden px-3 pb-2 text-[11.5px] font-medium text-stone-500 sm:table-cell">Kind</th>
                <th className="px-3 pb-2 text-[11.5px] font-medium text-stone-500">Tier</th>
                <th className="px-3 pb-2 text-[11.5px] font-medium text-stone-500">Version</th>
                <th className="hidden px-3 pb-2 text-[11.5px] font-medium text-stone-500 md:table-cell">Owner</th>
                <th className="px-4 pb-2 text-right text-[11.5px] font-medium text-stone-500">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ app, versionStatus, riskScore }) => {
                const Icon = KIND_ICON[app.kind];
                return (
                  <tr key={app.id} className="group h-10 border-b border-stone-100 transition-colors duration-150 ease-out last:border-0 hover:bg-stone-50/60">
                    <td className="max-w-[260px] px-4 py-2">
                      <Link href={`/apps/${app.slug}`} className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40">
                        <Icon size={14} className="shrink-0 text-stone-400 group-hover:text-emerald-700" />
                        <span>
                          <span className="block truncate font-medium text-stone-900">{app.name}</span>
                          <span className="block truncate font-mono text-[11px] text-stone-400">{app.slug}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <Badge tone="slate">{app.kind}</Badge>
                    </td>
                    <td className="px-3 py-2" title={riskScore !== null ? `risk score ${riskScore}` : undefined}>
                      <TierBadge tier={app.tier} />
                    </td>
                    <td className="px-3 py-2">{versionStatus ? <StatusPill status={versionStatus} /> : <span className="text-stone-300">—</span>}</td>
                    <td className="hidden max-w-[180px] truncate px-3 py-2 font-mono text-[11.5px] text-stone-500 md:table-cell">{app.owner_email}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-400">{relTime(app.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <Link href="/submit" className={BTN_SECONDARY}>
          Submit another app
        </Link>
      </div>
    </div>
  );
}
