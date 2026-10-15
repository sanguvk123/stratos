import { describe, expect, it } from 'vitest';
import { matchAnswer } from '@/domain/normalization';
import {
  DAILY_POOL,
  getAnswerIndex,
  getPriorPpm,
  hasRareTail,
  PRACTICE_POOL,
  QUESTION_BANK,
  RARE_TAIL_PPM,
  toPublicQuestion,
  validateBank,
  type PublishedQuestion,
} from '@/server/content/questions';
import { weightsToPpm } from '@/server/content/priors';

describe('weightsToPpm', () => {
  it('sums to exactly 1,000,000 with every value at the 500 floor or above', () => {
    for (const weights of [[1, 1, 1], [30, 22, 12, 8, 0.1], [0.0001, 100], Array(27).fill(1)]) {
      const ppm = weightsToPpm(weights);
      expect(ppm.reduce((a, b) => a + b, 0)).toBe(1_000_000);
      expect(Math.min(...ppm)).toBeGreaterThanOrEqual(500);
    }
  });

  it('keeps the order of the weights', () => {
    const ppm = weightsToPpm([5, 50, 10]);
    expect(ppm[1]).toBeGreaterThan(ppm[2] as number);
    expect(ppm[2]).toBeGreaterThan(ppm[0] as number);
  });

  it('rejects empty or non-positive weights', () => {
    expect(() => weightsToPpm([])).toThrow();
    expect(() => weightsToPpm([1, 0])).toThrow();
    expect(() => weightsToPpm([1, -1])).toThrow();
  });
});

describe('the launch question bank (publication checks, §5.7 and §18.7)', () => {
  it('has at least 20 questions with unique ids', () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(20);
    expect(new Set(QUESTION_BANK.map((q) => q.id)).size).toBe(QUESTION_BANK.length);
  });

  it('is publishable: no ambiguous alias, no duplicate answer, priors sum to exactly 1,000,000 ppm', () => {
    expect(validateBank()).toEqual([]);
  });

  it('gives every question a prompt, a boundary rule, and at least 5 answers', () => {
    for (const question of QUESTION_BANK) {
      expect(question.prompt.length).toBeGreaterThan(10);
      expect(question.qualifier.length).toBeGreaterThan(10);
      expect(question.answers.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('gives no hints: no prompt or boundary rule contains any accepted answer', () => {
    for (const question of QUESTION_BANK) {
      const visible = `${question.prompt} ${question.qualifier}`.toLowerCase();
      for (const answer of question.answers) {
        // Whole-word check so "Son" is not found inside "person".
        const needle = answer.text.toLowerCase();
        const pattern = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
        expect(pattern.test(visible), `${question.id} reveals "${answer.text}"`).toBe(false);
      }
    }
  });

  it('is written for India: every question is about India or Indian life', () => {
    const indian = QUESTION_BANK.filter((q) => q.category.startsWith('India'));
    expect(indian.length).toBe(QUESTION_BANK.length);
  });

  it('matches every canonical answer and every alias back to its own answer', () => {
    for (const question of QUESTION_BANK) {
      const index = getAnswerIndex(question.id);
      for (const answer of question.answers) {
        for (const text of [answer.text, ...answer.aliases]) {
          const result = matchAnswer(text, index);
          expect(result.ok, `${question.id}: "${text}"`).toBe(true);
          if (result.ok) expect(result.canonicalAnswerId, `${question.id}: "${text}"`).toBe(answer.id);
        }
      }
    }
  });

  it('rejects an unrelated answer on every question (nothing is accepted just for being unusual)', () => {
    for (const question of QUESTION_BANK) {
      for (const junk of ['zzzz qqqq', 'asdfgh', '12345', 'a banana split']) {
        expect(matchAnswer(junk, getAnswerIndex(question.id)).ok).toBe(false);
      }
    }
  });

  it('never leaks accepted answers, priors or an example in the public question', () => {
    for (const question of QUESTION_BANK) {
      const publicForm = toPublicQuestion(question) as unknown as Record<string, unknown>;
      expect(Object.keys(publicForm).sort()).toEqual(['category', 'id', 'prompt', 'qualifier']);
      expect(publicForm).not.toHaveProperty('answers');
      expect(publicForm).not.toHaveProperty('example');
    }
  });

  it('assigns a prior to every answer, in line with its editorial weight', () => {
    const states = QUESTION_BANK.find((q) => q.id === 'indian-state') as PublishedQuestion;
    expect(getPriorPpm('indian-state', 'maharashtra')).toBeGreaterThan(getPriorPpm('indian-state', 'tripura'));
    expect(states.answers.reduce((s, a) => s + a.priorPpm, 0)).toBe(1_000_000);
    expect(() => getPriorPpm('indian-state', 'atlantis')).toThrow();
  });

  it('accepts a misspelling of a well-known answer and still refuses a different answer', () => {
    const index = getAnswerIndex('indian-state');
    expect(matchAnswer('Maharastra', index)).toMatchObject({ ok: true, canonicalAnswerId: 'maharashtra', matchedVia: 'typo_correction' });
    expect(matchAnswer('Karnatka', index)).toMatchObject({ ok: true, canonicalAnswerId: 'karnataka' });
    expect(matchAnswer('Gujrat', index)).toMatchObject({ ok: true, canonicalAnswerId: 'gujarat' });
    expect(matchAnswer('Mumbai', index).ok).toBe(false);
  });

  it('does not auto-correct very short answers, so one wrong letter never becomes another state', () => {
    const index = getAnswerIndex('indian-state');
    expect(matchAnswer('Assam', index)).toMatchObject({ ok: true, canonicalAnswerId: 'assam', matchedVia: 'canonical' });
    expect(matchAnswer('Goaa', index).ok).toBe(false); // "Goa" has 3 letters: no corrections
    expect(matchAnswer('Goa', index)).toMatchObject({ ok: true, canonicalAnswerId: 'goa' });
  });

  it('only puts questions that can pay a rare tier into the ranked daily', () => {
    for (const question of DAILY_POOL) {
      expect(Math.min(...question.answers.map((a) => a.priorPpm))).toBeLessThan(RARE_TAIL_PPM);
      expect(hasRareTail(question)).toBe(true);
    }
    // A flat closed set of common answers is practice-only (built by hand: none ships in the bank).
    const flat: PublishedQuestion = {
      id: 'flat',
      version: 2,
      category: 'India: Test',
      prompt: 'A question with no rare answers at all.',
      qualifier: 'Used by a test only.',
      answers: ['a', 'b', 'c', 'd', 'e'].map((text) => ({ id: text, text, aliases: [], priorPpm: 200_000 })),
    };
    expect(hasRareTail(flat)).toBe(false);
    expect(DAILY_POOL.includes(flat)).toBe(false);
    for (const question of QUESTION_BANK) {
      expect(PRACTICE_POOL.includes(question), question.id).toBe(true);
    }
  });

  it('has enough daily-eligible questions to build a 7-question daily with room to rotate', () => {
    expect(DAILY_POOL.length).toBeGreaterThanOrEqual(10);
    expect(PRACTICE_POOL.length).toBe(QUESTION_BANK.length);
  });
});
