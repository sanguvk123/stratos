// The motion system: one place for durations, curves and the reveal timeline, so the whole game
// moves consistently. The CSS variables in globals.css mirror these values. Pure functions only, so
// they are unit-tested; nothing here knows about React or the DOM except `prefersReducedMotion`.
//
// IMPORTANT: none of this touches the countdown. The countdown reads the server deadline directly
// (clock.ts) and is never delayed by an animation. Animations here only decorate a result that the
// server has already confirmed.

import type { RevealLevel } from './altitude';

export const MOTION = {
  /** Button press and release. */
  pressMs: 90,
  /** A pop or stamp. */
  popMs: 420,
  /** One staged reveal element. */
  revealMs: 600,
  /** Sky cross-fade between layers. */
  skyMs: 2500,
  /** A score or altitude count-up. */
  countMs: 900,
} as const;

export const EASING = {
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  launch: 'cubic-bezier(0.5, 0, 0.9, 0.4)',
} as const;

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** The integer shown `elapsedMs` into a count from `from` to `to` over `durationMs`. */
export function countValue(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return to;
  const t = easeOutCubic(elapsedMs / durationMs);
  return Math.round(from + (to - from) * t);
}

export interface RevealTimeline {
  /** When the "answer locked" stamp lands. */
  readonly lockMs: number;
  /** When the recognised answer appears. */
  readonly answerMs: number;
  /** When the tier badge pops. */
  readonly tierMs: number;
  /** When the points and altitude start counting up. */
  readonly pointsMs: number;
  /** How long a launch (rocket, speed lines, sparks) runs. */
  readonly launchSeconds: number;
  readonly speedLines: number;
  readonly sparks: number;
  /** Only the biggest answers shake the card. */
  readonly shake: boolean;
}

const TIMELINES: Readonly<Record<RevealLevel, RevealTimeline>> = {
  // 10 to 15 points: quick and clear, so a low score never feels slow or punishing.
  small: { lockMs: 0, answerMs: 250, tierMs: 550, pointsMs: 800, launchSeconds: 1.6, speedLines: 8, sparks: 0, shake: false },
  // 30 to 60 points.
  medium: { lockMs: 0, answerMs: 300, tierMs: 700, pointsMs: 1000, launchSeconds: 2.2, speedLines: 16, sparks: 8, shake: false },
  // 85 to 100 points: spectacular but still brief.
  big: { lockMs: 0, answerMs: 350, tierMs: 850, pointsMs: 1200, launchSeconds: 3.0, speedLines: 28, sparks: 18, shake: true },
};

export function revealTimeline(level: RevealLevel): RevealTimeline {
  return TIMELINES[level];
}

/** True when the user asked for less motion. Safe to call on the server (returns false there). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
