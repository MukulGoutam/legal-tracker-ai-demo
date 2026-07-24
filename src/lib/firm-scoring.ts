/**
 * Firm Ranking Engine — Legal Tracker AI Demo
 *
 * Ranks outside counsel using four statistical metrics derived from
 * historical closed-matter data.  No win/loss or outcome data exists
 * in Legal Tracker; this file MUST NOT invent success-rate metrics.
 *
 * DISCLAIMER: Statistical ranking based on historical billing data.
 * Not a trained ML model.  Use as one input among many.
 */

import { PrismaClient } from '@prisma/client';
import { median, mean, stdDev, daysBetween } from './stats';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Minimum closed matters per firm to receive a composite score. */
const MIN_MATTERS = 3;
/** Minimum closed matters in the category peer set before falling back to practice area. */
const PEER_SET_MIN = 30;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ScoringWeights {
  cost: number;
  experience: number;
  cycle: number;
  predictability: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  cost: 0.30,
  experience: 0.20,
  cycle: 0.20,
  predictability: 0.30,
};

export interface FirmMetrics {
  /** 0–1: lower median billing vs peers → higher score (+0.5 shift applied). */
  costEfficiency: number;
  /** 0–1: log-scaled matter count relative to the busiest firm in peer set. */
  experienceVolume: number;
  /** 0–1: shorter median duration vs peers → higher score (+0.5 shift applied). */
  cycleTimeScore: number;
  /**
   * 0–1: how close actual costs came to forecast.
   * Falls back to 1 − CV of the firm's own billing totals when no forecast data exists.
   */
  budgetPredictability: number;
}

export interface FirmRawStats {
  matterCount: number;
  /** Firm's median total billing per matter in segment. */
  medianTotal: number;
  /** Peer median total billing per matter (all firm/matter pairs in peer set). */
  peerMedianTotal: number;
  /** Firm's median calendar-day matter duration. */
  medianCycleDays: number;
  /** Peer median calendar-day matter duration. */
  peerMedianCycleDays: number;
  /** Average billed rate ($/hr) across all firm invoices in segment. Absent when hours data is zero. */
  avgHourlyRate?: number;
  forecastedMatterCount: number;
  predictabilitySource: 'forecast' | 'cv';
  medianForecastError: number | null;
  coefficientOfVariation: number | null;
}

export interface FirmScore {
  firmId: string;
  firmName: string;
  metrics: FirmMetrics;
  rawStats: FirmRawStats;
  /** 0–100 composite score. */
  compositeScore: number;
  /** 1-based rank among scored firms. */
  rank: number;
  dataQualityNote: string | null;
}

export interface InsufficientFirmData {
  firmId: string;
  firmName: string;
  matterCount: number;
  note: string;
}

export interface PeerSetInfo {
  category: string;
  sampleSize: number;
  usedFallback: boolean;
  fallbackNote: string | null;
}

