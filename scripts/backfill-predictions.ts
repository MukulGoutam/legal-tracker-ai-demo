/**
 * Backfill historical intake predictions for all closed matters.
 * Simulates what our prediction model would have said at intake time,
 * then computes accuracy against known actual invoice totals.
 *
 * Run: npm run backfill
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { suggestForNewMatter } from '../src/lib/suggestions';
import { versionForDate } from '../src/lib/model-version';
import { percentile, median } from '../src/lib/stats';

const prisma = new PrismaClient();

interface CategoryStats {
  count: number;
  errors: number[];
  inRange: number;
}

async function main() {
  console.log('🔍 Loading closed matters with invoices...');

  // Clear existing backfilled predictions to allow re-running
  const deleted = await prisma.predictionLog.deleteMany({
    where: { predictionType: 'intake' },
  });
  console.log(`  Cleared ${deleted.count} existing intake prediction logs.`);

  const matters = await prisma.matter.findMany({
    where: { status: 'Closed' },
    include: {
      invoices: { select: { amount: true } },
    },
    orderBy: { openedAt: 'asc' },
  });

  console.log(`  Found ${matters.length} closed matters to backfill.`);

  let backfilled = 0;
  let skipped = 0;
  const categoryStats = new Map<string, CategoryStats>();

  for (let i = 0; i < matters.length; i++) {
    const matter = matters[i];

    // Compute actual total from invoices
    const actualTotal = matter.invoices.reduce((s, inv) => s + Number(inv.amount), 0);
    if (actualTotal === 0) {
      skipped++;
      continue;
    }

    try {
      const suggestion = await suggestForNewMatter({
        substantiveLaw: matter.substantiveLaw,
        category: matter.category,
        exposureAmount: matter.exposureAmount != null ? Number(matter.exposureAmount) : null,
        liabilityEstimate: (matter.liabilityEstimate as Parameters<typeof suggestForNewMatter>[0]['liabilityEstimate']) ?? null,
        jurisdiction: matter.jurisdiction ?? null,
      });

      const predicted = suggestion.estimatedFees.p50;
      const p25 = suggestion.estimatedFees.p25;
      const p75 = suggestion.estimatedFees.p75;

      if (predicted === 0) {
        skipped++;
        continue;
      }

      const errorAbsolute = Math.abs(actualTotal - predicted);
      const errorPercent = (errorAbsolute / predicted) * 100;
      const isWithinRange = actualTotal >= p25 && actualTotal <= p75;
      const modelVersion = versionForDate(matter.openedAt);

      await prisma.predictionLog.create({
        data: {
          matterId: matter.id,
          predictionType: 'intake',
          predictedAt: matter.openedAt,
          predictedValue: new Prisma.Decimal(Math.round(predicted)),
          predictedP25: new Prisma.Decimal(Math.round(p25)),
          predictedP75: new Prisma.Decimal(Math.round(p75)),
          confidence: suggestion.confidence,
          fallbackLevel: suggestion.fallbackLevel,
          sampleSize: suggestion.sampleSize,
          methodology: suggestion.methodology,
          modelVersion,
          inputParameters: {
            substantiveLaw: matter.substantiveLaw,
            category: matter.category,
            exposureAmount: matter.exposureAmount != null ? Number(matter.exposureAmount) : null,
            liabilityEstimate: matter.liabilityEstimate ?? null,
            jurisdictionTier: matter.jurisdictionTier ?? null,
            filtersApplied: suggestion.filtersApplied,
            filtersDropped: suggestion.filtersDropped,
          },
          actualValue: new Prisma.Decimal(Math.round(actualTotal)),
          actualClosedAt: matter.closedAt,
          errorAbsolute: new Prisma.Decimal(Math.round(errorAbsolute)),
          errorPercent: new Prisma.Decimal(Number(errorPercent.toFixed(2))),
          isWithinRange,
        },
      });

      backfilled++;

      // Track category stats
      if (!categoryStats.has(matter.category)) {
        categoryStats.set(matter.category, { count: 0, errors: [], inRange: 0 });
      }
      const stats = categoryStats.get(matter.category)!;
      stats.count++;
      stats.errors.push(errorPercent);
      if (isWithinRange) stats.inRange++;

      if (backfilled % 50 === 0) {
        console.log(`  Progress: ${backfilled} backfilled, ${skipped} skipped...`);
      }
    } catch (err) {
      console.error(`  Error on matter ${matter.id}:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const allErrors = Array.from(categoryStats.values()).flatMap((s) => s.errors);
  const allInRange = Array.from(categoryStats.values()).reduce((s, v) => s + v.inRange, 0);
  const totalWithStats = allErrors.length;

  console.log('\n════════════════════════════════════════════════════');
  console.log('  BACKFILL COMPLETE');
  console.log('════════════════════════════════════════════════════');
  console.log(`  Total backfilled:   ${backfilled}`);
  console.log(`  Skipped (no data):  ${skipped}`);
  if (totalWithStats > 0) {
    console.log(`  Median error:       ${(median(allErrors) ?? 0).toFixed(1)}%`);
    console.log(`  Mean error:         ${(allErrors.reduce((s, v) => s + v, 0) / allErrors.length).toFixed(1)}%`);
    console.log(`  Within P25-P75:     ${((allInRange / totalWithStats) * 100).toFixed(1)}%`);
  }
  console.log('\n  By Category:');
  console.log('  ─────────────────────────────────────────────────');
  const sorted = Array.from(categoryStats.entries()).sort((a, b) => b[1].count - a[1].count);
  for (const [cat, stats] of sorted) {
    const med = median(stats.errors) ?? 0;
    const inRangePct = ((stats.inRange / stats.count) * 100).toFixed(0);
    console.log(`  ${cat.padEnd(30)} ${String(stats.count).padStart(4)} matters  |  ${med.toFixed(1).padStart(5)}% med error  |  ${inRangePct}% in range`);
  }
  console.log('════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
