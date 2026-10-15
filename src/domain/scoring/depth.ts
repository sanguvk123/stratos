import { assertNonNegativeSafeInteger, ScoringInputError } from './errors';
import { ALLOWED_QUESTION_POINTS, METRES_PER_POINT, QUESTIONS_PER_DIVE } from './tiers';

/** depth_m = points x 10 (§7.7). Valid for a single question or for a total. */
export function toDepthMetres(points: number): number {
  assertNonNegativeSafeInteger('points', points);
  return points * METRES_PER_POINT;
}

export interface DiveSummary {
  readonly totalPoints: number;
  readonly depthM: number;
}

/** Total score is the sum of the per-question scores, and depth follows from the total. */
export function summarizeDive(pointsPerQuestion: readonly number[]): DiveSummary {
  if (pointsPerQuestion.length > QUESTIONS_PER_DIVE) {
    throw new ScoringInputError(
      `a dive has at most ${QUESTIONS_PER_DIVE} questions, got ${pointsPerQuestion.length}`,
    );
  }
  let totalPoints = 0;
  for (const points of pointsPerQuestion) {
    if (!ALLOWED_QUESTION_POINTS.has(points)) {
      throw new ScoringInputError(`${points} is not a valid per-question score`);
    }
    totalPoints += points;
  }
  return { totalPoints, depthM: toDepthMetres(totalPoints) };
}
