/**
 * Smoke-test for the firm ranking engine.
 * Run with: npx tsx scripts/test-firm-scoring.ts
 */

import { rankFirms, DEFAULT_WEIGHTS } from '../src/lib/firm-scoring';

function fmtScore(n: number): string {
  return n.toFixed(1);
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

async function run() {
  // ── Test 1: Normal segment — verify basic return shape and score range ────────
  console.log('\n' + '='.repeat(70));
  console.log('TEST 1: Commercial Litigation / Litigation — normal ranked output');
  console.log('Expected: rankedFirms array, compositeScore 0–100, rank ascending from 1');
  console.log('='.repeat(70));

  const t1 = await rankFirms({
    substantiveLaw: 'Litigation',
    category: 'Commercial Litigation',
  });

  console.log(JSON.stringify({
    peerSetInfo: t1.peerSetInfo,
    rankedCount: t1.rankedFirms.length,
    insufficientCount: t1.insufficientDataFirms.length,
    methodology: t1.methodology,
    weights: t1.weights,
  }, null, 2));

  if (t1.rankedFirms.length > 0) {
    const top = t1.rankedFirms[0];
    console.log('\nTop firm:');
    console.log(JSON.stringify({
      firmName: top.firmName,
      rank: top.rank,
      compositeScore: fmtScore(top.compositeScore),
      metrics: {
        costEfficiency: top.metrics.costEfficiency.toFixed(3),
        experienceVolume: top.metrics.experienceVolume.toFixed(3),
        cycleTimeScore: top.metrics.cycleTimeScore.toFixed(3),
        budgetPredictability: top.metrics.budgetPredictability.toFixed(3),
      },
      rawStats: {
        matterCount: top.rawStats.matterCount,
        medianTotal: fmtCurrency(top.rawStats.medianTotal),
        peerMedianTotal: fmtCurrency(top.rawStats.peerMedianTotal),
        medianCycleDays: top.rawStats.medianCycleDays,
        peerMedianCycleDays: top.rawStats.peerMedianCycleDays,
        avgHourlyRate: top.rawStats.avgHourlyRate ? fmtCurrency(top.rawStats.avgHourlyRate) + '/hr' : undefined,
        predictabilitySource: top.rawStats.predictabilitySource,
      },
      dataQualityNote: top.dataQualityNote,
    }, null, 2));

    // Assertions
    let pass = true;

    if (top.compositeScore < 0 || top.compositeScore > 100) {
      console.warn(`⚠️  compositeScore out of range: ${top.compositeScore}`);
      pass = false;
    }
    if (top.rank !== 1) {
      console.warn(`⚠️  First firm rank should be 1, got ${top.rank}`);
      pass = false;
    }
    for (const [key, val] of Object.entries(top.metrics)) {
      const v = val as number;
      if (v < 0 || v > 1) {
        console.warn(`⚠️  metric ${key} out of 0–1 range: ${v}`);
        pass = false;
      }
    }
    if (!('peerMedianTotal' in top.rawStats)) {
      console.warn('⚠️  peerMedianTotal missing from rawStats');
      pass = false;
    }

    if (pass) console.log('✅ Test 1: return shape, score range, and rank all correct');

    // Verify ranks are ascending 1..N
    const ranks = t1.rankedFirms.map(f => f.rank);
    const expected = Array.from({ length: t1.rankedFirms.length }, (_, i) => i + 1);
    if (JSON.stringify(ranks) !== JSON.stringify(expected)) {
      console.warn('⚠️  Ranks are not sequential:', ranks);
    } else {
      console.log('✅ Ranks sequential');
    }
  } else {
    console.log('ℹ  No firms with sufficient data in Commercial Litigation — fallback check only');
  }

  // Verify insufficient data firms have `note` field
  if (t1.insufficientDataFirms.length > 0) {
    const insuf = t1.insufficientDataFirms[0];
    if (!insuf.note) {
      console.warn('⚠️  insufficientDataFirms[0] missing `note` field');
    } else {
      console.log(`✅ insufficientDataFirms note: "${insuf.note}"`);
    }
  }

  // ── Test 2: Sparse category — verify peer-set fallback triggers ───────────────
  console.log('\n' + '='.repeat(70));
  console.log('TEST 2: Product Liability / Litigation — sparse category fallback');
  console.log('Expected: peerSetInfo.usedFallback === true and fallbackNote populated');
  console.log('='.repeat(70));

  const t2 = await rankFirms({
    substantiveLaw: 'Litigation',
    category: 'Product Liability',
  });

  console.log(JSON.stringify({
    peerSetInfo: t2.peerSetInfo,
    rankedCount: t2.rankedFirms.length,
    insufficientCount: t2.insufficientDataFirms.length,
  }, null, 2));

  if (t2.peerSetInfo.usedFallback) {
    console.log('✅ Test 2: peer-set fallback triggered correctly');
    if (t2.peerSetInfo.fallbackNote) {
      console.log(`   Note: ${t2.peerSetInfo.fallbackNote}`);
    } else {
      console.warn('⚠️  fallbackNote should be populated when usedFallback is true');
    }
  } else {
    console.log('ℹ  Product Liability has ≥30 closed matters — fallback not needed (seeded data may be larger)');
    console.log(`   peerSetInfo.sampleSize = ${t2.peerSetInfo.sampleSize}`);
  }

  // ── Test 3: Custom weights — verify weights are normalised and reflected ─────
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: Custom weights (cost=0.80, others=0.05) — cost-dominant ranking');
  console.log('Expected: weights normalised to sum ~1.0, cost ~73%');
  console.log('='.repeat(70));

  const t3 = await rankFirms({
    substantiveLaw: 'Litigation',
    category: 'Commercial Litigation',
    weights: { cost: 0.80, experience: 0.05, cycle: 0.05, predictability: 0.05 },
  });

  const w = t3.weights;
  const weightSum = w.cost + w.experience + w.cycle + w.predictability;
  console.log(JSON.stringify({
    weights: {
      cost: w.cost.toFixed(3),
      experience: w.experience.toFixed(3),
      cycle: w.cycle.toFixed(3),
      predictability: w.predictability.toFixed(3),
      sum: weightSum.toFixed(4),
    },
    methodology: t3.methodology,
  }, null, 2));

  if (Math.abs(weightSum - 1.0) < 0.001) {
    console.log('✅ Test 3: weights normalised to 1.0');
  } else {
    console.warn(`⚠️  weights sum to ${weightSum.toFixed(4)}, expected ~1.0`);
  }
  if (w.cost > 0.7) {
    console.log('✅ Cost weight is dominant (>0.7 after normalisation)');
  }

  // Verify default weights unchanged
  if (DEFAULT_WEIGHTS.cost !== 0.30) {
    console.warn('⚠️  DEFAULT_WEIGHTS.cost was mutated');
  } else {
    console.log('✅ DEFAULT_WEIGHTS unchanged after custom-weight call');
  }

  console.log('\n' + '='.repeat(70));
  console.log('All tests complete.');
  console.log('='.repeat(70) + '\n');
}

run().catch(e => {
  console.error('Test run failed:', e);
  process.exit(1);
});
