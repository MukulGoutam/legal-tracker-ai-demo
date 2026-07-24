import { PrismaClient } from '@prisma/client';
import { median, mean, stdDev, daysBetween } from './stats';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Minimum closed matters in segment for a firm to receive a score. */
const MIN_MATTERS = 3;

// ─── Public types ──────────────────────────────────────────────────────────────

export interface ScoringWeights {
  /** Weight for cost efficiency metric (default 0.30). */
  cost: number;
  /** Weight for experience volume metric (default 0.20). */
  experience: number;
  /** Weight for cycle time metric (default 0.20). */
  cycle: number;
  /** Weight for budget predictability metric (default 0.30). */
  predictability: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  cost: 0.30,
  experience: 0.20,
  cycle: 0.20,
  predictability: 0.30,
};

export interface FirmMetrics {
  /** 0–1: lower median billing vs peers → higher score. */
  costEfficiency: number;
  /** 0–1: log-scaled matter count relative to the busiest firm in segment. */
  experienceVolume: number;
  /** 0–1: shorter median matter duration vs peers → higher score. */
  cycleTimeScore: number;
  /**
   * 0–1: how close actual costs came to forecast.
   * Falls back to 1 − CV of the firm's own billing totals when no forecast data exists.
   */
  budgetPredictability: number;
}

export interface FirmRawStats {
  matterCount: number;
  /** This firm's median total billing per matter in segment. */
  medianTotal: number;
  /** Median calendar-day duration of matters this firm worked on. */
  medianCycleDays: number;
  /** Number of this firm's segment matters that had a forecast. */
  forecastedMatterCount: number;
  /** Whether predictability used forecast error or spend-variance proxy. */
  predictabilitySource: 'forecast' | 'cv';
  /** Median |actual − forecast| / forecast (set when predictabilitySource === 'forecast'). */
  medianForecastError: number | null;
  /** Coefficient of variation of billing totals (set when predictabilitySource === 'cv'). */
  coefficientOfVariation: number | null;
}

export interface FirmScore {
  firmId: string;
  firmName: string;
  metrics: FirmMetrics;
  /** Raw numbers for tooltip display. */
  rawStats: FirmRawStats;
  compositeScore: number;
  /** 1-based rank among scored firms, sorted by compositeScore descending. */
  rank: number;
  /** Human-readable caveat about data quality, or null when none. */
  dataQualityNote: string | null;
}

export interface InsufficientFirmData {
  firmId: string;
  firmName: string;
  matterCount: number;
}

