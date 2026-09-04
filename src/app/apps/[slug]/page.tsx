import Link from "next/link";
import { notFound } from "next/navigation";
import {
  IconAlertTriangle,
  IconBox,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconExternalLink,
  IconHash,
  IconKey,
  IconLock,
  IconPlay,
  IconRotateCcw,
  IconSquare,
  IconTerminal,
  IconUsers,
  IconZap,
} from "@/components/icons";
import {
  Badge,
  BTN_DANGER,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  Card,
  CheckIcon,
  cn,
  Dot,
  durationBetween,
  EmptyState,
  FlashError,
  fmtDateTime,
  MICRO_LABEL,
  Mono,
  parseDbTime,
  relTime,
  shortDigest,
  ScoreDial,
  StatusPill,
  Tabs,
  TierBadge,
} from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { approveVersion, currentRole, deployVersion, rejectVersion, rollbackApp, runJobNow, stopDeploymentAction } from "@/server/actions";
import {
  countRollbackCandidates,
  getAppDetail,
  getRunLog,
  nextCronRuns,
  requiredApproverRoles,
  type AppDetail,
  type CheckRow,
} from "@/server/queries";

export const dynamic = "force-dynamic";

const KIND_ICON = { static: IconBox, job: IconZap, service: IconTerminal };

const TAB_IDS = ["overview", "validation", "review", "runtime", "identity", "history"] as const;
type TabId = (typeof TAB_IDS)[number];

function evidenceOf(c: CheckRow): string[] {
  try {
    return c.evidence_json ? (JSON.parse(c.evidence_json) as string[]) : [];
  } catch {
    return [];
  }
}

