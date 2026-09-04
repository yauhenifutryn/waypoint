import type { ReactNode } from "react";
import { cn } from "@/components/ui";

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={k} className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[11.5px] text-stone-800">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(
        <strong key={k} className="font-semibold text-stone-900">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = m[5];
      nodes.push(
        <a key={k} href={href} className="text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:decoration-emerald-600">
          {label}
        </a>,
      );
    } else {
      nodes.push(
        <em key={k} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-md border border-stone-200 bg-stone-950 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-stone-100"
        >
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? "mt-4 mb-1.5 text-base font-semibold tracking-tight first:mt-0"
          : level === 2
            ? "mt-4 mb-1.5 text-[14px] font-semibold tracking-tight first:mt-0"
            : "mt-4 mb-1 text-[13px] font-semibold uppercase tracking-wide text-stone-500 first:mt-0";
      blocks.push(
        <p key={key++} className={cn(cls, "text-stone-900")}>
          {inline(heading[2], `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-4 border-stone-200" />);
      i++;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        buf.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2 rounded-r-md border-l-2 border-emerald-300 bg-emerald-50/50 px-3 py-2 text-[13px] leading-relaxed text-stone-700"
        >
          {inline(buf.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 space-y-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-stone-700">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-stone-400" />
              <span>{inline(it, `li${key}-${j}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-1.5 space-y-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-stone-700">
              <span className="shrink-0 font-medium tabular-nums text-stone-500">{j + 1}.</span>
              <span>{inline(it, `ol${key}-${j}`)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith(">") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !/^---+\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1.5 text-[13px] leading-relaxed text-stone-700">
        {inline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className={cn("max-w-none", className)}>{blocks}</div>;
}
