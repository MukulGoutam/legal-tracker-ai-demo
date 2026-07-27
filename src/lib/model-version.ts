// Version history simulated for demo purposes.
// In production, this would track real model releases with actual performance data.

export const MODEL_VERSIONS = {
  v1: {
    name: 'v1.0',
    releasedAt: '2024-01-01',
    description: 'Initial category-based prediction',
    expectedMedianError: 35,
  },
  v1_1: {
    name: 'v1.1',
    releasedAt: '2024-04-01',
    description: 'Added exposure amount scaling',
    expectedMedianError: 28,
  },
  v1_2: {
    name: 'v1.2',
    releasedAt: '2024-07-01',
    description: 'Added liability estimate filter',
    expectedMedianError: 24,
  },
  v2_0: {
    name: 'v2.0 (current)',
    releasedAt: '2024-10-01',
    description: 'Multi-parameter cascading filter with jurisdiction tiering',
    expectedMedianError: 21,
  },
} as const;

export type ModelVersionKey = keyof typeof MODEL_VERSIONS;

export const CURRENT_MODEL_VERSION: ModelVersionKey = 'v2_0';

/** Assign simulated model version based on when the matter was opened. */
export function versionForDate(openedAt: Date): ModelVersionKey {
  const msSince = Date.now() - openedAt.getTime();
  const monthsSince = msSince / (1000 * 60 * 60 * 24 * 30.44);
  if (monthsSince > 18) return 'v1';
  if (monthsSince > 12) return 'v1_1';
  if (monthsSince > 6) return 'v1_2';
  return 'v2_0';
}
