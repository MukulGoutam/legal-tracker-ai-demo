import { PrismaClient, Prisma } from '@prisma/client';
import { percentile, mean } from '@/lib/stats';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const predictionType = searchParams.get('predictionType') || 'intake';
  const category = searchParams.get('category') || null;
  const fromDate = searchParams.get('fromDate') || null;
  const toDate = searchParams.get('toDate') || null;
  const confidenceLevel = searchParams.get('confidenceLevel') || null;
  const modelVersion = searchParams.get('modelVersion') || null;

  const where: Prisma.PredictionLogWhereInput = {
    predictionType,
    errorPercent: { not: null },
    actualValue: { not: null },
  };

  if (fromDate) where.predictedAt = { ...(where.predictedAt as object), gte: new Date(fromDate) };
  if (toDate) where.predictedAt = { ...(where.predictedAt as object), lte: new Date(toDate) };
  if (confidenceLevel) where.confidence = confidenceLevel;
  if (modelVersion) where.modelVersion = modelVersion;

  const matterWhere: Prisma.MatterWhereInput = {};
  if (category) matterWhere.category = category;

  // Fetch all logs matching filters (with matter category for cross-filter)
  const logs = await prisma.predictionLog.findMany({
    where,
    include: {
      matter: { select: { id: true, name: true, category: true, substantiveLaw: true } },
    },
    orderBy: { predictedAt: 'asc' },
  });

  // Apply category filter after join (SQLite doesn't support relation filter with count easily)
  const filtered = category ? logs.filter((l) => l.matter.category === category) : logs;

  if (filtered.length === 0) {
    return Response.json({
      summary: {
        totalPredictions: 0,
        medianErrorPercent: null,
        meanErrorPercent: null,
        withinRangePercent: null,
        overpredictionRate: null,
        underpredictionRate: null,
      },
      byCategory: [],
      byConfidence: [],
      byFallbackLevel: [],
      byModelVersion: [],
      timeSeries: [],
      scatterData: [],
    });
  }

  const errors = filtered.map((l) => Number(l.errorPercent));
  const withRange = filtered.filter((l) => l.isWithinRange !== null);
  const inRange = withRange.filter((l) => l.isWithinRange === true).length;

  const overPredicted = filtered.filter(
    (l) => l.predictedValue !== null && l.actualValue !== null && Number(l.predictedValue) > Number(l.actualValue),
  ).length;
  const underPredicted = filtered.filter(
    (l) => l.predictedValue !== null && l.actualValue !== null && Number(l.predictedValue) < Number(l.actualValue),
  ).length;

  const summary = {
    totalPredictions: filtered.length,
    medianErrorPercent: Math.round(percentile(errors, 50) * 10) / 10,
    meanErrorPercent: Math.round(mean(errors) * 10) / 10,
    withinRangePercent: withRange.length > 0 ? Math.round((inRange / withRange.length) * 1000) / 10 : null,
    overpredictionRate: Math.round((overPredicted / filtered.length) * 1000) / 10,
    underpredictionRate: Math.round((underPredicted / filtered.length) * 1000) / 10,
  };

  // ── By Category ───────────────────────────────────────────────────────────
  const catMap = new Map<string, { errors: number[]; inRange: number; total: number }>();
  for (const l of filtered) {
    const cat = l.matter.category;
    if (!catMap.has(cat)) catMap.set(cat, { errors: [], inRange: 0, total: 0 });
    const entry = catMap.get(cat)!;
    entry.errors.push(Number(l.errorPercent));
    entry.total++;
    if (l.isWithinRange) entry.inRange++;
  }
  const byCategory = Array.from(catMap.entries())
    .map(([cat, s]) => ({
      category: cat,
      count: s.total,
      medianError: Math.round(percentile(s.errors, 50) * 10) / 10,
      meanError: Math.round(mean(s.errors) * 10) / 10,
      withinRangePct: Math.round((s.inRange / s.total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  // ── By Confidence ─────────────────────────────────────────────────────────
  const confMap = new Map<string, { errors: number[]; total: number }>();
  for (const l of filtered) {
    const conf = l.confidence;
    if (!confMap.has(conf)) confMap.set(conf, { errors: [], total: 0 });
    const entry = confMap.get(conf)!;
    entry.errors.push(Number(l.errorPercent));
    entry.total++;
  }
  const confOrder = ['High', 'Medium', 'Low', 'Insufficient'];
  const byConfidence = confOrder
    .filter((c) => confMap.has(c))
    .map((conf) => {
      const s = confMap.get(conf)!;
      return {
        confidence: conf,
        count: s.total,
        medianError: Math.round(percentile(s.errors, 50) * 10) / 10,
        meanError: Math.round(mean(s.errors) * 10) / 10,
      };
    });

  // ── By Fallback Level ──────────────────────────────────────────────────────
  const fbMap = new Map<number, { errors: number[]; total: number }>();
  for (const l of filtered) {
    const fb = l.fallbackLevel ?? -1;
    if (!fbMap.has(fb)) fbMap.set(fb, { errors: [], total: 0 });
    const entry = fbMap.get(fb)!;
    entry.errors.push(Number(l.errorPercent));
    entry.total++;
  }
  const byFallbackLevel = Array.from(fbMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([level, s]) => ({
      fallbackLevel: level === -1 ? null : level,
      label: level === 0 ? 'Full match' : level === 1 ? '–1 filter' : level === 2 ? '–2 filters' : level === 3 ? '–3 filters' : level === 4 ? 'Category only' : 'Unknown',
      count: s.total,
      medianError: Math.round(percentile(s.errors, 50) * 10) / 10,
    }));

  // ── By Model Version ──────────────────────────────────────────────────────
  const verMap = new Map<string, { errors: number[]; total: number; inRange: number }>();
  for (const l of filtered) {
    const ver = l.modelVersion;
    if (!verMap.has(ver)) verMap.set(ver, { errors: [], total: 0, inRange: 0 });
    const entry = verMap.get(ver)!;
    entry.errors.push(Number(l.errorPercent));
    entry.total++;
    if (l.isWithinRange) entry.inRange++;
  }
  const verOrder = ['v1', 'v1_1', 'v1_2', 'v2_0'];
  const verLabels: Record<string, string> = { v1: 'v1.0', v1_1: 'v1.1', v1_2: 'v1.2', v2_0: 'v2.0' };
  const byModelVersion = verOrder
    .filter((v) => verMap.has(v))
    .map((ver) => {
      const s = verMap.get(ver)!;
      return {
        modelVersion: ver,
        label: verLabels[ver] ?? ver,
        count: s.total,
        medianError: Math.round(percentile(s.errors, 50) * 10) / 10,
        meanError: Math.round(mean(s.errors) * 10) / 10,
        withinRangePct: Math.round((s.inRange / s.total) * 1000) / 10,
      };
    });

  // ── Time Series (monthly buckets) ─────────────────────────────────────────
  const monthMap = new Map<string, { errors: number[]; total: number }>();
  for (const l of filtered) {
    const d = l.predictedAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap.has(key)) monthMap.set(key, { errors: [], total: 0 });
    const entry = monthMap.get(key)!;
    entry.errors.push(Number(l.errorPercent));
    entry.total++;
  }
  const timeSeries = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, s]) => ({
      month,
      count: s.total,
      medianError: Math.round(percentile(s.errors, 50) * 10) / 10,
      meanError: Math.round(mean(s.errors) * 10) / 10,
    }));

  // ── Scatter Data (up to 300 points) ───────────────────────────────────────
  const scatterSource = filtered.filter((l) => l.predictedValue !== null && l.actualValue !== null);
  // Sample evenly if > 300
  const step = scatterSource.length > 300 ? Math.ceil(scatterSource.length / 300) : 1;
  const scatterData = scatterSource
    .filter((_, i) => i % step === 0)
    .map((l) => ({
      matterId: l.matterId,
      matterName: l.matter.name,
      category: l.matter.category,
      predicted: Math.round(Number(l.predictedValue)),
      actual: Math.round(Number(l.actualValue)),
      errorPercent: Math.round(Number(l.errorPercent) * 10) / 10,
      confidence: l.confidence,
      modelVersion: l.modelVersion,
      isWithinRange: l.isWithinRange,
    }));

  return Response.json({ summary, byCategory, byConfidence, byFallbackLevel, byModelVersion, timeSeries, scatterData });
}
