import { PrismaClient, Prisma } from '@prisma/client';
import { faker } from '@faker-js/faker';
import {
  bandExposure,
  tierJurisdiction,
  LIABILITY_COST_MULTIPLIER,
  JURISDICTION_COST_MULTIPLIER,
  type LiabilityEstimate,
} from '../src/lib/matter-taxonomy';

const prisma = new PrismaClient();

// Deterministic seed so data is reproducible across runs
faker.seed(42);

// ============================================================
// CONFIGURATION
// ============================================================

type FirmProfile = {
  name: string;
  rateMultiplier: number;      // 1.0 = baseline hourly rate
  speedMultiplier: number;     // 1.0 = baseline cycle time (lower = faster)
  predictability: number;      // 0-1, higher = tighter variance
  volumeBias: number;          // 0-1, higher = gets more matters
  categoryAffinity?: string[]; // Categories this firm leans toward
};

const FIRMS: FirmProfile[] = [
  { name: 'Anderson & Cole LLP',      rateMultiplier: 1.45, speedMultiplier: 0.75, predictability: 0.92, volumeBias: 0.85, categoryAffinity: ['Commercial Litigation', 'M&A'] },
  { name: 'Baker Sterling',            rateMultiplier: 1.00, speedMultiplier: 1.00, predictability: 0.95, volumeBias: 0.70 },
  { name: 'Chen Rothstein',            rateMultiplier: 0.70, speedMultiplier: 1.35, predictability: 0.55, volumeBias: 0.60, categoryAffinity: ['Employment Litigation', 'Advice & Counseling'] },
  { name: 'Davenport Legal Group',     rateMultiplier: 1.05, speedMultiplier: 0.80, predictability: 0.80, volumeBias: 0.95, categoryAffinity: ['Commercial Litigation', 'Employment Litigation'] },
  { name: 'Ellis & Marsh',             rateMultiplier: 1.55, speedMultiplier: 1.20, predictability: 0.60, volumeBias: 0.30, categoryAffinity: ['IP Litigation', 'Patent Prosecution'] },
  { name: 'Fitzgerald Partners',       rateMultiplier: 0.75, speedMultiplier: 0.85, predictability: 0.72, volumeBias: 0.65 },
  { name: 'Grayson Whitfield LLP',     rateMultiplier: 1.00, speedMultiplier: 1.00, predictability: 0.75, volumeBias: 0.75 },
  { name: 'Harrington Blake',          rateMultiplier: 1.35, speedMultiplier: 1.00, predictability: 0.90, volumeBias: 0.55, categoryAffinity: ['IP Litigation', 'Trademark'] },
];

type CategoryConfig = {
  substantiveLaw: string;
  category: string;
  matterCount: number;
  baseCost: number;          // Median expected cost in USD
  baseDurationDays: number;  // Median expected duration
  phaseWeights: Record<string, number>; // How costs distribute across UTBMS phases
};

