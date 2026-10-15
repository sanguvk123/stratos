import type { Db } from '../db';

// Population queries (ARCHITECTURE.md §7, §18.9). There are two, deliberately separate. The
// provisional path that used to be a third was removed: nobody is shown a predicted score any more.
//
//   finalCohortCounts      ranked scoring. Earlier finalized rounds only, by cohort sequence.
//   practiceReferenceCounts  practice scoring. A frozen earlier daily, never live data.

export interface Counts {
  readonly cPrior: number;
  readonly nPrior: number;
}

/**
 * C_prior and N_prior for the round at `sequence` (§7.1): earlier cohort rows only, so the current
 * player is NOT included and is counted exactly once, by the formula's "+ 1". Unanswered rounds
 * hold no vote. This is the SQL twin of computeCohortCounts() in the domain layer; a test checks
 * the two agree on the same data.
 */
export function finalCohortCounts(
  db: Db,
  cohort: string,
  sequence: number,
  canonicalId: string,
): Counts {
  const row = db.get<{ n: number; c: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(canonical_id = ?), 0) AS c
       FROM final_answers
      WHERE cohort_key = ? AND in_cohort = 1 AND canonical_id IS NOT NULL AND cohort_sequence < ?`,
    canonicalId,
    cohort,
    sequence,
  );
  return { cPrior: Number(row?.c ?? 0), nPrior: Number(row?.n ?? 0) };
}

/**
 * Practice reference (§18.9): the full final population of the MOST RECENT EARLIER DAILY on which
 * this question was played. Fixed once that day is over, so practice scores are stable all day and
 * practice can never influence a ranked cohort. With no earlier daily the counts are zero and the
 * reviewed prior carries the score.
 *
 * LIMIT: this is computed on read from immutable final_answers rather than from a separate frozen
 * snapshot table, so a round that finalizes after midnight could still add to "yesterday".
 */
export function practiceReferenceCounts(
  db: Db,
  questionId: string,
  today: string,
  canonicalId: string,
): Counts {
  const latest = db.get<{ d: string }>(
    `SELECT MAX(challenge_date) AS d FROM final_answers
      WHERE question_id = ? AND challenge_date < ?`,
    questionId,
    today,
  );
  if (!latest?.d) return { cPrior: 0, nPrior: 0 };
  const row = db.get<{ n: number; c: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(canonical_id = ?), 0) AS c
       FROM final_answers
      WHERE question_id = ? AND challenge_date = ? AND in_cohort = 1 AND canonical_id IS NOT NULL`,
    canonicalId,
    questionId,
    latest.d,
  );
  return { cPrior: Number(row?.c ?? 0), nPrior: Number(row?.n ?? 0) };
}

