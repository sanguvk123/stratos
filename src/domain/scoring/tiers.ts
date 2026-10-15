// Fixed scoring constants (ARCHITECTURE.md §7.3, §7.7, §7.10).
// Point values are FIXED in code. Only the popularity thresholds are configurable and versioned.

export const TIER_IDS = [1, 2, 3, 4, 5, 6] as const;

/** Ordinal and stable: 1 = most common ... 6 = rarest. Display labels are copy, never stored. */
export type TierId = (typeof TIER_IDS)[number];

export const TIER_POINTS: Readonly<Record<TierId, number>> = {
  1: 10,
  2: 15,
  3: 30,
  4: 60,
  5: 85,
  6: 100,
};

/** 0 is the score of an unanswered or invalid response. */
export const ALLOWED_QUESTION_POINTS: ReadonlySet<number> = new Set([
  0,
  ...Object.values(TIER_POINTS),
]);

/** Parts per million. All probabilities in the scoring engine are exact integers in ppm. */
export const PPM = 1_000_000;
export const PPM_BIG = 1_000_000n;

/** A closed-set prior may never be zero (§7.2). */
export const MIN_PRIOR_PPM = 500;

export const QUESTIONS_PER_DIVE = 7;
export const METRES_PER_POINT = 10;
export const MAX_DIVE_POINTS = QUESTIONS_PER_DIVE * TIER_POINTS[6]; // 700
