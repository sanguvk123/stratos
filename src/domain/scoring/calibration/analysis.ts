import type { ScoringConfig } from '../config';
import { scoreAnsweredPlayer } from '../engine';
import { PPM, TIER_IDS, type TierId } from '../tiers';

// Exact (non-simulated) calibration analysis. For an answer whose true share is p, the number of
// earlier players who gave it, C_prior, is Binomial(N_prior, p). The tier is a monotone function of
// C_prior, so the whole tier distribution follows from a few cut-offs found by binary search over
// the REAL scoring engine. That keeps the harness honest: it can never drift from production code.

function tierAt(c: number, n: number, priorPpm: number, config: ScoringConfig): TierId {
  return scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm }, config).tier;
}

/**
 * cutoffs[t] = the largest C_prior in [0, n] whose tier is at least t (rarer or equal), or -1 if
 * even C_prior = 0 falls short. Index 0 is unused. cutoffs[1] is always n.
 * Tier never gets rarer as C_prior grows, so each cut-off is found by binary search.
 */
export function tierCutoffs(
  n: number,
  priorPpm: number,
  config: ScoringConfig,
): readonly number[] {
  const cut = new Array<number>(TIER_IDS.length + 1).fill(-1);
  cut[1] = n;
  for (let t = 2; t <= TIER_IDS.length; t += 1) {
    if (tierAt(0, n, priorPpm, config) < t) {
      cut[t] = -1;
      continue;
    }
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (tierAt(mid, n, priorPpm, config) >= t) lo = mid;
      else hi = mid - 1;
    }
    cut[t] = lo;
  }
  return cut;
}

const logFactorialCache: number[] = [0];

function logFactorial(n: number): number {
  while (logFactorialCache.length <= n) {
    const next = logFactorialCache.length;
    logFactorialCache.push((logFactorialCache[next - 1] ?? 0) + Math.log(next));
  }
  return logFactorialCache[n] as number;
}

function binomialPmf(c: number, n: number, p: number): number {
  if (p <= 0) return c === 0 ? 1 : 0;
  if (p >= 1) return c === n ? 1 : 0;
  const logPmf =
    logFactorial(n) -
    logFactorial(c) -
    logFactorial(n - c) +
    c * Math.log(p) +
    (n - c) * Math.log1p(-p);
  return Math.exp(logPmf);
}

/** P(tier = t) for t = 1..6 (index 0 unused), for an answer with true share p. Sums to ~1. */
export function tierDistribution(
  n: number,
  p: number,
  priorPpm: number,
  config: ScoringConfig,
): readonly number[] {
  const cut = tierCutoffs(n, priorPpm, config);
  const reach = Math.max(...cut.slice(2));
  const cdf: number[] = [];
  let running = 0;
  for (let c = 0; c <= reach; c += 1) {
    running += binomialPmf(c, n, p);
    cdf.push(Math.min(1, running));
  }
  const atLeast = (t: number): number => {
    if (t <= 1) return 1;
    if (t > TIER_IDS.length) return 0;
    const c = cut[t] as number;
    return c < 0 ? 0 : (cdf[c] as number);
  };
  const dist = new Array<number>(TIER_IDS.length + 1).fill(0);
  for (let t = 1; t <= TIER_IDS.length; t += 1) {
    dist[t] = Math.max(0, atLeast(t) - atLeast(t + 1));
  }
  return dist;
}

/** The tier a share p "deserves": the smallest tier whose lower bound p meets. Truth, not smoothed. */
export function oracleTier(p: number, config: ScoringConfig): TierId {
  const ppm = p * PPM;
  for (const [index, threshold] of config.thresholdPpm.entries()) {
    if (ppm >= threshold) return (index + 1) as TierId;
  }
  return TIER_IDS[TIER_IDS.length - 1] as TierId;
}

export interface Accuracy {
  /** Share of player outcomes within one tier of the oracle. */
  readonly withinOne: number;
  /** Share of player outcomes two or more tiers away. */
  readonly twoOrMoreAway: number;
  /** Weighted median of |awarded tier - oracle tier|. */
  readonly medianAbsError: number;
  /** Expected awarded tier over player outcomes. */
  readonly meanTier: number;
  /** Share of player outcomes in each tier (index 0 unused). */
  readonly tierMix: readonly number[];
}

/**
 * How closely awarded tiers track the true-share oracle for a whole distribution, at a given
 * earlier-population size, when the editorial priors are `priorsPpm`. Player-weighted: an answer
 * chosen by more players counts for more, which is what players actually experience.
 */
export function evaluateAccuracy(
  truth: readonly number[],
  priorsPpm: readonly number[],
  n: number,
  config: ScoringConfig,
): Accuracy {
  const errorMass = new Array<number>(TIER_IDS.length).fill(0);
  const tierMix = new Array<number>(TIER_IDS.length + 1).fill(0);
  let meanTier = 0;
  let totalWeight = 0;

  for (let i = 0; i < truth.length; i += 1) {
    const p = truth[i] as number;
    if (p <= 0) continue;
    const dist = tierDistribution(n, p, priorsPpm[i] as number, config);
    const oracle = oracleTier(p, config);
    totalWeight += p;
    for (let t = 1; t <= TIER_IDS.length; t += 1) {
      const mass = p * (dist[t] as number);
      errorMass[Math.abs(t - oracle)] = (errorMass[Math.abs(t - oracle)] as number) + mass;
      tierMix[t] = (tierMix[t] as number) + mass;
      meanTier += mass * t;
    }
  }

  const withinOne = (errorMass[0] as number) + (errorMass[1] as number);
  let cumulative = 0;
  let median = 0;
  for (let e = 0; e < errorMass.length; e += 1) {
    cumulative += errorMass[e] as number;
    if (cumulative >= totalWeight / 2) {
      median = e;
      break;
    }
  }
  return {
    withinOne: withinOne / totalWeight,
    twoOrMoreAway: 1 - withinOne / totalWeight,
    medianAbsError: median,
    meanTier: meanTier / totalWeight,
    tierMix: tierMix.map((m) => m / totalWeight),
  };
}

/**
 * The smallest earlier-population size at which a unique answer (C_prior = 0) first reaches
 * `tier`, or null if it does not within `limit`. Tier at C_prior = 0 only gets rarer as the
 * population grows, so this is a binary search.
 */
export function firstPopulationReaching(
  tier: TierId,
  priorPpm: number,
  config: ScoringConfig,
  limit = 10_000_000,
): number | null {
  if (tierAt(0, 0, priorPpm, config) >= tier) return 0;
  if (tierAt(0, limit, priorPpm, config) < tier) return null;
  let lo = 0; // does not reach
  let hi = limit; // reaches
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (tierAt(0, mid, priorPpm, config) >= tier) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The largest share of EARLIER answers that may match yours and still reach `tier`, at population
 * n (null if no number of matches reaches it). Expressed as C_prior / n.
 */
export function shareNeededForTier(
  tier: TierId,
  n: number,
  priorPpm: number,
  config: ScoringConfig,
): number | null {
  if (n === 0) return null;
  const cutoff = tierCutoffs(n, priorPpm, config)[tier] as number;
  return cutoff < 0 ? null : cutoff / n;
}
