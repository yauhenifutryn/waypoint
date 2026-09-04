import Link from "next/link";
import { IconArrowRight } from "@/components/icons";
import { BTN_PRIMARY } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="text-[13px] font-semibold uppercase tracking-widest text-stone-400">404</p>
      <h1 className="text-[17px] font-semibold tracking-tight text-stone-900">Nothing at this waypoint</h1>
      <p className="max-w-sm text-[13px] text-stone-500">
        The app, run, or route you followed does not exist in this governed path.
      </p>
      <Link href="/" className={BTN_PRIMARY}>
        Back to dashboard <IconArrowRight size={14} />
      </Link>
    </div>
  );
}
