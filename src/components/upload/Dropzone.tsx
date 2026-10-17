"use client";
// Video dropzone: dashed volt border on drag-over, click to browse (accept="video/*" offers camera roll / record on mobile).
import { useRef, useState, type DragEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CircleAlert, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DropzoneProps {
  onFile: (file: File) => void;
  /** Inline validation error (from the caller). */
  error?: string | null;
  className?: string;
}

export function Dropzone({ onFile, error, className }: DropzoneProps) {
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (f: File | undefined | null) => {
    if (f) onFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  };

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "group relative flex h-full min-h-[300px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed p-8 text-center transition-colors duration-200",
          over ? "border-volt bg-volt/[0.06]" : error ? "border-signal/60 bg-signal/[0.04]" : "border-line bg-surface/60 hover:border-volt/50 hover:bg-surface/80",
        )}
        onClick={() => input.current?.click()}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgb(198_255_61/0.07),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <motion.span
          animate={over && !reduce ? { y: [0, -6, 0] } : { y: 0 }}
          transition={{ duration: 0.8, repeat: over ? Infinity : 0 }}
          className={cn("flex size-20 items-center justify-center rounded-2xl ring-1 transition-colors duration-200", over ? "bg-volt text-bg ring-volt" : "bg-volt/10 text-volt ring-volt/30")}
        >
          <Upload className="size-9" aria-hidden />
        </motion.span>
        <p className="mt-6 font-display text-[clamp(26px,3vw,36px)] uppercase leading-none text-text">{over ? "Drop it" : "Drop your set"}</p>
        <p className="mt-2 text-[15px] text-dim">MP4 or MOV · 5–20 s · one set</p>
        <label className="relative mt-6 inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-volt px-5 text-[15px] font-bold text-bg shadow-[var(--shadow-glow-volt)] transition-colors hover:bg-volt/85 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-volt" onClick={(e) => e.stopPropagation()}>
          Choose a video
          <input
            ref={input}
            data-testid="dropzone-input"
            type="file"
            accept="video/*"
            className="sr-only"
            aria-label="Upload a video of your set"
            onChange={(e) => {
              take(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p className="mt-3 text-[12.5px] text-dim">On your phone you can record straight from the camera.</p>
      </div>
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[14px] text-signal">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
