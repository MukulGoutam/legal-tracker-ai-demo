/**
 * Statistical suggestion based on historical Legal Tracker data.
 * NOT a trained ML model.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  bandExposure,
  tierJurisdiction,
  LIABILITY_COST_MULTIPLIER,
  JURISDICTION_COST_MULTIPLIER,
  type LiabilityEstimate,
  type JurisdictionTier,
  type ExposureBand,
} from './matter-taxonomy';
import { confidenceLevel, MIN_SAMPLE_STRICT, type ConfidenceLevel } from './confidence';
import { percentile, daysBetween } from './stats';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// ─── Shared types ──────────────────────────────────────────────────────────────

interface PercentileRange {
  p25: number;
  p50: number;
  p75: number;
}

function pRange(values: number[]): PercentileRange {
  return {
    p25: Math.round(percentile(values, 25)),
    p50: Math.round(percentile(values, 50)),
    p75: Math.round(percentile(values, 75)),
  };
}

// ─── Exposure band → Prisma where clause ──────────────────────────────────────

function bandWhere(band: ExposureBand): Prisma.DecimalNullableFilter {
  switch (band) {
    case 'micro':  return { gt: new Prisma.Decimal(0), lt: new Prisma.Decimal(100_000) };
    case 'small':  return { gte: new Prisma.Decimal(100_000),    lt: new Prisma.Decimal(1_000_000) };
    case 'medium': return { gte: new Prisma.Decimal(1_000_000),  lt: new Prisma.Decimal(10_000_000) };
    case 'large':  return { gte: new Prisma.Decimal(10_000_000), lt: new Prisma.Decimal(100_000_000) };
    case 'mega':   return { gte: new Prisma.Decimal(100_000_000) };
  }
}

// ─── suggestForNewMatter ───────────────────────────────────────────────────────

export interface MatterSuggestion {
  estimatedFees: PercentileRange;
  estimatedDurationDays: PercentileRange;
  confidence: ConfidenceLevel;
  sampleSize: number;
  filtersApplied: string[];
  filtersDropped: string[];
  fallbackLevel: 1 | 2 | 3 | 4 | 5;
  fallbackNote: string | null;
  methodology: string;
  driverBreakdown: {
    baseCategoryMedian: number;
    exposureAdjustment: number;
    liabilityAdjustment: number;
    jurisdictionAdjustment: number;
    finalEstimate: number;
  };
}

type LevelDef = {
  level: 1 | 2 | 3 | 4 | 5;
  useSubstantiveLaw: boolean;
  useCategory: boolean;
  useExposureBand: boolean;
  useLiability: boolean;
  useTier: boolean;
};

const CASCADE_LEVELS: LevelDef[] = [
  { level: 1, useSubstantiveLaw: false, useCategory: true,  useExposureBand: true,  useLiability: true,  useTier: true  },
  { level: 2, useSubstantiveLaw: false, useCategory: true,  useExposureBand: true,  useLiability: true,  useTier: false },
  { level: 3, useSubstantiveLaw: false, useCategory: true,  useExposureBand: true,  useLiability: false, useTier: false },
  { level: 4, useSubstantiveLaw: false, useCategory: true,  useExposureBand: false, useLiability: false, useTier: false },
  { level: 5, useSubstantiveLaw: true,  useCategory: false, useExposureBand: false, useLiability: false, useTier: false },
];

type PeerRow = {
  id: string;
  openedAt: Date;
  closedAt: Date | null;
  exposureAmount: Prisma.Decimal | null;
  invoices: { amount: Prisma.Decimal }[];
};

export async function suggestForNewMatter({
  substantiveLaw,
  category,
  exposureAmount,
  liabilityEstimate,
  jurisdiction,
}: {
  substantiveLaw: string;
  category: string;
  exposureAmount?: number | null;
  liabilityEstimate?: LiabilityEstimate | null;
  jurisdiction?: string | null;
  estimatedResolutionDays?: number | null;
}): Promise<MatterSuggestion> {
  const band: ExposureBand | null = exposureAmount != null ? bandExposure(exposureAmount) : null;
  const tier: JurisdictionTier | null = jurisdiction ? tierJurisdiction(jurisdiction) : null;

  let peers: PeerRow[] = [];
  let usedLevel: LevelDef = CASCADE_LEVELS[3];

  for (const lvl of CASCADE_LEVELS) {
    const where: Prisma.MatterWhereInput = { status: 'Closed' };

    if (lvl.useSubstantiveLaw) where.substantiveLaw = substantiveLaw;
    if (lvl.useCategory) where.category = category;
    if (lvl.useExposureBand && band != null) where.exposureAmount = bandWhere(band);
    if (lvl.useLiability && liabilityEstimate != null) where.liabilityEstimate = liabilityEstimate;
    if (lvl.useTier && tier != null) where.jurisdictionTier = tier;

    const rows = await prisma.matter.findMany({
      where,
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        exposureAmount: true,
        invoices: { select: { amount: true } },
      },
    });

    if (rows.length >= MIN_SAMPLE_STRICT || lvl.level === 5) {
      peers = rows;
      usedLevel = lvl;
      break;
    }
  }

  const sampleSize = peers.length;
  const confidence = confidenceLevel(sampleSize);

  const feeTotals = peers
    .map(m => m.invoices.reduce((s, inv) => s + Number(inv.amount), 0))
    .filter(f => f > 0);

  const durations = peers
    .filter(m => m.closedAt != null)
    .map(m => daysBetween(m.openedAt, m.closedAt!));

  // ── Driver breakdown ─────────────────────────────────────────────────────────

  const baseCategoryMedianRaw = percentile(feeTotals, 50);

  // Exposure scaling
  let scaledMedian = baseCategoryMedianRaw;
  if (exposureAmount != null && exposureAmount > 0 && feeTotals.length > 0) {
    const peerExposures = peers
      .map(m => (m.exposureAmount != null ? Number(m.exposureAmount) : null))
      .filter((v): v is number => v != null && v > 0);
    const peerMedianExposure = percentile(peerExposures, 50);
    if (peerMedianExposure > 0) {
      scaledMedian = baseCategoryMedianRaw * Math.pow(exposureAmount / peerMedianExposure, 0.6);
    }
  }

  const exposureAdjustment = scaledMedian - baseCategoryMedianRaw;

  // Liability adjustment — only if liability was provided but NOT baked into the peer filter
  let liabilityAdjustment = 0;
  if (liabilityEstimate != null && !usedLevel.useLiability) {
    liabilityAdjustment = scaledMedian * (LIABILITY_COST_MULTIPLIER[liabilityEstimate] - 1);
  }

  // Jurisdiction adjustment — only if tier was provided but NOT baked into the peer filter
  let jurisdictionAdjustment = 0;
  if (tier != null && !usedLevel.useTier) {
    jurisdictionAdjustment = (scaledMedian + liabilityAdjustment) * (JURISDICTION_COST_MULTIPLIER[tier] - 1);
  }

  const finalEstimateRaw = scaledMedian + liabilityAdjustment + jurisdictionAdjustment;

  // Scale the full fee distribution by the combined factor, preserving the spread shape
  const combinedMultiplier = baseCategoryMedianRaw > 0 ? finalEstimateRaw / baseCategoryMedianRaw : 1;
  const scaledFees = feeTotals.map(f => f * combinedMultiplier);

  const estimatedFees = pRange(scaledFees);
  const estimatedDurationDays = pRange(durations);

  // ── Filter metadata ──────────────────────────────────────────────────────────

  const availableFilters: string[] = ['category'];
  if (band != null) availableFilters.push('exposureBand');
  if (liabilityEstimate != null) availableFilters.push('liabilityEstimate');
  if (tier != null) availableFilters.push('jurisdictionTier');

  const filtersApplied: string[] = [];
  if (usedLevel.useSubstantiveLaw) filtersApplied.push('substantiveLaw');
  if (usedLevel.useCategory) filtersApplied.push('category');
  if (usedLevel.useExposureBand && band != null) filtersApplied.push('exposureBand');
  if (usedLevel.useLiability && liabilityEstimate != null) filtersApplied.push('liabilityEstimate');
  if (usedLevel.useTier && tier != null) filtersApplied.push('jurisdictionTier');

  const filtersDropped = availableFilters.filter(f => !filtersApplied.includes(f));

  const fallbackNote: string | null =
    usedLevel.level === 1
      ? null
      : `Insufficient data at higher specificity. Dropped: ${filtersDropped.join(', ')}. ` +
        `Using ${sampleSize} peers at Level ${usedLevel.level}/5 (${filtersApplied.join(' + ')}).`;

  const methodology =
    `Statistical prediction from ${sampleSize} historical closed matters. ` +
    `Filter level ${usedLevel.level}/5 (${filtersApplied.join(' + ')}). ` +
    `Confidence: ${confidence}.` +
    (filtersDropped.length > 0
      ? ` Adjustments applied for dropped filters: ${filtersDropped.join(', ')}.`
      : '');

  return {
    estimatedFees,
    estimatedDurationDays,
    confidence,
    sampleSize,
    filtersApplied,
    filtersDropped,
    fallbackLevel: usedLevel.level,
    fallbackNote,
    methodology,
    driverBreakdown: {
      baseCategoryMedian: Math.round(baseCategoryMedianRaw),
      exposureAdjustment: Math.round(exposureAdjustment),
      liabilityAdjustment: Math.round(liabilityAdjustment),
      jurisdictionAdjustment: Math.round(jurisdictionAdjustment),
      finalEstimate: Math.round(finalEstimateRaw),
    },
  };
}

// ─── Forecast types ────────────────────────────────────────────────────────────

interface TaskForecast {
  taskCode: string;
  taskName: string;
  estimatedHours: PercentileRange;
  estimatedAmount: PercentileRange;
}

interface PhaseForecast {
  phaseCode: string;
  phaseName: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  estimatedHours: PercentileRange;
  estimatedAmount: PercentileRange;
  tasks: TaskForecast[];
}

export interface PeerBenchmarkPoint {
  matterId: string;
  totalAmount: number;
}

export interface ForecastSuggestion {
  phases: PhaseForecast[];
  sampleSize: number;
  usedFallback: boolean;
  fallbackNote: string | null;
  peerBenchmark: PeerBenchmarkPoint[];
  overallConfidence: ConfidenceLevel;
}

/**
 * Builds a pre-filled phase/task budget breakdown for a matter by analysing
 * invoices from peer closed matters.
 */
