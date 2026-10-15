import { MIN_PRIOR_PPM, PPM } from '@/domain/scoring';

/**
 * Turns relative editorial weights into integer priors in parts per million that sum to EXACTLY
 * 1,000,000 with every value at least 500 (ARCHITECTURE.md §5.7, §7.2). The remainder after
 * rounding goes to the largest prior, where one ppm is a negligible relative change.
 */
export function weightsToPpm(weights: readonly number[]): number[] {
  if (weights.length === 0) throw new Error('no weights');
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0) || weights.some((w) => !(w > 0))) throw new Error('weights must be positive');

  const ppm = weights.map((w) => Math.max(MIN_PRIOR_PPM, Math.round((w / total) * PPM)));
  const sum = ppm.reduce((a, b) => a + b, 0);
  let largest = 0;
  ppm.forEach((value, index) => {
    if (value > (ppm[largest] as number)) largest = index;
  });
  ppm[largest] = (ppm[largest] as number) + (PPM - sum);
  if (ppm.reduce((a, b) => a + b, 0) !== PPM || ppm.some((v) => v < MIN_PRIOR_PPM)) {
    throw new Error('priors could not be normalized to exactly 1,000,000 ppm');
  }
  return ppm;
}
