import { cn } from "@/components/ui";

/**
 * Waypoint logomark: a route entering from the repo side, passing through the
 * waypoint diamond, continuing toward production. Drawn once, used at sidebar,
 * auth-less headers and favicon scale (the favicon variant drops the route
 * segments so the diamond stays legible at 16px).
 */
export function Logomark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
    >
      {/* route in */}
      <path d="M2 16h6.6" stroke="#A8A29E" strokeWidth={2} strokeLinecap="round" />
      {/* route out */}
      <path d="M23.4 16H30" stroke="#A8A29E" strokeWidth={2} strokeLinecap="round" />
      {/* waypoint diamond */}
      <path
        d="M16 7.9 24.1 16 16 24.1 7.9 16Z"
        fill="#047857"
        stroke="#047857"
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      {/* position dot */}
      <circle cx={16} cy={16} r={2.3} fill="#FAFAF8" />
    </svg>
  );
}

export function FaviconMark() {
  return (
    <svg width={32} height={32} viewBox="0 0 32 32" fill="none" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <path d="M16 6.5 25.5 16 16 25.5 6.5 16Z" fill="#047857" stroke="#047857" strokeWidth={2.6} strokeLinejoin="round" />
      <circle cx={16} cy={16} r={2.6} fill="#FAFAF8" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logomark size={26} />
      <span className="leading-none">
        <span className="block text-[14.5px] font-semibold tracking-tight text-stone-900">Waypoint</span>
        <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">
          Governed path
        </span>
      </span>
    </span>
  );
}
