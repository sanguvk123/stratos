import crypto from 'node:crypto';

export const newId = (): string => crypto.randomUUID();

export const sha256 = (text: string): string =>
  crypto.createHash('sha256').update(text).digest('hex');

/** Deterministic pseudo-random ordering key for (seed, id). Stable across machines. */
export function seedOrder(seed: string, id: string): number {
  return parseInt(sha256(`${seed}|${id}`).slice(0, 8), 16);
}

/** The UTC calendar date of an instant. The daily challenge resets at 00:00 UTC (§4). */
export function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function cohortKey(date: string, questionId: string): string {
  return `${date}:${questionId}`;
}
