// Task C: calibration runner (ARCHITECTURE.md §7.11 and §7.11.1).
//
//   npm run calibrate                 summary: every candidate against every gate row
//   npm run calibrate -- B:20         detail tables for one candidate (threshold table B, alpha 20)
//
// Everything here is seeded and calls the REAL scoring engine, so a rerun reproduces every number.
// It prints measurements as well as pass/fail. It never freezes a config: freezing needs the gate
// AND the owner's review (gate 1), and a passing simulation only shows behaviour under the assumed
// distributions (§7.11, "Limits of this evidence").

import {
  scoreAnsweredPlayer,
  TIER_IDS,
  validateScoringConfig,
  type ScoringConfig,
  type TierId,
} from '@/domain/scoring';
import {
  evaluateAccuracy,
  firstPopulationReaching,
  shareNeededForTier,
  tierDistribution,
} from '@/domain/scoring/calibration/analysis';
import {
  headHeavy,
  scaledPriors,
  shiftMassToRarest,
  STANDARD_FAMILIES,
  swappedTopTwoPriors,
  swapTopTwoTruth,
  toPriorPpm,
  zipf,
} from '@/domain/scoring/calibration/distributions';
import { simulateCohorts, simulateProvisionalStability } from '@/domain/scoring/calibration/simulate';

const SEED = 20261015;
const ALPHAS = [5, 10, 20, 50] as const;
const TABLES: Record<string, readonly number[]> = {
  A: [300_000, 150_000, 50_000, 10_000, 1_000, 0], // the §7.3 placeholder
  B: [300_000, 150_000, 50_000, 15_000, 4_000, 0], // compressed upper tiers, to test reachability
};

interface Candidate {
  readonly id: string;
  readonly config: ScoringConfig;
}

function candidate(table: string, alpha: number): Candidate {
  const config = validateScoringConfig({
    version: 1,
    alpha,
    thresholdPpm: TABLES[table] as readonly number[],
    popularityMinSample: 30,
    provisionalHoldEvaluations: 2,
  });
  return { id: `${table}:${alpha}`, config };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const num = (x: number | null): string => (x === null ? 'never' : x.toLocaleString('en-US'));

interface GateRow {
  readonly row: number;
  readonly name: string;
  readonly measured: string;
  readonly pass: boolean;
}

// --- Gate rows -------------------------------------------------------------------------------

function row1Monotonicity(config: ScoringConfig): GateRow {
  const populations = [0, 1, 2, 5, 10, 30, 100, 250, 1_000, 5_000];
  const priors = [500, 1_000, 5_000, 20_000, 50_000, 150_000, 300_000, 600_000, 1_000_000];
  let violations = 0;
  let checked = 0;
  for (const n of populations) {
    const cs = [...new Set([0, 1, Math.floor(n / 4), Math.floor(n / 2), n])].filter((c) => c <= n).sort((a, b) => a - b);
    for (const prior of priors) {
      let previous = Infinity;
      for (const c of cs) {
        const points = scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: prior }, config).points;
        if (points > previous) violations += 1;
        previous = points;
        checked += 1;
      }
    }
    for (const c of cs) {
      let previous = Infinity;
      for (const prior of priors) {
        const points = scoreAnsweredPlayer({ cPrior: c, nPrior: n, priorPpm: prior }, config).points;
        if (points > previous) violations += 1;
        previous = points;
        checked += 1;
      }
    }
  }
  return { row: 1, name: 'Monotonicity', measured: `${violations} violations in ${checked} checks`, pass: violations === 0 };
}

function row2ColdStart(config: ScoringConfig): GateRow {
  let worst = 1;
  let worstName = '';
  for (const family of STANDARD_FAMILIES) {
    const a = evaluateAccuracy(family.probs, toPriorPpm(family.probs), 0, config).withinOne;
    if (a < worst) {
      worst = a;
      worstName = family.name;
    }
  }
  return { row: 2, name: 'Cold start (N=0, correct priors)', measured: `worst ${pct(worst)} within 1 tier (${worstName})`, pass: worst >= 0.7 };
}

