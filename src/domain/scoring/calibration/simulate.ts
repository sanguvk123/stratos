import type { ScoringConfig } from '../config';
import { scoreAnsweredPlayer } from '../engine';
import { INITIAL_DISPLAY_STATE, onEvaluation, onNewCandidate, type DisplayState } from '../provisional';
import { TIER_IDS, type TierId } from '../tiers';
import { buildCdf, sampleIndex } from './distributions';
import { mulberry32, poisson, type Rng } from './rng';

// Monte Carlo simulation. It calls the REAL scoring engine for every player, in cohort order, the
// way production does: each player is scored against earlier players only (§7.1, §16.2).

export interface CohortMix {
  /** Share of all players in each tier (index 0 unused). */
  readonly tierMix: readonly number[];
  readonly meanPoints: number;
  /** Mean points of the first and last quarter of arrivals: the early-versus-late fairness gap. */
  readonly meanPointsFirstQuarter: number;
  readonly meanPointsLastQuarter: number;
  /** Players who chose a truly rare answer (true share < 1%), and how many reached tier 5 or 6. */
  readonly rareAnswerPlayers: number;
  readonly rareAnswerPlayersReachingTop2: number;
}

/** Simulates `runs` independent daily cohorts of `population` players and aggregates them. */
export function simulateCohorts(
  truth: readonly number[],
  priorsPpm: readonly number[],
  population: number,
  runs: number,
  config: ScoringConfig,
  seed: number,
): CohortMix {
  const rng = mulberry32(seed);
  const cdf = buildCdf(truth);
  const tierCounts = new Array<number>(TIER_IDS.length + 1).fill(0);
  let totalPoints = 0;
  let firstQuarterPoints = 0;
  let lastQuarterPoints = 0;
  let firstQuarterPlayers = 0;
  let lastQuarterPlayers = 0;
  let rarePlayers = 0;
  let rareTop2 = 0;
  const quarter = Math.max(1, Math.floor(population / 4));

  for (let run = 0; run < runs; run += 1) {
    const counts = new Int32Array(truth.length);
    for (let k = 0; k < population; k += 1) {
      const answer = sampleIndex(cdf, rng);
      const score = scoreAnsweredPlayer(
        { cPrior: counts[answer] as number, nPrior: k, priorPpm: priorsPpm[answer] as number },
        config,
      );
      counts[answer] = (counts[answer] as number) + 1;
      tierCounts[score.tier] = (tierCounts[score.tier] as number) + 1;
      totalPoints += score.points;
      if (k < quarter) {
        firstQuarterPoints += score.points;
        firstQuarterPlayers += 1;
      } else if (k >= population - quarter) {
        lastQuarterPoints += score.points;
        lastQuarterPlayers += 1;
      }
      if ((truth[answer] as number) < 0.01) {
        rarePlayers += 1;
        if (score.tier >= 5) rareTop2 += 1;
      }
    }
  }

  const players = runs * population;
  return {
    tierMix: tierCounts.map((c) => c / players),
    meanPoints: totalPoints / players,
    meanPointsFirstQuarter: firstQuarterPoints / Math.max(1, firstQuarterPlayers),
    meanPointsLastQuarter: lastQuarterPoints / Math.max(1, lastQuarterPlayers),
    rareAnswerPlayers: rarePlayers,
    rareAnswerPlayersReachingTop2: rareTop2,
  };
}

export interface ProvisionalStability {
  /** Share of player-rounds with at most `maxChanges` display changes. */
  readonly shareWithinLimit: number;
  readonly meanChanges: number;
  readonly p95Changes: number;
  readonly playerRounds: number;
}

export interface ProvisionalOptions {
  /** Players already finalized for this question before the window opens. */
  readonly baselinePlayers: number;
  /** Players answering during the same 60 s window. */
  readonly concurrentPlayers: number;
  /** Mean number of EXTRA candidates per player (revisions), Poisson. Capped at 4 extra. */
  readonly revisionMean: number;
  readonly holdEvaluations: number;
  readonly maxChanges: number;
  readonly runs: number;
  readonly seed: number;
}

