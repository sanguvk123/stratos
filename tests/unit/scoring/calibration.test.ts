import { describe, expect, it } from 'vitest';
import {
  DRAFT_PLACEHOLDER_CONFIG,
  scoreAnsweredPlayer,
  type ScoringConfig,
} from '@/domain/scoring';
import {
  evaluateAccuracy,
  firstPopulationReaching,
  oracleTier,
  shareNeededForTier,
  tierCutoffs,
  tierDistribution,
} from '@/domain/scoring/calibration/analysis';
import {
  buildCdf,
  flat,
  sampleIndex,
  scaledPriors,
  shiftMassToRarest,
  swapTopTwoTruth,
  toPriorPpm,
  zipf,
} from '@/domain/scoring/calibration/distributions';
import { mulberry32, poisson } from '@/domain/scoring/calibration/rng';
import { simulateCohorts, simulateProvisionalStability } from '@/domain/scoring/calibration/simulate';

const CONFIG = DRAFT_PLACEHOLDER_CONFIG;

describe('seeded randomness', () => {
  it('gives the same sequence for the same seed and a different one for another seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
    for (const x of seqA) expect(x).toBeGreaterThanOrEqual(0);
    for (const x of seqA) expect(x).toBeLessThan(1);
  });

  it('draws Poisson counts with roughly the requested mean', () => {
    const rng = mulberry32(99);
    const draws = Array.from({ length: 20_000 }, () => poisson(rng, 1.5));
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
    expect(mean).toBeGreaterThan(1.45);
    expect(mean).toBeLessThan(1.55);
    expect(poisson(rng, 0)).toBe(0);
  });
});

describe('distributions', () => {
  it('produces probability vectors that sum to 1', () => {
    for (const d of [zipf(300, 0.8), zipf(300, 1.3), flat(50)]) {
      expect(d.probs.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
    }
  });

  it('samples in proportion to the probabilities', () => {
    const rng = mulberry32(5);
    const cdf = buildCdf([0.7, 0.2, 0.1]);
    const counts = [0, 0, 0];
    for (let i = 0; i < 50_000; i += 1) counts[sampleIndex(cdf, rng)]! += 1;
    expect(counts[0]! / 50_000).toBeGreaterThan(0.69);
    expect(counts[0]! / 50_000).toBeLessThan(0.71);
    expect(counts[2]! / 50_000).toBeGreaterThan(0.095);
    expect(counts[2]! / 50_000).toBeLessThan(0.105);
  });

  it('clamps priors to the 500 ppm floor and 1,000,000 ceiling', () => {
    expect(toPriorPpm([0, 1e-9, 0.5, 2])).toEqual([500, 500, 500_000, 1_000_000]);
    expect(scaledPriors([0.1], 2)).toEqual([200_000]);
  });

  it('shifts and swaps truth without losing mass', () => {
    const probs = [0.5, 0.3, 0.2];
    expect(shiftMassToRarest(probs, 0.5).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    expect(shiftMassToRarest(probs, 0.5)[2]).toBeCloseTo(0.1 + 0.5, 12);
    expect(swapTopTwoTruth(probs)).toEqual([0.3, 0.5, 0.2]);
  });
});

describe('exact analysis agrees with the real engine', () => {
  it('finds tier cut-offs that match brute force over every C_prior', () => {
    for (const n of [0, 1, 7, 100, 1_000]) {
      for (const prior of [500, 50_000, 300_000]) {
        const cut = tierCutoffs(n, prior, CONFIG);
        for (let t = 2; t <= 6; t += 1) {
          let expected = -1;
          for (let c = 0; c <= n; c += 1) {
            if (scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: prior }, CONFIG).tier >= t) expected = c;
          }
          expect(cut[t]).toBe(expected);
        }
      }
    }
  });

  it('gives a tier distribution that sums to 1 and matches brute-force binomial sums', () => {
    const n = 200;
    const p = 0.03;
    const prior = 30_000;
    const dist = tierDistribution(n, p, prior, CONFIG);
    expect(dist.slice(1).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);

    // Brute force: sum the binomial pmf for each C_prior, grouped by the real engine's tier.
    const brute = new Array<number>(7).fill(0);
    let logChoose = 0;
    for (let c = 0; c <= n; c += 1) {
      if (c > 0) logChoose += Math.log(n - c + 1) - Math.log(c);
      const pmf = Math.exp(logChoose + c * Math.log(p) + (n - c) * Math.log1p(-p));
      const tier = scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: prior }, CONFIG).tier;
      brute[tier] = brute[tier]! + pmf;
    }
    for (let t = 1; t <= 6; t += 1) expect(dist[t]).toBeCloseTo(brute[t]!, 9);
  });

  it('finds the same first populations the engine tests found by linear search (§7.4)', () => {
    expect(firstPopulationReaching(5, 50_000, CONFIG)).toBe(180);
    expect(firstPopulationReaching(6, 50_000, CONFIG)).toBe(1_980);
    expect(firstPopulationReaching(5, 500, CONFIG)).toBe(81);
    expect(firstPopulationReaching(6, 500, CONFIG)).toBe(990);
    expect(firstPopulationReaching(1, 500, CONFIG)).toBe(0);
  });

  it('reports a tier as unreachable when no population gets there', () => {
    // Tier 6 is reached only when p falls below tier 5's lower bound. With that bound at 1 ppm,
    // p would have to drop under 1e-6, which needs over a million earlier players. Within a
    // 10,000-player limit the tier is genuinely out of reach.
    const unreachableTop: ScoringConfig = {
      ...CONFIG,
      thresholdPpm: [300_000, 150_000, 50_000, 10_000, 1, 0],
    };
    expect(firstPopulationReaching(6, 500, unreachableTop, 10_000)).toBeNull();
    // A tier with a generous lower bound is reachable quickly, and a rarer-than-needed tier is
    // reached at once: low probabilities map to HIGH tier numbers.
    expect(firstPopulationReaching(5, 500, unreachableTop, 10_000)).not.toBeNull();
    const generous: ScoringConfig = {
      ...CONFIG,
      thresholdPpm: [1_000_000, 900_000, 800_000, 700_000, 600_000, 0],
    };
    expect(firstPopulationReaching(2, 500, generous, 10_000)).toBe(0);
  });

  it('finds the maximum share of earlier answers allowed for a tier', () => {
    const n = 1_000;
    const share = shareNeededForTier(4, n, 50_000, CONFIG);
    expect(share).not.toBeNull();
    const c = Math.round(share! * n);
    expect(scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: 50_000 }, CONFIG).tier).toBeGreaterThanOrEqual(4);
    expect(scoreAnsweredPlayer({ cPrior: c + 1, nPrior: n, priorPpm: 50_000 }, CONFIG).tier).toBeLessThan(4);
    expect(shareNeededForTier(2, 0, 50_000, CONFIG)).toBeNull();
  });
});