function row3SparseToLarge(config: ScoringConfig): GateRow {
  let worst = 1;
  let where = '';
  for (const family of STANDARD_FAMILIES) {
    for (const n of [100, 1_000, 10_000]) {
      const a = evaluateAccuracy(family.probs, toPriorPpm(family.probs), n, config).withinOne;
      if (a < worst) {
        worst = a;
        where = `${family.name}, N=${n}`;
      }
    }
  }
  return { row: 3, name: 'Sparse to large (N>=100)', measured: `worst ${pct(worst)} within 1 tier (${where})`, pass: worst >= 0.9 };
}

function row4Popular(config: ScoringConfig): GateRow {
  const at30 = tierDistribution(100, 0.3, 300_000, config);
  const at45 = tierDistribution(100, 0.45, 450_000, config);
  const asWritten = at30[1] as number;
  const upToTier2 = (at30[1] as number) + (at30[2] as number);
  const margin = at45[1] as number;
  // PASS IS THE ROW AS WRITTEN IN §7.11: "true share >= 30% reaches tier 1 in >= 99% of draws".
  // A share of EXACTLY 30% sits on the tier-1 boundary, so about half of draws fall just below it
  // and this can never reach 99%. The row is structurally unsatisfiable at the boundary for any
  // config whose tier-1 threshold is 300,000 ppm. That is reported, not hidden: the amended
  // criterion below is only a PROPOSAL for gate 1 to approve or reject.
  return {
    row: 4,
    name: 'Popular answers (N=100), as written',
    measured:
      `as written, p=30% exactly: tier1 ${pct(asWritten)} (boundary case); ` +
      `[proposed amendment, NOT applied: p=45% tier1 ${pct(margin)}, p=30% tier<=2 ${pct(upToTier2)}]`,
    pass: asWritten >= 0.99,
  };
}

function row5Reachability(config: ScoringConfig): GateRow {
  const t5 = firstPopulationReaching(5, 500, config);
  const t6 = firstPopulationReaching(6, 500, config);
  // The pass flag uses the 500 ppm prior, the MOST FAVOURABLE case (the row did not say which
  // prior). The 50,000 ppm figures are printed beside it because an answer editors believed
  // plausible (a 5% prior) is far harder to push into the top tiers.
  const t5Typical = firstPopulationReaching(5, 50_000, config);
  const t6Typical = firstPopulationReaching(6, 50_000, config);
  return {
    row: 5,
    name: 'Reachability',
    measured:
      `at 500 ppm prior (favourable, drives pass): tier5 N=${num(t5)}, tier6 N=${num(t6)}; ` +
      `at 50,000 ppm prior: tier5 N=${num(t5Typical)}, tier6 N=${num(t6Typical)}`,
    pass: t5 !== null && t5 <= 200 && t6 !== null && t6 <= 2_000,
  };
}

function row6Misspecified(config: ScoringConfig): GateRow {
  let worst100 = 0;
  let worst100Where = '';
  let worst0 = 0;
  for (const family of STANDARD_FAMILIES) {
    const variants: Array<[string, number[]]> = [
      ['x2', scaledPriors(family.probs, 2)],
      ['x0.5', scaledPriors(family.probs, 0.5)],
      ['x5', scaledPriors(family.probs, 5)],
      ['x0.2', scaledPriors(family.probs, 0.2)],
      ['swap', swappedTopTwoPriors(family.probs)],
    ];
    for (const [label, priors] of variants) {
      worst0 = Math.max(worst0, evaluateAccuracy(family.probs, priors, 0, config).medianAbsError);
      for (const n of [100, 1_000]) {
        const e = evaluateAccuracy(family.probs, priors, n, config).medianAbsError;
        if (e > worst100) {
          worst100 = e;
          worst100Where = `${family.name} ${label} N=${n}`;
        }
      }
    }
  }
  return {
    row: 6,
    name: 'Prior misspecification',
    measured: `worst median tier error ${worst100} at N>=100${worst100Where ? ` (${worst100Where})` : ''}; ${worst0} at N=0 (reported)`,
    pass: worst100 <= 1,
  };
}