const CATEGORIES: CategoryConfig[] = [
  {
    substantiveLaw: 'Litigation', category: 'Commercial Litigation',
    matterCount: 150, baseCost: 285_000, baseDurationDays: 420,
    phaseWeights: { L100: 0.08, L200: 0.22, L300: 0.42, L400: 0.23, L500: 0.05 },
  },
  {
    substantiveLaw: 'Litigation', category: 'Employment Litigation',
    matterCount: 80, baseCost: 145_000, baseDurationDays: 320,
    phaseWeights: { L100: 0.10, L200: 0.25, L300: 0.40, L400: 0.20, L500: 0.05 },
  },
  {
    substantiveLaw: 'Litigation', category: 'IP Litigation',
    matterCount: 60, baseCost: 620_000, baseDurationDays: 540,
    phaseWeights: { L100: 0.06, L200: 0.18, L300: 0.45, L400: 0.26, L500: 0.05 },
  },
  {
    substantiveLaw: 'Litigation', category: 'Product Liability',
    matterCount: 8, baseCost: 380_000, baseDurationDays: 480,   // INTENTIONALLY SPARSE for guardrail demo
    phaseWeights: { L100: 0.07, L200: 0.20, L300: 0.43, L400: 0.25, L500: 0.05 },
  },
  {
    substantiveLaw: 'IP', category: 'Patent Prosecution',
    matterCount: 70, baseCost: 45_000, baseDurationDays: 720,
    phaseWeights: { L100: 0.15, L200: 0.55, L300: 0.20, L400: 0.10, L500: 0.00 },
  },
  {
    substantiveLaw: 'IP', category: 'Trademark',
    matterCount: 50, baseCost: 18_000, baseDurationDays: 240,
    phaseWeights: { L100: 0.20, L200: 0.60, L300: 0.15, L400: 0.05, L500: 0.00 },
  },
  {
    substantiveLaw: 'Employment', category: 'Advice & Counseling',
    matterCount: 50, baseCost: 22_000, baseDurationDays: 90,
    phaseWeights: { L100: 0.40, L200: 0.30, L300: 0.20, L400: 0.10, L500: 0.00 },
  },
  {
    substantiveLaw: 'Corporate', category: 'M&A',
    matterCount: 32, baseCost: 480_000, baseDurationDays: 180,
    phaseWeights: { L100: 0.25, L200: 0.35, L300: 0.25, L400: 0.15, L500: 0.00 },
  },
];

const PHASE_NAMES: Record<string, string> = {
  L100: 'Case Assessment, Development and Administration',
  L200: 'Pre-Trial Pleadings and Motions',
  L300: 'Discovery',
  L400: 'Trial Preparation and Trial',
  L500: 'Appeal',
};

const TASKS_BY_PHASE: Record<string, Array<{ code: string; name: string; weight: number }>> = {
  L100: [
    { code: 'L110', name: 'Fact Investigation/Development', weight: 0.45 },
    { code: 'L120', name: 'Analysis/Strategy',              weight: 0.40 },
    { code: 'L130', name: 'Experts/Consultants',            weight: 0.15 },
  ],
  L200: [
    { code: 'L210', name: 'Pleadings',                      weight: 0.30 },
    { code: 'L220', name: 'Preliminary Injunctions/Provisional Remedies', weight: 0.20 },
    { code: 'L230', name: 'Court Mandated Conferences',     weight: 0.15 },
    { code: 'L240', name: 'Dispositive Motions',            weight: 0.35 },
  ],
  L300: [
    { code: 'L310', name: 'Written Discovery',              weight: 0.25 },
    { code: 'L320', name: 'Document Production',            weight: 0.35 },
    { code: 'L330', name: 'Depositions',                    weight: 0.30 },
    { code: 'L340', name: 'Expert Discovery',               weight: 0.10 },
  ],
  L400: [
    { code: 'L410', name: 'Fact Witnesses',                 weight: 0.20 },
    { code: 'L420', name: 'Expert Witnesses',               weight: 0.20 },
    { code: 'L430', name: 'Written Motions and Submissions',weight: 0.25 },
    { code: 'L440', name: 'Other Trial Preparation and Support Work', weight: 0.15 },
    { code: 'L450', name: 'Trial and Hearing Attendance',   weight: 0.20 },
  ],
  L500: [
    { code: 'L510', name: 'Appellate Motions and Submissions', weight: 0.50 },
    { code: 'L520', name: 'Appellate Briefs',                  weight: 0.35 },
    { code: 'L530', name: 'Oral Argument',                     weight: 0.15 },
  ],
};

const JURISDICTIONS = [
  'US - Federal - S.D.N.Y.', 'US - Federal - N.D. Cal.', 'US - Federal - D. Del.',
  'US - CA', 'US - NY', 'US - TX', 'US - IL', 'US - MA', 'UK - England & Wales', 'EU - Germany',
];

