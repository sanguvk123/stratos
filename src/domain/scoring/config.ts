import { assertNonNegativeSafeInteger, assertPositiveSafeInteger, ScoringInputError } from './errors';
import { PPM, TIER_IDS } from './tiers';

/**
 * A versioned scoring configuration (§5.17). Once a version is frozen it is never edited:
 * changing alpha or a threshold means a new version.
 */
export interface ScoringConfig {
  readonly version: number;
  /** Prior strength in equivalent observations. A positive integer. */
  readonly alpha: number;
  /** Six lower bounds in ppm, tier 1..6, strictly descending, inclusive. The last must be 0. */
  readonly thresholdPpm: readonly number[];
  /** Minimum N_prior before the reveal shows a popularity figure (§7.9). */
  readonly popularityMinSample: number;
  /** Consecutive evaluations a new raw tier must persist before the provisional display moves. */
  readonly provisionalHoldEvaluations: number;
}

export function validateScoringConfig(config: ScoringConfig): ScoringConfig {
  assertPositiveSafeInteger('config.version', config.version);
  assertPositiveSafeInteger('config.alpha', config.alpha);
  assertNonNegativeSafeInteger('config.popularityMinSample', config.popularityMinSample);
  assertPositiveSafeInteger('config.provisionalHoldEvaluations', config.provisionalHoldEvaluations);

  const thresholds = config.thresholdPpm;
  if (thresholds.length !== TIER_IDS.length) {
    throw new ScoringInputError(
      `config.thresholdPpm must have ${TIER_IDS.length} entries, got ${thresholds.length}`,
    );
  }
  let previous = Number.POSITIVE_INFINITY;
  for (const [index, threshold] of thresholds.entries()) {
    assertNonNegativeSafeInteger(`config.thresholdPpm[${index}]`, threshold);
    if (threshold > PPM) {
      throw new ScoringInputError(`config.thresholdPpm[${index}] exceeds ${PPM} ppm`);
    }
    if (threshold >= previous) {
      throw new ScoringInputError('config.thresholdPpm must be strictly descending');
    }
    previous = threshold;
  }
  if (thresholds[thresholds.length - 1] !== 0) {
    throw new ScoringInputError('the last threshold (tier 6) must be 0 so a tier always matches');
  }
  return config;
}

/**
 * DRAFT PLACEHOLDER (§7.3). These thresholds and this alpha are NOT validated.
 * Do not treat this as scoring config v1: freezing waits for the §7.11 calibration gate and
 * review gate 1. It exists so Task C has a starting point and so tests can exercise the engine.
 */
export const DRAFT_PLACEHOLDER_CONFIG: ScoringConfig = Object.freeze({
  version: 1,
  alpha: 20,
  thresholdPpm: Object.freeze([300_000, 150_000, 50_000, 10_000, 1_000, 0]),
  popularityMinSample: 30,
  provisionalHoldEvaluations: 2,
});
