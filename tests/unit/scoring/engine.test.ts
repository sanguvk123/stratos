import { describe, expect, it } from 'vitest';
import {
  assignTier,
  computeScoreFraction,
  DRAFT_PLACEHOLDER_CONFIG,
  scoreAnsweredPlayer,
  scoreUnanswered,
  ScoringInputError,
  TIER_POINTS,
  validateScoringConfig,
  type ScoringConfig,
  type TierId,
} from '@/domain/scoring';

const CONFIG = DRAFT_PLACEHOLDER_CONFIG;
const THRESHOLDS = CONFIG.thresholdPpm;
const PRIOR_5_PCT = 50_000;

describe('fixed point values', () => {
  it('maps all six tiers to 10, 15, 30, 60, 85 and 100', () => {
    expect(TIER_POINTS).toEqual({ 1: 10, 2: 15, 3: 30, 4: 60, 5: 85, 6: 100 });
  });
});

describe('assignTier: every threshold boundary (§7.3, §7.12 invariant 8)', () => {
  // Lower bound inclusive, upper bound exclusive. With denominator 1e6, the numerator is the ppm value.
  const D = 1_000_000n;
  const cases: Array<[string, bigint, TierId]> = [
    ['exactly 300,000 ppm', 300_000n, 1],
    ['299,999 ppm', 299_999n, 2],
    ['exactly 150,000 ppm', 150_000n, 2],
    ['149,999 ppm', 149_999n, 3],
    ['exactly 50,000 ppm', 50_000n, 3],
    ['49,999 ppm', 49_999n, 4],
    ['exactly 10,000 ppm', 10_000n, 4],
    ['9,999 ppm', 9_999n, 5],
    ['exactly 1,000 ppm', 1_000n, 5],
    ['999 ppm', 999n, 6],
    ['0 ppm', 0n, 6],
    ['1,000,000 ppm (certain)', 1_000_000n, 1],
  ];
  it.each(cases)('%s', (_label, numerator, expected) => {
    expect(assignTier(numerator, D, THRESHOLDS)).toBe(expected);
  });

  it('is scale-free: only the ratio matters', () => {
    expect(assignTier(15n, 100n, THRESHOLDS)).toBe(2); // 0.15 exactly
    expect(assignTier(1_500_000n, 10_000_000n, THRESHOLDS)).toBe(2);
    expect(assignTier(14_999n, 100_000n, THRESHOLDS)).toBe(3); // just under 0.15
  });

  it('lands an exact boundary produced by the real formula in the more common tier', () => {
    // alpha 20, prior 50,000 ppm: (13 + 1 + 1) / (79 + 1 + 20) = 15/100 = 0.15 exactly.
    const score = scoreAnsweredPlayer({ cPrior: 13, nPrior: 79, priorPpm: PRIOR_5_PCT }, CONFIG);
    expect(score.numerator * 100n).toBe(score.denominator * 15n); // exactly 15/100
    expect(score.tier).toBe(2);
    expect(score.points).toBe(15);
  });

  it('rejects a non-positive denominator and a negative numerator', () => {
    expect(() => assignTier(1n, 0n, THRESHOLDS)).toThrow(ScoringInputError);
    expect(() => assignTier(-1n, 10n, THRESHOLDS)).toThrow(ScoringInputError);
  });
});

describe('scoreAnsweredPlayer: worked examples (§7.4)', () => {
  const rows: Array<{ n: number; c: number; tier: TierId; fraction: [bigint, bigint] }> = [
    { n: 0, c: 0, tier: 3, fraction: [2n, 21n] },
    { n: 10, c: 0, tier: 3, fraction: [2n, 31n] },
    { n: 100, c: 0, tier: 4, fraction: [2n, 121n] },
    { n: 1_000, c: 0, tier: 5, fraction: [2n, 1_021n] },
    { n: 10_000, c: 0, tier: 6, fraction: [2n, 10_021n] },
    { n: 100, c: 40, tier: 1, fraction: [42n, 121n] },
  ];
  it.each(rows)('N_prior=$n C_prior=$c gives tier $tier', ({ n, c, tier, fraction }) => {
    const score = scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: PRIOR_5_PCT }, CONFIG);
    expect(score.tier).toBe(tier);
    expect(score.points).toBe(TIER_POINTS[tier]);
    // Same ratio as the documented exact fraction, whatever the internal scale.
    expect(score.numerator * fraction[1]).toBe(score.denominator * fraction[0]);
  });

  it('stores a floor(p * 1e9) display value that never decides the tier', () => {
    const score = scoreAnsweredPlayer({ cPrior: 0, nPrior: 0, priorPpm: PRIOR_5_PCT }, CONFIG);
    expect(score.pNano).toBe(95_238_095n); // floor(2/21 * 1e9)
  });

  it('cold start with no history relies entirely on the prior, never on the lone vote', () => {
    const rare = scoreAnsweredPlayer({ cPrior: 0, nPrior: 0, priorPpm: 500 }, CONFIG);
    const popular = scoreAnsweredPlayer({ cPrior: 0, nPrior: 0, priorPpm: 400_000 }, CONFIG);
    expect(rare.tier).toBeGreaterThan(popular.tier);
  });
});

describe('reachability findings for the placeholder config (§7.4)', () => {
  function firstPopulationReaching(tier: TierId, priorPpm: number): number {
    for (let n = 0; n <= 5_000; n += 1) {
      if (scoreAnsweredPlayer({ cPrior: 0, nPrior: n, priorPpm }, CONFIG).tier >= tier) return n;
    }
    throw new Error(`tier ${tier} never reached for prior ${priorPpm}`);
  }

  it('with a 5% prior, tier 5 needs 180 earlier answers and tier 6 needs 1,980', () => {
    expect(firstPopulationReaching(5, PRIOR_5_PCT)).toBe(180);
    expect(firstPopulationReaching(6, PRIOR_5_PCT)).toBe(1_980);
  });

  it('with the smallest allowed prior (500 ppm), tier 5 needs 81 and tier 6 needs 990', () => {
    expect(firstPopulationReaching(5, 500)).toBe(81);
    expect(firstPopulationReaching(6, 500)).toBe(990);
  });
});

