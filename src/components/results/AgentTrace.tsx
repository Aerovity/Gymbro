"use client";
// "Under the hood" sheet for judges: provider attempts with timings, raw Cosmos JSON, refinement, model IDs.
import { useMemo, useRef, type ReactNode } from "react";
import { Check, CornerDownRight, Crosshair, TriangleAlert, X } from "lucide-react";
import type { ChosenMoment, ScanResult, TraceEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtMs, fmtTime } from "@/components/shared/tokens";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProviderBadge } from "./ProviderBadge";

export interface AgentTraceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trace: TraceEntry[];
  scan?: ScanResult;
  moment?: ChosenMoment;
  /** Extra model IDs to list (e.g. coach / image models). */
  models?: Record<string, string>;
}

/** Split "<think>…</think>{json}" and pretty-print the JSON part. */
function splitRaw(raw: string): { think?: string; json: string } {
  const m = raw.match(/<think>([\s\S]*?)<\/think>/i);
  const think = m?.[1]?.trim();
  const rest = raw.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
  const start = rest.search(/[[{]/);
  if (start >= 0) {
    const candidate = rest.slice(start).replace(/```\s*$/, "").trim();
    try {
      return { think, json: JSON.stringify(JSON.parse(candidate), null, 2) };
    } catch {
      /* not clean JSON; show raw */
    }
  }
  return { think, json: rest };
}

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b(true|false|null)\b/gi;
  let last = 0;
  let k = 0;
  for (let m = re.exec(json); m; m = re.exec(json)) {
    if (m.index > last) out.push(json.slice(last, m.index));
    if (m[1]) {
      out.push(
        <span key={k++} className={m[2] ? "text-cyan" : "text-volt"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3]) out.push(<span key={k++} className="text-amber">{m[3]}</span>);
    else if (m[4]) out.push(<span key={k++} className="text-signal">{m[4]}</span>);
    last = re.lastIndex;
  }
  out.push(json.slice(last));
  return out;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function AgentTrace({ open, onOpenChange, trace, scan, moment, models }: AgentTraceProps) {
  const headRef = useRef<HTMLDivElement>(null);
  const rawText = scan?.raw;
  const raw = useMemo(() => (rawText ? splitRaw(rawText) : null), [rawText]);
  const total = trace.reduce((a, t) => a + (t.ms || 0), 0);
  const max = Math.max(1, ...trace.map((t) => t.ms || 0));
  const modelList = useMemo(() => {
    const m = new Map<string, string>();
    if (scan) m.set(`scan · ${scan.provider}`, scan.model);
    for (const t of trace) if (t.model) m.set(`${t.step}${t.provider ? ` · ${t.provider}` : ""}`, t.model);
    for (const [k, v] of Object.entries(models ?? {})) m.set(k, v);
    return [...m.entries()];
  }, [scan, trace, models]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" initialFocus={headRef} className="w-full gap-0 overflow-y-auto border-line bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <SheetHeader ref={headRef} tabIndex={-1} className="sticky top-0 z-10 border-b border-line bg-surface/95 px-5 py-4 outline-none backdrop-blur">
          <SheetTitle className="font-display text-2xl uppercase tracking-wide">Agent trace</SheetTitle>
          <SheetDescription>Every model call, timing and fallback behind this verdict.</SheetDescription>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {scan && <ProviderBadge provider={scan.provider} size="sm" />}
            <span className="font-mono text-[11px] tabular text-dim">
              {trace.length} calls · {fmtMs(total)} total
            </span>
          </div>
        </SheetHeader>

        <Section title="Steps">
          <ol className="space-y-1.5">
            {trace.map((t, i) => {
              const tone = !t.ok ? "fail" : t.fallback ? "fallback" : "ok";
              return (
                <li key={i} className="rounded-xl border border-line bg-bg/40 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full",
                        tone === "ok" && "bg-volt/15 text-volt",
                        tone === "fail" && "bg-signal/15 text-signal",
                        tone === "fallback" && "bg-amber/15 text-amber",
                      )}
                      role="img"
                      aria-label={tone === "ok" ? "ok" : tone === "fail" ? "failed" : "fallback"}
                    >
                      {tone === "ok" ? <Check className="size-3" strokeWidth={3} /> : tone === "fail" ? <X className="size-3" strokeWidth={3} /> : <TriangleAlert className="size-3" />}
                    </span>
                    <span className="font-mono text-[12.5px] font-semibold uppercase tracking-wider text-text">{t.step}</span>
                    {t.provider && <ProviderBadge provider={t.provider} size="xs" />}
                    <span className="ml-auto font-mono text-[12px] tabular text-text">{fmtMs(t.ms)}</span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className={cn("h-full rounded-full", tone === "ok" ? "bg-cyan/70" : tone === "fail" ? "bg-signal" : "bg-amber")} style={{ width: `${Math.max(2, ((t.ms || 0) / max) * 100)}%` }} />
                  </div>
                  {(t.model || t.detail || t.error) && (
                    <div className="mt-1.5 space-y-0.5 font-mono text-[11px] leading-4">
                      {t.model && <div className="text-dim">{t.model}</div>}
                      {t.detail && (
                        <div className="flex items-start gap-1 text-text/80">
                          <CornerDownRight className="mt-px size-3 shrink-0" aria-hidden /> {t.detail}
                        </div>
                      )}
                      {t.error && <div className="text-signal">{t.error}</div>}
                    </div>
                  )}
                </li>
              );
            })}
            {!trace.length && <li className="text-sm text-dim">No calls yet.</li>}
          </ol>
        </Section>

        {moment && (
          <Section title="Chosen moment">
            <div className="flex items-center gap-3 rounded-xl border border-line bg-bg/40 p-3">
              <Crosshair className="size-5 text-signal" aria-hidden />
              <div className="font-mono text-[12.5px] tabular">
                {moment.refinedFrom != null ? (
                  <>
                    <span className="text-dim">Video-model peak</span> <span className="text-text">{fmtTime(moment.refinedFrom, true)}</span>
                    <span className="text-dim"> → pose refine </span>
                    <span className="font-bold text-volt">{fmtTime(moment.t, true)}</span>
                  </>
                ) : (
                  <span className="text-text">{fmtTime(moment.t, true)}</span>
                )}
                <div className="mt-0.5 text-[11px] text-dim">source: {moment.source}{moment.event ? ` · ${moment.event.issue}` : ""}</div>
              </div>
            </div>
          </Section>
        )}

        {raw && (
          <Section title="Raw video-model output" right={scan && <span className="font-mono text-[10.5px] text-dim">{scan.model}</span>}>
            {raw.think && (
              <details className="mb-2 rounded-xl border border-line bg-bg/40 p-3 text-[12px] text-dim">
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] text-dim">Reasoning trace</summary>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">{raw.think}</p>
              </details>
            )}
            <pre className="max-h-[420px] overflow-auto rounded-xl border border-line bg-[#05070a] p-3.5 font-mono text-[11.5px] leading-[1.55] text-text/85">
              <code>{highlight(raw.json)}</code>
            </pre>
          </Section>
        )}

        {modelList.length > 0 && (
          <Section title="Models">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px]">
              {modelList.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="uppercase tracking-wider text-dim">{k}</dt>
                  <dd className="truncate text-text">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}
      </SheetContent>
    </Sheet>
  );
}