export async function suggestForecast({
  matterId,
  substantiveLaw,
  category,
}: {
  matterId: string;
  substantiveLaw: string;
  category: string;
}): Promise<ForecastSuggestion> {
  let peers = await prisma.matter.findMany({
    where: { status: 'Closed', substantiveLaw, category, id: { not: matterId } },
    include: { invoices: true },
  });

  let usedFallback = false;
  let fallbackNote: string | null = null;
  const primaryCount = peers.length;

  if (primaryCount < MIN_SAMPLE_STRICT) {
    peers = await prisma.matter.findMany({
      where: { status: 'Closed', substantiveLaw, id: { not: matterId } },
      include: { invoices: true },
    });
    usedFallback = true;
    fallbackNote =
      `Only ${primaryCount} closed peer matter${primaryCount !== 1 ? 's' : ''} matched` +
      ` "${category}" + "${substantiveLaw}"; broadened to all "${substantiveLaw}" matters` +
      ` (${peers.length} total).`;
  }

  const sampleSize = peers.length;

  type TaskAccum = { hours: number; amount: number; taskName: string };
  type PhaseAccum = {
    phaseName: string;
    matterTotals: Map<string, { hours: number; amount: number }>;
    tasks: Map<string, { taskName: string; matterTotals: Map<string, TaskAccum> }>;
  };

  const phaseMap = new Map<string, PhaseAccum>();

  for (const matter of peers) {
    for (const inv of matter.invoices) {
      if (!phaseMap.has(inv.phaseCode)) {
        phaseMap.set(inv.phaseCode, {
          phaseName: inv.phaseName,
          matterTotals: new Map(),
          tasks: new Map(),
        });
      }
      const phase = phaseMap.get(inv.phaseCode)!;

      const existing = phase.matterTotals.get(matter.id) ?? { hours: 0, amount: 0 };
      phase.matterTotals.set(matter.id, {
        hours: existing.hours + Number(inv.hours),
        amount: existing.amount + Number(inv.amount),
      });

      if (!phase.tasks.has(inv.taskCode)) {
        phase.tasks.set(inv.taskCode, { taskName: inv.taskName, matterTotals: new Map() });
      }
      const task = phase.tasks.get(inv.taskCode)!;
      const taskExisting = task.matterTotals.get(matter.id) ?? { hours: 0, amount: 0, taskName: inv.taskName };
      task.matterTotals.set(matter.id, {
        hours: taskExisting.hours + Number(inv.hours),
        amount: taskExisting.amount + Number(inv.amount),
        taskName: inv.taskName,
      });
    }
  }

  const phases: PhaseForecast[] = Array.from(phaseMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([phaseCode, phase]) => {
      const matterHours = Array.from(phase.matterTotals.values()).map(t => t.hours);
      const matterAmounts = Array.from(phase.matterTotals.values()).map(t => t.amount);
      const phaseSampleSize = phase.matterTotals.size;

      const tasks: TaskForecast[] = Array.from(phase.tasks.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([taskCode, task]) => ({
          taskCode,
          taskName: task.taskName,
          estimatedHours: pRange(Array.from(task.matterTotals.values()).map(t => t.hours)),
          estimatedAmount: pRange(Array.from(task.matterTotals.values()).map(t => t.amount)),
        }));

      return {
        phaseCode,
        phaseName: phase.phaseName,
        confidence: confidenceLevel(phaseSampleSize),
        sampleSize: phaseSampleSize,
        estimatedHours: pRange(matterHours),
        estimatedAmount: pRange(matterAmounts),
        tasks,
      };
    });

  const peerBenchmark: PeerBenchmarkPoint[] = peers
    .map(m => ({
      matterId: m.id,
      totalAmount: m.invoices.reduce((s, inv) => s + Number(inv.amount), 0),
    }))
    .filter(p => p.totalAmount > 0);

  const CONF_SCORE: Record<ConfidenceLevel, number> = { Insufficient: 0, Low: 1, Medium: 2, High: 3 };
  const scoreToLevel = (s: number): ConfidenceLevel => {
    if (s >= 2.5) return 'High';
    if (s >= 1.5) return 'Medium';
    if (s >= 0.5) return 'Low';
    return 'Insufficient';
  };
  const totalWeight = phases.reduce((s, p) => s + p.sampleSize, 0);
  const overallConfidence: ConfidenceLevel =
    totalWeight === 0 || phases.length === 0
      ? confidenceLevel(sampleSize)
      : scoreToLevel(
          phases.reduce((s, p) => s + CONF_SCORE[p.confidence] * p.sampleSize, 0) / totalWeight,
        );

  return { phases, sampleSize, usedFallback, fallbackNote, peerBenchmark, overallConfidence };
}