function ActionForm({
  action,
  fields,
  label,
  className,
  icon,
  disabled = false,
  disabledTitle,
}: {
  action: (fd: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  className?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        className={className ?? BTN_GHOST}
      >
        {icon}
        {label}
      </button>
    </form>
  );
}

function ReviewActions({ d, role }: { d: AppDetail; role: string }) {
  const v = d.currentVersion;
  const back = `/apps/${d.app.slug}?tab=review`;
  const approver = ["platform_reviewer", "security_reviewer", "platform_admin"].includes(role);
  if (!v || v.status !== "needs_review") {
    return (
      <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[12px] text-stone-500">
        No decision is open on this version ({v?.status.replace("_", " ") ?? "none"}).
      </p>
    );
  }
  if (!approver || role === "owner" || role === "auditor") {
    return (
      <div className="flex items-center gap-2">
        <button type="button" disabled className={BTN_PRIMARY} title="Separation of duties">
          <IconCheck size={14} /> Approve
        </button>
        <button type="button" disabled className={BTN_DANGER} title="Separation of duties">
          Reject
        </button>
        <span className="text-[11.5px] text-stone-400">Separation of duties: owners and auditors cannot review.</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        name="note"
        rows={2}
        placeholder="Decision note (recorded in the audit trail)"
        className="w-full resize-y rounded-md border border-stone-200 bg-white px-3 py-2 text-[12.5px] text-stone-800 placeholder:text-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:border-emerald-600"
      />
      <div className="flex items-center gap-2">
        <form action={approveVersion}>
          <input type="hidden" name="versionId" value={v.id} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className={BTN_PRIMARY}>
            <IconCheck size={14} /> Approve
          </button>
        </form>
        <form action={rejectVersion}>
          <input type="hidden" name="versionId" value={v.id} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className={BTN_DANGER}>
            Reject
          </button>
        </form>
      </div>
    </div>
  );
}

function Overview({ d }: { d: AppDetail }) {
  const v = d.currentVersion;
  const m = d.manifest;
  const reasons = (() => {
    try {
      return v?.risk_reasons_json ? (JSON.parse(v.risk_reasons_json) as string[]) : [];
    } catch {
      return [];
    }
  })();
  const anomalies = (() => {
    try {
      return v?.anomalies_json ? (JSON.parse(v.anomalies_json) as Array<{ note: string; basis: string; severity: string }>) : [];
    } catch {
      return [];
    }
  })();
  const blockers = d.checks.filter((c) => c.status === "fail");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Purpose" className="lg:col-span-2">
        <p className="text-[13.5px] leading-relaxed text-stone-700">{d.app.purpose}</p>
        {m?.metadata.provenance && (m.metadata.provenance.builtWith || m.metadata.provenance.migratedFrom) ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-3">
            <span className={MICRO_LABEL}>Provenance</span>
            {m.metadata.provenance.builtWith && <Badge tone="slate">built with {m.metadata.provenance.builtWith}</Badge>}
            {m.metadata.provenance.migratedFrom && <Badge tone="sky">migrated from {m.metadata.provenance.migratedFrom}</Badge>}
          </div>
        ) : null}
      </Card>

      <Card title="Risk score" subtitle="Deterministic rubric · every point traceable">
        {v?.risk_score !== null && v?.risk_score !== undefined ? (
          <div className="flex items-start gap-3">
            <ScoreDial score={v.risk_score} tier={d.app.tier} />
            <ul className="min-w-0 flex-1 space-y-1">
              {reasons.length === 0 ? (
                <li className="text-[12.5px] text-stone-500">No risk contributions recorded.</li>
              ) : (
                reasons.map((r, i) => (
                  <li key={i} className="font-mono text-[11.5px] leading-snug text-stone-600">
                    {r}
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : (
          <EmptyState title="Not scored yet" body="Risk is computed during gate validation." />
        )}
      </Card>

      {blockers.length > 0 && (
        <div className="lg:col-span-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-red-800">
            <IconAlertTriangle size={15} /> Hard-blocked by the deterministic gate
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-red-700">
            Blocked means blocked: no human can waive this in-tool. A waiver requires a documented offline exception by the platform admin, recorded in audit.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {blockers.map((b) => (
              <Mono key={b.key} className="rounded-md border border-red-200 bg-white px-2 py-0.5 text-red-700">
                {b.key}
              </Mono>
            ))}
          </div>
        </div>
      )}

      <Card
        title="Advisory AI notes"
        subtitle="heuristic-v0"
        className="lg:col-span-2"
        actions={
          <span className="inline-flex items-center gap-1 rounded-md bg-stone-50 px-2 py-0.5 text-[10.5px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200" title="Structurally excluded from the approval state machine">
            <IconLock size={11} /> advisory-only · cannot gate promotion
          </span>
        }
      >
        {anomalies.length === 0 ? (
          <EmptyState title="No anomalies flagged" body="Static analysis found nothing that contradicts the declared intent." />
        ) : (
          <ul className="space-y-2.5">
            {anomalies.map((a, i) => (
              <li key={i} className="rounded-md border border-amber-200/70 bg-amber-50/50 px-3 py-2">
                <p className="text-[12.5px] leading-snug text-stone-800">{a.note}</p>
                <p className="mt-0.5 font-mono text-[10.5px] text-stone-400">{a.basis}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Facts">
        <dl className="space-y-2 text-[12.5px]">
          {[
            ["Created", relTime(d.app.created_at)],
            ["Current version", v ? `${v.label}` : "—"],
            ["Digest", <span key="d" className="inline-flex items-center gap-1"><IconHash size={11} />{shortDigest(v?.manifest_digest)}</span>],
            ["Versions", String(d.versions.length)],
            ["Source dir", <span key="s" className="truncate font-mono">{v?.source_dir ?? "—"}</span>],
          ].map(([k, val], i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-stone-400">{k}</dt>
              <dd className="min-w-0 truncate text-right font-medium text-stone-700">{val}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

function Validation({ d }: { d: AppDetail }) {
  const groups: Record<"blockers" | "warn" | "pass", CheckRow[]> = { blockers: [], warn: [], pass: [] };
  for (const c of d.checks) {
    if (c.status === "pass") groups.pass.push(c);
    else if (c.status === "warn") groups.warn.push(c);
    else groups.blockers.push(c);
  }
  if (d.checks.length === 0) return <EmptyState title="No checks recorded" body="Validation has not produced findings for this version." />;
  const Section = ({ id, title, rows }: { id: string; title: string; rows: CheckRow[] }) =>
    rows.length === 0 ? null : (
      <section aria-label={title}>
        <h3 className={cn("mb-1.5", MICRO_LABEL)}>
          {title} <span className="tabular-nums">({rows.length})</span>
        </h3>
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {rows.map((c) => (
            <li key={c.key}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-3.5 py-2 transition-colors duration-150 ease-out hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 [&::-webkit-details-marker]:hidden">
                  <CheckIcon status={c.status} />
                  <span className="text-[13px] font-medium text-stone-800">{c.title}</span>
                  {c.severity === "critical" && c.status !== "pass" && <Badge tone="red">critical</Badge>}
                  <Mono className="ml-auto hidden shrink-0 text-stone-400 sm:inline">{c.key}</Mono>
                  <IconChevronRight size={14} className="shrink-0 text-stone-300 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none" />
                </summary>
                <div className="border-t border-stone-100 bg-stone-50/60 px-3.5 py-2.5 pl-[46px]">
                  <p className="text-[12.5px] leading-relaxed text-stone-600">{c.details}</p>
                  {evidenceOf(c).length > 0 && (
                    <pre className="mt-2 overflow-x-auto rounded-md border border-stone-200 bg-stone-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-200">
                      {evidenceOf(c).join("\n")}
                    </pre>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <div className="space-y-5">
      {groups.blockers.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-red-800">
            <IconAlertTriangle size={15} /> Blocking findings ({groups.blockers.length})
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-red-700">Promotion stops until these are fixed and the app is resubmitted.</p>
        </div>
      )}
      <Section id="blockers" title="Blocking" rows={groups.blockers} />
      <Section id="warn" title="Warnings" rows={groups.warn} />
      <Section id="pass" title="Passing" rows={groups.pass} />
    </div>
  );
}

function Review({ d, role }: { d: AppDetail; role: string }) {
  const v = d.currentVersion;
  const required = requiredApproverRoles(d.app.tier);
  const received = new Map<string, { decision: string; actor: string; auto: boolean; at: string }>();
  for (const r of d.reviews) {
    if (r.decision === "approved" && !received.has(r.role)) received.set(r.role, { decision: r.decision, actor: r.actor_label, auto: r.auto !== 0, at: r.at });
  }
  return (
    <div className="grid items-start gap-4 lg:grid-cols-5">
      <Card title="Review packet" subtitle="Generated deterministically at submission" className="lg:col-span-3">
        {v?.packet_md ? <Markdown source={v.packet_md} /> : <EmptyState title="No packet recorded" />}
      </Card>
      <div className="space-y-4 lg:col-span-2">
        <Card title="Approvals" subtitle={`Tier ${d.app.tier} · ${required.length === 0 ? "no human approvals required" : `${required.length} required`}`}>
          <ul className="space-y-2">
            {required.map((r) => {
              const got = received.get(r);
              return (
                <li key={r} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex items-center gap-1.5 text-stone-600">
                    <Dot tone={got ? "emerald" : "amber"} /> {r.replace("_", " ")}
                  </span>
                  {got ? (
                    <span className="flex items-center gap-1.5 font-medium text-stone-800">
                      {got.actor}
                      {got.auto && <Badge tone="slate">auto</Badge>}
                      <span className="tabular-nums text-stone-400">{relTime(got.at)}</span>
                    </span>
                  ) : (
                    <Badge tone="amber">pending</Badge>
                  )}
                </li>
              );
            })}
            {required.length === 0 && <li className="text-[12.5px] text-stone-500">Tier 1 standard change: policy-engine pre-authorizes when every check is green.</li>}
          </ul>
        </Card>
        <Card title="Decide" subtitle={role !== "owner" ? `Acting as ${role.replace("_", " ")}` : undefined}>
          <ReviewActions d={d} role={role} />
        </Card>
        <Card title="Approval timeline">
          {d.reviews.length === 0 ? (
            <EmptyState title="No decisions yet" />
          ) : (
            <ol className="relative space-y-3 border-l border-stone-200 pl-4">
              {[...d.reviews].reverse().map((r, i) => (
                <li key={i} className="relative">
                  <span className={cn("absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white", r.decision === "approved" ? "bg-emerald-600" : "bg-red-500")} aria-hidden />
                  <p className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
                    <span className="font-medium text-stone-900">{r.actor_label}</span>
                    {r.auto !== 0 && <Badge tone="slate">policy-engine</Badge>}
                    <StatusPill status={r.decision === "approved" ? "approved" : "rejected"} />
                    <span className="ml-auto tabular-nums text-[11.5px] text-stone-400">{relTime(r.at)}</span>
                  </p>
                  {r.note && <p className="mt-0.5 text-[12px] italic leading-snug text-stone-500">&ldquo;{r.note}&rdquo;</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

async function Runtime({ d, role, runParam }: { d: AppDetail; role: string; runParam?: string }) {
  const dep = d.deployment;
  const m = d.manifest;
  const jm = m?.spec.job;
  const sm = m?.spec.service;
  const canOperate = ["platform_reviewer", "platform_admin"].includes(role);
  const canRunJob = ["platform_reviewer", "platform_admin", "owner"].includes(role);
  const selected = runParam ? d.runs.find((r) => r.id === runParam) : undefined;
  const logData = selected && selected.log_file ? await getRunLog(selected.id) : null;

  return (
    <div className="space-y-4">
      {!dep ? (
        <EmptyState
          title="Never deployed"
          body={
            d.currentVersion?.status === "approved"
              ? canOperate
                ? "This version is approved and ready to deploy."
                : "This version is approved; a platform reviewer or admin must deploy it."
              : "The current version has not reached an approvable state."
          }
          icon={<IconZap size={20} />}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5">
            <span className={MICRO_LABEL}>Desired</span>
            <StatusPill status={dep.desired_state === "running" ? "running" : "stopped"} />
            <IconChevronRight size={13} className="text-stone-300" />
            <span className={MICRO_LABEL}>Actual</span>
            <StatusPill status={dep.actual_state} />
            {dep.kind === "job" && dep.failure_count > 0 && (
              <Badge tone="red">
                <Dot tone="red" /> {dep.failure_count} consecutive failures
              </Badge>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {d.currentVersion && ["approved"].includes(d.currentVersion.status) && canOperate && dep.version_id !== d.currentVersion.id && (
                <ActionForm action={deployVersion} fields={{ versionId: d.currentVersion.id, back: `/apps/${d.app.slug}?tab=runtime` }} label="Deploy" className={BTN_PRIMARY} icon={<IconZap size={13} />} />
              )}
              {canOperate && dep.desired_state === "running" && dep.kind !== "job" && (
                <ActionForm action={stopDeploymentAction} fields={{ appId: d.app.id, back: `/apps/${d.app.slug}?tab=runtime` }} label="Stop" className={BTN_DANGER} icon={<IconSquare size={12} />} />
              )}
              {canOperate && dep.desired_state === "stopped" && d.currentVersion && ["live", "approved"].includes(d.currentVersion.status) && dep.version_id === d.currentVersion.id && (
                <ActionForm action={deployVersion} fields={{ versionId: d.currentVersion.id, back: `/apps/${d.app.slug}?tab=runtime` }} label="Start" className={BTN_PRIMARY} icon={<IconPlay size={13} />} />
              )}
              {countRollbackCandidates(d.app.id, d.app.current_version_id) > 0 &&
                canOperate &&
                (d.currentVersion?.status === "live" || dep.actual_state === "running") && (
                  <ActionForm
                    action={rollbackApp}
                    fields={{ appId: d.app.id, back: `/apps/${d.app.slug}?tab=runtime` }}
                    label="Rollback"
                    className={BTN_DANGER}
                    icon={<IconRotateCcw size={13} />}
                  />
                )}
              {!canOperate && (dep.desired_state === "running" || d.currentVersion?.status === "approved") && (
                <span className="text-[11.5px] text-stone-400" title="Only platform reviewer or admin may operate runtimes">
                  <IconLock size={11} className="mr-1 inline" />
                  read-only role
                </span>
              )}
            </span>
          </div>

          {dep.kind === "job" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Schedule" actions={<IconClock size={14} className="text-stone-300" />}>
                {jm?.schedule ? (
                  <>
                    <p className="font-mono text-[15px] font-semibold tracking-tight text-stone-900">{jm.schedule.cron}</p>
                    <p className="mt-0.5 text-[12px] text-stone-500">{jm.schedule.timezone}</p>
                    <dl className="mt-3 space-y-1.5 border-t border-stone-100 pt-2.5 text-[12.5px]">
                      <div className="flex justify-between"><dt className="text-stone-400">Concurrency</dt><dd className="font-medium text-stone-700">{jm.concurrencyPolicy ?? "allow"}</dd></div>
                      <div className="flex justify-between"><dt className="text-stone-400">Timeout</dt><dd className="font-medium tabular-nums text-stone-700">{jm.timeoutSeconds ?? 600}s</dd></div>
                      <div className="flex justify-between"><dt className="text-stone-400">Max retries</dt><dd className="font-medium tabular-nums text-stone-700">{jm.maxRetries ?? 0}</dd></div>
                    </dl>
                    <p className={cn("mt-3 border-t border-stone-100 pt-2.5", MICRO_LABEL)}>Next fires</p>
                    <ol className="mt-1 space-y-0.5">
                      {(() => {
                        const fires = nextCronRuns(dep.cron_spec || jm.schedule.cron, dep.timezone || jm.schedule.timezone, 3);
                        return fires.length > 0 ? (
                          fires.map((f, i) => (
                            <li key={i} className="flex items-baseline justify-between text-[12.5px] tabular-nums">
                              <span className="text-stone-600">{fmtDateTime(f.toISOString())}</span>
                              <span className="text-stone-400">{relTime(f.toISOString())}</span>
                            </li>
                          ))
                        ) : (
                          <li className="text-[12px] text-stone-400">Schedule unreadable</li>
                        );
                      })()}
                    </ol>
                  </>
                ) : (
                  <EmptyState title="No schedule declared" body="Manual runs only." />
                )}
              </Card>

              <Card title="Run history" subtitle={`${d.runs.length} recent runs`} bodyClassName="px-0 py-0">
                {d.runs.length === 0 ? (
                  <div className="p-4">
                    <EmptyState title="No runs yet" body="Trigger one manually once the schedule is armed." />
                  </div>
                ) : (
                  <table className="w-full text-left text-[12.5px]">
                    <thead>
                      <tr className="border-b border-stone-200">
                        <th className="px-4 pb-2 text-[11.5px] font-medium text-stone-500">Status</th>
                        <th className="px-2 pb-2 text-[11.5px] font-medium text-stone-500">Exit</th>
                        <th className="px-2 pb-2 text-[11.5px] font-medium text-stone-500">Trigger</th>
                        <th className="px-2 pb-2 text-[11.5px] font-medium text-stone-500">Duration</th>
                        <th className="px-4 pb-2 text-right text-[11.5px] font-medium text-stone-500">Started</th>
                        <th className="w-16 px-4 pb-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {d.runs.slice(0, 8).map((r) => (
                        <tr key={r.id} className={cn("h-10 border-b border-stone-100 transition-colors duration-150 ease-out last:border-0 hover:bg-stone-50/60", r.id === runParam && "bg-emerald-50/40")}>
                          <td className="px-4 py-1.5"><StatusPill status={r.status} /></td>
                          <td className="px-2 py-1.5 font-mono tabular-nums text-stone-600">{r.exit_code ?? "—"}</td>
                          <td className="px-2 py-1.5 text-stone-500">{r.trigger_type}</td>
                          <td className="px-2 py-1.5 tabular-nums text-stone-500">{durationBetween(r.started_at, r.finished_at)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-stone-400">{relTime(r.started_at)}</td>
                          <td className="px-4 py-1.5 text-right">
                            <Link href={`/apps/${d.app.slug}?tab=runtime&run=${r.id}`} className={BTN_GHOST}>
                              <IconTerminal size={12} /> Log
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {canRunJob && dep.desired_state === "running" && (
                  <div className="border-t border-stone-100 px-4 py-2">
                    <ActionForm action={runJobNow} fields={{ deploymentId: dep.id, back: `/apps/${d.app.slug}?tab=runtime` }} label="Run now" className={BTN_PRIMARY} icon={<IconPlay size={12} />} />
                  </div>
                )}
              </Card>

              {selected && (
                <Card
                  title={<>Run log <Mono className="ml-1 text-stone-400">{selected.id.slice(0, 8)}</Mono></>}
                  subtitle={<>{selected.log_file ?? "no file"}{logData?.truncated ? " · showing last 80 KB" : ""}</>}
                  className="lg:col-span-2"
                  bodyClassName="p-0"
                >
                  <details open>
                    <summary className="cursor-pointer list-none rounded-md px-4 py-1.5 text-[12px] font-medium text-stone-500 transition-colors duration-150 ease-out hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 [&::-webkit-details-marker]:hidden">
                      Collapse
                    </summary>
                    <pre className="max-h-96 overflow-auto bg-stone-950 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-stone-200">{logData?.log ?? "Log unavailable."}</pre>
                  </details>
                </Card>
              )}
            </div>
          )}

          {dep.kind === "service" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Endpoint" actions={<StatusPill status={dep.actual_state} />}>
                <p className="font-mono text-[15px] font-semibold tracking-tight text-stone-900">:{dep.port ?? "?"}</p>
                <a
                  href={`/s/${d.app.slug}/healthz`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-2 transition-colors duration-150 ease-out hover:text-emerald-800"
                >
                  /s/{d.app.slug}/healthz <IconExternalLink size={12} />
                </a>
                <dl className="mt-3 space-y-1.5 border-t border-stone-100 pt-2.5 text-[12.5px]">
                  <div className="flex justify-between"><dt className="text-stone-400">Health path</dt><dd className="font-mono text-stone-700">{sm?.healthCheckPath ?? "/healthz"}</dd></div>
                  <div className="flex justify-between"><dt className="text-stone-400">Restart policy</dt><dd className="font-medium text-stone-700">{sm?.restartPolicy ?? "on-failure"}</dd></div>
                  <div className="flex justify-between"><dt className="text-stone-400">Restarts this hour</dt><dd className="font-medium tabular-nums text-stone-700">{dep.restarts_this_hour}</dd></div>
                  <div className="flex justify-between"><dt className="text-stone-400">pid</dt><dd className="font-mono tabular-nums text-stone-700">{dep.pid ?? "—"}</dd></div>
                </dl>
              </Card>
              <Card title="Health state" subtitle="polled by supervisor every tick (~2s)">
                <pre className="overflow-x-auto rounded-md border border-stone-200 bg-stone-950 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-stone-200">
                  {JSON.stringify(dep.health_json ? JSON.parse(dep.health_json) : { healthy: null }, null, 2)}
                </pre>
              </Card>
            </div>
          )}

          {dep.kind === "static" && (
            <Card title="Published site" actions={<StatusPill status={dep.actual_state} />}>
              <p className="text-[12.5px] text-stone-600">
                Serves verbatim from <Mono>{m?.spec.static?.publishPath ?? "dist"}/</Mono> in the artifact snapshot.
              </p>
              <div className="mt-3">
                <a
                  href={`/r/${d.app.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className={BTN_PRIMARY}
                >
                  Open /r/{d.app.slug} <IconExternalLink size={12} />
                </a>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Identity({ d }: { d: AppDetail }) {
  const now = Date.now();
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <Card title="Leases issued" subtitle="short-lived workload identities bound to the manifest digest" className="lg:col-span-2" bodyClassName="px-0 py-0">
        {d.leases.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No leases yet" body="A lease is minted at deploy time and on every run." icon={<IconKey size={18} />} />
          </div>
        ) : (
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="px-4 pb-2 text-[11.5px] font-medium text-stone-500">Token</th>
                <th className="px-3 pb-2 text-[11.5px] font-medium text-stone-500">Scopes</th>
                <th className="hidden px-3 pb-2 text-[11.5px] font-medium text-stone-500 md:table-cell">Purpose</th>
                <th className="px-4 pb-2 text-right text-[11.5px] font-medium text-stone-500">Expires</th>
              </tr>
            </thead>
            <tbody>
              {d.leases.map((l, i) => {
                const exp = parseDbTime(l.expires_at);
                const expired = exp <= now;
                let scopes: string[] = [];
                try {
                  scopes = JSON.parse(l.scopes_json) as string[];
                } catch {}
                return (
                  <tr key={i} className="h-10 border-b border-stone-100 transition-colors duration-150 ease-out last:border-0 hover:bg-stone-50/60">
                    <td className="px-4 py-2 font-mono text-[11px] text-stone-500">{l.token.slice(0, 24)}…</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {scopes.slice(0, 3).map((s) => (
                          <Badge key={s} tone="slate">
                            {s}
                          </Badge>
                        ))}
                        {scopes.length > 3 && <Badge tone="slate">+{scopes.length - 3}</Badge>}
                        {scopes.length === 0 && <span className="text-stone-300">—</span>}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <Badge tone={l.purpose === "deploy" ? "emerald" : "blue"}>{l.purpose}</Badge>
                    </td>
                    <td className={cn("px-4 py-2 text-right tabular-nums", expired ? "text-stone-400" : "text-stone-600")}>
                      {expired ? "expired" : relTime(l.expires_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Identity model">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-stone-600">
          <li className="flex gap-2"><IconClock size={14} className="mt-0.5 shrink-0 text-stone-400" /> Short-lived TTLs (15–60 min); nothing persists past its purpose.</li>
          <li className="flex gap-2"><IconKey size={14} className="mt-0.5 shrink-0 text-stone-400" /> Scopes derive only from declared resources in the manifest.</li>
          <li className="flex gap-2"><IconLock size={14} className="mt-0.5 shrink-0 text-stone-400" /> Deny-by-default: requests for undeclared resources fail closed.</li>
        </ul>
        <div className="mt-3 border-t border-stone-100 pt-2.5">
          <p className={cn("flex items-center gap-1.5", MICRO_LABEL)}>
            <IconUsers size={12} /> Enterprise mapping
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="slate">Vault Agent injection</Badge>
            <Badge tone="slate">OIDC federation</Badge>
            <Badge tone="slate">SPIFFE SVIDs</Badge>
            <Badge tone="slate">gMSA (Windows)</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}

function History({ d }: { d: AppDetail }) {
  if (d.versions.length === 0) return <EmptyState title="No versions" />;
  return (
    <ol className="relative space-y-0 border-l border-stone-200 pl-5">
      {d.versions.map((v, i) => (
        <li key={v.id} className={cn("relative pb-5", i === 0 && "pb-1")}>
          <span
            className={cn(
              "absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2",
              v.id === d.app.current_version_id ? "border-emerald-600 bg-emerald-600" : "border-stone-300 bg-white",
            )}
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Mono className="font-semibold text-stone-900">{v.label}</Mono>
            {v.id === d.app.current_version_id && <Badge tone="emerald">current</Badge>}
            <StatusPill status={v.status} />
            <span className="ml-auto flex items-center gap-1.5 text-[11.5px] tabular-nums text-stone-400">
              <IconHash size={11} />
              {shortDigest(v.manifest_digest)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-stone-500">
            submitted by <span className="font-mono">{v.submitted_by}</span> · {relTime(v.created_at)}
            {v.risk_score !== null && <> · risk <span className="tabular-nums font-medium">{v.risk_score}</span></>}
          </p>
        </li>
      ))}
    </ol>
  );
}

export default async function AppPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; run?: string; error?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const d = getAppDetail(slug);
  if (!d) notFound();
  const role = await currentRole();
  const tab: TabId = (TAB_IDS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as TabId) : "overview";
  const Icon = KIND_ICON[d.app.kind];
  const v = d.currentVersion;

  return (
    <div className="space-y-4">
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-500">
            <Icon size={15} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-stone-900">{d.app.name}</h1>
            <p className="font-mono text-[11.5px] text-stone-400">{d.app.slug}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <TierBadge tier={d.app.tier} prominent />
            {v && <StatusPill status={v.status} />}
            <Badge tone="slate">
              <IconTerminal size={11} /> {d.app.kind}
            </Badge>
          </div>
        </div>
        <p className="text-[12.5px] text-stone-500">
          owned by <span className="font-mono text-stone-600">{d.app.owner_email}</span>
        </p>
      </header>

      <FlashError message={sp.error} />

      <Tabs base={`/apps/${d.app.slug}`} current={tab} tabs={TAB_IDS.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))} />

      <div className="pt-1">
        {tab === "overview" && <Overview d={d} />}
        {tab === "validation" && <Validation d={d} />}
        {tab === "review" && <Review d={d} role={role} />}
        {tab === "runtime" && <Runtime d={d} role={role} runParam={sp.run} />}
        {tab === "identity" && <Identity d={d} />}
        {tab === "history" && <History d={d} />}
      </div>
    </div>
  );
}
