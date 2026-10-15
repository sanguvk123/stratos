import { exceedsMaxAnswerLength, normalizeAnswerText } from './normalize';

// The closed answer set for one question version (ARCHITECTURE.md §6 and §18.7), as an in-memory
// index. It is built from reviewed editorial data and then used for every submission. A question
// version is immutable once published (§5.20), so an index can be cached per question version.
//
// Building the index is also where ambiguity is caught: a plain Map<string, id> cannot represent
// "this alias could mean two answers", so any such case is reported as a problem and the index is
// refused. The same analysis backs the publication check, so an ambiguous set never reaches play.

export interface AnswerDefinition {
  /** Stable canonical answer id (a UUID in production). */
  readonly id: string;
  /** The canonical answer as the editors wrote it, for example "JavaScript". */
  readonly text: string;
  /** Explicit aliases and approved spelling variants, for example "JS". */
  readonly aliases?: readonly string[];
}

export type IndexProblem =
  | { readonly kind: 'NO_ANSWERS' }
  | { readonly kind: 'DUPLICATE_ANSWER_ID'; readonly answerId: string }
  | { readonly kind: 'EMPTY_TEXT'; readonly answerId: string; readonly text: string }
  | { readonly kind: 'TEXT_TOO_LONG'; readonly answerId: string; readonly text: string }
  | {
      readonly kind: 'DUPLICATE_CANONICAL_TEXT';
      readonly normalizedText: string;
      readonly answerIds: readonly string[];
    }
  | {
      readonly kind: 'AMBIGUOUS_ALIAS';
      readonly normalizedText: string;
      readonly answerIds: readonly string[];
    };

export interface IndexEntry {
  readonly text: string;
  /** `text` as code points, precomputed for typo comparison. */
  readonly chars: readonly string[];
  readonly answerId: string;
  readonly isCanonical: boolean;
}

export interface AnswerIndex {
  /** normalized canonical text -> canonical answer id */
  readonly canonicalByText: ReadonlyMap<string, string>;
  /** normalized alias text -> canonical answer id (never equal to a canonical text) */
  readonly aliasByText: ReadonlyMap<string, string>;
  /** Every canonical text and alias, for typo comparison. */
  readonly entries: readonly IndexEntry[];
}

export class AnswerIndexError extends Error {
  readonly problems: readonly IndexProblem[];

  constructor(problems: readonly IndexProblem[]) {
    super(`answer set is not publishable: ${problems.map((p) => p.kind).join(', ')}`);
    this.name = 'AnswerIndexError';
    this.problems = problems;
  }
}

function addOwner(owners: Map<string, Set<string>>, text: string, answerId: string): void {
  const existing = owners.get(text);
  if (existing) existing.add(answerId);
  else owners.set(text, new Set([answerId]));
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

function problemKey(problem: IndexProblem): string {
  switch (problem.kind) {
    case 'NO_ANSWERS':
      return 'NO_ANSWERS';
    case 'DUPLICATE_ANSWER_ID':
      return `${problem.kind}|${problem.answerId}`;
    case 'EMPTY_TEXT':
    case 'TEXT_TOO_LONG':
      return `${problem.kind}|${problem.answerId}|${problem.text}`;
    default:
      return `${problem.kind}|${problem.normalizedText}`;
  }
}

interface Analysis {
  readonly problems: IndexProblem[];
  readonly canonicalOwners: ReadonlyMap<string, ReadonlySet<string>>;
  readonly aliasOwners: ReadonlyMap<string, ReadonlySet<string>>;
}

function analyze(answers: readonly AnswerDefinition[]): Analysis {
  const problems: IndexProblem[] = [];
  const canonicalOwners = new Map<string, Set<string>>();
  const aliasOwners = new Map<string, Set<string>>();

  if (answers.length === 0) problems.push({ kind: 'NO_ANSWERS' });

  const seenIds = new Set<string>();
  for (const answer of answers) {
    if (seenIds.has(answer.id)) problems.push({ kind: 'DUPLICATE_ANSWER_ID', answerId: answer.id });
    seenIds.add(answer.id);
  }

  // Returns the normalized text, or null (after recording a problem) if it cannot be used.
  function prepare(answerId: string, text: string): string | null {
    const trimmed = text.trim();
    if (exceedsMaxAnswerLength(trimmed)) {
      problems.push({ kind: 'TEXT_TOO_LONG', answerId, text });
      return null;
    }
    const normalized = normalizeAnswerText(trimmed);
    if (normalized === '') {
      problems.push({ kind: 'EMPTY_TEXT', answerId, text });
      return null;
    }
    return normalized;
  }

  for (const answer of answers) {
    const canonical = prepare(answer.id, answer.text);
    if (canonical !== null) addOwner(canonicalOwners, canonical, answer.id);

    for (const alias of answer.aliases ?? []) {
      const normalized = prepare(answer.id, alias);
      if (normalized === null) continue;
      // An alias identical to its own canonical text is redundant, not ambiguous: skip it so an
      // exact canonical match is always reported as 'canonical'.
      if (normalized === canonical) continue;
      addOwner(aliasOwners, normalized, answer.id);
    }
  }

  for (const [normalizedText, owners] of canonicalOwners) {
    if (owners.size > 1) {
      problems.push({
        kind: 'DUPLICATE_CANONICAL_TEXT',
        normalizedText,
        answerIds: sortedIds(owners),
      });
    }
  }

  for (const [normalizedText, owners] of aliasOwners) {
    const everyOwner = new Set([...owners, ...(canonicalOwners.get(normalizedText) ?? [])]);
    if (everyOwner.size > 1) {
      problems.push({ kind: 'AMBIGUOUS_ALIAS', normalizedText, answerIds: sortedIds(everyOwner) });
    }
  }

  problems.sort((a, b) => (problemKey(a) < problemKey(b) ? -1 : problemKey(a) > problemKey(b) ? 1 : 0));
  return { problems, canonicalOwners, aliasOwners };
}

/** The publication check: every problem that would make this answer set unsafe, or [] if none. */
export function analyzeAnswerSet(answers: readonly AnswerDefinition[]): readonly IndexProblem[] {
  return analyze(answers).problems;
}

/** Builds the index, or throws AnswerIndexError listing every problem at once. */
export function buildAnswerIndex(answers: readonly AnswerDefinition[]): AnswerIndex {
  const { problems, canonicalOwners, aliasOwners } = analyze(answers);
  if (problems.length > 0) throw new AnswerIndexError(problems);

  const canonicalByText = new Map<string, string>();
  const aliasByText = new Map<string, string>();
  const entries: IndexEntry[] = [];

  for (const [text, owners] of canonicalOwners) {
    const answerId = [...owners][0] as string;
    canonicalByText.set(text, answerId);
    entries.push({ text, chars: Array.from(text), answerId, isCanonical: true });
  }
  for (const [text, owners] of aliasOwners) {
    const answerId = [...owners][0] as string;
    aliasByText.set(text, answerId);
    entries.push({ text, chars: Array.from(text), answerId, isCanonical: false });
  }
  return { canonicalByText, aliasByText, entries };
}
