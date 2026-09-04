import Link from "next/link";
import type { ReactNode } from "react";
import { IconAlertTriangle, IconCheck, IconChevronRight, IconXCircle } from "@/components/icons";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "slate" | "emerald" | "amber" | "red" | "blue" | "sky" | "rose";

const TONE_BADGE: Record<Tone, string> = {
  slate: "bg-stone-100 text-stone-600 ring-stone-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
};

export const MICRO_LABEL = "text-[11px] font-medium uppercase tracking-[0.08em] text-stone-400";

const TONE_DOT: Record<Tone, string> = {
  slate: "bg-stone-400",
  emerald: "bg-emerald-600",
  amber: "bg-amber-500",
  red: "bg-red-600",
  blue: "bg-blue-600",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
};

export function Dot({ tone }: { tone: Tone }) {
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />;
}

export function Badge({
  tone = "slate",
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ring-1 ring-inset",
        TONE_BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type AnyStatus =
  | "submitted" | "validating" | "blocked" | "needs_review" | "rejected"
  | "approved" | "deploying" | "live" | "retired" | "superseded"
  | "pass" | "warn" | "fail" | "error"
  | "running" | "degraded" | "failed" | "stopped"
  | "success" | "queued" | "timeout"
  | string;

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Submitted", tone: "slate" },
  validating: { label: "Validating", tone: "blue" },
  needs_review: { label: "Needs review", tone: "amber" },
  approved: { label: "Approved", tone: "emerald" },
  deploying: { label: "Deploying", tone: "blue" },
  live: { label: "Live", tone: "emerald" },
  blocked: { label: "Blocked", tone: "red" },
  rejected: { label: "Rejected", tone: "red" },
  retired: { label: "Retired", tone: "slate" },
  superseded: { label: "Superseded", tone: "slate" },
  pass: { label: "Pass", tone: "emerald" },
  warn: { label: "Warn", tone: "amber" },
  fail: { label: "Fail", tone: "red" },
  error: { label: "Error", tone: "red" },
  running: { label: "Running", tone: "blue" },
  degraded: { label: "Degraded", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
  stopped: { label: "Stopped", tone: "slate" },
  queued: { label: "Queued", tone: "slate" },
  success: { label: "Success", tone: "emerald" },
  timeout: { label: "Timeout", tone: "red" },
};

export function StatusPill({ status, className }: { status: AnyStatus; className?: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "slate" as Tone };
  return (
    <Badge tone={meta.tone} className={className}>
      <Dot tone={meta.tone} />
      {meta.label}
    </Badge>
  );
}

export function TierBadge({ tier, prominent = false }: { tier: number; prominent?: boolean }) {
  const map: Record<number, { tone: Tone; label: string; hint: string }> = {
    1: { tone: "sky", label: "T1", hint: "Trivial · standard change" },
    2: { tone: "amber", label: "T2", hint: "Standard · one reviewer" },
    3: { tone: "rose", label: "T3", hint: "Elevated · dual approval" },
  };
  const m = map[tier] ?? map[1];
  return (
    <Badge tone={m.tone} className={prominent ? "px-2.5 py-1 text-xs font-semibold" : undefined} title={m.hint}>
      {m.label}
      {prominent ? <span className="font-normal opacity-80">{m.hint.split(" · ")[0]}</span> : null}
    </Badge>
  );
}

export function CheckIcon({ status }: { status: string }) {
  if (status === "pass") return <IconCheck size={14} className="shrink-0 text-emerald-600" />;
  if (status === "warn") return <IconAlertTriangle size={14} className="shrink-0 text-amber-500" />;
  return <IconXCircle size={14} className="shrink-0 text-red-600" />;
}

export function ScoreDial({ score, tier }: { score: number; tier: number }) {
  const max = Math.max(score, tier >= 3 ? 12 : tier === 2 ? 8 : 4);
  const pct = Math.min(1, score / max);
  const r = 13;
  const circ = 2 * Math.PI * r;
  const color = tier === 3 ? "#e11d48" : tier === 2 ? "#d97706" : "#047857";
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-label={`Risk score ${score}`}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="#f5f5f4" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${circ * pct} ${circ}`}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="22" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1c1917" style={{ fontVariantNumeric: "tabular-nums" }}>
        {score}
      </text>
    </svg>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-stone-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-3">
          <div>
            <h2 className="text-[13.5px] font-semibold tracking-tight text-stone-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p> : null}
          </div>
          {actions}
        </header>
      )}
      <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-500">{icon}</span>
      ) : null}
      <p className="text-[13.5px] font-semibold tracking-tight text-stone-900">{title}</p>
      {body ? <p className="max-w-sm text-[13px] leading-relaxed text-stone-500">{body}</p> : null}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] tracking-tight", className)}>{children}</span>;
}

export function relTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const t = typeof input === "string" ? parseDbTime(input) : input.getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < -30) return futureRel(-s);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

function futureRel(s: number): string {
  if (s < 90) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export function parseDbTime(s: string): number {
  if (s.includes("T")) return Date.parse(s);
  return Date.parse(s.replace(" ", "T").endsWith("Z") ? s.replace(" ", "T") : s.replace(" ", "T") + "Z");
}

export function fmtDateTime(input: string | null | undefined): string {
  if (!input) return "—";
  const t = parseDbTime(input);
  if (Number.isNaN(t)) return input;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function durationBetween(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = parseDbTime(end) - parseDbTime(start);
  if (Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 h-8 text-[12.5px] font-medium transition duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50";
export const BTN_PRIMARY = cn(BTN_BASE, "bg-emerald-700 text-white hover:bg-emerald-800");
export const BTN_SECONDARY = cn(BTN_BASE, "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50");
export const BTN_GHOST = cn(BTN_BASE, "text-stone-600 hover:bg-stone-100");
export const BTN_DANGER = cn(BTN_BASE, "text-red-700 hover:bg-red-50");

export function FlashError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
      <IconXCircle size={15} className="mt-0.5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: Array<{ id: string; label: string }> }) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-stone-200" aria-label="Sections">
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <Link
            key={t.id}
            href={`${base}?tab=${t.id}`}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40",
              active
                ? "border-emerald-700 font-medium text-stone-900"
                : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800",
            )}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[13px] text-stone-500" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <IconChevronRight size={13} className="text-stone-300" />}
          {it.href ? (
            <Link href={it.href} className="transition-colors duration-150 ease-out hover:text-stone-800">
              {it.label}
            </Link>
          ) : (
            <span className="font-medium text-stone-800">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function shortDigest(d: string | null | undefined, n = 7): string {
  return d ? d.slice(0, n) : "—";
}
