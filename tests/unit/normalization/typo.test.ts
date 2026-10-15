import { describe, expect, it } from 'vitest';
import { boundedEditDistance, classifySingleEdit, maxEditsForLength } from '@/domain/normalization';

const distance = (a: string, b: string, limit = 5) =>
  boundedEditDistance(Array.from(a), Array.from(b), limit);

const edit = (input: string, candidate: string) =>
  classifySingleEdit(Array.from(input), Array.from(candidate));

describe('classifySingleEdit (§6.2)', () => {
  it('detects one substitution', () => {
    expect(edit('elixer', 'elixir')).toBe('substitution');
    expect(edit('xython', 'python')).toBe('substitution');
    expect(edit('pythoz', 'python')).toBe('substitution');
  });

  it('detects one adjacent transposition', () => {
    expect(edit('pyhton', 'python')).toBe('transposition');
    expect(edit('recieve', 'receive')).toBe('transposition');
    expect(edit('ypthon', 'python')).toBe('transposition');
  });

  it('detects one insertion and one deletion, named relative to turning input into candidate', () => {
    expect(edit('haskel', 'haskell')).toBe('insertion'); // the candidate has one extra letter
    expect(edit('haskells', 'haskell')).toBe('deletion'); // the input has one extra letter
    expect(edit('aython', 'ython')).toBe('deletion');
    expect(edit('ython', 'python')).toBe('insertion');
  });

  it('returns null for identical text and for anything more than one edit away', () => {
    expect(edit('python', 'python')).toBeNull();
    expect(edit('pythxz', 'python')).toBeNull(); // two substitutions
    expect(edit('pyth', 'python')).toBeNull(); // two deletions
    expect(edit('abcd', 'cbad')).toBeNull(); // a swap of non-adjacent characters
    expect(edit('abcdef', 'badcfe')).toBeNull();
    expect(edit('', 'ab')).toBeNull();
  });

  it('is not fooled by a transposition-looking pair that is really two substitutions', () => {
    expect(edit('abcd', 'abdx')).toBeNull();
    expect(edit('ab', 'cd')).toBeNull();
  });

  it('works on code points, so an emoji is one character', () => {
    expect(edit('caf\uD83D\uDE00e', 'caf\uD83D\uDE01e')).toBe('substitution');
  });

});

describe('maxEditsForLength', () => {
  it('allows nothing for very short words and more for longer ones', () => {
    expect(maxEditsForLength(1)).toBe(0);
    expect(maxEditsForLength(3)).toBe(0);
    expect(maxEditsForLength(4)).toBe(1);
    expect(maxEditsForLength(7)).toBe(1);
    expect(maxEditsForLength(8)).toBe(2);
    expect(maxEditsForLength(11)).toBe(2);
    expect(maxEditsForLength(12)).toBe(3);
    expect(maxEditsForLength(40)).toBe(3);
  });
});

describe('boundedEditDistance', () => {
  it('is zero for identical text', () => {
    expect(distance('delhi', 'delhi')).toBe(0);
  });

  it('counts a substitution, an insertion, a deletion and a transposition as one edit each', () => {
    expect(distance('mumbei', 'mumbai')).toBe(1);
    expect(distance('hyderbad', 'hyderabad')).toBe(1);
    expect(distance('bangalore', 'bangalor')).toBe(1);
    expect(distance('chenani', 'chennai')).toBe(1);
  });

  it('adds up independent edits', () => {
    expect(distance('kolkta', 'kolkata')).toBe(1);
    expect(distance('kolktaa', 'kolkata')).toBe(1); // one adjacent swap
    expect(distance('kolktxa', 'kolkata')).toBe(2); // two separate edits
  });

  it('stops early and reports limit + 1 when the text is too far away', () => {
    expect(distance('abcdef', 'uvwxyz', 2)).toBe(3);
    expect(distance('a', 'abcdefgh', 2)).toBe(3);
  });

  it('works on code points', () => {
    expect(distance('caf\uD83D\uDE00e', 'caf\uD83D\uDE01e')).toBe(1);
  });
});