const MATTER_NAME_TEMPLATES: Record<string, string[]> = {
  'Commercial Litigation':   ['{{company}} v. {{company}} - Contract Dispute', '{{company}} Breach of Contract', '{{company}} Commercial Dispute'],
  'Employment Litigation':   ['{{name}} v. {{company}} - Employment Claim', '{{company}} Discrimination Suit', '{{name}} Wrongful Termination'],
  'IP Litigation':           ['{{company}} v. {{company}} - Patent Infringement', '{{company}} Trade Secret Misappropriation', '{{company}} v. {{company}} - IP Dispute'],
  'Product Liability':       ['{{company}} Product Recall Litigation', '{{company}} Consumer Safety Class Action', '{{company}} Product Defect Claims'],
  'Patent Prosecution':      ['{{company}} Patent Application - {{tech}}', '{{company}} Continuation Filing', '{{company}} PCT Application - {{tech}}'],
  'Trademark':               ['{{company}} Trademark Registration', '{{company}} Brand Protection', '{{company}} TM Opposition Proceeding'],
  'Advice & Counseling':     ['{{company}} HR Policy Review', '{{company}} Employment Handbook Update', '{{company}} Wage & Hour Advisory'],
  'M&A':                     ['{{company}} Acquisition of {{company}}', '{{company}} Merger Advisory', '{{company}} Divestiture - {{division}}'],
};

