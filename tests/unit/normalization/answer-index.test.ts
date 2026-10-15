import { describe, expect, it } from 'vitest';
import {
  analyzeAnswerSet,
  AnswerIndexError,
  buildAnswerIndex,
  matchAnswer,
  type AnswerDefinition,
} from '@/domain/normalization';

const LANGUAGES: AnswerDefinition[] = [
  { id: 'js', text: 'JavaScript', aliases: ['JS', 'ECMAScript'] },
  { id: 'py', text: 'Python', aliases: ['Python 3', 'py'] },
  { id: 'rust', text: 'Rust' },
];

describe('analyzeAnswerSet: publication-time checks (§18.7)', () => {
  it('accepts a clean answer set', () => {
    expect(analyzeAnswerSet(LANGUAGES)).toEqual([]);
  });

  it('rejects an empty answer set', () => {
    expect(analyzeAnswerSet([])).toEqual([{ kind: 'NO_ANSWERS' }]);
  });

  it('rejects duplicate answer ids', () => {
    const problems = analyzeAnswerSet([
      { id: 'a', text: 'Alpha' },
      { id: 'a', text: 'Beta' },
    ]);
    expect(problems).toContainEqual({ kind: 'DUPLICATE_ANSWER_ID', answerId: 'a' });
  });

  it('rejects answers and aliases that normalize to nothing', () => {
    const problems = analyzeAnswerSet([
      { id: 'a', text: '...' },
      { id: 'b', text: 'Beta', aliases: ['', '  ', '"'] },
    ]);
    expect(problems.filter((p) => p.kind === 'EMPTY_TEXT')).toHaveLength(4);
  });

  it('rejects text longer than 200 code points', () => {
    const problems = analyzeAnswerSet([{ id: 'a', text: 'x'.repeat(201) }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('TEXT_TOO_LONG');
  });

  it('rejects two canonical answers that normalize to the same text', () => {
    const problems = analyzeAnswerSet([
      { id: 'a', text: 'Python' },
      { id: 'b', text: ' python. ' },
    ]);
    expect(problems).toContainEqual({
      kind: 'DUPLICATE_CANONICAL_TEXT',
      normalizedText: 'python',
      answerIds: ['a', 'b'],
    });
  });

  it('rejects an alias claimed by two different answers', () => {
    const problems = analyzeAnswerSet([
      { id: 'a', text: 'Alpha', aliases: ['Shared'] },
      { id: 'b', text: 'Beta', aliases: ['shared'] },
    ]);
    expect(problems).toContainEqual({
      kind: 'AMBIGUOUS_ALIAS',
      normalizedText: 'shared',
      answerIds: ['a', 'b'],
    });
  });

  it('rejects an alias that equals another answer\u2019s canonical text', () => {
    const problems = analyzeAnswerSet([
      { id: 'go', text: 'Go' },
      { id: 'golang', text: 'Golang', aliases: ['GO'] },
    ]);
    expect(problems).toContainEqual({
      kind: 'AMBIGUOUS_ALIAS',
      normalizedText: 'go',
      answerIds: ['go', 'golang'],
    });
  });

  it('treats an alias identical to its own canonical text as redundant, not ambiguous', () => {
    const answers = [{ id: 'a', text: 'Alpha', aliases: ['ALPHA', 'alpha.'] }];
    expect(analyzeAnswerSet(answers)).toEqual([]);
    expect(matchAnswer('alpha', buildAnswerIndex(answers))).toMatchObject({
      ok: true,
      matchedVia: 'canonical',
    });
  });

  it('treats the same alias listed twice for one answer as harmless', () => {
    expect(analyzeAnswerSet([{ id: 'a', text: 'Alpha', aliases: ['Al', 'AL', 'al.'] }])).toEqual([]);
  });

  it('reports every problem at once, in a deterministic order', () => {
    const answers: AnswerDefinition[] = [
      { id: 'a', text: 'Same' },
      { id: 'b', text: 'same' },
      { id: 'c', text: 'Gamma', aliases: ['x'] },
      { id: 'd', text: 'Delta', aliases: ['X'] },
      { id: 'e', text: '...' },
    ];
    const forward = analyzeAnswerSet(answers);
    const backward = analyzeAnswerSet([...answers].reverse());
    expect(forward.map((p) => p.kind).sort()).toEqual(
      ['AMBIGUOUS_ALIAS', 'DUPLICATE_CANONICAL_TEXT', 'EMPTY_TEXT'].sort(),
    );
    expect(backward).toEqual(forward);
  });
});

describe('buildAnswerIndex', () => {
  it('throws an AnswerIndexError carrying every problem when the set is unsafe', () => {
    const bad: AnswerDefinition[] = [
      { id: 'a', text: 'Alpha', aliases: ['Shared'] },
      { id: 'b', text: 'Beta', aliases: ['Shared'] },
    ];
    try {
      buildAnswerIndex(bad);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AnswerIndexError);
      expect((error as AnswerIndexError).problems).toHaveLength(1);
    }
  });

  it('indexes canonicals and aliases separately and never lets an alias shadow a canonical', () => {
    const index = buildAnswerIndex(LANGUAGES);
    expect(index.canonicalByText.get('javascript')).toBe('js');
    expect(index.aliasByText.get('js')).toBe('js');
    expect(index.aliasByText.get('python 3')).toBe('py');
    expect(index.aliasByText.has('javascript')).toBe(false);
    // 3 canonical answers (JavaScript, Python, Rust) + 4 aliases (JS, ECMAScript, Python 3, py).
    expect(index.canonicalByText.size).toBe(3);
    expect(index.aliasByText.size).toBe(4);
    expect(index.entries).toHaveLength(7);
    expect(index.entries.filter((entry) => entry.isCanonical)).toHaveLength(3);
  });

  it('does not depend on the order the answers are given in', () => {
    const forward = buildAnswerIndex(LANGUAGES);
    const reversed = buildAnswerIndex([...LANGUAGES].reverse());
    for (const text of ['javascript', 'python', 'rust', 'js', 'py', 'python 3', 'ecmascript']) {
      expect(matchAnswer(text, forward)).toEqual(matchAnswer(text, reversed));
    }
  });
});
