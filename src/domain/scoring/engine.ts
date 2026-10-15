import { validateScoringConfig, type ScoringConfig } from './config';
import { assertNonNegativeSafeInteger, ScoringInputError } from './errors';
import { MIN_PRIOR_PPM, PPM, PPM_BIG, TIER_POINTS, type TierId } from './tiers';

/**
 * The scoring formula of §7.1, in exact integer arithmetic (§7.10).
 *
 *   p = (C_prior + 1 + alpha * p_prior) / (N_prior + 1 + alpha)
 *
 * C_prior and N_prior count EARLIER eligible answers and EXCLUDE the current player. The current
 * player's own valid answer is added exactly once, by the "+ 1" terms. Callers must therefore
 * never pass counts that already include the current round (see computeCohortCounts).
 */
export interface ScoreInput {
  /** Earlier eligible answers matching this canonical answer, excluding the current player. */
  readonly cPrior: number;
  /** All earlier eligible answers in the cohort, excluding the current player. */
  readonly nPrior: number;
  /** Reviewed prior for this canonical answer, in parts per million. */
  readonly priorPpm: number;
}

export interface AnsweredScore {
  readonly kind: 'answered';
  readonly tier: TierId;
  readonly points: number;
  /** p = numerator / denominator, exact. Stored so the score is reproducible from integers alone. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  /** floor(p * 1e9). Display and diagnostics only. It never decides a tier. */
  readonly pNano: bigint;
}

export interface UnansweredScore {
  readonly kind: 'unanswered';
  readonly tier: null;
  readonly points: 0;
}

export type PlayerScore = AnsweredScore | UnansweredScore;

function validateScoreInput(input: ScoreInput): void {
  assertNonNegativeSafeInteger('cPrior', input.cPrior);
  assertNonNegativeSafeInteger('nPrior', input.nPrior);
  if (input.cPrior > input.nPrior) {
    throw new ScoringInputError(
      `cPrior (${input.cPrior}) cannot exceed nPrior (${input.nPrior}): the matches are a subset`,
    );
  }
  if (
    !Number.isSafeInteger(input.priorPpm) ||
    input.priorPpm < MIN_PRIOR_PPM ||
    input.priorPpm > PPM
  ) {
    throw new ScoringInputError(
      `priorPpm must be an integer between ${MIN_PRIOR_PPM} and ${PPM}, got ${input.priorPpm}`,
    );
  }
}

/** Steps 2 and 3 of §7.10. */
export function computeScoreFraction(
  input: ScoreInput,
  config: ScoringConfig,
): { numerator: bigint; denominator: bigint } {
  validateScoreInput(input);
  validateScoringConfig(config);
  const alpha = BigInt(config.alpha);
  const numerator = (BigInt(input.cPrior) + 1n) * PPM_BIG + alpha * BigInt(input.priorPpm);
  const denominator = (BigInt(input.nPrior) + 1n + alpha) * PPM_BIG;
  return { numerator, denominator };
}

/**
 * Step 4 of §7.10: the SMALLEST tier index (1 = most common) whose lower bound the fraction meets.
 * The comparison is exact. A tier's lower bound is inclusive and its upper bound exclusive, so a
 * value exactly on a boundary lands in the MORE COMMON tier, the one whose lower bound it equals
 * (for example exactly 150,000 ppm is tier 2, not tier 3).
 * The fraction is scale-free: only the ratio numerator / denominator matters.
 */
export function assignTier(
  numerator: bigint,
  denominator: bigint,
  thresholdPpm: readonly number[],
): TierId {
  if (denominator <= 0n) {
    throw new ScoringInputError('denominator must be positive');
  }
  if (numerator < 0n) {
    throw new ScoringInputError('numerator must not be negative');
  }
  for (const [index, threshold] of thresholdPpm.entries()) {
    if (numerator * PPM_BIG >= BigInt(threshold) * denominator) {
      return (index + 1) as TierId;
    }
  }
  throw new ScoringInputError('no tier matched: the last threshold must be 0');
}

/** The final score for a player who gave a valid, accepted answer. Pure and deterministic. */
export function scoreAnsweredPlayer(input: ScoreInput, config: ScoringConfig): AnsweredScore {
  const { numerator, denominator } = computeScoreFraction(input, config);
  const tier = assignTier(numerator, denominator, config.thresholdPpm);
  return {
    kind: 'answered',
    tier,
    points: TIER_POINTS[tier],
    numerator,
    denominator,
    pNano: (numerator * 1_000_000_000n) / denominator,
  };
}

/** No accepted answer: 0 points, no tier, and no vote anywhere (§7.1, §7.12 invariant 2). */
export function scoreUnanswered(): UnansweredScore {
  return { kind: 'unanswered', tier: null, points: 0 };
}
