import Link from "next/link";
import { IconBox, IconChevronRight, IconExternalLink, IconPlay, IconRotateCcw, IconSquare, IconTerminal, IconZap } from "@/components/icons";
import { Badge, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, cn, Dot, EmptyState, FlashError, fmtDateTime, MICRO_LABEL, relTime, StatusPill } from "@/components/ui";
import { currentRole, rollbackApp, runJobNow, stopDeploymentAction } from "@/server/actions";
import { getRuntimes, nextCronRuns, type RuntimeRow } from "@/server/queries";

export const dynamic = "force-dynamic";

const GROUPS: Array<{ id: "job" | "service" | "static"; title: string; blurb: string }> = [
  { id: "job", title: "Jobs", blurb: "scheduled and manual runs on cron" },
  { id: "service", title: "Services", blurb: "long-running processes behind health checks" },
  { id: "static", title: "Static", blurb: "published snapshots served verbatim" },
];

function Controls({ row, role }: { row: RuntimeRow; role: string }) {
  const back = "/runtimes";
  const canOperate = ["platform_reviewer", "platform_admin"].includes(role);
  const canRunJob = ["platform_reviewer", "platform_admin", "owner"].includes(role);
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {row.kind === "job" && canRunJob && row.desiredState === "running" && (
        <form action={runJobNow}>
          <input type="hidden" name="deploymentId" value={row.deploymentId} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className={BTN_PRIMARY}>
            <IconPlay size={11} /> Run now
          </button>
        </form>
      )}
      {row.publicPath && (
        <a href={row.publicPath} target="_blank" rel="noreferrer" className={BTN_SECONDARY}>
          {row.kind === "service" ? "healthz" : "open"} <IconExternalLink size={11} />
        </a>
      )}
      <Link href={`/apps/${row.appSlug}?tab=runtime`} className={BTN_SECONDARY}>
        <IconTerminal size={11} /> logs
      </Link>
      {canOperate && row.desiredState === "running" && row.kind !== "static" && (
        <form action={stopDeploymentAction}>
          <input type="hidden" name="appId" value={row.appId} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className={BTN_DANGER}>
            <IconSquare size={10} /> Stop
          </button>
        </form>
      )}
      {canOperate && row.actualState === "running" && row.kind !== "static" && (
        <form action={rollbackApp}>
          <input type="hidden" name="appId" value={row.appId} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className={BTN_DANGER} title="Roll back to the most recent prior artifact">
            <IconRotateCcw size={11} /> Rollback
          </button>
        </form>
      )}
    </span>
  );
}

export default async function RuntimesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const role = await currentRole();
  const groups = getRuntimes();
  const all = [...groups.job, ...groups.service, ...groups.static];
  const total = all.length;
  const running = all.filter((r) => r.actualState === "running").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Mission control</h1>
          <p className="mt-0.5 text-[13px] text-stone-500">
            Desired state lives in the database; the supervisor reconciles the machine to it every ~2 seconds.
          </p>
        </div>
        <p className="text-[12.5px] tabular-nums text-stone-500">
          {running}/{total} running
        </p>
      </div>

      <FlashError message={sp.error} />

      {total === 0 && <EmptyState title="No deployments yet" body="Approved versions appear here once deployed." icon={<IconZap size={20} />} />}

      {GROUPS.map((g) => {
        const rows = groups[g.id];
        if (rows.length === 0) return null;
        const Icon = g.id === "job" ? IconZap : g.id === "service" ? IconTerminal : IconBox;
        return (
          <section key={g.id} aria-label={g.title}>
            <h2 className={cn("mb-1.5 flex flex-wrap items-center gap-2", MICRO_LABEL)}>
              <Icon size={13} /> {g.title}
              <span className="tabular-nums">({rows.length})</span>
              <span className="font-normal normal-case tracking-normal text-stone-400/80">· {g.blurb}</span>
            </h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {rows.map((r) => {
                const fires = r.kind === "job" ? nextCronRuns(r.cronSpec, r.timezone, 1) : [];
                return (
                  <li
                    key={r.deploymentId}
                    className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-2.5 transition-colors duration-150 ease-out hover:bg-stone-50/60 lg:grid-cols-[minmax(170px,1.1fr)_auto_minmax(160px,1fr)_minmax(110px,auto)_auto]"                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/apps/${r.appSlug}`}
                        className="truncate text-[13.5px] font-semibold tracking-tight text-stone-900 transition-colors duration-150 ease-out hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40"
                      >
                        {r.appName}
                      </Link>
                      {r.versionLabel && <Badge tone="slate">{r.versionLabel}</Badge>}
                    </span>

                    <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className="text-stone-400">want</span>
                      <StatusPill status={r.desiredState === "running" ? "running" : "stopped"} />
                      <IconChevronRight size={12} className="text-stone-300" />
                      <span className="text-stone-400">is</span>
                      <StatusPill status={r.actualState} />
                      {r.failureCount > 0 && (
                        <Badge tone="red">
                          <Dot tone="red" /> x{r.failureCount}
                        </Badge>
                      )}
                    </span>

                    <span className="min-w-0 text-[12px] leading-tight text-stone-500">
                      {r.kind === "job" &&
                        (r.cronSpec ? (
                          <>
                            <span className="block font-mono text-[11.5px] text-stone-700">{r.cronSpec}</span>
                            <span className="block tabular-nums text-stone-400">
                              {fires[0]
                                ? `next ${relTime(fires[0].toISOString())} · ${fmtDateTime(fires[0].toISOString()).slice(11)} ${r.timezone ?? ""}`
                                : "cron unreadable"}
                            </span>
                          </>
                        ) : (
                          <span className="text-stone-400">manual trigger only</span>
                        ))}
                      {r.kind === "service" && (
                        <>
                          <span className="block font-mono text-[11.5px] text-stone-700">port {r.port ?? "?"}</span>
                          <span className={cn("block tabular-nums", r.health?.healthy ? "text-emerald-700" : "text-amber-600")}>
                            health {r.health?.healthy ? "ok" : `fail x${r.health?.failures ?? "?"}`}
                          </span>
                        </>
                      )}
                      {r.kind === "static" && <span className="font-mono text-[11px] text-stone-400">{r.publicPath}</span>}
                    </span>

                    <span className="whitespace-nowrap text-right text-[11.5px] tabular-nums text-stone-400 lg:text-left">
                      {r.lastRunAt ? <>last run {relTime(r.lastRunAt)}</> : <>reconciled {relTime(r.updatedAt)}</>}
                    </span>

                    <Controls row={r} role={role} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
