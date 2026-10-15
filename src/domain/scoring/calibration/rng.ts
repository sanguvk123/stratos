// Seeded randomness for the calibration harness (ARCHITECTURE.md §7.11).
// Calibration must be reproducible: the same seed gives the same numbers on every machine.
// This is analysis tooling only. It is never used on the scoring path.

export type Rng = () => number;

/** mulberry32: a small, fast, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth's Poisson sampler. Fine for the small means used here. */
export function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0;
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > limit);
  return k - 1;
}