function row7Provisional(config: ScoringConfig): GateRow {
  const family = zipf(300, 1.0);
  const priors = toPriorPpm(family.probs);
  const results = [100, 1_000].map((concurrentPlayers) =>
    simulateProvisionalStability(family.probs, priors, config, {
      baselinePlayers: 200,
      concurrentPlayers,
      revisionMean: 1,
      holdEvaluations: config.provisionalHoldEvaluations,
      maxChanges: 3,
      runs: concurrentPlayers === 100 ? 4 : 2,
      seed: SEED,
    }),
  );
  const worst = Math.min(...results.map((r) => r.shareWithinLimit));
  return {
    row: 7,
    name: 'Provisional stability (60 s rounds)',
    measured: results.map((r, i) => `${i === 0 ? 100 : 1000} players: ${pct(r.shareWithinLimit)} within 3 changes (p95 ${r.p95Changes})`).join('; '),
    pass: worst >= 0.95,
  };
}

function row8Growth(config: ScoringConfig): GateRow {
  let worst = 0;
  let where = '';
  for (const family of STANDARD_FAMILIES) {
    const priors = toPriorPpm(family.probs);
    const a = evaluateAccuracy(family.probs, priors, 1_000, config).meanTier;
    const b = evaluateAccuracy(family.probs, priors, 10_000, config).meanTier;
    if (Math.abs(a - b) > worst) {
      worst = Math.abs(a - b);
      where = family.name;
    }
  }
  return { row: 8, name: 'Population growth (N=1,000 vs 10,000)', measured: `largest mean-tier difference ${worst.toFixed(2)} (${where})`, pass: worst <= 1 };
}

function row9Shift(config: ScoringConfig): GateRow {
  let worst = 1;
  let where = '';
  for (const family of STANDARD_FAMILIES) {
    const stale = toPriorPpm(family.probs);
    const shifts: Array<[string, number[]]> = [
      ['50% mass to rarest', shiftMassToRarest(family.probs, 0.5)],
      ['top two swap', swapTopTwoTruth(family.probs)],
    ];
    for (const [label, truth] of shifts) {
      const a = evaluateAccuracy(truth, stale, 200, config).withinOne;
      if (a < worst) {
        worst = a;
        where = `${family.name}, ${label}`;
      }
    }
  }
  return { row: 9, name: 'Distribution shift (N=200, stale priors)', measured: `worst ${pct(worst)} within 1 tier (${where})`, pass: worst >= 0.9 };
}

function row10Repeatability(config: ScoringConfig): GateRow {
  const family = zipf(300, 1.0);
  const priors = toPriorPpm(family.probs);
  const a = JSON.stringify([evaluateAccuracy(family.probs, priors, 500, config), simulateCohorts(family.probs, priors, 300, 5, config, SEED)]);
  const b = JSON.stringify([evaluateAccuracy(family.probs, priors, 500, config), simulateCohorts(family.probs, priors, 300, 5, config, SEED)]);
  return { row: 10, name: 'Repeatability', measured: a === b ? 'identical on rerun' : 'DIFFERENT on rerun', pass: a === b };
}

function runGate(c: Candidate): GateRow[] {
  const config = c.config;
  return [
    row1Monotonicity(config),
    row2ColdStart(config),
    row3SparseToLarge(config),
    row4Popular(config),
    row5Reachability(config),
    row6Misspecified(config),
    row7Provisional(config),
    row8Growth(config),
    row9Shift(config),
    row10Repeatability(config),
  ];
}

// --- Detail tables (§7.11.1) -------------------------------------------------------------------

