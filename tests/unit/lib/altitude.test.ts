import { describe, expect, it } from 'vitest';
import {
  altitudeKm,
  boostStrength,
  darkness,
  formatAltitude,
  revealLevel,
  SPHERES,
  sphereForQuestion,
} from '@/lib/altitude';

describe('spheres', () => {
  it('starts on the surface of the Earth', () => {
    expect(sphereForQuestion(0).id).toBe('surface');
  });

  it('has one distinct sphere for each of the seven questions', () => {
    const ids = Array.from({ length: 7 }, (_, i) => sphereForQuestion(i).id);
    expect(new Set(ids).size).toBe(7);
    expect(ids[6]).toBe('space');
  });

  it('keeps real-world floors non-decreasing going up', () => {
    for (let i = 1; i < SPHERES.length; i++) {
      expect(SPHERES[i]!.realFloorKm).toBeGreaterThanOrEqual(SPHERES[i - 1]!.realFloorKm);
    }
  });

  it('rejects an invalid index', () => {
    expect(() => sphereForQuestion(-1)).toThrow(RangeError);
    expect(() => sphereForQuestion(1.5)).toThrow(RangeError);
  });

  it('clamps beyond the last sphere', () => {
    expect(sphereForQuestion(99).id).toBe('space');
  });
});

describe('altitude', () => {
  it('is zero at the start and grows with points', () => {
    expect(altitudeKm(0)).toBe(0);
    expect(altitudeKm(100)).toBeGreaterThan(altitudeKm(10));
  });

  it('rejects negative or non-finite points', () => {
    expect(() => altitudeKm(-1)).toThrow(RangeError);
    expect(() => altitudeKm(Number.NaN)).toThrow(RangeError);
  });

  it('formats with grouping and a unit', () => {
    expect(formatAltitude(0)).toBe('0 km');
    expect(formatAltitude(450)).toBe('450 km');
  });
});

describe('darkness', () => {
  it('is a bright sky at the very start and black at the very end', () => {
    expect(darkness(0, 0)).toBe(0);
    expect(darkness(6, 700)).toBe(1);
  });

  it('never gets lighter as the dive goes on, even with no points', () => {
    let previous = -1;
    for (let q = 0; q < 7; q++) {
      const d = darkness(q, 0);
      expect(d).toBeGreaterThanOrEqual(previous);
      previous = d;
    }
  });

  it('is darker for a player who has scored more at the same question', () => {
    expect(darkness(3, 300)).toBeGreaterThan(darkness(3, 40));
  });

  it('stays within 0..1', () => {
    expect(darkness(50, 99999)).toBe(1);
    expect(darkness(0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('revealLevel (how dramatic a reveal is)', () => {
  it('maps the six point values to three intensities: 10-15 small, 30-60 medium, 85-100 big', () => {
    expect([10, 15].map(revealLevel)).toEqual(['small', 'small']);
    expect([30, 60].map(revealLevel)).toEqual(['medium', 'medium']);
    expect([85, 100].map(revealLevel)).toEqual(['big', 'big']);
  });

  it('treats a no-answer round (0 points) as small, never as a failure state', () => {
    expect(revealLevel(0)).toBe('small');
  });

  it('rejects impossible points', () => {
    expect(() => revealLevel(-1)).toThrow(RangeError);
    expect(() => revealLevel(Number.NaN)).toThrow(RangeError);
  });
});

describe('the three ideas stay separate', () => {
  it('the layer follows the question number, not the score', () => {
    expect(sphereForQuestion(2).id).toBe('stratosphere');
    expect(sphereForQuestion(2).id).toBe(sphereForQuestion(2).id);
  });

  it('altitude follows the points, not the question number', () => {
    expect(altitudeKm(45)).toBe(45);
    expect(altitudeKm(0)).toBe(0);
  });
});

describe('boostStrength', () => {
  it('scales with points and is capped at 1', () => {
    expect(boostStrength(10)).toBeCloseTo(0.1);
    expect(boostStrength(100)).toBe(1);
    expect(boostStrength(500)).toBe(1);
  });
});
