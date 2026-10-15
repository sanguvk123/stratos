// Order-sensitivity report for the rolling cohort (ARCHITECTURE.md §19.6).
//
//   npm run order-effect
//
// For each answer distribution and daily population it draws one fixed set of answers for every
// player on all 7 questions, scores it under two independent random arrival orders, and reports how
// different the two leaderboards are. Seeded: a rerun reproduces every number. Like Task C, it
// measures behaviour under ASSUMED distributions, not real players.

import { WORKING_SCORING_CONFIG } from '@/server/config';
import {
  headHeavy,
  scaledPriors,
  STANDARD_FAMILIES,
  swappedTopTwoPriors,
  toPriorPpm,
  type Distribution,
} from '@/domain/scoring/calibration/distributions';
import { simulateOrderEffect } from '@/domain/scoring/calibration/order';

const SEED = 20261016;
const QUESTIONS = 7;
const POPULATIONS = [50, 200, 1000];
const RUNS: Record<number, number> = { 50: 60, 200: 30, 1000: 8 };

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function row(label: string, truth: Distribution, priors: readonly number[], players: number) {
  const e = simulateOrderEffect(truth.probs, priors, players, QUESTIONS, RUNS[players] as number, WORKING_SCORING_CONFIG, SEED);
  console.log(
    [
      label.padEnd(34),
      String(players).padStart(5),
      e.meanTotal.toFixed(0).padStart(6),
      e.meanAbsTotalDifference.toFixed(1).padStart(7),
      pct(e.relativeDifference).padStart(7),
      e.rankCorrelation.toFixed(3).padStart(8),
      pct(e.topDecileOverlap).padStart(8),
      pct(e.sameTierShare).padStart(9),
    ].join('  '),
  );
}

console.log(
  `Working config v${WORKING_SCORING_CONFIG.version}, alpha ${WORKING_SCORING_CONFIG.alpha}, ${QUESTIONS} questions, seed ${SEED}\n`,
);
console.log(
  ['distribution / priors'.padEnd(34), 'N'.padStart(5), 'mean'.padStart(6), 'mean|d|'.padStart(7), 'd/mean'.padStart(7), 'spearman'.padStart(8), 'top10%'.padStart(8), 'same tier'.padStart(9)].join('  '),
);
console.log('-'.repeat(96));

for (const family of [...STANDARD_FAMILIES, headHeavy(60)]) {
  for (const players of POPULATIONS) row(`${family.name}, right priors`, family, toPriorPpm(family.probs), players);
  console.log('');
}

const stress = STANDARD_FAMILIES[1] as Distribution;
for (const players of POPULATIONS) {
  row(`${stress.name}, priors 2x too high`, stress, scaledPriors(stress.probs, 2), players);
  row(`${stress.name}, priors 2x too low`, stress, scaledPriors(stress.probs, 0.5), players);
  row(`${stress.name}, top two swapped`, stress, swappedTopTwoPriors(stress.probs), players);
}

console.log('\nmean      = average points per player over the 7-question climb');
console.log('mean|d|   = average absolute difference in a player\'s total between the two arrival orders');
console.log('d/mean    = that difference as a share of the mean total');
console.log('spearman  = rank correlation of the two leaderboards (1 = identical)');
console.log('top10%    = of the top decile under order A, the share still in the top decile under order B');
console.log('same tier = share of single answers given the same tier under both orders');
