import { describe, expect, it } from 'vitest';
import {
  computeCohortCounts,
  DRAFT_PLACEHOLDER_CONFIG,
  scoreAnsweredPlayer,
  ScoringInputError,
  type CohortRow,
} from '@/domain/scoring';

function row(
  cohortSequence: number,
  canonicalAnswerId: string | null,
  inCohort = true,
): CohortRow {
  return { cohortSequence, canonicalAnswerId, inCohort };
}

describe('computeCohortCounts (§7.1, §7.12 invariant 1)', () => {
  const rows = [row(1, 'py'), row(2, 'py'), row(3, 'js'), row(4, 'py'), row(5, 'js')];

  it('counts only rows strictly before the current sequence', () => {
    expect(computeCohortCounts(rows, 4, 'py')).toEqual({ cPrior: 2, nPrior: 3 });
    expect(computeCohortCounts(rows, 1, 'py')).toEqual({ cPrior: 0, nPrior: 0 });
  });

  it('never counts the current round itself, so the player is not counted twice', () => {
    // The row at sequence 4 IS the current player's own row, and it is present in `rows`.
    const withSelf = computeCohortCounts(rows, 4, 'py');
    const withoutSelf = computeCohortCounts(
      rows.filter((r) => r.cohortSequence !== 4),
      4,
      'py',
    );
    expect(withSelf).toEqual(withoutSelf);
  });

  it('does not let later rounds affect an earlier round, whatever their answers', () => {
    const later = [...rows, row(6, 'py'), row(7, 'py'), row(8, 'py')];
    expect(computeCohortCounts(later, 4, 'py')).toEqual(computeCohortCounts(rows, 4, 'py'));
  });

  it('ignores unanswered rounds: they cast no vote and do not grow the population', () => {
    const withBlanks = [row(1, 'py'), row(2, null), row(3, null), row(4, 'js')];
    expect(computeCohortCounts(withBlanks, 5, 'py')).toEqual({ cPrior: 1, nPrior: 2 });
  });

  it('ignores rounds outside the cohort (voided, moderated, or guests excluded by config)', () => {
    const withExcluded = [row(1, 'py'), row(2, 'py', false), row(3, 'js', false)];
    expect(computeCohortCounts(withExcluded, 4, 'py')).toEqual({ cPrior: 1, nPrior: 1 });
  });

  it('gives the same result whatever order the rows arrive in (§7.12 invariant 5)', () => {
    const baseline = computeCohortCounts(rows, 5, 'py');
    const shuffles = [
      [...rows].reverse(),
      [rows[2]!, rows[0]!, rows[4]!, rows[1]!, rows[3]!],
      [rows[4]!, rows[3]!, rows[2]!, rows[1]!, rows[0]!],
    ];
    for (const shuffled of shuffles) {
      expect(computeCohortCounts(shuffled, 5, 'py')).toEqual(baseline);
    }
  });

  it('returns zero counts for an answer nobody gave', () => {
    expect(computeCohortCounts(rows, 5, 'forth')).toEqual({ cPrior: 0, nPrior: 4 });
  });

  it('rejects an invalid current sequence', () => {
    expect(() => computeCohortCounts(rows, 0, 'py')).toThrow(ScoringInputError);
    expect(() => computeCohortCounts(rows, 1.5, 'py')).toThrow(ScoringInputError);
  });
});

describe('cohort counts feeding the formula: the player is counted exactly once', () => {
  it('equals the score computed from a hand-built population, with the player added once', () => {
    // Ten earlier valid answers, three of them "py". The current player (sequence 11) also says "py".
    const earlier = [
      ...Array.from({ length: 3 }, (_, i) => row(i + 1, 'py')),
      ...Array.from({ length: 7 }, (_, i) => row(i + 4, 'other')),
    ];
    const counts = computeCohortCounts([...earlier, row(11, 'py')], 11, 'py');
    expect(counts).toEqual({ cPrior: 3, nPrior: 10 });

    const score = scoreAnsweredPlayer({ ...counts, priorPpm: 50_000 }, DRAFT_PLACEHOLDER_CONFIG);
    // (3 + 1 + 1) / (10 + 1 + 20) = 5/31, i.e. the player's own vote appears once.
    expect(score.numerator * 31n).toBe(score.denominator * 5n);
  });

  it('would be wrong if the current round were included: the counts would drift by one', () => {
    const rows = [row(1, 'py'), row(2, 'py')];
    const correct = computeCohortCounts(rows, 2, 'py'); // excludes sequence 2
    const doubleCounted = computeCohortCounts(rows, 3, 'py'); // includes sequence 2, as a buggy query would
    expect(correct).toEqual({ cPrior: 1, nPrior: 1 });
    expect(doubleCounted).toEqual({ cPrior: 2, nPrior: 2 });
    expect(doubleCounted).not.toEqual(correct);
  });
});
