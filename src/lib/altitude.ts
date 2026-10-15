// The ascent metaphor: a climb is a trip from the surface of the Earth up through the layers of
// the atmosphere, one layer per question. Presentation only; scoring never reads this file.
//
// Three ideas are kept apart on purpose:
//   - the QUESTION NUMBER picks the named layer (question 1 is the Surface, question 7 is Space);
//   - accumulated POINTS are the altitude in kilometres (1 point = 1 km);
//   - the RARITY of one answer (its points) decides how big the reveal effects are.
//
// Darkness blends the layer the player is in (so the sky always darkens as the climb goes on) with
// how well they have scored (so a better answer visibly darkens it faster).

export const ALTITUDE_KM_PER_POINT = 1;
export const MAX_DIVE_POINTS = 700;

export interface Sphere {
  readonly id: string;
  readonly name: string;
  /** Real-world floor of the layer, in kilometres, shown as a caption only. */
  readonly realFloorKm: number;
  readonly blurb: string;
  /** Sky gradient, top and bottom, at the layer's own base darkness. */
  readonly skyTop: string;
  readonly skyBottom: string;
  /** The colour of the glow along the horizon: warm near the ground, ultraviolet near space. */
  readonly glow: string;
}

export const SPHERES: readonly Sphere[] = [
  {
    id: 'surface',
    name: 'Surface',
    realFloorKm: 0,
    blurb: 'Solid ground. Everyone starts here.',
    skyTop: '#2b7bff',
    skyBottom: '#8fe6ff',
    glow: '#ff9d6b',
  },
  {
    id: 'troposphere',
    name: 'Troposphere',
    realFloorKm: 0,
    blurb: 'Clouds, weather and every flight you have taken.',
    skyTop: '#2a58f5',
    skyBottom: '#62c6ff',
    glow: '#ffb86b',
  },
  {
    id: 'stratosphere',
    name: 'Stratosphere',
    realFloorKm: 12,
    blurb: 'Thin, cold and calm, above the weather.',
    skyTop: '#3a3fd6',
    skyBottom: '#4aa9ff',
    glow: '#c98bff',
  },
  {
    id: 'mesosphere',
    name: 'Mesosphere',
    realFloorKm: 50,
    blurb: 'Where meteors burn up.',
    skyTop: '#2a2a9e',
    skyBottom: '#3b6fe0',
    glow: '#9f6bff',
  },
  {
    id: 'thermosphere',
    name: 'Thermosphere',
    realFloorKm: 85,
    blurb: 'Auroras and the space station.',
    skyTop: '#171a63',
    skyBottom: '#3b3fb8',
    glow: '#7a4dff',
  },
  {
    id: 'exosphere',
    name: 'Exosphere',
    realFloorKm: 600,
    blurb: 'The last wisps of air.',
    skyTop: '#0b0d3d',
    skyBottom: '#20227a',
    glow: '#6a3dff',
  },
  {
    id: 'space',
    name: 'Space',
    realFloorKm: 10000,
    blurb: 'Black sky and a curved Earth below.',
    skyTop: '#04051a',
    skyBottom: '#0c0b3a',
    glow: '#b14dff',
  },
];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** The sphere a question takes place in. Question 0 is the first question, on the surface. */
export function sphereForQuestion(questionIndex: number): Sphere {
  if (!Number.isInteger(questionIndex) || questionIndex < 0) {
    throw new RangeError(`questionIndex must be a non-negative integer, got ${questionIndex}`);
  }
  return SPHERES[Math.min(questionIndex, SPHERES.length - 1)]!;
}

export function altitudeKm(totalPoints: number): number {
  if (!Number.isFinite(totalPoints) || totalPoints < 0) {
    throw new RangeError(`totalPoints must be a non-negative number, got ${totalPoints}`);
  }
  return totalPoints * ALTITUDE_KM_PER_POINT;
}

/**
 * 0 is a bright day sky, 1 is black space. 60% comes from the layer, 40% from the score, so the
 * sky never lightens as a climb goes on and a strong answer visibly darkens it further.
 */
export function darkness(questionIndex: number, totalPoints: number): number {
  const last = SPHERES.length - 1;
  const layer = clamp01(Math.min(questionIndex, last) / last);
  const score = clamp01(totalPoints / MAX_DIVE_POINTS);
  return clamp01(0.6 * layer + 0.4 * score);
}

/** How big the "boost" animation for a single answer should be: 0 (barely) to 1 (maximum). */
export function boostStrength(points: number): number {
  return clamp01(points / 100);
}

export type RevealLevel = 'small' | 'medium' | 'big';

/**
 * How dramatic the answer reveal is. Every valid answer gets a clear reward; rarer ones get more.
 * 10 to 15 points is small, 30 to 60 is medium, 85 to 100 is big.
 */
export function revealLevel(points: number): RevealLevel {
  if (!Number.isFinite(points) || points < 0) {
    throw new RangeError(`points must be a non-negative number, got ${points}`);
  }
  if (points >= 85) return 'big';
  if (points >= 30) return 'medium';
  return 'small';
}

export function formatAltitude(km: number): string {
  if (km < 1) return '0 km';
  return `${Math.round(km).toLocaleString('en-IN')} km`;
}
