import { describe, expect, it } from 'vitest';
import {
  buildAnswerIndex,
  matchAnswer,
  NORMALIZATION_VERSION,
  type AnswerDefinition,
} from '@/domain/normalization';

const LANGUAGES: AnswerDefinition[] = [
  { id: 'js', text: 'JavaScript', aliases: ['JS', 'ECMAScript'] },
  { id: 'py', text: 'Python', aliases: ['Python 3', 'py'] },
  { id: 'rust', text: 'Rust' },
  { id: 'elixir', text: 'Elixir' },
  { id: 'ocaml', text: 'OCaml' },
  { id: 'haskell', text: 'Haskell' },
];
const index = buildAnswerIndex(LANGUAGES);

describe('exact matching (§6.1 steps 5-6)', () => {
  it('matches an alias and reports it as an alias', () => {
    expect(matchAnswer('JS', index)).toMatchObject({ ok: true, canonicalAnswerId: 'js', matchedVia: 'alias' });
    expect(matchAnswer('js', index)).toMatchObject({ ok: true, canonicalAnswerId: 'js', matchedVia: 'alias' });
    expect(matchAnswer('ECMAScript', index)).toMatchObject({ ok: true, canonicalAnswerId: 'js' });
  });

  it('maps equivalent aliases to the same canonical answer, so they cannot split the vote', () => {
    const viaAlias = matchAnswer('JS', index);
    const viaCanonical = matchAnswer('JavaScript', index);
    const viaSloppyCase = matchAnswer('  javascript  ', index);
    for (const result of [viaAlias, viaCanonical, viaSloppyCase]) {
      expect(result).toMatchObject({ ok: true, canonicalAnswerId: 'js' });
    }
  });

  it('matches a canonical answer', () => {
    expect(matchAnswer('Python', index)).toMatchObject({ ok: true, canonicalAnswerId: 'py', matchedVia: 'canonical' });
    expect(matchAnswer('OCAML', index)).toMatchObject({ ok: true, canonicalAnswerId: 'ocaml' });
  });

  it('normalizes punctuation and spacing before matching', () => {
    expect(matchAnswer('python-3', index)).toMatchObject({ ok: true, canonicalAnswerId: 'py', matchedVia: 'alias' });
    expect(matchAnswer('  "Python 3".  ', index)).toMatchObject({ ok: true, canonicalAnswerId: 'py' });
    expect(matchAnswer('Java\u200BScript', index)).toMatchObject({ ok: true, canonicalAnswerId: 'js' });
  });

  it('records the normalized text and the normalization version on every result', () => {
    expect(matchAnswer('  Python-3. ', index)).toEqual({
      ok: true,
      canonicalAnswerId: 'py',
      matchedVia: 'alias',
      normalizedText: 'python 3',
      normalizationVersion: NORMALIZATION_VERSION,
    });
    expect(matchAnswer('klingon', index)).toMatchObject({ ok: false, normalizationVersion: NORMALIZATION_VERSION });
  });

  it('matches composed and decomposed Unicode identically', () => {
    const cafes = buildAnswerIndex([{ id: 'cafe', text: 'Caf\u00E9' }]);
    expect(matchAnswer('Cafe\u0301', cafes)).toMatchObject({ ok: true, canonicalAnswerId: 'cafe' });
    expect(matchAnswer('CAF\u00C9', cafes)).toMatchObject({ ok: true, canonicalAnswerId: 'cafe' });
    // No accent folding: a missing accent is one edit, so it is handled as a spelling correction.
    expect(matchAnswer('cafe', cafes)).toMatchObject({ ok: true, matchedVia: 'typo_correction' });
  });
});