describe('monotonicity (§7.11 row 1)', () => {
  it('points never increase as C_prior or the prior increase', () => {
    const populations = [0, 1, 2, 5, 10, 30, 100, 250, 1_000, 5_000];
    const priors = [500, 1_000, 5_000, 20_000, 50_000, 150_000, 300_000, 600_000, 1_000_000];
    let violations = 0;
    let checked = 0;

    for (const n of populations) {
      // Only valid matches: cPrior can never exceed nPrior.
      const cValues = Array.from(new Set([0, 1, Math.floor(n / 4), Math.floor(n / 2), n]))
        .filter((c) => c <= n)
        .sort((a, b) => a - b);

      for (const prior of priors) {
        let previous = Number.POSITIVE_INFINITY;
        for (const c of cValues) {
          const points = scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: prior }, CONFIG).points;
          if (points > previous) violations += 1;
          previous = points;
          checked += 1;
        }
      }
      for (const c of cValues) {
        let previous = Number.POSITIVE_INFINITY;
        for (const prior of priors) {
          const points = scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: prior }, CONFIG).points;
          if (points > previous) violations += 1;
          previous = points;
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(violations).toBe(0);
  });

  it('points never decrease as the cohort grows with a fixed number of matches', () => {
    let previous = 0;
    for (let n = 5; n <= 3_000; n += 1) {
      const points = scoreAnsweredPlayer({ cPrior: 5, nPrior: n, priorPpm: PRIOR_5_PCT }, CONFIG).points;
      expect(points).toBeGreaterThanOrEqual(previous);
      previous = points;
    }
  });
});

describe('unanswered responses (§7.12 invariant 2)', () => {
  it('score 0 with no tier', () => {
    expect(scoreUnanswered()).toEqual({ kind: 'unanswered', tier: null, points: 0 });
  });
});

describe('input validation', () => {
  const ok = { cPrior: 1, nPrior: 10, priorPpm: 50_000 };

  it.each([
    ['negative cPrior', { ...ok, cPrior: -1 }],
    ['negative nPrior', { ...ok, nPrior: -1 }],
    ['fractional cPrior', { ...ok, cPrior: 1.5 }],
    ['NaN nPrior', { ...ok, nPrior: Number.NaN }],
    ['cPrior above nPrior', { ...ok, cPrior: 11 }],
    ['prior below the 500 ppm floor', { ...ok, priorPpm: 499 }],
    ['prior above 1,000,000 ppm', { ...ok, priorPpm: 1_000_001 }],
    ['fractional prior', { ...ok, priorPpm: 50_000.5 }],
  ])('rejects %s', (_label, input) => {
    expect(() => computeScoreFraction(input, CONFIG)).toThrow(ScoringInputError);
  });
});

describe('validateScoringConfig', () => {
  const base: ScoringConfig = CONFIG;

  it('accepts the draft placeholder config', () => {
    expect(() => validateScoringConfig(base)).not.toThrow();
  });

  it.each([
    ['alpha of zero', { ...base, alpha: 0 }],
    ['fractional alpha', { ...base, alpha: 2.5 }],
    ['five thresholds', { ...base, thresholdPpm: [300_000, 150_000, 50_000, 10_000, 0] }],
    ['thresholds not descending', { ...base, thresholdPpm: [300_000, 400_000, 50_000, 10_000, 1_000, 0] }],
    ['equal thresholds', { ...base, thresholdPpm: [300_000, 300_000, 50_000, 10_000, 1_000, 0] }],
    ['last threshold not zero', { ...base, thresholdPpm: [300_000, 150_000, 50_000, 10_000, 1_000, 1] }],
    ['threshold above 1,000,000', { ...base, thresholdPpm: [2_000_000, 150_000, 50_000, 10_000, 1_000, 0] }],
    ['zero hold evaluations', { ...base, provisionalHoldEvaluations: 0 }],
    ['version zero', { ...base, version: 0 }],
  ])('rejects %s', (_label, config) => {
    expect(() => validateScoringConfig(config)).toThrow(ScoringInputError);
  });

  it('is applied by the engine, so a bad config cannot score anything', () => {
    const bad = { ...base, alpha: 0 };
    expect(() => scoreAnsweredPlayer({ cPrior: 0, nPrior: 0, priorPpm: 50_000 }, bad)).toThrow(
      ScoringInputError,
    );
  });
});

describe('determinism (§7.12 invariant 4)', () => {
  // Small seeded PRNG so the dataset is the same on every run and every machine.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('gives byte-identical results for the same inputs, over 5,000 seeded random cases', () => {
    const random = mulberry32(20261015);
    for (let i = 0; i < 5_000; i += 1) {
      const nPrior = Math.floor(random() * 20_000);
      const cPrior = Math.floor(random() * (nPrior + 1));
      const priorPpm = 500 + Math.floor(random() * 999_500);
      const input = { cPrior, nPrior, priorPpm };

      const first = scoreAnsweredPlayer(input, CONFIG);
      const second = scoreAnsweredPlayer({ ...input }, CONFIG);
      expect(JSON.stringify(first, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(
        JSON.stringify(second, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      );
      expect(first.points).toBe(TIER_POINTS[first.tier]);
    }
  });
});