// ============================================================
// HELPERS
// ============================================================

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function gaussian(mean: number, stdDev: number): number {
  // Box-Muller transform
  const u1 = Math.random() || 0.0001;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function weightedPick<T>(items: T[], weightFn: (item: T) => number): T {
  const total = items.reduce((s, i) => s + weightFn(i), 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= weightFn(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function generateMatterName(category: string): string {
  const templates = MATTER_NAME_TEMPLATES[category] || ['{{company}} Matter'];
  const template = faker.helpers.arrayElement(templates);
  return template
    .replace(/\{\{company\}\}/g, () => faker.company.name())
    .replace(/\{\{name\}\}/g, () => faker.person.fullName())
    .replace(/\{\{tech\}\}/g, () => faker.helpers.arrayElement(['Semiconductor', 'Biotech', 'Software', 'Medical Device', 'Automotive', 'Clean Energy']))
    .replace(/\{\{division\}\}/g, () => faker.helpers.arrayElement(['North American Operations', 'Consumer Products Division', 'Legacy Systems', 'International Business Unit']));
}

function generateExposureAmount(category: string): number | null {
  const params: Record<string, { mu: number; sigma: number }> = {
    'Commercial Litigation':  { mu: Math.log(2_000_000),  sigma: 1.2 },
    'Employment Litigation':  { mu: Math.log(400_000),    sigma: 1.1 },
    'IP Litigation':          { mu: Math.log(8_000_000),  sigma: 1.3 },
    'Product Liability':      { mu: Math.log(15_000_000), sigma: 1.4 },
    'Trademark':              { mu: Math.log(200_000),    sigma: 0.9 },
    'M&A':                    { mu: Math.log(50_000_000), sigma: 1.5 },
  };
  const p = params[category];
  if (!p) return null;
  return Math.max(10_000, Math.round(Math.exp(p.mu + p.sigma * gaussian(0, 1))));
}

function generateLiability(): LiabilityEstimate {
  const r = Math.random();
  if (r < 0.30) return 'Probable';
  if (r < 0.75) return 'Reasonably Possible';
  return 'Remote';
}

function pickFirmsForMatter(category: string, count: number): FirmProfile[] {
  const withAffinity = FIRMS.filter(f => f.categoryAffinity?.includes(category));
  const others = FIRMS.filter(f => !f.categoryAffinity?.includes(category));

  const selected: FirmProfile[] = [];

  // 60% chance to prefer an affinity firm as lead
  if (withAffinity.length > 0 && Math.random() < 0.6) {
    selected.push(weightedPick(withAffinity, f => f.volumeBias));
  } else {
    selected.push(weightedPick(FIRMS, f => f.volumeBias));
  }

  // Add additional firms if needed
  while (selected.length < count) {
    const pool = FIRMS.filter(f => !selected.includes(f));
    if (pool.length === 0) break;
    selected.push(weightedPick(pool, f => f.volumeBias));
  }

  return selected;
}

// ============================================================
// MAIN SEED
// ============================================================

async function main() {
  console.log('🌱 Starting seed...\n');

  // Wipe existing data
  console.log('Clearing existing data...');
  await prisma.invoice.deleteMany();
  await prisma.forecast.deleteMany();
  await prisma.firmAssignment.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.firm.deleteMany();

  // Create firms
  console.log('Creating firms...');
  const firmRecords = await Promise.all(
    FIRMS.map(f => prisma.firm.create({ data: { name: f.name } }))
  );
  const firmByName = new Map(firmRecords.map(f => [f.name, f]));

  // Track statistics for the summary log
  const stats: Record<string, { matters: number; totalCost: number; closed: number }> = {};

  // Track distribution stats for new parameters
  const liabilityDist: Record<string, number> = { Probable: 0, 'Reasonably Possible': 0, Remote: 0 };
  const tierDist: Record<string, number> = {};
  const commLitBands: Record<string, number> = {};

  let totalInvoices = 0;

  // Create matters per category
  for (const cat of CATEGORIES) {
    console.log(`\nGenerating ${cat.matterCount} matters for ${cat.substantiveLaw} / ${cat.category}...`);
    stats[cat.category] = { matters: 0, totalCost: 0, closed: 0 };

    for (let i = 0; i < cat.matterCount; i++) {
      // 80% closed, 20% open
      const isClosed = Math.random() < 0.8;

      // Opened 0-3 years ago
      const daysAgo = Math.floor(randomBetween(30, 3 * 365));
      const openedAt = new Date();
      openedAt.setDate(openedAt.getDate() - daysAgo);

      // Assign firms (1-2 per matter, weighted toward 1)
      const firmCount = Math.random() < 0.75 ? 1 : 2;
      const assignedFirms = pickFirmsForMatter(cat.category, firmCount);
      const leadFirm = assignedFirms[0];

      // Duration influenced by lead firm's speed
      const durationNoise = gaussian(1, 0.15);
      const durationDays = Math.max(
        30,
        Math.round(cat.baseDurationDays * leadFirm.speedMultiplier * durationNoise)
      );

      let closedAt: Date | null = null;
      if (isClosed && daysAgo > durationDays) {
        closedAt = new Date(openedAt);
        closedAt.setDate(closedAt.getDate() + durationDays);
      }

      // New prediction parameters
      const exposureAmount = generateExposureAmount(cat.category);
      const liabilityEstimate = generateLiability();
      const jurisdiction = faker.helpers.arrayElement(JURISDICTIONS);
      const jurisdictionTier = tierJurisdiction(jurisdiction);
      const insurerInvolved = Math.random() < 0.20;
      const estResDate = new Date(openedAt);
      estResDate.setDate(estResDate.getDate() + cat.baseDurationDays +
        Math.floor(gaussian(0, 30)));

      // Target total cost — multi-parameter model
      let targetTotal = cat.baseCost;
      targetTotal *= leadFirm.rateMultiplier;

      if (exposureAmount) {
        const referenceExposures: Record<string, number> = {
          'Commercial Litigation': 2_000_000,
          'Employment Litigation': 400_000,
          'IP Litigation': 8_000_000,
          'Product Liability': 15_000_000,
          'Trademark': 200_000,
          'M&A': 50_000_000,
        };
        const ref = referenceExposures[cat.category];
        if (ref) targetTotal *= Math.pow(exposureAmount / ref, 0.6);
      }

      targetTotal *= LIABILITY_COST_MULTIPLIER[liabilityEstimate];
      if (jurisdictionTier)
        targetTotal *= JURISDICTION_COST_MULTIPLIER[jurisdictionTier];

      const costNoise = gaussian(1, 1 - leadFirm.predictability);
      targetTotal *= Math.max(0.3, costNoise);
      targetTotal = Math.max(cat.baseCost * 0.15, targetTotal);

      // Track distribution stats
      liabilityDist[liabilityEstimate] = (liabilityDist[liabilityEstimate] ?? 0) + 1;
      if (jurisdictionTier) {
        tierDist[jurisdictionTier] = (tierDist[jurisdictionTier] ?? 0) + 1;
      }
      if (cat.category === 'Commercial Litigation' && exposureAmount) {
        const band = bandExposure(exposureAmount) ?? 'null';
        commLitBands[band] = (commLitBands[band] ?? 0) + 1;
      }

      // Create matter
      const matter = await prisma.matter.create({
        data: {
          name: generateMatterName(cat.category),
          description: `Matter involving ${cat.category.toLowerCase()} for ${faker.company.name()}.`,
          substantiveLaw: cat.substantiveLaw,
          category: cat.category,
          jurisdiction,
          status: closedAt ? 'Closed' : 'Open',
          openedAt,
          closedAt,
          estimatedValue: new Prisma.Decimal(targetTotal * randomBetween(0.8, 1.2)),
          exposureAmount: exposureAmount ? new Prisma.Decimal(exposureAmount) : null,
          liabilityEstimate,
          jurisdictionTier,
          estimatedResolution: estResDate,
          insurerInvolved,
          budgetApprovalRoute: 'Default',
        },
      });

      // Firm assignments
      for (let f = 0; f < assignedFirms.length; f++) {
        const firm = firmByName.get(assignedFirms[f].name)!;
        await prisma.firmAssignment.create({
          data: {
            matterId: matter.id,
            firmId: firm.id,
            role: f === 0 ? 'Lead Counsel' : 'Co-Counsel',
            assignedAt: openedAt,
          },
        });
      }

      // Generate invoices for closed matters
      if (closedAt) {
        const invoicesToCreate: Prisma.InvoiceCreateManyInput[] = [];
        const invoiceCount = Math.floor(randomBetween(15, 40));

        // Distribute total across phases per category weights
        for (const [phaseCode, phaseWeight] of Object.entries(cat.phaseWeights)) {
          if (phaseWeight === 0) continue;
          const phaseBudget = targetTotal * phaseWeight;
          const tasks = TASKS_BY_PHASE[phaseCode];
          const phaseInvoiceCount = Math.max(1, Math.round(invoiceCount * phaseWeight));

          for (let inv = 0; inv < phaseInvoiceCount; inv++) {
            const task = weightedPick(tasks, t => t.weight);
            const invoiceAmount = (phaseBudget / phaseInvoiceCount) * randomBetween(0.7, 1.3);
            const hourlyRate = randomBetween(450, 950) * leadFirm.rateMultiplier;
            const hours = invoiceAmount / hourlyRate;

            // Invoice date spread across matter's lifespan
            const invoiceDate = new Date(openedAt);
            invoiceDate.setDate(
              invoiceDate.getDate() + Math.floor(randomBetween(1, durationDays))
            );

            // Attribute invoice to one of the assigned firms (weighted to lead)
            const invoiceFirm = Math.random() < 0.8 ? assignedFirms[0] : assignedFirms[assignedFirms.length - 1];
            const firmRecord = firmByName.get(invoiceFirm.name)!;

            invoicesToCreate.push({
              matterId: matter.id,
              firmId: firmRecord.id,
              phaseCode,
              phaseName: PHASE_NAMES[phaseCode],
              taskCode: task.code,
              taskName: task.name,
              amount: new Prisma.Decimal(Math.round(invoiceAmount * 100) / 100),
              hours: new Prisma.Decimal(Math.round(hours * 10) / 10),
              invoiceDate,
            });
          }
        }

        await prisma.invoice.createMany({ data: invoicesToCreate });
        totalInvoices += invoicesToCreate.length;

        // Create a forecast for ~70% of closed matters (for v2 accuracy demo)
        if (Math.random() < 0.7) {
          const actualTotal = invoicesToCreate.reduce((s, i) => s + Number(i.amount), 0);
          const forecastNoise = gaussian(1, 1 - leadFirm.predictability * 0.7);
          const forecastTotal = actualTotal * Math.max(0.5, forecastNoise);

          const phasesJson = Object.entries(cat.phaseWeights)
            .filter(([, w]) => w > 0)
            .map(([code, w]) => ({
              phaseCode: code,
              phaseName: PHASE_NAMES[code],
              estimatedAmount: Math.round(forecastTotal * w),
              estimatedHours: Math.round((forecastTotal * w) / 650),
              tasks: TASKS_BY_PHASE[code].map(t => ({
                taskCode: t.code,
                taskName: t.name,
                estimatedAmount: Math.round(forecastTotal * w * t.weight),
                estimatedHours: Math.round((forecastTotal * w * t.weight) / 650),
              })),
            }));

          await prisma.forecast.create({
            data: {
              matterId: matter.id,
              phases: phasesJson as any,
              confidence: 'Medium',
              createdAt: openedAt,
            },
          });
        }

        stats[cat.category].totalCost += invoicesToCreate.reduce((s, i) => s + Number(i.amount), 0);
        stats[cat.category].closed += 1;
      }

      stats[cat.category].matters += 1;
    }
  }

  // ============================================================
  // DISTRIBUTION LOGS
  // ============================================================
  const totalMatters = Object.values(stats).reduce((s, c) => s + c.matters, 0);

  console.log('\n' + '='.repeat(70));
  console.log('LIABILITY ESTIMATE DISTRIBUTION');
  console.log('='.repeat(70));
  for (const [label, count] of Object.entries(liabilityDist)) {
    const pct = ((count / totalMatters) * 100).toFixed(1);
    console.log(`  ${label.padEnd(22)} ${String(count).padStart(4)}  (${pct}%)`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('JURISDICTION TIER DISTRIBUTION');
  console.log('='.repeat(70));
  const allTierCount = Object.values(tierDist).reduce((s, n) => s + n, 0);
  for (const [tier, count] of Object.entries(tierDist).sort(([a], [b]) => a.localeCompare(b))) {
    const pct = ((count / allTierCount) * 100).toFixed(1);
    console.log(`  ${tier.padEnd(20)} ${String(count).padStart(4)}  (${pct}%)`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('EXPOSURE BANDS — Commercial Litigation');
  console.log('='.repeat(70));
  const commLitTotal = Object.values(commLitBands).reduce((s, n) => s + n, 0);
  for (const [band, count] of Object.entries(commLitBands).sort()) {
    const pct = ((count / commLitTotal) * 100).toFixed(1);
    console.log(`  ${band.padEnd(10)} ${String(count).padStart(4)}  (${pct}%)`);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(70));
  console.log('SEED COMPLETE');
  console.log('='.repeat(70));
  console.log(`\nFirms:    ${firmRecords.length}`);
  console.log(`Matters:  ${totalMatters}`);
  console.log(`Invoices: ${totalInvoices}\n`);

  console.log('Matters by Category:');
  console.log('-'.repeat(70));
  console.log(
    'Category'.padEnd(30) +
    'Total'.padStart(8) +
    'Closed'.padStart(8) +
    'Avg Cost'.padStart(14) +
    'Guardrail'.padStart(12)
  );
  console.log('-'.repeat(70));

  for (const cat of CATEGORIES) {
    const s = stats[cat.category];
    const avgCost = s.closed > 0 ? s.totalCost / s.closed : 0;
    const guardrail = s.matters < 15 ? '⚠️  SPARSE' : '✓ OK';
    console.log(
      cat.category.padEnd(30) +
      String(s.matters).padStart(8) +
      String(s.closed).padStart(8) +
      `$${Math.round(avgCost).toLocaleString()}`.padStart(14) +
      guardrail.padStart(12)
    );
  }
  console.log('-'.repeat(70));
  console.log('\n✅ Ready to demo. The sparse category will trigger the data-sufficiency guardrail.\n');
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
