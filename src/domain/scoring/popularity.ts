import { assertNonNegativeSafeInteger, ScoringInputError } from './errors';

/** The only aggregate shown after a round closes (§7.9). */
export type PopularityStat =
  | { readonly kind: 'shown'; readonly percentOfEarlierAnswers: number } // integer 1..100
  | { readonly kind: 'under_one_percent' } // C_prior > 0 but rounds to 0
  | { readonly kind: 'none_earlier' } // C_prior = 0
  | { readonly kind: 'suppressed' }; // N_prior below the minimum sample

/**
 * "Of the earlier valid answers in your cohort, what share matched yours?"
 *
 * share = C_prior / N_prior, EXCLUDING the player's own answer from both terms. It is a
 * descriptive statistic and is NOT the smoothed estimate used for the tier, so the two can differ.
 * Rounding is half-up in integer arithmetic: floor((200 * C + N) / (2 * N)).
 */
export function computePopularity(
  cPrior: number,
  nPrior: number,
  minSample: number,
): PopularityStat {
  assertNonNegativeSafeInteger('cPrior', cPrior);
  assertNonNegativeSafeInteger('nPrior', nPrior);
  assertNonNegativeSafeInteger('minSample', minSample);
  if (cPrior > nPrior) {
    throw new ScoringInputError(`cPrior (${cPrior}) cannot exceed nPrior (${nPrior})`);
  }

  if (nPrior < minSample) return { kind: 'suppressed' };
  if (cPrior === 0) return { kind: 'none_earlier' }; // also guards nPrior = 0 when minSample = 0

  const percent = Number((200n * BigInt(cPrior) + BigInt(nPrior)) / (2n * BigInt(nPrior)));
  if (percent === 0) return { kind: 'under_one_percent' };
  return { kind: 'shown', percentOfEarlierAnswers: percent };
}