export interface FirmScoringResult {
  /** Firms with ≥3 closed matters in segment, sorted by compositeScore descending. */
  scored: FirmScore[];
  /** Firms with <3 closed matters — present for visibility but not ranked. */
  insufficientData: InsufficientFirmData[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeWeights(w: ScoringWeights): ScoringWeights {
  const total = w.cost + w.experience + w.cycle + w.predictability;
  if (total === 0) return DEFAULT_WEIGHTS;
  return {
    cost: w.cost / total,
    experience: w.experience / total,
    cycle: w.cycle / total,
    predictability: w.predictability / total,
  };
}

/**
 * Sums `estimatedAmount` across all phases in a Forecast.phases JSON blob.
 * Returns null if the value is absent or structurally unexpected.
 */
function parseForecastTotal(phases: unknown): number | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  let total = 0;
  for (const p of phases) {
    if (typeof p !== 'object' || p === null || !('estimatedAmount' in p)) return null;
    total += Number((p as { estimatedAmount: unknown }).estimatedAmount);
  }
  return total;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

/**
 * Ranks external law firms for a given legal segment using four statistical metrics.
 *
 * Metrics (all 0–1, higher is better):
 *   1. costEfficiency      — 1 − (firm_median_total / peer_median_total), clamped [0,1]
 *   2. experienceVolume    — log(count+1) / log(max_count+1)
 *   3. cycleTimeScore      — 1 − (firm_median_days / peer_median_days), clamped [0,1]
 *   4. budgetPredictability — 1 − median_relative_forecast_error; falls back to
 *                             1 − CV of matter billing totals when no forecast data exists
 *
 * No success-rate or outcome data is used — those fields do not exist in Legal Tracker.
 *
 * @param params.substantiveLaw - e.g. "Litigation"
 * @param params.category       - e.g. "Commercial Litigation"
 * @param params.weights        - composite weights (auto-normalised; default 0.30/0.20/0.20/0.30)
 */
export async function scoreFirms({
  substantiveLaw,
  category,
  weights = DEFAULT_WEIGHTS,
}: {
  substantiveLaw: string;
  category: string;
  weights?: ScoringWeights;
}): Promise<FirmScoringResult> {
  const w = normalizeWeights(weights);

  const matters = await prisma.matter.findMany({
    where: { status: 'Closed', substantiveLaw, category },
    include: {
      invoices: true,
      assignments: { include: { firm: true } },
      forecast: true,
    },
  });

  if (matters.length === 0) return { scored: [], insufficientData: [] };

  // Build firm-name map from assignment records; invoices may include firms
  // not formally assigned, so firmId is the fallback display value.
  const firmNameMap = new Map<string, string>();
  for (const m of matters) {
    for (const asgn of m.assignments) {
      firmNameMap.set(asgn.firm.id, asgn.firm.name);
    }
  }

  // ── Per-matter shared stats ─────────────────────────────────────────────────
  type MatterStats = {
    cycleDays: number;
    actualTotal: number;
    forecastTotal: number | null;
  };

  const matterStats = new Map<string, MatterStats>();
  for (const m of matters) {
    matterStats.set(m.id, {
      cycleDays: m.closedAt ? daysBetween(m.openedAt, m.closedAt) : 0,
      actualTotal: m.invoices.reduce((s, inv) => s + Number(inv.amount), 0),
      forecastTotal: m.forecast ? parseForecastTotal(m.forecast.phases) : null,
    });
  }

  // ── Group invoice totals by firm ────────────────────────────────────────────
  type FirmMatterEntry = MatterStats & { matterTotal: number };
  const firmDataMap = new Map<string, Map<string, FirmMatterEntry>>();

  for (const m of matters) {
    const ms = matterStats.get(m.id)!;

    // Sum each firm's invoices for this matter
    const firmTotals = new Map<string, number>();
    for (const inv of m.invoices) {
      firmTotals.set(inv.firmId, (firmTotals.get(inv.firmId) ?? 0) + Number(inv.amount));
    }

    for (const [firmId, matterTotal] of firmTotals) {
      if (!firmDataMap.has(firmId)) firmDataMap.set(firmId, new Map());
      firmDataMap.get(firmId)!.set(m.id, { matterTotal, ...ms });
    }
  }

  // ── Peer baselines ──────────────────────────────────────────────────────────

  // Peer-median total: median across ALL (firm, matter) billing pairs.
  // Represents the typical per-matter cost a firm in this segment charges.
  const allFirmMatterTotals: number[] = [];
  for (const entries of firmDataMap.values()) {
    for (const e of entries.values()) allFirmMatterTotals.push(e.matterTotal);
  }
  const peerMedianTotal = median(allFirmMatterTotals) ?? 1;

  // Peer-median days: median matter duration (each matter counted once).
  const allCycleDays = Array.from(matterStats.values())
    .map(s => s.cycleDays)
    .filter(d => d > 0);
  const peerMedianDays = median(allCycleDays) ?? 1;

  // Max matter count across all firms (denominator for experience normalisation).
  let maxMatterCount = 0;
  for (const entries of firmDataMap.values()) {
    if (entries.size > maxMatterCount) maxMatterCount = entries.size;
  }

  // ── Score each firm ─────────────────────────────────────────────────────────
  const scored: FirmScore[] = [];
  const insufficientData: InsufficientFirmData[] = [];

  for (const [firmId, entries] of firmDataMap) {
    const matterCount = entries.size;
    const firmName = firmNameMap.get(firmId) ?? firmId;

    if (matterCount < MIN_MATTERS) {
      insufficientData.push({ firmId, firmName, matterCount });
      continue;
    }

    const matterTotals = Array.from(entries.values()).map(e => e.matterTotal);
    const cycleDaysArr = Array.from(entries.values())
      .map(e => e.cycleDays)
      .filter(d => d > 0);

    // Metric 1 — cost efficiency
    const firmMedianTotal = median(matterTotals) ?? 0;
    const costEfficiency = peerMedianTotal > 0
      ? clamp(1 - firmMedianTotal / peerMedianTotal)
      : 0;

    // Metric 2 — experience volume (log-scaled)
    const experienceVolume = maxMatterCount > 1
      ? Math.log(matterCount + 1) / Math.log(maxMatterCount + 1)
      : 1;

    // Metric 3 — cycle time score
    const firmMedianDays = median(cycleDaysArr) ?? 0;
    const cycleTimeScore = peerMedianDays > 0
      ? clamp(1 - firmMedianDays / peerMedianDays)
      : 0;

    // Metric 4 — budget predictability
    const forecastedEntries = Array.from(entries.values())
      .filter(e => e.forecastTotal !== null && e.forecastTotal > 0);
    const forecastedMatterCount = forecastedEntries.length;

    let budgetPredictability: number;
    let predictabilitySource: 'forecast' | 'cv';
    let medianForecastError: number | null = null;
    let coefficientOfVariation: number | null = null;
    let dataQualityNote: string | null = null;

    if (forecastedMatterCount > 0) {
      // Primary path: median relative error against matter-level forecasts.
      // actual_total is the full matter cost (all firms); forecast_total is from Forecast.phases.
      const relErrors = forecastedEntries.map(
        e => Math.abs(e.actualTotal - e.forecastTotal!) / e.forecastTotal!
      );
      medianForecastError = median(relErrors) ?? 0;
      budgetPredictability = clamp(1 - medianForecastError);
      predictabilitySource = 'forecast';

      if (forecastedMatterCount < MIN_MATTERS) {
        dataQualityNote =
          `Predictability based on only ${forecastedMatterCount} forecasted` +
          ` matter${forecastedMatterCount === 1 ? '' : 's'} — interpret with caution.`;
      }
    } else {
      // Fallback: 1 − coefficient of variation of the firm's own billing totals.
      // Lower spread → more predictable spend → higher score.
      const m = mean(matterTotals);
      const cv = m > 0 ? stdDev(matterTotals) / m : 0;
      coefficientOfVariation = cv;
      budgetPredictability = clamp(1 - cv);
      predictabilitySource = 'cv';
      dataQualityNote =
        'Predictability estimated from spend variance (forecast data unavailable).';
    }

    // Composite score
    const compositeScore =
      w.cost * costEfficiency +
      w.experience * experienceVolume +
      w.cycle * cycleTimeScore +
      w.predictability * budgetPredictability;

    scored.push({
      firmId,
      firmName,
      metrics: { costEfficiency, experienceVolume, cycleTimeScore, budgetPredictability },
      rawStats: {
        matterCount,
        medianTotal: firmMedianTotal,
        medianCycleDays: firmMedianDays,
        forecastedMatterCount,
        predictabilitySource,
        medianForecastError,
        coefficientOfVariation,
      },
      compositeScore,
      rank: 0, // assigned below after sort
      dataQualityNote,
    });
  }

  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  scored.forEach((f, i) => { f.rank = i + 1; });

  insufficientData.sort((a, b) => b.matterCount - a.matterCount);

  return { scored, insufficientData };
}