/**
 * Display stability of the PROVISIONAL tier (§7.8). Each second every player with a candidate is
 * re-evaluated (the rate limit allows at most one provisional update per player per second). The
 * population is finalized baseline players plus other players' CURRENT candidates, with the
 * viewer's own candidate subtracted and then added back once, as in production.
 * Display changes caused by the player's own new candidate are not counted: those are the player's
 * action, not instability.
 */
export function simulateProvisionalStability(
  truth: readonly number[],
  priorsPpm: readonly number[],
  config: ScoringConfig,
  options: ProvisionalOptions,
): ProvisionalStability {
  const rng: Rng = mulberry32(options.seed);
  const cdf = buildCdf(truth);
  const windowSeconds = 60;
  const changeCounts: number[] = [];

  for (let run = 0; run < options.runs; run += 1) {
    const counts = new Int32Array(truth.length);
    for (let i = 0; i < options.baselinePlayers; i += 1) {
      const a = sampleIndex(cdf, rng);
      counts[a] = (counts[a] as number) + 1;
    }

    // Each player's candidate schedule: [second, answer] pairs, in time order.
    const schedules: Array<Array<[number, number]>> = [];
    for (let player = 0; player < options.concurrentPlayers; player += 1) {
      const events: Array<[number, number]> = [];
      let second = Math.floor(rng() * 40);
      events.push([second, sampleIndex(cdf, rng)]);
      const extras = Math.min(4, poisson(rng, options.revisionMean));
      for (let e = 0; e < extras; e += 1) {
        const next = second + 1 + Math.floor(rng() * Math.max(1, 55 - second));
        if (next >= windowSeconds) break;
        second = next;
        events.push([second, sampleIndex(cdf, rng)]);
      }
      schedules.push(events);
    }

    const current = new Int32Array(options.concurrentPlayers).fill(-1);
    const nextEvent = new Int32Array(options.concurrentPlayers);
    const display: DisplayState[] = Array.from({ length: options.concurrentPlayers }, () => INITIAL_DISPLAY_STATE);
    const changes = new Int32Array(options.concurrentPlayers);
    let totalCurrent = 0;

    for (let second = 0; second < windowSeconds; second += 1) {
      const fresh = new Set<number>();
      for (let player = 0; player < options.concurrentPlayers; player += 1) {
        const events = schedules[player] as Array<[number, number]>;
        let idx = nextEvent[player] as number;
        while (idx < events.length && (events[idx] as [number, number])[0] === second) {
          const answer = (events[idx] as [number, number])[1];
          const previous = current[player] as number;
          if (previous >= 0) counts[previous] = (counts[previous] as number) - 1;
          else totalCurrent += 1;
          counts[answer] = (counts[answer] as number) + 1;
          current[player] = answer;
          fresh.add(player);
          idx += 1;
        }
        nextEvent[player] = idx;
      }

      const population = options.baselinePlayers + totalCurrent;
      for (let player = 0; player < options.concurrentPlayers; player += 1) {
        const answer = current[player] as number;
        if (answer < 0) continue;
        const raw = scoreAnsweredPlayer(
          {
            cPrior: (counts[answer] as number) - 1,
            nPrior: population - 1,
            priorPpm: priorsPpm[answer] as number,
          },
          config,
        ).tier as TierId;
        const before = display[player] as DisplayState;
        if (fresh.has(player)) {
          display[player] = onNewCandidate(raw);
        } else {
          const after = onEvaluation(before, raw, options.holdEvaluations);
          if (after.displayedTier !== before.displayedTier) {
            changes[player] = (changes[player] as number) + 1;
          }
          display[player] = after;
        }
      }
    }
    for (let player = 0; player < options.concurrentPlayers; player += 1) {
      if ((current[player] as number) >= 0) changeCounts.push(changes[player] as number);
    }
  }

  const sorted = [...changeCounts].sort((a, b) => a - b);
  const within = sorted.filter((c) => c <= options.maxChanges).length;
  const total = sorted.length;
  return {
    shareWithinLimit: total === 0 ? 1 : within / total,
    meanChanges: total === 0 ? 0 : sorted.reduce((s, c) => s + c, 0) / total,
    p95Changes: sorted[Math.min(total - 1, Math.floor(total * 0.95))] ?? 0,
    playerRounds: total,
  };
}
