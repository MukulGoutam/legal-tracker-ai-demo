/**
 * Manual smoke-test for the multi-parameter prediction engine.
 * Run with: npx tsx scripts/test-prediction.ts
 */

import { suggestForNewMatter } from '../src/lib/suggestions';

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

async function run() {
  // ── Test 1: Commercial Lit, $2M exposure, Reasonably Possible, SDNY ──────────
  console.log('\n' + '='.repeat(70));
  console.log('TEST 1: Commercial Lit | $2M | Reasonably Possible | US-Federal-SDNY');
  console.log('Expected: Level 1 or 2, Medium/High confidence, ~$200k–$500k');
  console.log('='.repeat(70));

  const t1 = await suggestForNewMatter({
    substantiveLaw: 'Litigation',
    category: 'Commercial Litigation',
    exposureAmount: 2_000_000,
    liabilityEstimate: 'Reasonably Possible',
    jurisdiction: 'US - Federal - S.D.N.Y.',
  });

  console.log(JSON.stringify({
    fallbackLevel: t1.fallbackLevel,
    confidence: t1.confidence,
    sampleSize: t1.sampleSize,
    filtersApplied: t1.filtersApplied,
    filtersDropped: t1.filtersDropped,
    estimatedFees: {
      p25: fmt(t1.estimatedFees.p25),
      p50: fmt(t1.estimatedFees.p50),
      p75: fmt(t1.estimatedFees.p75),
    },
    driverBreakdown: {
      baseCategoryMedian: fmt(t1.driverBreakdown.baseCategoryMedian),
      exposureAdjustment: fmt(t1.driverBreakdown.exposureAdjustment),
      liabilityAdjustment: fmt(t1.driverBreakdown.liabilityAdjustment),
      jurisdictionAdjustment: fmt(t1.driverBreakdown.jurisdictionAdjustment),
      finalEstimate: fmt(t1.driverBreakdown.finalEstimate),
    },
    fallbackNote: t1.fallbackNote,
  }, null, 2));

  // ── Test 2: Same but $50M exposure → should be significantly higher ───────────
  console.log('\n' + '='.repeat(70));
  console.log('TEST 2: Commercial Lit | $50M | Reasonably Possible | US-Federal-SDNY');
  console.log('Expected: finalEstimate meaningfully higher than Test 1 (2x–4x)');
  console.log('='.repeat(70));

  const t2 = await suggestForNewMatter({
    substantiveLaw: 'Litigation',
    category: 'Commercial Litigation',
    exposureAmount: 50_000_000,
    liabilityEstimate: 'Reasonably Possible',
    jurisdiction: 'US - Federal - S.D.N.Y.',
  });

  console.log(JSON.stringify({
    fallbackLevel: t2.fallbackLevel,
    confidence: t2.confidence,
    sampleSize: t2.sampleSize,
    estimatedFees: {
      p25: fmt(t2.estimatedFees.p25),
      p50: fmt(t2.estimatedFees.p50),
      p75: fmt(t2.estimatedFees.p75),
    },
    driverBreakdown: {
      baseCategoryMedian: fmt(t2.driverBreakdown.baseCategoryMedian),
      exposureAdjustment: fmt(t2.driverBreakdown.exposureAdjustment),
      liabilityAdjustment: fmt(t2.driverBreakdown.liabilityAdjustment),
      jurisdictionAdjustment: fmt(t2.driverBreakdown.jurisdictionAdjustment),
      finalEstimate: fmt(t2.driverBreakdown.finalEstimate),
    },
  }, null, 2));

  const ratio = t2.driverBreakdown.finalEstimate / (t1.driverBreakdown.finalEstimate || 1);
  console.log(`\n→ T2/T1 ratio: ${ratio.toFixed(2)}x  (expect 2x–4x)`);
  if (ratio < 1.5) {
    console.warn('⚠️  WARNING: ratio is too low — exposure scaling may not be working');
  } else {
    console.log('✅ Exposure scaling working correctly');
  }

  // ── Test 3: Product Liability, $15M, Remote, N.D. Cal → sparse, fallback ─────
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: Product Liability | $15M | Remote | US-Federal-NDCal');
  console.log('Expected: Level 3–5, Low/Insufficient confidence, fallbackNote populated');
  console.log('='.repeat(70));

  const t3 = await suggestForNewMatter({
    substantiveLaw: 'Litigation',
    category: 'Product Liability',
    exposureAmount: 15_000_000,
    liabilityEstimate: 'Remote',
    jurisdiction: 'US - Federal - N.D. Cal.',
  });

  console.log(JSON.stringify({
    fallbackLevel: t3.fallbackLevel,
    confidence: t3.confidence,
    sampleSize: t3.sampleSize,
    filtersApplied: t3.filtersApplied,
    filtersDropped: t3.filtersDropped,
    estimatedFees: {
      p25: fmt(t3.estimatedFees.p25),
      p50: fmt(t3.estimatedFees.p50),
      p75: fmt(t3.estimatedFees.p75),
    },
    driverBreakdown: {
      baseCategoryMedian: fmt(t3.driverBreakdown.baseCategoryMedian),
      finalEstimate: fmt(t3.driverBreakdown.finalEstimate),
    },
    fallbackNote: t3.fallbackNote,
  }, null, 2));

  if (t3.fallbackLevel <= 2) {
    console.warn('⚠️  WARNING: Product Liability should trigger fallback (only 8 matters seeded)');
  } else {
    console.log('✅ Fallback triggered correctly');
  }
  if (!t3.fallbackNote) {
    console.warn('⚠️  WARNING: fallbackNote should be populated for sparse categories');
  } else {
    console.log('✅ fallbackNote populated');
  }

  console.log('\n' + '='.repeat(70));
  console.log('All tests complete.');
  console.log('='.repeat(70) + '\n');
}

run()
  .catch(e => {
    console.error('Test run failed:', e);
    process.exit(1);
  });
