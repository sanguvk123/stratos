import { validateScoringConfig, type ScoringConfig } from '@/domain/scoring';

/**
 * The scoring configuration the game runs on. NOT FROZEN, NOT VALIDATED BEYOND SIMULATION.
 *
 * This is the working candidate from ARCHITECTURE.md §7.11.2 (threshold table A, alpha 50). Review
 * gate 1 has not happened, so the thresholds and alpha may change. A score row records the config
 * version and alpha it used, so changing this later never rewrites an old score.
 */
export const WORKING_SCORING_CONFIG: ScoringConfig = validateScoringConfig({
  version: 1,
  alpha: 50,
  thresholdPpm: [300_000, 150_000, 50_000, 10_000, 1_000, 0],
  popularityMinSample: 30,
  provisionalHoldEvaluations: 2,
});

export const GAME = {
  questionCount: 7,
  /**
   * Pause enforced between a question's result and the next question. It is 0: the player moves on
   * with a button, at their own pace, and there is no countdown on it. (It used to be 5 s, which
   * forced a visible timer on the button. Nothing else depends on it: the next question's clock
   * starts when it is issued, not when the result was shown.)
   */
  revealWindowMs: 0,
  /** A round may finalize this long after its deadline, so an in-flight write commits first (§4.5). */
  finalizeGraceMs: 250,
  /**
   * A session idle for longer than this is abandoned (§4.6.6). The architecture default is 300 s,
   * but abandonment only labels a session: unserved questions have no round row, so an idle session
   * can never block a cohort. A short timeout would just cost a returning player their one daily
   * attempt, so this build uses 2 hours. OWNER CHOICE: change it here.
   */
  abandonAfterMs: 2 * 60 * 60 * 1000,
  /**
   * Hard cap on stored attempts per round (§11.1). Only a MATCHED answer ends a round, so a player
   * who keeps typing things that do not match can try again, but not without limit.
   */
  maxAttemptsPerRound: 50,
  /** Per-session limit on answer requests in any 60 s window (§10.4). */
  answerRequestsPerMinute: 20,
  scoring: WORKING_SCORING_CONFIG,
} as const;
