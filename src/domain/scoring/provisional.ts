import { assertPositiveSafeInteger } from './errors';
import type { TierId } from './tiers';

/**
 * Deterministic display hysteresis for the PROVISIONAL tier (§7.8).
 *
 * It exists for display stability only. It must never influence a final score, and this module
 * deliberately imports nothing from the cohort or engine code: provisional and final scoring
 * share only the pure formula, never an aggregate (§7.12 invariant 7).
 */
export interface DisplayState {
  readonly displayedTier: TierId | null;
  readonly pendingTier: TierId | null;
  readonly pendingCount: number;
}

export const INITIAL_DISPLAY_STATE: DisplayState = Object.freeze({
  displayedTier: null,
  pendingTier: null,
  pendingCount: 0,
});

/** The player submitted a new candidate: its tier is shown immediately and nothing is pending. */
export function onNewCandidate(rawTier: TierId): DisplayState {
  return { displayedTier: rawTier, pendingTier: null, pendingCount: 0 };
}

/**
 * A later evaluation of the SAME candidate produced `rawTier`. The displayed tier moves only after
 * the new raw tier has been seen on `holdEvaluations` consecutive evaluations.
 */
export function onEvaluation(
  state: DisplayState,
  rawTier: TierId,
  holdEvaluations: number,
): DisplayState {
  assertPositiveSafeInteger('holdEvaluations', holdEvaluations);

  if (state.displayedTier === null) return onNewCandidate(rawTier);

  if (rawTier === state.displayedTier) {
    return { displayedTier: rawTier, pendingTier: null, pendingCount: 0 };
  }

  const count = rawTier === state.pendingTier ? state.pendingCount + 1 : 1;
  if (count >= holdEvaluations) return onNewCandidate(rawTier);
  return { displayedTier: state.displayedTier, pendingTier: rawTier, pendingCount: count };
}
