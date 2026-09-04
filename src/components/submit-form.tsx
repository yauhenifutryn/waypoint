"use client";

import { useActionState, useState } from "react";
import { IconBox, IconCheck, IconTerminal, IconZap } from "@/components/icons";
import { BTN_PRIMARY, cn, MICRO_LABEL } from "@/components/ui";
import { submitApp } from "@/server/actions";

export interface SampleCard {
  slug: string;
  name: string;
  kind: "static" | "job" | "service";
  oneLiner: string;
  dir: string;
  note: string;
}

const KIND_ICON = { static: IconBox, job: IconZap, service: IconTerminal };

export function SubmitForm({ samples }: { samples: SampleCard[] }) {
  const [sourcePath, setSourcePath] = useState("");
  const [state, formAction, pending] = useActionState(submitApp, null);

  return (
    <div className="space-y-5">
      <section aria-label="Pick a sample">
        <h2 className="text-[13px] font-semibold tracking-tight text-stone-900">A · Pick a sample source</h2>
        <p className="mt-0.5 text-xs text-stone-500">Selecting a card fills the path below. Samples ship with the demo repository.</p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {samples.map((s) => {
            const selected = sourcePath === s.dir;
            const Icon = KIND_ICON[s.kind];
            return (
              <button
                key={s.slug}
                type="button"
                onClick={() => setSourcePath(s.dir)}
                aria-pressed={selected}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition duration-150 ease-out hover:border-stone-300 hover:bg-stone-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40",
                  selected ? "border-emerald-600 bg-white ring-1 ring-emerald-600" : "border-stone-200 bg-white",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-stone-900">
                    <Icon size={14} className={selected ? "text-emerald-700" : "text-stone-400"} />
                    {s.name}
                  </span>
                  {selected ? (
                    <IconCheck size={14} className="text-emerald-700" />
                  ) : (
                    <span className="text-[11px] text-stone-400">{s.kind}</span>
                  )}
                </span>
                <span className="mt-1 block text-[11.5px] leading-snug text-stone-500">{s.oneLiner}</span>
                <span className={cn("mt-1 block text-[10.5px]", s.note.startsWith("Blocked") ? "text-red-600" : "text-stone-400")}>{s.note}</span>
              </button>
            );
          })}
          <form action={formAction} className="sm:col-span-2 lg:col-span-3" id="intake">
            <label htmlFor="sourcePath" className="block pt-1 text-[13px] font-semibold tracking-tight text-stone-900">
              B · Or point at any local directory
            </label>
            <p className="mt-0.5 mb-2 text-xs text-stone-500">
              Absolute path on this machine. The gate reads it read-only and copies a version snapshot into the artifact store.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="sourcePath"
                name="sourcePath"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                placeholder="/Users/you/src/my-tool"
                spellCheck={false}
                autoComplete="off"
                className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-3 font-mono text-[12.5px] text-stone-800 placeholder:text-stone-300 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:border-emerald-600"
              />
              <button
                type="submit"
                disabled={pending || !sourcePath.trim()}
                className={BTN_PRIMARY}
              >
                {pending ? "Running gate…" : "Run gate & submit"}
              </button>
            </div>
            {state?.errors?.length ? (
              <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-red-700">Gate rejected submission</p>
                <ul className="mt-1 space-y-1">
                  {state.errors.map((e, i) => (
                    <li key={i} className="font-mono text-[12px] leading-relaxed break-words text-red-800">
                      - {e}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </form>
        </div>
      </section>
    </div>
  );
}
