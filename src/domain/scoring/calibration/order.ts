import type { ScoringConfig } from '../config';
import { scoreAnsweredPlayer } from '../engine';
import { buildCdf, sampleIndex } from './distributions';
import { mulberry32, type Rng } from './rng';

// Order-sensitivity measurement for the rolling cohort (ARCHITECTURE.md §16.2, §19.6).
//
// A player is scored against the players who locked BEFORE them, so the same set of answers
// produces different scores under a different order. This module quantifies how much that matters
// for a leaderboard: take ONE fixed set of answers for every player on every question, score it
// under two independent random orderings, and compare the two resulting leaderboards. Speed earns
// nothing, so the orderings are exchangeable: any difference is pure luck of arrival order.

export interface OrderEffect {
  /** Mean points per player over the whole climb. */
  readonly meanTotal: number;
  /** Mean |total under ordering A - total under ordering B| per player, in points. */
  readonly meanAbsTotalDifference: number;
  /** The same difference as a share of the mean total. */
  readonly relativeDifference: number;
  /** Spearman rank correlation of the two leaderboards, averaged over runs. 1 means identical. */
  readonly rankCorrelation: number;
  /** Of the players in the top decile under A, the share still in it under B. */
  readonly topDecileOverlap: number;
  /** Share of single answers that land in the same tier under both orderings. */
  readonly sameTierShare: number;
}

function shuffled(n: number, rng: Rng): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const held = order[i] as number;
    order[i] = order[j] as number;
    order[j] = held;
  }
  return order;
}

/** Average ranks (ties share the mean of the ranks they span), 1-based, higher value = higher rank. */
export function averageRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < indexed.length) {
    let end = start;
    while (end + 1 < indexed.length && (indexed[end + 1] as { value: number }).value === (indexed[start] as { value: number }).value) {
      end += 1;
    }
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) ranks[(indexed[k] as { index: number }).index] = rank;
    start = end + 1;
  }
  return ranks;
}

/** Spearman rank correlation. 1 for identical orderings, -1 for reversed, 1 when both are constant. */
export function rankCorrelation(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError('rankCorrelation needs two lists of the same length');
  if (a.length < 2) return 1;
  const ra = averageRanks(a);
  const rb = averageRanks(b);
  const mean = (a.length + 1) / 2;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = (ra[i] as number) - mean;
    const db = (rb[i] as number) - mean;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA === 0 && varianceB === 0) return 1;
  if (varianceA === 0 || varianceB === 0) return 0;
  return covariance / Math.sqrt(varianceA * varianceB);
}

/** Players whose total is at or above the m-th highest total (ties are included, not cut). */
function topSet(totals: readonly number[], share: number): Set<number> {
  const m = Math.max(1, Math.ceil(totals.length * share));
  const cutoff = [...totals].sort((x, y) => y - x)[m - 1] as number;
  const set = new Set<number>();
  totals.forEach((total, player) => {
    if (total >= cutoff) set.add(player);
  });
  return set;
}

interface Scored {
  readonly totals: number[];
  /** tiers[q][player] */
  readonly tiers: Int8Array[];
}

function scoreOrdering(
  answers: readonly Int32Array[],
  orders: readonly number[][],
  priorsPpm: readonly number[],
  config: ScoringConfig,
  answerCount: number,
): Scored {
  const players = (answers[0] as Int32Array).length;
  const totals = new Array<number>(players).fill(0);
  const tiers = answers.map(() => new Int8Array(players));
  for (let q = 0; q < answers.length; q += 1) {
    const counts = new Int32Array(answerCount);
    const order = orders[q] as number[];
    const given = answers[q] as Int32Array;
    for (let position = 0; position < players; position += 1) {
      const player = order[position] as number;
      const answer = given[player] as number;
      const score = scoreAnsweredPlayer(
        { cPrior: counts[answer] as number, nPrior: position, priorPpm: priorsPpm[answer] as number },
        config,
      );
      counts[answer] = (counts[answer] as number) + 1;
      totals[player] = (totals[player] as number) + score.points;
      (tiers[q] as Int8Array)[player] = score.tier;
    }
  }
  return { totals, tiers };
}

/**
 * Draws `players` x `questions` fixed answers from `truth`, scores them under two independent
 * random orderings per question, and compares the two leaderboards. Averaged over `runs`.
 * `priorsPpm` are the editorial priors the formula sees (they may differ from `truth`).
 */
export function simulateOrderEffect(
  truth: readonly number[],
  priorsPpm: readonly number[],
  players: number,
  questions: number,
  runs: number,
  config: ScoringConfig,
  seed: number,
): OrderEffect {
  if (players < 2 || questions < 1 || runs < 1) throw new RangeError('need players >= 2, questions >= 1, runs >= 1');
  const rng = mulberry32(seed);
  const cdf = buildCdf(truth);

  let meanTotal = 0;
  let meanAbsDifference = 0;
  let correlation = 0;
  let overlap = 0;
  let sameTier = 0;

  for (let run = 0; run < runs; run += 1) {
    const answers = Array.from({ length: questions }, () => {
      const row = new Int32Array(players);
      for (let p = 0; p < players; p += 1) row[p] = sampleIndex(cdf, rng);
      return row;
    });
    const ordersA = answers.map(() => shuffled(players, rng));
    const ordersB = answers.map(() => shuffled(players, rng));
    const a = scoreOrdering(answers, ordersA, priorsPpm, config, truth.length);
    const b = scoreOrdering(answers, ordersB, priorsPpm, config, truth.length);

    let totalSum = 0;
    let differenceSum = 0;
    for (let p = 0; p < players; p += 1) {
      totalSum += (a.totals[p] as number) + (b.totals[p] as number);
      differenceSum += Math.abs((a.totals[p] as number) - (b.totals[p] as number));
    }
    meanTotal += totalSum / (2 * players);
    meanAbsDifference += differenceSum / players;
    correlation += rankCorrelation(a.totals, b.totals);

    const topA = topSet(a.totals, 0.1);
    const topB = topSet(b.totals, 0.1);
    let kept = 0;
    for (const p of topA) if (topB.has(p)) kept += 1;
    overlap += kept / topA.size;

    let same = 0;
    for (let q = 0; q < questions; q += 1) {
      for (let p = 0; p < players; p += 1) {
        if ((a.tiers[q] as Int8Array)[p] === (b.tiers[q] as Int8Array)[p]) same += 1;
      }
    }
    sameTier += same / (questions * players);
  }

  const average = (x: number) => x / runs;
  return {
    meanTotal: average(meanTotal),
    meanAbsTotalDifference: average(meanAbsDifference),
    relativeDifference: average(meanAbsDifference) / Math.max(1e-9, average(meanTotal)),
    rankCorrelation: average(correlation),
    topDecileOverlap: average(overlap),
    sameTierShare: average(sameTier),
  };
}
