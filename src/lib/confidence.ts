export const MIN_SAMPLE_STRICT = 15;
export const MIN_SAMPLE_FALLBACK = 5;

export type ConfidenceLevel = 'High' | 'Medium' | 'Low' | 'Insufficient';

/**
 * Maps a sample size to a confidence tier.
 * @param n - number of data points
 */
export function confidenceLevel(n: number): ConfidenceLevel {
  if (n >= 50) return 'High';
  if (n >= MIN_SAMPLE_STRICT) return 'Medium';
  if (n >= MIN_SAMPLE_FALLBACK) return 'Low';
  return 'Insufficient';
}

/**
 * Returns Tailwind badge classes for a confidence level.
 * @param level - ConfidenceLevel string
 */
export function confidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case 'High':         return 'bg-green-100 text-green-800 ring-green-600/20';
    case 'Medium':       return 'bg-yellow-100 text-yellow-800 ring-yellow-600/20';
    case 'Low':          return 'bg-orange-100 text-orange-800 ring-orange-600/20';
    case 'Insufficient': return 'bg-red-100 text-red-800 ring-red-600/20';
  }
}