function printDetail(c: Candidate): void {
  const config = c.config;
  console.log(`\n=== DETAIL for candidate ${c.id} (alpha ${config.alpha}, thresholds ${config.thresholdPpm.join('/')}) ===`);

  console.log('\n1. Reachability: smallest earlier population N at which a UNIQUE answer (C_prior=0) first reaches each tier');
  console.log('   prior ppm |  tier 2 |  tier 3 |  tier 4 |  tier 5 |  tier 6');
  for (const prior of [500, 2_000, 10_000, 50_000, 150_000]) {
    const cells = ([2, 3, 4, 5, 6] as TierId[]).map((t) => num(firstPopulationReaching(t, prior, config)).padStart(7));
    console.log(`   ${String(prior).padStart(9)} | ${cells.join(' | ')}`);
  }

  console.log('\n2. Share of EARLIER answers that may match yours and still reach each tier (prior 50,000 ppm)');
  console.log('        N |  tier 2 |  tier 3 |  tier 4 |  tier 5 |  tier 6');
  for (const n of [10, 100, 1_000, 10_000]) {
    const cells = ([2, 3, 4, 5, 6] as TierId[]).map((t) => {
      const s = shareNeededForTier(t, n, 50_000, config);
      return (s === null ? 'unreach' : pct(s)).padStart(7);
    });
    console.log(`   ${String(n).padStart(6)} | ${cells.join(' | ')}`);
  }

  console.log('\n3. Tier error from wrong priors (player-weighted median |tier - oracle|, zipf s=1.0)');
  const family = zipf(300, 1.0);
  console.log('   priors      |   N=0 |  N=100 | N=1000');
  const variants: Array<[string, number[]]> = [
    ['correct', toPriorPpm(family.probs)],
    ['x0.2', scaledPriors(family.probs, 0.2)],
    ['x0.5', scaledPriors(family.probs, 0.5)],
    ['x2', scaledPriors(family.probs, 2)],
    ['x5', scaledPriors(family.probs, 5)],
    ['top2 swap', swappedTopTwoPriors(family.probs)],
  ];
  for (const [label, priors] of variants) {
    const cells = [0, 100, 1_000].map((n) => String(evaluateAccuracy(family.probs, priors, n, config).medianAbsError).padStart(6));
    console.log(`   ${label.padEnd(11)} | ${cells.join(' | ')}`);
  }

  console.log('\n4. Tier mix by whole-day population, averaged over arrival order (share of players per tier)');
  console.log('   family                          |   N  |   t1 |   t2 |   t3 |   t4 |   t5 |   t6 | mean pts | 1st qtr | last qtr | rare-answer players reaching t5-6');
  for (const fam of [...STANDARD_FAMILIES, headHeavy(50)]) {
    const priors = toPriorPpm(fam.probs);
    for (const population of [50, 500, 5_000]) {
      const runs = population === 5_000 ? 6 : population === 500 ? 40 : 200;
      const mix = simulateCohorts(fam.probs, priors, population, runs, config, SEED);
      const t = TIER_IDS.map((id) => pct(mix.tierMix[id] as number).padStart(5)).join(' | ');
      const rare = mix.rareAnswerPlayers === 0 ? 'n/a' : `${pct(mix.rareAnswerPlayersReachingTop2 / mix.rareAnswerPlayers)} of ${mix.rareAnswerPlayers}`;
      console.log(
        `   ${fam.name.padEnd(31)} | ${String(population).padStart(4)} | ${t} | ${mix.meanPoints.toFixed(1).padStart(8)} | ${mix.meanPointsFirstQuarter.toFixed(1).padStart(7)} | ${mix.meanPointsLastQuarter.toFixed(1).padStart(8)} | ${rare}`,
      );
    }
  }
}

// --- Main ----------------------------------------------------------------------------------------

const arg = process.argv[2];
if (arg) {
  const [table, alpha] = arg.split(':');
  printDetail(candidate(table as string, Number(alpha)));
} else {
  const candidates = Object.keys(TABLES).flatMap((table) => ALPHAS.map((alpha) => candidate(table, alpha)));
  const results = candidates.map((c) => ({ c, rows: runGate(c) }));

  console.log('Gate summary (PASS/fail per §7.11 rows AS WRITTEN). Config v1 is NOT frozen by this script.');
  console.log('A pass here is necessary, not sufficient: gate 1 is the owner review (§18.13), and the gate');
  console.log('has no row for the early-versus-late scoring gap (see the detail view, column "1st qtr"/"last qtr").\n');
  console.log(`candidate | ${Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2)).join(' ')} | passed`);
  for (const { c, rows } of results) {
    const marks = rows.map((r) => (r.pass ? ' ✓' : ' ✗')).join(' ');
    console.log(`${c.id.padEnd(9)} | ${marks} | ${rows.filter((r) => r.pass).length}/10`);
  }
  for (const { c, rows } of results) {
    console.log(`\n--- ${c.id} ---`);
    for (const r of rows) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  row ${String(r.row).padStart(2)} ${r.name}: ${r.measured}`);
  }
}
