"use client";
import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

/** Animated number from 0 → target (respects reduced motion). */
export function useCountUp(target: number | null | undefined, { duration = 0.6, delay = 0, from = 0 }: { duration?: number; delay?: number; from?: number } = {}) {
  const reduce = useReducedMotion();
  const [v, setV] = useState<number>(target == null ? 0 : from);
  useEffect(() => {
    if (target == null) return;
    if (reduce) {
      const id = requestAnimationFrame(() => setV(target));
      return () => cancelAnimationFrame(id);
    }
    const c = animate(from, target, { duration, delay, ease: [0.2, 0.8, 0.2, 1], onUpdate: setV });
    return () => c.stop();
  }, [target, duration, delay, from, reduce]);
  return v;
}