export interface FirmRankingResult {
  rankedFirms: FirmScore[];
  insufficientDataFirms: InsufficientFirmData[];
  peerSetInfo: PeerSetInfo;
  weights: ScoringWeights;
  methodology: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function parseForecastTotal(phases: unknown): number | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  let total = 0;
  for (const p of phases) {
    if (typeof p !== 'object' || p === null || !('estimatedAmount' in p)) return null;
    total += Number((p as { estimatedAmount: unknown }).estimatedAmount);
  }
  return total;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

/**
 * Ranks external law firms for a given legal segment using four statistical metrics.
 *
 * Metrics (all 0–1, higher is better; compositeScore scaled to 0–100):
 *   1. costEfficiency      — clamp((1 − firm_median / peer_median) + 0.5, 0, 1)
 *   2. experienceVolume    — log(count+1) / log(max_count+1)
 *   3. cycleTimeScore      — clamp((1 − firm_days / peer_days) + 0.5, 0, 1)
 *   4. budgetPredictability — 1 − median_relative_forecast_error; falls back to
 *                             1 − CV of matter billing totals when no forecast data
 *
 * Peer-set fallback: if < 30 closed matters exist in the category, the engine
 * automatically expands to all matters in the practice area (substantiveLaw).
 *
 * No success-rate or outcome data is used — those fields do not exist in Legal Tracker.
 *
 * @param params.substantiveLaw  - e.g. "Litigation"
 * @param params.category        - e.g. "Commercial Litigation"
 * @param params.weights         - composite weights (auto-normalised; default 0.30/0.20/0.20/0.30)
 * @param params.exposureBand    - optional, reserved for future sub-filtering
 * @param params.liabilityEstimate - optional, reserved for future sub-filtering
 * @param params.jurisdictionTier  - optional, reserved for future sub-filtering
 */
export async function rankFirms({
  substantiveLaw,
  category,
  weights = DEFAULT_WEIGHTS,
  exposureBand: _exposureBand,
  liabilityEstimate: _liabilityEstimate,
  jurisdictionTier: _jurisdictionTier,
}: {
  substantiveLaw: string;
  category: string;
  weights?: ScoringWeights;
  exposureBand?: string;
  liabilityEstimate?: string;
  jurisdictionTier?: string;
}): Promise<FirmRankingResult> {
  const w = normalizeWeights(weights);

  // ── Peer-set selection with category → practice-area fallback ─────────────
  let matters = await prisma.matter.findMany({
    where: { status: 'Closed', substantiveLaw, category },
    include: {
      invoices: true,
      assignments: { include: { firm: true } },
      forecast: true,
    },
  });

  let usedFallback = false;
  let fallbackNote: string | null = null;
  let resolvedCategory = category;

  if (matters.length < PEER_SET_MIN) {
    const broadMatters = await prisma.matter.findMany({
      where: { status: 'Closed', substantiveLaw },
      include: {
        invoices: true,
        assignments: { include: { firm: true } },
        forecast: true,
      },
    });
    if (broadMatters.length > matters.length) {
      usedFallback = true;
      resolvedCategory = substantiveLaw;
      fallbackNote =
        `Fewer than ${PEER_SET_MIN} closed matters in "${category}" (${matters.length} found). ` +
        `Peer set expanded to all "${substantiveLaw}" matters (${broadMatters.length} total).`;
      matters = broadMatters;
    }
  }

  const peerSetInfo: PeerSetInfo = {
    category: resolvedCategory,
    sampleSize: matters.length,
    usedFallback,
    fallbackNote,
  };

  if (matters.length === 0) {
    return {
      rankedFirms: [],
      insufficientDataFirms: [],
      peerSetInfo,
      weights: w,
      methodology: `No closed matters found for "${substantiveLaw}" / "${category}".`,
    };
  }

  // ── Build firm-name map ───────────────────────────────────────────────────
  const firmNameMap = new Map<string, string>();
  for (const m of matters) {
    for (const asgn of m.assignments) {
      firmNameMap.set(asgn.firm.id, asgn.firm.name);
    }
  }

  // ── Per-matter shared stats ───────────────────────────────────────────────
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

  // ── Group per-firm billing by matter; track hours for rate computation ────
  type FirmMatterEntry = MatterStats & { matterTotal: number };
  const firmDataMap = new Map<string, Map<string, FirmMatterEntry>>();
  const firmHoursMap = new Map<string, { amount: number; hours: number }>();

  for (const m of matters) {
    const ms = matterStats.get(m.id)!;

    const firmTotals = new Map<string, number>();
    for (const inv of m.invoices) {
      firmTotals.set(inv.firmId, (firmTotals.get(inv.firmId) ?? 0) + Number(inv.amount));

      const h = Number(inv.hours);
      if (h > 0) {
        const cur = firmHoursMap.get(inv.firmId) ?? { amount: 0, hours: 0 };
        firmHoursMap.set(inv.firmId, {
          amount: cur.amount + Number(inv.amount),
          hours: cur.hours + h,
        });
      }
    }

    for (const [firmId, matterTotal] of firmTotals) {
      if (!firmDataMap.has(firmId)) firmDataMap.set(firmId, new Map());
      firmDataMap.get(firmId)!.set(m.id, { matterTotal, ...ms });
    }
  }

  // ── Peer baselines ────────────────────────────────────────────────────────
  const allFirmMatterTotals: number[] = [];
  for (const entries of firmDataMap.values()) {
    for (const e of entries.values()) allFirmMatterTotals.push(e.matterTotal);
  }
  const peerMedianTotal = median(allFirmMatterTotals) ?? 1;

  const allCycleDays = Array.from(matterStats.values())
    .map(s => s.cycleDays)
    .filter(d => d > 0);
  const peerMedianDays = median(allCycleDays) ?? 1;

  let maxMatterCount = 0;
  for (const entries of firmDataMap.values()) {
    if (entries.size > maxMatterCount) maxMatterCount = entries.size;
  }

  // ── Score each firm ───────────────────────────────────────────────────────
  const rankedFirms: FirmScore[] = [];
  const insufficientDataFirms: InsufficientFirmData[] = [];

  for (const [firmId, entries] of firmDataMap) {
    const matterCount = entries.size;
    const firmName = firmNameMap.get(firmId) ?? firmId;

    if (matterCount < MIN_MATTERS) {
      insufficientDataFirms.push({
        firmId,
        firmName,
        matterCount,
        note: `Only ${matterCount} closed matter${matterCount === 1 ? '' : 's'} in segment — minimum ${MIN_MATTERS} required for a score.`,
      });
      continue;
    }

    const matterTotals = Array.from(entries.values()).map(e => e.matterTotal);
    const cycleDaysArr = Array.from(entries.values())
      .map(e => e.cycleDays)
      .filter(d => d > 0);

    // Metric 1: cost efficiency — +0.5 shift so a peer-average firm scores 0.5
    const firmMedianTotal = median(matterTotals) ?? 0;
    const costEfficiency = peerMedianTotal > 0
      ? clamp((1 - firmMedianTotal / peerMedianTotal) + 0.5)
      : 0.5;

    // Metric 2: experience volume (log-scaled)
    const experienceVolume = maxMatterCount > 1
      ? Math.log(matterCount + 1) / Math.log(maxMatterCount + 1)
      : 1;

    // Metric 3: cycle time score — +0.5 shift so a peer-average firm scores 0.5
    const firmMedianDays = median(cycleDaysArr) ?? 0;
    const cycleTimeScore = peerMedianDays > 0
      ? clamp((1 - firmMedianDays / peerMedianDays) + 0.5)
      : 0.5;

    // Metric 4: budget predictability
    const forecastedEntries = Array.from(entries.values())
      .filter(e => e.forecastTotal !== null && e.forecastTotal > 0);
    const forecastedMatterCount = forecastedEntries.length;

    let budgetPredictability: number;
    let predictabilitySource: 'forecast' | 'cv';
    let medianForecastError: number | null = null;
    let coefficientOfVariation: number | null = null;
    let dataQualityNote: string | null = null;

    if (forecastedMatterCount > 0) {
      const relErrors = forecastedEntries.map(
        e => Math.abs(e.actualTotal - e.forecastTotal!) / e.forecastTotal!
      );
      medianForecastError = median(relErrors) ?? 0;
      budgetPredictability = clamp(1 - medianForecastError);
      predictabilitySource = 'forecast';

      if (forecastedMatterCount < MIN_MATTERS) {
        dataQualityNote =
          `Predictability based on only ${forecastedMatterCount} forecasted ` +
          `matter${forecastedMatterCount === 1 ? '' : 's'} — interpret with caution.`;
      }
    } else {
      const m = mean(matterTotals);
      const cv = m > 0 ? stdDev(matterTotals) / m : 0;
      coefficientOfVariation = cv;
      budgetPredictability = clamp(1 - cv);
      predictabilitySource = 'cv';
      dataQualityNote = 'Predictability estimated from spend variance (no forecast data).';
    }

    // avgHourlyRate
    const rateData = firmHoursMap.get(firmId);
    const avgHourlyRate = rateData && rateData.hours > 0
      ? rateData.amount / rateData.hours
      : undefined;

    // Composite score scaled to 0–100
    const compositeScore = (
      w.cost * costEfficiency +
      w.experience * experienceVolume +
      w.cycle * cycleTimeScore +
      w.predictability * budgetPredictability
    ) * 100;

    rankedFirms.push({
      firmId,
      firmName,
      metrics: { costEfficiency, experienceVolume, cycleTimeScore, budgetPredictability },
      rawStats: {
        matterCount,
        medianTotal: firmMedianTotal,
        peerMedianTotal,
        medianCycleDays: firmMedianDays,
        peerMedianCycleDays: peerMedianDays,
        avgHourlyRate,
        forecastedMatterCount,
        predictabilitySource,
        medianForecastError,
        coefficientOfVariation,
      },
      compositeScore,
      rank: 0,
      dataQualityNote,
    });
  }

  rankedFirms.sort((a, b) => b.compositeScore - a.compositeScore);
  rankedFirms.forEach((f, i) => { f.rank = i + 1; });

  insufficientDataFirms.sort((a, b) => b.matterCount - a.matterCount);

  const methodology =
    `${rankedFirms.length} firm${rankedFirms.length !== 1 ? 's' : ''} ranked on ` +
    `"${resolvedCategory}" matters (${substantiveLaw}).` +
    (usedFallback ? ` Peer set expanded to practice area.` : '') +
    ` Composite weights — cost: ${pct(w.cost)}, experience: ${pct(w.experience)},` +
    ` cycle time: ${pct(w.cycle)}, predictability: ${pct(w.predictability)}.` +
    (insufficientDataFirms.length > 0
      ? ` ${insufficientDataFirms.length} firm${insufficientDataFirms.length !== 1 ? 's' : ''} had insufficient data (<${MIN_MATTERS} closed matters).`
      : '');

  return { rankedFirms, insufficientDataFirms, peerSetInfo, weights: w, methodology };
}

/** @deprecated Use rankFirms — identical implementation, new return shape. */
export const scoreFirms = rankFirms;
