import type { AnswerIndex } from './answer-index';
import { exceedsMaxAnswerLength, NORMALIZATION_VERSION, normalizeAnswerText } from './normalize';
import { boundedEditDistance, maxEditsForLength } from './typo';

// The answer-matching pipeline (ARCHITECTURE.md §6.1). Pure and deterministic: no I/O, no clock,
// no randomness, and no LLM. Correctness is decided here and is independent of rarity (§2).

export type MatchedVia = 'alias' | 'canonical' | 'typo_correction';

export type RejectionReason = 'EMPTY_INPUT' | 'TOO_LONG' | 'NO_MATCH' | 'AMBIGUOUS_TYPO';

export type MatchResult =
  | {
      readonly ok: true;
      readonly canonicalAnswerId: string;
      readonly matchedVia: MatchedVia;
      readonly normalizedText: string;
      readonly normalizationVersion: number;
    }
  | {
      readonly ok: false;
      readonly reason: RejectionReason;
      /** null when the input was rejected before normalization (empty or too long). */
      readonly normalizedText: string | null;
      readonly normalizationVersion: number;
    };

function reject(reason: RejectionReason, normalizedText: string | null): MatchResult {
  return { ok: false, reason, normalizedText, normalizationVersion: NORMALIZATION_VERSION };
}

function accept(
  canonicalAnswerId: string,
  matchedVia: MatchedVia,
  normalizedText: string,
): MatchResult {
  return {
    ok: true,
    canonicalAnswerId,
    matchedVia,
    normalizedText,
    normalizationVersion: NORMALIZATION_VERSION,
  };
}

/**
 * Resolves what a player typed to a canonical answer id, or a rejection reason.
 *
 * 1. Trim. Reject empty, or longer than 200 code points.
 * 2-4. Normalize (§6.1 steps 2-4). Reject if nothing meaningful is left.
 * 5. Exact alias match.   6. Exact canonical match.
 * 7. Spelling auto-correction, see below.   8. Otherwise NO_MATCH.
 *
 * Auto-correction (normalization version 2) accepts a near miss only when ALL of these hold:
 *  - the edit distance to some canonical text or alias is within the allowance for that length
 *    (none under 4 characters, 1 edit under 8, 2 under 12, 3 beyond);
 *  - exactly one answer is at that smallest distance. If two different answers tie it is
 *    AMBIGUOUS_TYPO, because guessing between them would be unfair to the player.
 * Anything else is NO_MATCH. An input that is only a PREFIX of a longer answer is never corrected
 * unless it is within the allowance, so "Java" does not become "JavaScript".
 */
export function matchAnswer(rawText: string, index: AnswerIndex): MatchResult {
  const trimmed = rawText.trim();
  if (trimmed === '') return reject('EMPTY_INPUT', null);
  if (exceedsMaxAnswerLength(trimmed)) return reject('TOO_LONG', null);

  const normalized = normalizeAnswerText(trimmed);
  if (normalized === '') return reject('EMPTY_INPUT', normalized);

  const aliasHit = index.aliasByText.get(normalized);
  if (aliasHit !== undefined) return accept(aliasHit, 'alias', normalized);

  const canonicalHit = index.canonicalByText.get(normalized);
  if (canonicalHit !== undefined) return accept(canonicalHit, 'canonical', normalized);

  const inputChars = Array.from(normalized);
  if (maxEditsForLength(inputChars.length) === 0) return reject('NO_MATCH', normalized);

  // Smallest in-allowance distance per answer id.
  const bestPerAnswer = new Map<string, number>();
  for (const entry of index.entries) {
    const allowance = maxEditsForLength(Math.min(inputChars.length, entry.chars.length));
    if (allowance === 0) continue;
    const distance = boundedEditDistance(inputChars, entry.chars, allowance);
    if (distance > allowance) continue;
    const known = bestPerAnswer.get(entry.answerId);
    if (known === undefined || distance < known) bestPerAnswer.set(entry.answerId, distance);
  }
  if (bestPerAnswer.size === 0) return reject('NO_MATCH', normalized);

  let nearest = Number.POSITIVE_INFINITY;
  for (const distance of bestPerAnswer.values()) nearest = Math.min(nearest, distance);
  const winners = [...bestPerAnswer].filter(([, distance]) => distance === nearest);
  if (winners.length > 1) return reject('AMBIGUOUS_TYPO', normalized);
  return accept((winners[0] as [string, number])[0], 'typo_correction', normalized);
}
