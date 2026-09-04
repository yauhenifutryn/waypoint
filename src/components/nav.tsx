"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Logo } from "@/components/logo";
import {
  IconArrowRight,
  IconBox,
  IconChevronRight,
  IconFileText,
  IconHome,
  IconInbox,
  IconMenu,
  IconShield,
  IconZap,
} from "@/components/icons";
import { cn } from "@/components/ui";
import { setRole } from "@/server/actions";

type Role = "owner" | "platform_reviewer" | "security_reviewer" | "auditor" | "platform_admin";

const ROLE_META: Record<Role, { label: string; dot: string }> = {
  owner: { label: "Owner", dot: "bg-stone-400" },
  platform_reviewer: { label: "Platform reviewer", dot: "bg-sky-500" },
  security_reviewer: { label: "Security reviewer", dot: "bg-rose-500" },
  auditor: { label: "Auditor", dot: "bg-stone-700" },
  platform_admin: { label: "Platform admin", dot: "bg-emerald-600" },
};

const NAV = [
  { href: "/", label: "Dashboard", icon: IconHome },
  { href: "/submit", label: "Submit", icon: IconArrowRight },
  { href: "/apps", label: "Apps", icon: IconBox },
  { href: "/reviews", label: "Reviews", icon: IconInbox, badge: true as const },
  { href: "/runtimes", label: "Runtimes", icon: IconZap },
  { href: "/audit", label: "Audit", icon: IconFileText },
  { href: "/policy", label: "Policy", icon: IconShield },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pendingReviews }: { pendingReviews: number }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40",
                active ? "bg-stone-900/[0.04] text-stone-900" : "text-stone-600 hover:bg-stone-900/[0.03] hover:text-stone-900",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={15} className={active ? "text-emerald-700" : "text-stone-400"} />
              <span className="flex-1">{item.label}</span>
              {"badge" in item && item.badge && pendingReviews > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-amber-800">
                  {pendingReviews}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({
  dbPath,
  heartbeatSeconds,
  pendingReviews,
}: {
  dbPath: string;
  heartbeatSeconds: number | null;
  pendingReviews: number;
}) {
  const live = heartbeatSeconds !== null && heartbeatSeconds <= 10;
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50/80 md:flex">
      <div className="flex items-center px-4 pb-3 pt-5">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pt-2" aria-label="Primary">
        <NavLinks pendingReviews={pendingReviews} />
      </nav>
      <footer className="border-t border-stone-200/70 px-4 py-3 text-[10.5px] leading-relaxed text-stone-400">
        <p className="truncate font-mono" title={dbPath}>
          {dbPath}
        </p>
        <p className="mt-1 flex items-center gap-1.5">
          <span
            className={cn("inline-block h-1.5 w-1.5 rounded-full", live ? "bg-emerald-500" : "bg-amber-400")}
            aria-hidden
          />
          {heartbeatSeconds === null
            ? "supervisor state unknown"
            : live
              ? `supervisor live · tick ${heartbeatSeconds}s ago`
              : `supervisor quiet ${heartbeatSeconds}s`}
        </p>
      </footer>
    </aside>
  );
}

function useCrumb(): Array<{ label: string; href?: string }> {
  const pathname = usePathname();
  if (!pathname || pathname === "/") return [{ label: "Dashboard" }];
  const labels: Record<string, string> = {
    submit: "Submit",
    apps: "Apps",
    reviews: "Review queue",
    runtimes: "Runtimes",
    audit: "Audit log",
    policy: "Policy pack",
  };
  const segs = pathname.split("/").filter(Boolean);
  const crumbs: Array<{ label: string; href?: string }> = [];
  let acc = "";
  segs.forEach((s, i) => {
    acc += `/${s}`;
    const last = i === segs.length - 1;
    if (/^[0-9a-f-]{36}$/.test(s)) return;
    if (labels[s]) crumbs.push({ label: labels[s], href: last ? undefined : acc });
    else if (i === 0 && !labels[s]) crumbs.push({ label: s, href: last ? undefined : acc });
    else crumbs.push({ label: s, href: last ? undefined : acc });
  });
  return crumbs;
}

function Crumbs() {
  const crumbs = useCrumb();
  return (
    <nav className="flex min-w-0 items-center gap-1 text-[12.5px]" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <IconChevronRight size={12} className="shrink-0 text-stone-300" />}
          <span className={cn("truncate", i === crumbs.length - 1 ? "font-semibold text-stone-800" : "text-stone-500")}>
            {c.label}
          </span>
        </span>
      ))}
    </nav>
  );
}

export function RoleSwitcher({ role, compact = false }: { role: Role; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<Role>(role);
  useEffect(() => setValue(role), [role]);
  const meta = ROLE_META[value];
  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <span className="hidden items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-stone-700 sm:inline-flex">
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden />
          Acting as {meta.label}
        </span>
      )}
      <span
        className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-700"
        title="Demo environment: roles are simulated via a cookie"
      >
        DEMO
      </span>
      <label className="relative inline-flex items-center">
        <span className="sr-only">Acting role</span>
        <select
          value={value}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value as Role;
            setValue(next);
            startTransition(() => {
              void setRole(next);
            });
          }}
          className={cn(
            "h-8 appearance-none rounded-md border border-stone-200 bg-white pl-2.5 pr-7 text-[12.5px] font-medium text-stone-700 transition-colors duration-150 ease-out hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 disabled:opacity-60",
          )}
        >
          {(Object.keys(ROLE_META) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_META[r].label}
            </option>
          ))}
        </select>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="pointer-events-none absolute right-2 text-stone-400"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </label>
    </div>
  );
}

export function TopBar({ role, pendingReviews }: { role: Role; pendingReviews: number }) {
  const [open, setOpen] = useState(false);
  const closeOnNav = () => setOpen(false);
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-3 px-4 md:px-8">
        <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="md:hidden">
          <summary
            className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition-colors duration-150 ease-out hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 [&::-webkit-details-marker]:hidden"
            aria-label="Menu"
          >
            <IconMenu size={15} />
          </summary>
          <div className="absolute left-4 right-4 top-12 rounded-xl border border-stone-200 bg-white p-2 shadow-sm" onClick={closeOnNav}>
            <NavLinks pendingReviews={pendingReviews} />
          </div>
        </details>
        <Crumbs />
        <div className="ml-auto flex items-center gap-2">
          <RoleSwitcher role={role} />
        </div>
      </div>
    </header>
  );
}

export function MobileNavList({ pendingReviews }: { pendingReviews: number }) {
  return <NavLinks pendingReviews={pendingReviews} />;
}
