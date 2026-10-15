import { MIN_PRIOR_PPM, PPM } from '../tiers';
import type { Rng } from './rng';

// Synthetic answer distributions for calibration. Each is a probability vector over a CLOSED set of
// canonical answers (§18.7), so the probabilities sum to 1. These are assumptions, not data: a
// passing simulation shows behaviour under these shapes only (§7.11, "Limits of this evidence").

export interface Distribution {
  readonly name: string;
  readonly probs: readonly number[];
}

function normalize(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => w / total);
}

/** p_i proportional to 1 / i^s over `size` answers. Larger s means a heavier head. */
export function zipf(size: number, exponent: number): Distribution {
  const weights = Array.from({ length: size }, (_, i) => 1 / Math.pow(i + 1, exponent));
  return { name: `zipf s=${exponent} K=${size}`, probs: normalize(weights) };
}

/** Every answer equally likely. The hardest case for a frequency-based tier ladder. */
export function flat(size: number): Distribution {
  return { name: `flat K=${size}`, probs: normalize(Array(size).fill(1)) };
}

/** Three dominant answers (40%, 20%, 10%) over a long tail holding the other 30%. */
export function headHeavy(tailSize = 200): Distribution {
  const tail = zipf(tailSize, 1).probs.map((p) => p * 0.3);
  return { name: `head-heavy 40/20/10 + tail ${tailSize}`, probs: [0.4, 0.2, 0.1, ...tail] };
}

export const STANDARD_FAMILIES: readonly Distribution[] = [
  zipf(300, 0.8),
  zipf(300, 1.0),
  zipf(300, 1.3),
  flat(50),
  headHeavy(),
];

/**
 * Editorial priors in ppm for a probability vector. Clamped to the 500 ppm floor and the 1,000,000
 * ceiling (§7.2). Note: the formula only ever reads ONE answer's prior, so these need not sum to
 * exactly 1,000,000 for the analysis. (Publication still enforces the exact sum, §5.7.)
 */
export function toPriorPpm(probs: readonly number[]): number[] {
  return probs.map((p) => Math.min(PPM, Math.max(MIN_PRIOR_PPM, Math.round(p * PPM))));
}

/** Priors that are wrong by a constant factor, e.g. 2 means every prior is double the truth. */
export function scaledPriors(probs: readonly number[], factor: number): number[] {
  return toPriorPpm(probs.map((p) => p * factor));
}

/** Priors where the two most popular answers have swapped places. */
export function swappedTopTwoPriors(probs: readonly number[]): number[] {
  const swapped = [...probs];
  const a = swapped[0] ?? 0;
  swapped[0] = swapped[1] ?? a;
  swapped[1] = a;
  return toPriorPpm(swapped);
}

/** Truth after a shift: `fraction` of the mass moves onto the rarest answer. */
export function shiftMassToRarest(probs: readonly number[], fraction: number): number[] {
  const shifted = probs.map((p) => p * (1 - fraction));
  const rarest = shifted.length - 1;
  shifted[rarest] = (shifted[rarest] ?? 0) + fraction;
  return shifted;
}

/** Truth after the two most popular answers swap places. */
export function swapTopTwoTruth(probs: readonly number[]): number[] {
  const swapped = [...probs];
  const a = swapped[0] ?? 0;
  swapped[0] = swapped[1] ?? a;
  swapped[1] = a;
  return swapped;
}

export function buildCdf(probs: readonly number[]): Float64Array {
  const cdf = new Float64Array(probs.length);
  let running = 0;
  for (let i = 0; i < probs.length; i += 1) {
    running += probs[i] ?? 0;
    cdf[i] = running;
  }
  return cdf;
}

/** Samples an answer index by binary search over the CDF. */
export function sampleIndex(cdf: Float64Array, rng: Rng): number {
  const u = rng() * (cdf[cdf.length - 1] ?? 1);
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cdf[mid] ?? 0) > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
