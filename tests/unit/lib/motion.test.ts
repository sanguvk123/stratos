import { describe, expect, it } from 'vitest';
import { revealLevel, type RevealLevel } from '@/lib/altitude';
import { countValue, easeOutCubic, MOTION, prefersReducedMotion, revealTimeline } from '@/lib/motion';

describe('easeOutCubic', () => {
  it('starts at 0, ends at 1, never overshoots, and rises monotonically', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let previous = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(previous);
      expect(v).toBeLessThanOrEqual(1);
      previous = v;
    }
  });

  it('clamps outside 0..1', () => {
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(9)).toBe(1);
  });
});

describe('countValue (the score and altitude count-up)', () => {
  it('begins at the start value and lands exactly on the confirmed value', () => {
    expect(countValue(0, 85, 0, 900)).toBe(0);
    expect(countValue(0, 85, 900, 900)).toBe(85);
    expect(countValue(0, 85, 5_000, 900)).toBe(85);
  });

  it('counts up from the previous total, never below it or above the new one', () => {
    for (let ms = 0; ms <= 900; ms += 50) {
      const v = countValue(120, 205, ms, 900);
      expect(v).toBeGreaterThanOrEqual(120);
      expect(v).toBeLessThanOrEqual(205);
    }
  });

  it('shows the final number at once when there is no duration', () => {
    expect(countValue(10, 60, 0, 0)).toBe(60);
  });

  it('only ever shows integers', () => {
    for (let ms = 0; ms <= 900; ms += 37) expect(Number.isInteger(countValue(0, 100, ms, 900))).toBe(true);
  });
});

describe('revealTimeline', () => {
  const levels: RevealLevel[] = ['small', 'medium', 'big'];

  it('stages the beats in order: lock, answer, tier, points', () => {
    for (const level of levels) {
      const t = revealTimeline(level);
      expect(t.lockMs).toBeLessThan(t.answerMs);
      expect(t.answerMs).toBeLessThan(t.tierMs);
      expect(t.tierMs).toBeLessThan(t.pointsMs);
    }
  });

  it('grows the launch with the points: longer, more speed lines, more sparks', () => {
    const [small, medium, big] = levels.map((l) => revealTimeline(l)) as [
      ReturnType<typeof revealTimeline>,
      ReturnType<typeof revealTimeline>,
      ReturnType<typeof revealTimeline>,
    ];
    expect(small.launchSeconds).toBeLessThan(medium.launchSeconds);
    expect(medium.launchSeconds).toBeLessThan(big.launchSeconds);
    expect(small.speedLines).toBeLessThan(medium.speedLines);
    expect(medium.speedLines).toBeLessThan(big.speedLines);
    expect(small.sparks).toBeLessThan(medium.sparks);
    expect(medium.sparks).toBeLessThan(big.sparks);
  });

  it('never makes a low score punishing: it is still quick, with a clear reward', () => {
    const small = revealTimeline('small');
    expect(small.pointsMs).toBeLessThanOrEqual(1000);
    expect(small.speedLines).toBeGreaterThan(0);
  });

  it('keeps even the biggest reveal brief, and only the biggest shakes the card', () => {
    const big = revealTimeline('big');
    expect(big.launchSeconds).toBeLessThanOrEqual(3);
    expect(big.pointsMs).toBeLessThan(2000);
    expect(revealTimeline('small').shake).toBe(false);
    expect(revealTimeline('medium').shake).toBe(false);
    expect(big.shake).toBe(true);
  });

  it('is chosen by points: each of the six point values gets a timeline', () => {
    for (const points of [10, 15, 30, 60, 85, 100]) {
      expect(revealTimeline(revealLevel(points)).launchSeconds).toBeGreaterThan(0);
    }
  });
});

describe('motion constants', () => {
  it('keeps button feedback much faster than a reveal beat, so presses feel instant', () => {
    expect(MOTION.pressMs).toBeLessThan(MOTION.popMs);
    expect(MOTION.popMs).toBeLessThanOrEqual(MOTION.revealMs);
  });
});

describe('prefersReducedMotion', () => {
  it('is false where there is no window (server rendering) rather than throwing', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
