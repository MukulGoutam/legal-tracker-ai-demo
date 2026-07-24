/**
 * Returns the p-th percentile of `values` using linear interpolation.
 * Returns 0 for an empty array.
 * @param values - unsorted array of numbers
 * @param p - percentile in [0, 100]
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Returns the median of `values`, or null for an empty array.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return percentile(values, 50);
}

/**
 * Returns the arithmetic mean of `values`, or 0 for an empty array.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Returns the population standard deviation of `values`, or 0 for an empty array.
 */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Returns the absolute number of calendar days between two dates.
 */
export function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / 86_400_000);
}
