// Deterministic answer-text normalization (ARCHITECTURE.md §6.1 steps 1-4).
//
// This single function is used for BOTH the player's input and every canonical answer and alias at
// index-build time, so two texts are "the same answer" exactly when they normalize to the same
// string. Any change to the output of this function changes what counts as a match, so it must
// bump NORMALIZATION_VERSION. Candidates store the version they were accepted under (§7.10).

// Version 2: spelling auto-correction widened from one substitution/transposition to a
// length-scaled edit distance with a unique-nearest rule (see pipeline.ts).
export const NORMALIZATION_VERSION = 2;

/** Maximum answer length in Unicode code points, matching the DB CHECK on `raw_text` (§5.12). */
export const MAX_ANSWER_CODE_POINTS = 200;

// Invisible characters that make visually identical text compare unequal: soft hyphen, zero-width
// space/non-joiner/joiner, word joiner, and the BOM.
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

// Unpaired UTF-16 surrogates cannot be stored as valid UTF-8. `raw_text` is kept as typed (the API
// layer should reject malformed strings), but the normalized form must always be well formed.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Every apostrophe and quotation mark, straight or typographic, is removed anywhere in the text.
// That covers leading/trailing quotes and possessives ("world's" -> "worlds") and, unlike removing
// only some of them, it is trivially idempotent.
const QUOTES = /['"\u2018-\u201F\u2032\u2033\u0060\u00B4\u00AB\u00BB\u2039\u203A]/g;

// ASCII hyphen and the Unicode dash variants all become a space ("spider-man" -> "spider man").
const DASHES = /[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

function onePass(input: string): string {
  let s = input.replace(INVISIBLE, '').replace(LONE_SURROGATE, '');
  // Step 2 + 3: NFC, then lowercase, then NFC again because lowercasing can emit decomposed forms.
  s = s.normalize('NFC').toLowerCase().normalize('NFC');
  // Step 4: punctuation and spacing.
  s = s.replace(QUOTES, '');
  s = s.replace(DASHES, ' ');
  s = s.replace(/\s+/g, ' ');
  // Strip leading space and trailing periods and spaces together, so removing a period can never
  // expose a new trailing space or period ("a. ." -> "a"). Internal periods are kept ("st. louis").
  s = s.replace(/^\s+/, '').replace(/[.\s]+$/, '');
  // Removing quotes can have joined a base character to a combining mark, so compose once more.
  return s.normalize('NFC');
}

/**
 * Normalizes already-trimmed answer text. Returns '' if nothing meaningful is left.
 *
 * The pass is applied until the output stops changing (it settles after one or two passes), so the
 * result is a fixed point: normalizeAnswerText(normalizeAnswerText(x)) === normalizeAnswerText(x).
 * The cap only guards against an unforeseen infinite loop. It is never expected to be reached, and
 * the property test in tests/unit/normalization checks idempotence on adversarial input.
 */
export function normalizeAnswerText(trimmed: string): string {
  let current = onePass(trimmed);
  for (let pass = 0; pass < 4; pass += 1) {
    const next = onePass(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Length in Unicode code points, not UTF-16 units, so an emoji counts as one (like Postgres). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * True when trimmed answer text is longer than the 200 code-point limit. A code point is at most
 * two UTF-16 units, so anything over 400 units is certainly too long, and that is decided without
 * allocating, which keeps a huge malicious input cheap to reject.
 */
export function exceedsMaxAnswerLength(trimmed: string): boolean {
  if (trimmed.length > MAX_ANSWER_CODE_POINTS * 2) return true;
  return codePointLength(trimmed) > MAX_ANSWER_CODE_POINTS;
}