describe('oracleTier uses the true share, not the smoothed estimate', () => {
  it('respects inclusive lower bounds', () => {
    expect(oracleTier(0.3, CONFIG)).toBe(1);
    expect(oracleTier(0.2999, CONFIG)).toBe(2);
    expect(oracleTier(0.15, CONFIG)).toBe(2);
    expect(oracleTier(0.0001, CONFIG)).toBe(6);
  });
});

describe('evaluateAccuracy', () => {
  it('is perfect-ish for a large cohort with correct priors on a head-heavy distribution', () => {
    const truth = zipf(300, 1.0).probs;
    const accuracy = evaluateAccuracy(truth, toPriorPpm(truth), 5_000, CONFIG);
    expect(accuracy.withinOne).toBeGreaterThan(0.95);
    expect(accuracy.tierMix.slice(1).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(accuracy.twoOrMoreAway).toBeCloseTo(1 - accuracy.withinOne, 12);
  });

  it('gets worse when the priors are badly wrong', () => {
    const truth = zipf(300, 1.0).probs;
    const right = evaluateAccuracy(truth, toPriorPpm(truth), 0, CONFIG);
    const wrong = evaluateAccuracy(truth, scaledPriors(truth, 5), 0, CONFIG);
    expect(wrong.withinOne).toBeLessThanOrEqual(right.withinOne);
  });
});

describe('Monte Carlo simulation', () => {
  it('is reproducible for a given seed', () => {
    const truth = zipf(100, 1.0).probs;
    const priors = toPriorPpm(truth);
    const a = simulateCohorts(truth, priors, 200, 5, CONFIG, 123);
    const b = simulateCohorts(truth, priors, 200, 5, CONFIG, 123);
    expect(a).toEqual(b);
  });

  it('agrees with the exact analysis on the tier mix', () => {
    const truth = zipf(100, 1.0).probs;
    const priors = toPriorPpm(truth);
    const population = 300;
    // Exact: average over arrival positions 0..population-1 of the exact tier mix at that N.
    const exact = new Array<number>(7).fill(0);
    for (let k = 0; k < population; k += 1) {
      const accuracy = evaluateAccuracy(truth, priors, k, CONFIG);
      for (let t = 1; t <= 6; t += 1) exact[t] = exact[t]! + accuracy.tierMix[t]! / population;
    }
    const simulated = simulateCohorts(truth, priors, population, 400, CONFIG, 2026);
    for (let t = 1; t <= 6; t += 1) expect(simulated.tierMix[t]).toBeCloseTo(exact[t]!, 1);
    expect(simulated.tierMix.slice(1).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
  });

  it('shows late arrivals earning at least as much as early ones on a long-tail question', () => {
    const truth = zipf(300, 1.0).probs;
    const mix = simulateCohorts(truth, toPriorPpm(truth), 800, 20, CONFIG, 77);
    expect(mix.meanPointsLastQuarter).toBeGreaterThanOrEqual(mix.meanPointsFirstQuarter - 1);
  });

  it('keeps provisional display changes bounded and reproducible', () => {
    const truth = zipf(300, 1.0).probs;
    const options = {
      baselinePlayers: 100,
      concurrentPlayers: 50,
      revisionMean: 1,
      holdEvaluations: 2,
      maxChanges: 3,
      runs: 3,
      seed: 31,
    };
    const a = simulateProvisionalStability(truth, toPriorPpm(truth), CONFIG, options);
    const b = simulateProvisionalStability(truth, toPriorPpm(truth), CONFIG, options);
    expect(a).toEqual(b);
    expect(a.playerRounds).toBeGreaterThan(0);
    expect(a.shareWithinLimit).toBeGreaterThan(0.9);
  });
});
