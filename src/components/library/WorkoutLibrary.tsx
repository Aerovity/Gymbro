"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Film, Search } from "lucide-react";
import { Wordmark } from "@/components/shared/Broadcast";
import type { VastSearchResponse, VastSearchResult, VastStatus } from "@/lib/vast/types";

const fieldClass = "w-full rounded-xl border border-line bg-bg px-4 py-3 text-sm text-text placeholder:text-dim focus:border-volt";

function searchError(status: number): string {
  if (status === 401) return "The team access key was not accepted. Check it and try again.";
  if (status === 400) return "Enter a search between 3 and 500 characters.";
  if (status === 503) return "The workout library is not configured yet. Ask the project owner to connect it.";
  if (status === 504) return "The library took too long to respond. Try the search again.";
  return "The workout library could not complete this search. Try again shortly.";
}

export function WorkoutLibrary() {
  const [status, setStatus] = useState<VastStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [reload, setReload] = useState(0);
  const [accessKey, setAccessKey] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VastSearchResult[] | null>(null);
  const [selected, setSelected] = useState<VastSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playbackError, setPlaybackError] = useState(false);
  const activeSearch = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 10_000);
    fetch("/api/vast/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        const value: VastStatus = await response.json();
        if (value.provider !== "vast" || typeof value.configured !== "boolean" || typeof value.enabled !== "boolean") throw new Error("invalid status");
        setStatus(value);
        setStatusError(false);
      })
      .catch(() => { if (!disposed) setStatusError(true); })
      .finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [reload]);

  useEffect(() => () => activeSearch.current?.abort(), []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.configured || busy) return;
    activeSearch.current?.abort();
    const controller = new AbortController();
    activeSearch.current = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    setBusy(true);
    setError("");
    setResults(null);
    setSelected(null);
    setPlaybackError(false);
    try {
      const response = await fetch("/api/vast/search", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-vast-access-key": accessKey },
        body: JSON.stringify({ query: query.trim(), limit: 5 }),
      });
      if (!response.ok) throw new Error(searchError(response.status));
      const data: VastSearchResponse = await response.json();
      setResults(data.results);
      setSelected(data.results[0] ?? null);
    } catch (cause) {
      setError(controller.signal.aborted ? "The search timed out. Please try again." : cause instanceof Error ? cause.message : "Search failed. Please try again.");
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  const ready = status?.configured === true;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" aria-label="Gym Bro home"><Wordmark /></Link>
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-dim hover:text-text"><ArrowLeft className="size-4" aria-hidden />Analyse a clip</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-volt">VAST Data</p>
        <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">Workout library</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-dim">Search clips already indexed in your team’s workout collection. Describe the movement you want to find, then review the matching footage.</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-dim">Clips uploaded for analysis are not saved to this library automatically.</p>

        {!ready && (
          <section className="mt-8 rounded-2xl border border-line bg-surface p-6" aria-live="polite">
            <Film className="mb-4 size-7 text-dim" aria-hidden />
            <h2 className="text-lg font-semibold">{statusError ? "Connection status unavailable" : status ? "Library not configured" : "Checking library connection…"}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-dim">{statusError ? "We could not check the library connection. Try again shortly." : status ? "The project owner needs to connect VAST and choose an indexed workout collection. You can still upload a clip or use the cached demo from the home page." : "Checking whether a workout collection is connected."}</p>
            {statusError && <button type="button" onClick={() => { setStatusError(false); setReload((value) => value + 1); }} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm">Retry connection check</button>}
          </section>
        )}

        <form onSubmit={search} className="mt-8 grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <div>
            <label htmlFor="team-key" className="mb-2 block text-sm font-medium">Team access key</label>
            <input id="team-key" type="password" autoComplete="off" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} maxLength={512} required disabled={!ready || busy} className={fieldClass} aria-describedby="key-help" />
            <p id="key-help" className="mt-2 text-xs leading-5 text-dim">Use the library key from your project owner. It stays in this page’s memory and is not saved to browser storage.</p>
          </div>
          <div>
            <label htmlFor="workout-query" className="mb-2 block text-sm font-medium">Find a movement</label>
            <input id="workout-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="For example, a side view of a squat" minLength={3} maxLength={500} required disabled={!ready || busy} className={fieldClass} />
          </div>
          <button type="submit" disabled={!ready || busy || query.trim().length < 3 || !accessKey} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-volt px-5 py-3 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40 sm:justify-self-start"><Search className="size-4" aria-hidden />{busy ? "Searching…" : "Search workout clips"}</button>
        </form>

        {error && <p role="alert" className="mt-5 rounded-xl border border-signal/40 bg-signal/10 p-4 text-sm text-signal">{error}</p>}
        <div aria-live="polite" className="mt-6 text-sm text-dim">{busy ? "Searching the indexed workout collection…" : results?.length === 0 ? "No matching clips found in this collection. Try a different description." : results ? `${results.length} matching ${results.length === 1 ? "clip" : "clips"}` : null}</div>

        {!!results?.length && (
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[1fr_1.5fr]">
            <ul className="space-y-3" aria-label="Matching workout clips">
              {results.map((result) => (
                <li key={result.id}>
                  <button type="button" aria-pressed={selected?.id === result.id} onClick={() => { setSelected(result); setPlaybackError(false); }} className={`w-full rounded-xl border p-4 text-left transition-colors ${selected?.id === result.id ? "border-volt bg-volt/5" : "border-line bg-surface hover:bg-surface-2"}`}>
                    <span className="block break-words font-semibold">{result.title}</span>
                    <span className="mt-2 block break-words text-sm leading-6 text-dim">{result.description || "Open this clip to review the match."}</span>
                    {result.startSeconds != null && <span className="mt-2 block text-xs text-dim">Match in original video: {result.startSeconds.toFixed(1)}s{result.endSeconds != null ? ` to ${result.endSeconds.toFixed(1)}s` : ""}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <section className="overflow-hidden rounded-2xl border border-line bg-surface" aria-label="Selected workout clip">
                <video key={selected.playbackUrl} src={selected.playbackUrl} controls playsInline preload="none" className="aspect-video w-full bg-black" onError={() => setPlaybackError(true)} aria-label={selected.title} />
                <div className="p-5">
                  <h2 className="break-words font-semibold">{selected.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-dim">Search matches describe indexed footage. Review the clip before drawing conclusions about exercise form.</p>
                  {playbackError && <p role="alert" className="mt-3 text-sm text-amber">This clip could not be played. Its link may have expired, or its format may be unsupported. Search again to refresh the link.</p>}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
