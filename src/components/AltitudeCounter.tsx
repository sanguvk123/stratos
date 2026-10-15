'use client';

import { useEffect, useRef, useState } from 'react';
import { formatAltitude } from '@/lib/altitude';
import { MOTION, countValue, prefersReducedMotion } from '@/lib/motion';

/**
 * Counts a number up to its new value. The TRUE value is always `value`: the visible count is a
 * short animation toward it, and under reduced motion it simply shows `value`. It only ever animates
 * between totals the server has confirmed. `initial` is where the first count starts (default: no
 * animation on first paint); pass 0 to count a fresh result up from nothing.
 */
export function useCountUp(
  value: number,
  delayMs = 0,
  durationMs: number = MOTION.countMs,
  initial: number = value,
): number {
  const [shown, setShown] = useState(initial);
  const from = useRef(initial);

  useEffect(() => {
    if (value === from.current) return;
    if (prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    let raf = 0;
    let begin = 0;
    const timer = window.setTimeout(() => {
      const step = (now: number) => {
        if (begin === 0) begin = now;
        const elapsed = now - begin;
        setShown(countValue(start, value, elapsed, durationMs));
        if (elapsed < durationMs) raf = window.requestAnimationFrame(step);
        else from.current = value;
      };
      raf = window.requestAnimationFrame(step);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
    };
  }, [value, delayMs, durationMs]);

  return shown;
}

/** Altitude in kilometres (1 point = 1 km), with a count-up when it changes. */
export function AltitudeCounter({
  km,
  delayMs = 0,
  className = '',
  label = true,
}: {
  km: number;
  delayMs?: number;
  className?: string;
  label?: boolean;
}) {
  const shown = useCountUp(km, delayMs);
  return (
    <div className={className} aria-label={`Altitude ${formatAltitude(km)}`}>
      {label ? (
        <div className="font-display text-[0.7rem] font-extrabold uppercase tracking-[0.2em] text-sky-100/90">Altitude</div>
      ) : null}
      <div className="font-display text-4xl font-black tabular-nums leading-none text-white sm:text-5xl" aria-hidden="true">
        {formatAltitude(shown)}
      </div>
    </div>
  );
}
