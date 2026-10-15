import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  exceedsMaxAnswerLength,
  MAX_ANSWER_CODE_POINTS,
  normalizeAnswerText,
} from '@/domain/normalization';

describe('normalizeAnswerText (§6.1 steps 2-4)', () => {
  it.each([
    ['JavaScript', 'javascript'],
    ['PYTHON', 'python'],
    ['Spider-Man', 'spider man'],
    ['spider\u2013man', 'spider man'], // en dash
    ['spider\u2014man', 'spider man'], // em dash
    ['World\u2019s Fair', 'worlds fair'], // typographic apostrophe
    ["World's Fair", 'worlds fair'],
    ['"Python"', 'python'],
    ['\u201CPython\u201D', 'python'],
    ['Python.', 'python'],
    ['Python...', 'python'],
    ['Python . . .', 'python'],
    ['a  b\t\n c', 'a b c'],
    ['St. Louis', 'st. louis'], // internal punctuation is kept
    ['Node.js.', 'node.js'],
    ['.NET', '.net'], // a leading period is part of the name
    ['C++', 'c++'],
    ['C#', 'c#'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeAnswerText(input)).toBe(expected);
  });

  it('returns an empty string when nothing meaningful is left', () => {
    for (const input of ['...', '. .', '"', "''", '\u200B', '\u00AD\uFEFF', '-', '\u201C\u201D']) {
      expect(normalizeAnswerText(input)).toBe('');
    }
  });

  it('removes invisible characters that make identical-looking text unequal', () => {
    expect(normalizeAnswerText('Java\u200BScript')).toBe('javascript');
    expect(normalizeAnswerText('Java\u00ADScript')).toBe('javascript');
    expect(normalizeAnswerText('\uFEFFPython')).toBe('python');
  });

  it('composes to NFC so decomposed and composed text match', () => {
    const composed = 'Caf\u00E9';
    const decomposed = 'Cafe\u0301';
    expect(composed).not.toBe(decomposed);
    expect(normalizeAnswerText(decomposed)).toBe(normalizeAnswerText(composed));
    expect(normalizeAnswerText(decomposed)).toBe('caf\u00E9');
  });

  it('keeps accented letters distinct from plain ones (no accent folding)', () => {
    expect(normalizeAnswerText('caf\u00E9')).not.toBe(normalizeAnswerText('cafe'));
  });

  it('never leaves an unpaired surrogate, even when removing a character would join two halves', () => {
    const out = normalizeAnswerText('a\uD83D\u200B\uDE00b'); // zero-width space between surrogate halves
    expect(out).toBe('a\uD83D\uDE00b'); // the halves joined into one valid emoji
    expect(normalizeAnswerText('a\uD83Db')).toBe('ab'); // a genuinely lone half is dropped
    expect(() => encodeURIComponent(normalizeAnswerText('x\uDE00y'))).not.toThrow(); // well formed
  });

  it('does not mutate meaning-bearing characters in different scripts', () => {
    expect(normalizeAnswerText('\u6771\u4EAC')).toBe('\u6771\u4EAC');
    expect(normalizeAnswerText('\u041C\u043E\u0441\u043A\u0432\u0430')).toBe('\u043C\u043E\u0441\u043A\u0432\u0430');
  });
});

describe('normalizeAnswerText is idempotent (so index text and input text always agree)', () => {
  // Seeded, so the same adversarial inputs run on every machine.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ALPHABET = [
    'a', 'B', 'z', 'E', ' ', '  ', '\t', '\n', '.', '..', '-', '\u2013', "'", '"', '\u2019',
    '\u201C', '\u200B', '\u00AD', '\uFEFF', 'e', '\u0301', '\u00E9', '\u0130', '\u1FEF', '\u2126',
    '\u212A', '\uD83D', '\uDE00', '\uD83D\uDE00', '\u0060', '\u00B4', '1', '#', '+', '\u3000',
  ];

  it('holds for 20,000 seeded random strings built from tricky characters', () => {
    const random = mulberry32(424242);
    for (let i = 0; i < 20_000; i += 1) {
      const length = 1 + Math.floor(random() * 12);
      let text = '';
      for (let j = 0; j < length; j += 1) {
        text += ALPHABET[Math.floor(random() * ALPHABET.length)];
      }
      const once = normalizeAnswerText(text.trim());
      const twice = normalizeAnswerText(once);
      if (twice !== once) {
        throw new Error(`not idempotent for ${JSON.stringify(text)}: ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`);
      }
      expect(once).toBe(once.normalize('NFC'));
      expect(once).toBe(once.trim());
    }
  });
});

describe('length limits (§6.1 step 1)', () => {
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('\uD83D\uDE00')).toBe(1);
    expect('\uD83D\uDE00'.length).toBe(2);
  });

  it('allows exactly 200 code points and rejects 201', () => {
    expect(exceedsMaxAnswerLength('a'.repeat(MAX_ANSWER_CODE_POINTS))).toBe(false);
    expect(exceedsMaxAnswerLength('a'.repeat(MAX_ANSWER_CODE_POINTS + 1))).toBe(true);
    expect(exceedsMaxAnswerLength('\uD83D\uDE00'.repeat(200))).toBe(false); // 400 UTF-16 units
    expect(exceedsMaxAnswerLength('\uD83D\uDE00'.repeat(201))).toBe(true);
  });

  it('rejects an enormous input without needing to count it', () => {
    expect(exceedsMaxAnswerLength('a'.repeat(5_000_000))).toBe(true);
  });
});
