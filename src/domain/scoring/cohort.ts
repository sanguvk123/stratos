import { assertPositiveSafeInteger } from './errors';

/**
 * One finalized round in a challenge question's cohort. Mirrors the columns of `final_answers`
 * (§5.13) that the cohort query reads.
 */
export interface CohortRow {
  /** Position in (closes_at, round_id) order, assigned under the cohort lock. Unique per question. */
  readonly cohortSequence: number;
  /** null = unanswered or invalid: such a round casts no vote. */
  readonly canonicalAnswerId: string | null;
  /** Ranked, not voided, and not excluded by configuration or moderation. */
  readonly inCohort: boolean;
}

export interface CohortCounts {
  readonly cPrior: number;
  readonly nPrior: number;
}

/**
 * C_prior and N_prior for the round at `currentSequence` (§7.1, §18.3).
 *
 * Only rows STRICTLY BEFORE the current sequence are counted. That is what keeps the current
 * player out of the counts, so the "+ 1" in the formula is the only place they are counted, and
 * they are counted exactly once. The result does not depend on the order of `rows`.
 *
 * This is the in-memory twin of the SQL in §5.13. Task F's SQL must give identical counts, and an
 * integration test will compare the two on the same data.
 */
export function computeCohortCounts(
  rows: readonly CohortRow[],
  currentSequence: number,
  canonicalAnswerId: string,
): CohortCounts {
  assertPositiveSafeInteger('currentSequence', currentSequence);
  let cPrior = 0;
  let nPrior = 0;
  for (const row of rows) {
    if (row.cohortSequence >= currentSequence) continue;
    if (!row.inCohort) continue;
    if (row.canonicalAnswerId === null) continue;
    nPrior += 1;
    if (row.canonicalAnswerId === canonicalAnswerId) cPrior += 1;
  }
  return { cPrior, nPrior };
}
