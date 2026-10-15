import { DAILY_POOL, PRACTICE_POOL } from '../content/questions';
import { GAME } from '../config';
import { seedOrder } from './util';

/**
 * The seven questions of a daily challenge, fixed by the date alone, so every player gets the same
 * ordered set. Questions are drawn only from DAILY_POOL, i.e. ones that can pay a rare tier. The
 * result is stored when the challenge is first requested, so a later change to the bank never
 * changes a challenge that has already started.
 */
export function dailyQuestionIds(date: string): string[] {
  return [...DAILY_POOL]
    .sort((a, b) => seedOrder(date, a.id) - seedOrder(date, b.id) || a.id.localeCompare(b.id))
    .slice(0, GAME.questionCount)
    .map((q) => q.id);
}

/**
 * Seven questions for a practice dive. Today's daily questions are held back so practice cannot
 * leak them (ADR OQ-2). Questions the player has seen least often come first, so none repeats
 * until the whole eligible pool has been used (spec §4B). `seed` (the session id) breaks ties.
 */
export function practiceQuestionIds(
  usage: ReadonlyMap<string, number>,
  excluded: ReadonlySet<string>,
  seed: string,
): string[] {
  const eligible = PRACTICE_POOL.filter((q) => !excluded.has(q.id));
  const pool = eligible.length >= GAME.questionCount ? eligible : PRACTICE_POOL;
  return [...pool]
    .sort(
      (a, b) =>
        (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) ||
        seedOrder(seed, a.id) - seedOrder(seed, b.id) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, GAME.questionCount)
    .map((q) => q.id);
}