describe('rejections (§6.1 steps 1 and 8)', () => {
  it('rejects empty and whitespace-only input without a normalized form', () => {
    for (const input of ['', '   ', '\n\t']) {
      expect(matchAnswer(input, index)).toMatchObject({ ok: false, reason: 'EMPTY_INPUT', normalizedText: null });
    }
  });

  it('rejects input that normalizes to nothing', () => {
    for (const input of ['...', '"', '\u200B', '-']) {
      expect(matchAnswer(input, index)).toMatchObject({ ok: false, reason: 'EMPTY_INPUT', normalizedText: '' });
    }
  });

  it('rejects over-long input, counting code points, without normalizing it', () => {
    expect(matchAnswer('a'.repeat(201), index)).toMatchObject({ ok: false, reason: 'TOO_LONG', normalizedText: null });
    expect(matchAnswer('\uD83D\uDE00'.repeat(201), index)).toMatchObject({ ok: false, reason: 'TOO_LONG' });
    expect(matchAnswer('a'.repeat(200), index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
    expect(matchAnswer('\uD83D\uDE00'.repeat(200), index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
    expect(matchAnswer('a'.repeat(1_000_000), index)).toMatchObject({ ok: false, reason: 'TOO_LONG' });
  });

  it('rejects an unrelated answer: an unusual string is never assumed correct', () => {
    for (const input of ['Klingon', 'banana', 'forth', 'Brainfuck', '42', 'javascripture']) {
      expect(matchAnswer(input, index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
    }
  });

  it('does not match on a prefix or a superstring', () => {
    expect(matchAnswer('Java', index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
    expect(matchAnswer('Pythonista', index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
    expect(matchAnswer('Rust language', index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
  });
});

describe('spelling auto-correction (normalization version 2)', () => {
  it('accepts one adjacent transposition', () => {
    expect(matchAnswer('Pyhton', index)).toMatchObject({
      ok: true,
      canonicalAnswerId: 'py',
      matchedVia: 'typo_correction',
    });
  });

  it('accepts one substitution', () => {
    expect(matchAnswer('Elixer', index)).toMatchObject({
      ok: true,
      canonicalAnswerId: 'elixir',
      matchedVia: 'typo_correction',
    });
  });

  it('accepts a missing or extra letter', () => {
    expect(matchAnswer('Haskel', index)).toMatchObject({ ok: true, canonicalAnswerId: 'haskell', matchedVia: 'typo_correction' });
    expect(matchAnswer('Haskells', index)).toMatchObject({ ok: true, canonicalAnswerId: 'haskell', matchedVia: 'typo_correction' });
    expect(matchAnswer('Pythonn', index)).toMatchObject({ ok: true, canonicalAnswerId: 'py', matchedVia: 'typo_correction' });
  });

  it('allows more mistakes in longer words', () => {
    const cities = buildAnswerIndex([
      { id: 'hyd', text: 'Hyderabad' },
      { id: 'che', text: 'Chennai' },
      { id: 'tvm', text: 'Thiruvananthapuram' },
    ]);
    expect(matchAnswer('Hyderbad', cities)).toMatchObject({ ok: true, canonicalAnswerId: 'hyd' }); // 1 edit
    expect(matchAnswer('Chenaai', cities)).toMatchObject({ ok: true, canonicalAnswerId: 'che' }); // 1 edit, 7 letters
    expect(matchAnswer('Chenaaa', cities)).toMatchObject({ ok: false, reason: 'NO_MATCH' }); // 2 edits, 7 letters
    // 2 edits are fine in a long word (16 letters typed, 3 allowed).
    expect(matchAnswer('Thiruvanantpuram', cities)).toMatchObject({ ok: true, canonicalAnswerId: 'tvm' });
  });

  it('does not stretch a short input into a longer answer: the allowance follows the shorter text', () => {
    const cities = buildAnswerIndex([{ id: 'hyd', text: 'Hyderabad' }]);
    expect(matchAnswer('Hydrabd', cities)).toMatchObject({ ok: false, reason: 'NO_MATCH' }); // 7 letters, 2 edits
    expect(matchAnswer('Hyd', cities)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
  });

  it('never corrects very short input, where one edit changes the meaning', () => {
    const short = buildAnswerIndex([{ id: 'goa', text: 'Goa' }, { id: 'ooty', text: 'Ooty' }]);
    expect(matchAnswer('Gos', short)).toMatchObject({ ok: false, reason: 'NO_MATCH' }); // 3 letters
    expect(matchAnswer('Ooti', short)).toMatchObject({ ok: true, canonicalAnswerId: 'ooty' }); // 4 letters
  });

  it('rejects a wild guess that is merely somewhat similar', () => {
    expect(matchAnswer('Pyhtno', index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
    expect(matchAnswer('Elaxer', index)).toMatchObject({ ok: false, reason: 'NO_MATCH' });
  });

  it('prefers the strictly nearest answer when several are within range', () => {
    const answers = buildAnswerIndex([
      { id: 'pune', text: 'Punee' },
      { id: 'pun', text: 'Punjab' },
    ]);
    // "punje" is 1 edit from "punee", and 2 from "punjab", but the allowance for 5 letters is 1.
    expect(matchAnswer('Punje', answers)).toMatchObject({ ok: true, canonicalAnswerId: 'pune' });
  });

  it('rejects as ambiguous when two canonical answers are one edit away', () => {
    const cities = buildAnswerIndex([
      { id: 'berlin', text: 'Berlin' },
      { id: 'merlin', text: 'Merlin' },
    ]);
    expect(matchAnswer('Zerlin', cities)).toMatchObject({ ok: false, reason: 'AMBIGUOUS_TYPO' });
    expect(matchAnswer('Berlin', cities)).toMatchObject({ ok: true, canonicalAnswerId: 'berlin', matchedVia: 'canonical' });
  });

  it('lets another answer\u2019s alias block a correction (contrived, but it proves the rule)', () => {
    const planets = buildAnswerIndex([
      { id: 'jupiter', text: 'Jupiter' },
      { id: 'neptune', text: 'Neptune', aliases: ['Jupitor'] },
    ]);
    // "jupitar" is one substitution from BOTH "jupiter" and the alias "jupitor".
    expect(matchAnswer('Jupitar', planets)).toMatchObject({ ok: false, reason: 'AMBIGUOUS_TYPO' });
  });

  it('corrects through an alias too, and reports it as a correction', () => {
    const names = buildAnswerIndex([{ id: 'kath', text: 'Katherine', aliases: ['Kathryn'] }]);
    expect(matchAnswer('Kathrin', names)).toMatchObject({ ok: true, canonicalAnswerId: 'kath', matchedVia: 'typo_correction' });
    expect(matchAnswer('Kathryn', names)).toMatchObject({ ok: true, matchedVia: 'alias' }); // exact alias is fine
  });

  it('two spellings of the same answer never make a correction ambiguous', () => {
    const names = buildAnswerIndex([{ id: 'bom', text: 'Bombay', aliases: ['Bombai'] }]);
    expect(matchAnswer('Bombaj', names)).toMatchObject({ ok: true, canonicalAnswerId: 'bom' });
  });

  it('does not let an exact alias be overridden by a nearby canonical', () => {
    const answers = buildAnswerIndex([
      { id: 'a', text: 'Mercury' },
      { id: 'b', text: 'Venus', aliases: ['Mercurx'] },
    ]);
    expect(matchAnswer('Mercurx', answers)).toMatchObject({ ok: true, canonicalAnswerId: 'b', matchedVia: 'alias' });
  });
});

describe('determinism and purity (§6, §7.12)', () => {
  it('gives the same result for the same input every time', () => {
    const inputs = ['js', 'Pyhton', 'Klingon', '', 'Elixer', '  PYTHON 3. '];
    for (const input of inputs) {
      expect(matchAnswer(input, index)).toEqual(matchAnswer(input, index));
    }
  });

  it('does not change the index it is given', () => {
    const before = JSON.stringify([...index.canonicalByText].concat([...index.aliasByText]));
    matchAnswer('Pyhton', index);
    matchAnswer('js', index);
    expect(JSON.stringify([...index.canonicalByText].concat([...index.aliasByText]))).toBe(before);
  });

  it('matches every canonical answer and alias to itself, under a mix of case and spacing', () => {
    for (const answer of LANGUAGES) {
      for (const text of [answer.text, ...(answer.aliases ?? [])]) {
        for (const variant of [text, text.toUpperCase(), `  ${text.toLowerCase()}  `, `${text}.`]) {
          expect(matchAnswer(variant, index)).toMatchObject({ ok: true, canonicalAnswerId: answer.id });
        }
      }
    }
  });
});
