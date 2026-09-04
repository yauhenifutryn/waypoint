import Link from "next/link";
import { IconBox, IconCheck, IconLock, IconTerminal, IconZap } from "@/components/icons";
import { Badge, BTN_DANGER, BTN_PRIMARY, Card, cn, Dot, EmptyState, FlashError, relTime, TierBadge } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { approveVersion, currentRole, rejectVersion } from "@/server/actions";
import { getReviewQueue } from "@/server/queries";

export const dynamic = "force-dynamic";

const KIND_ICON = { static: IconBox, job: IconZap, service: IconTerminal };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const queue = getReviewQueue();
  const role = await currentRole();
  const approver = ["platform_reviewer", "security_reviewer", "platform_admin"].includes(role);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Review queue</h1>
        <p className="mt-0.5 text-[13px] text-stone-500">
          Versions waiting on human sign-off. Approvals are role-checked server-side; the submitting owner can never review their own work.
        </p>
      </div>

      <FlashError message={sp.error} />

      {queue.length === 0 ? (
        <EmptyState
          title="Queue clear"
          body="Nothing is waiting on a human decision. Tier 1 shapes auto-approve at the gate."
          icon={<IconCheck size={20} />}
        />
      ) : (
        <div className="space-y-4">
          {queue.map((item) => {
            const Icon = KIND_ICON[(item.appKind as "job") ?? "job"] ?? IconZap;
            const receivedByRole = new Map<string, { actor: string; auto: boolean }>();
            for (const r of item.reviews) {
              if (r.decision === "approved" && !receivedByRole.has(r.role)) receivedByRole.set(r.role, { actor: r.actor_label, auto: r.auto !== 0 });
            }
            return (
              <Card key={item.versionId} bodyClassName="px-0 py-0" title={undefined}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-stone-100 px-5 py-3">
                  <Icon size={15} className="text-stone-400" />
                  <Link href={`/apps/${item.appSlug}?tab=review`} className="text-[14px] font-semibold tracking-tight text-stone-900 transition-colors duration-150 ease-out hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40">
                    {item.appName}
                  </Link>
                  <MonoSpan slug={item.appSlug} />
                  <TierBadge tier={item.tier} />
                  <span className="ml-auto flex items-center gap-2.5">
                    <ScoreInline score={item.riskScore} />
                    <span className="hidden items-center gap-1 text-[11.5px] text-stone-400 sm:flex">
                      by <span className="font-mono">{item.submittedBy}</span> · {relTime(item.createdAt)}
                    </span>
                  </span>
                </div>

                <div className="grid gap-0 lg:grid-cols-5">
                  <div className="min-w-0 px-5 py-4 lg:col-span-3">
                    <div className="flex flex-wrap items-center gap-1.5 pb-2">
                      <CountPill tone="emerald" n={item.checkCounts.pass} label="pass" />
                      <CountPill tone="amber" n={item.checkCounts.warn} label="warn" />
                      <CountPill tone="red" n={item.checkCounts.fail} label="fail" />
                      {item.failKeys.length > 0 && (
                        <span className="font-mono text-[11px] text-red-600">{item.failKeys.join(", ")}</span>
                      )}
                      <span className="ml-auto font-mono text-[11px] text-stone-400">{item.versionLabel}</span>
                    </div>
                    {item.packetMd ? (
                      <div className="max-h-72 overflow-y-auto rounded-md border border-stone-100 bg-stone-50/60 px-3.5 py-1">
                        <Markdown source={item.packetMd} />
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-stone-400">No packet attached.</p>
                    )}
                  </div>

                  <div className="space-y-3 border-t border-stone-100 px-5 py-4 lg:col-span-2 lg:border-l lg:border-t-0">
                    <ul className="space-y-1.5">
                      {item.requiredRoles.length === 0 && (
                        <li className="text-[12.5px] text-stone-500">Tier 1: no approvals required.</li>
                      )}
                      {item.requiredRoles.map((r) => {
                        const got = receivedByRole.get(r);
                        return (
                          <li key={r} className="flex items-center justify-between gap-2 text-[12.5px]">
                            <span className="flex items-center gap-1.5 text-stone-600">
                              <Dot tone={got ? "emerald" : "amber"} /> {r.replace("_", " ")}
                            </span>
                            {got ? (
                              <span className="font-medium text-stone-800">
                                {got.actor}
                                {got.auto && <span className="ml-1 text-[10.5px] font-normal text-stone-400">(auto)</span>}
                              </span>
                            ) : (
                              <Badge tone="amber">pending</Badge>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {!approver || role === "owner" || role === "auditor" ? (
                      <div className="flex items-center gap-2">
                        <button type="button" disabled className={BTN_PRIMARY} title="Separation of duties">
                          Approve
                        </button>
                        <button type="button" disabled className={BTN_DANGER} title="Separation of duties">
                          Reject
                        </button>
                        <span className="inline-flex items-center gap-1 text-[11px] leading-tight text-stone-400">
                          <IconLock size={11} /> separation of duties
                        </span>
                      </div>
                    ) : (
                      <form className="space-y-2">
                        <input type="hidden" name="versionId" value={item.versionId} />
                        <input type="hidden" name="back" value="/reviews" />
                        <textarea
                          name="note"
                          rows={2}
                          placeholder="Decision note for the audit trail"
                          className="w-full resize-y rounded-md border border-stone-200 bg-white px-3 py-2 text-[12.5px] placeholder:text-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:border-emerald-600"
                        />
                        <div className="flex items-center gap-2">
                          <button type="submit" formAction={approveVersion} className={BTN_PRIMARY}>
                            <IconCheck size={14} /> Approve
                          </button>
                          <button type="submit" formAction={rejectVersion} className={BTN_DANGER}>
                            Reject
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonoSpan({ slug }: { slug: string }) {
  return <span className="font-mono text-[11px] text-stone-400">{slug}</span>;
}

function ScoreInline({ score }: { score: number | null }) {
  if (score === null) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-stone-600 ring-1 ring-inset ring-stone-200" title="Deterministic risk score">
      risk {score}
    </span>
  );
}

function CountPill({ tone, n, label }: { tone: "emerald" | "amber" | "red"; n: number; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 tabular-nums ring-1 ring-inset",
        tone === "emerald" && "bg-emerald-50 text-emerald-700 ring-emerald-200",
        tone === "amber" && "bg-amber-50 text-amber-700 ring-amber-200",
        tone === "red" && "bg-red-50 text-red-700 ring-red-200",
      )}
    >
      <Dot tone={tone} /> {n} {label}
    </span>
  );
}
