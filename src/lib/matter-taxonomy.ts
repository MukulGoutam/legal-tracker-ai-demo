// Taxonomy constants and helpers for multi-parameter matter prediction.

// ── Liability estimates ────────────────────────────────────────────────────────

export const LIABILITY_ESTIMATES = ['Probable', 'Reasonably Possible', 'Remote'] as const;
export type LiabilityEstimate = (typeof LIABILITY_ESTIMATES)[number];

// ── Jurisdiction tiers ─────────────────────────────────────────────────────────

export const JURISDICTION_TIERS = [
  'federal-major',
  'federal-other',
  'state-major',
  'state-other',
  'international',
] as const;
export type JurisdictionTier = (typeof JURISDICTION_TIERS)[number];

// ── Exposure bands ─────────────────────────────────────────────────────────────

export const EXPOSURE_BANDS = ['micro', 'small', 'medium', 'large', 'mega'] as const;
export type ExposureBand = (typeof EXPOSURE_BANDS)[number];

// ── Cost multipliers ───────────────────────────────────────────────────────────

export const LIABILITY_COST_MULTIPLIER: Record<LiabilityEstimate, number> = {
  Probable: 0.80,
  'Reasonably Possible': 1.00,
  Remote: 1.25,
};

export const JURISDICTION_COST_MULTIPLIER: Record<JurisdictionTier, number> = {
  'federal-major': 1.35,
  'federal-other': 1.12,
  'state-major': 1.00,
  'state-other': 0.85,
  international: 1.20,
};

// ── bandExposure ───────────────────────────────────────────────────────────────

/**
 * Maps a dollar amount to an exposure band.
 * Returns null for null, zero, or negative amounts.
 */
export function bandExposure(amount: number | null | undefined): ExposureBand | null {
  if (amount == null || amount <= 0) return null;
  if (amount < 100_000) return 'micro';
  if (amount < 1_000_000) return 'small';
  if (amount < 10_000_000) return 'medium';
  if (amount < 100_000_000) return 'large';
  return 'mega';
}

// ── tierJurisdiction ───────────────────────────────────────────────────────────

const FEDERAL_MAJOR_PATTERNS = /\b(SDNY|NDCA|D\.?\s*Del|DDel|N\.?D\.?\s*Cal|S\.?D\.?\s*N\.?Y)\b/i;
const INTERNATIONAL_PATTERNS = /\b(UK|England|Wales|EU|European Union|Germany|France|Netherlands|Singapore|HK|Hong Kong|Australia)\b/i;
const STATE_MAJOR_PATTERNS = /\b(New York|N\.?Y\.?|California|Cal\.?|Delaware|Del\.?|Texas|Tex\.?)\b/i;

/**
 * Infers a JurisdictionTier from a free-text jurisdiction string.
 * Returns null if input is null or empty.
 */
export function tierJurisdiction(jurisdiction: string | null | undefined): JurisdictionTier | null {
  if (!jurisdiction?.trim()) return null;
  const j = jurisdiction.trim();

  if (FEDERAL_MAJOR_PATTERNS.test(j)) return 'federal-major';
  if (/\bfederal\b/i.test(j)) return 'federal-other';
  if (INTERNATIONAL_PATTERNS.test(j)) return 'international';
  if (STATE_MAJOR_PATTERNS.test(j)) return 'state-major';
  return 'state-other';
}

// ── Human-readable labels ──────────────────────────────────────────────────────

const BAND_LABELS: Record<ExposureBand, string> = {
  micro: 'Micro exposure (< $100K)',
  small: 'Small exposure ($100K–$1M)',
  medium: 'Medium exposure ($1M–$10M)',
  large: 'Large exposure ($10M–$100M)',
  mega: 'Mega exposure (> $100M)',
};

const TIER_LABELS: Record<JurisdictionTier, string> = {
  'federal-major': 'Federal Major (SDNY, NDCA, DDel)',
  'federal-other': 'Federal Other',
  'state-major': 'State Major (NY, CA, DE, TX)',
  'state-other': 'State Other',
  international: 'International',
};

export function bandLabel(band: ExposureBand): string {
  return BAND_LABELS[band];
}

export function tierLabel(tier: JurisdictionTier): string {
  return TIER_LABELS[tier];
}
