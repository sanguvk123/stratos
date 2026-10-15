// Spelling auto-correction (ARCHITECTURE.md §6.2, widened in normalization version 2).
//
// Version 2 corrects a misspelling when the typed text is close to EXACTLY ONE answer:
//   - closeness is the optimal-string-alignment distance (insertion, deletion, substitution and
//     adjacent transposition each cost one edit);
//   - the number of edits allowed grows with the length of the words involved, so short words
//     (where one edit changes the meaning) are never corrected;
//   - the nearest answer must be strictly nearer than every other answer. A tie is ambiguous and
//     is refused rather than guessed.
// `classifySingleEdit` is kept as a precise description of a single edit.

export type EditKind = 'substitution' | 'transposition' | 'insertion' | 'deletion';

/**
 * How many edits a misspelling may contain, given the length in code points of the SHORTER of the
 * two texts being compared. Short texts get none: one edit turns "goa" into "goat".
 */
export function maxEditsForLength(length: number): number {
  if (length < 4) return 0;
  if (length < 8) return 1;
  if (length < 12) return 2;
  return 3;
}

/**
 * Optimal string alignment distance (Damerau-Levenshtein without repeated edits), on code points.
 * Returns `limit + 1` as soon as the distance is known to exceed `limit`.
 */
export function boundedEditDistance(
  a: readonly string[],
  b: readonly string[],
  limit: number,
): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const width = b.length + 1;
  let twoBack = new Array<number>(width).fill(0);
  let previous = Array.from({ length: width }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(width).fill(0);
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (twoBack[j - 2] as number) + 1);
      }
      current[j] = best;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > limit) return limit + 1;
    twoBack = previous;
    previous = current;
  }
  const distance = previous[b.length] as number;
  return distance > limit ? limit + 1 : distance;
}

function sameFrom(a: readonly string[], aStart: number, b: readonly string[], bStart: number): boolean {
  if (a.length - aStart !== b.length - bStart) return false;
  for (let i = aStart, j = bStart; i < a.length; i += 1, j += 1) {
    if (a[i] !== b[j]) return false;
  }
  return true;
}

/**
 * Classifies how `input` differs from `candidate`, both as arrays of code points.
 * Returns null when they are identical or more than one edit apart. Names are relative to turning
 * the input into the candidate: 'insertion' means the candidate has one extra character.
 */
export function classifySingleEdit(
  input: readonly string[],
  candidate: readonly string[],
): EditKind | null {
  const lengthDifference = candidate.length - input.length;
  if (Math.abs(lengthDifference) > 1) return null;

  if (lengthDifference === 0) {
    const mismatches: number[] = [];
    for (let i = 0; i < input.length; i += 1) {
      if (input[i] !== candidate[i]) {
        mismatches.push(i);
        if (mismatches.length > 2) return null;
      }
    }
    if (mismatches.length === 1) return 'substitution';
    if (mismatches.length === 2) {
      const [first, second] = mismatches as [number, number];
      const adjacent = second === first + 1;
      if (adjacent && input[first] === candidate[second] && input[second] === candidate[first]) {
        return 'transposition';
      }
    }
    return null;
  }

  const shorter = lengthDifference > 0 ? input : candidate;
  const longer = lengthDifference > 0 ? candidate : input;
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i += 1;
  if (!sameFrom(longer, i + 1, shorter, i)) return null;
  return lengthDifference > 0 ? 'insertion' : 'deletion';
}
