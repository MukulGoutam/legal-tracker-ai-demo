import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { LIABILITY_ESTIMATES, tierJurisdiction } from '@/lib/matter-taxonomy';
import { suggestForNewMatter } from '@/lib/suggestions';
import { CURRENT_MODEL_VERSION } from '@/lib/model-version';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const BodySchema = z.object({
  name: z.string().min(1, 'Matter name is required'),
  description: z.string().optional(),
  substantiveLaw: z.string().min(1, 'Substantive law is required'),
  category: z.string().min(1, 'Category is required'),
  jurisdiction: z.string().optional(),
  estimatedValue: z.number().positive().optional(),
  exposureAmount: z.number().positive().nullable().optional(),
  liabilityEstimate: z.enum(LIABILITY_ESTIMATES).nullable().optional(),
  estimatedResolutionDate: z.string().nullable().optional(),
  insurerInvolved: z.boolean().optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const {
    name,
    description,
    substantiveLaw,
    category,
    jurisdiction,
    estimatedValue,
    exposureAmount,
    liabilityEstimate,
    estimatedResolutionDate,
    insurerInvolved,
  } = parsed.data;

  const jurisdictionTier = jurisdiction ? tierJurisdiction(jurisdiction) : null;

  let estimatedResolution: Date | null = null;
  if (estimatedResolutionDate) {
    const d = new Date(estimatedResolutionDate);
    if (!isNaN(d.getTime())) estimatedResolution = d;
  }

  try {
    const matter = await prisma.matter.create({
      data: {
        name,
        description: description ?? null,
        substantiveLaw,
        category,
        jurisdiction: jurisdiction ?? null,
        status: 'Open',
        openedAt: new Date(),
        estimatedValue: estimatedValue != null ? new Prisma.Decimal(estimatedValue) : null,
        exposureAmount: exposureAmount != null ? new Prisma.Decimal(exposureAmount) : null,
        liabilityEstimate: liabilityEstimate ?? null,
        jurisdictionTier,
        estimatedResolution,
        insurerInvolved: insurerInvolved ?? false,
        budgetApprovalRoute: 'Default',
      },
    });

    // Log intake prediction (non-critical — matter creation already succeeded)
    try {
      const suggestion = await suggestForNewMatter({
        substantiveLaw,
        category,
        exposureAmount: exposureAmount ?? null,
        liabilityEstimate: liabilityEstimate ?? null,
        jurisdiction: jurisdiction ?? null,
      });
      await prisma.predictionLog.create({
        data: {
          matterId: matter.id,
          predictionType: 'intake',
          predictedValue: new Prisma.Decimal(suggestion.estimatedFees.p50),
          predictedP25: new Prisma.Decimal(suggestion.estimatedFees.p25),
          predictedP75: new Prisma.Decimal(suggestion.estimatedFees.p75),
          confidence: suggestion.confidence,
          fallbackLevel: suggestion.fallbackLevel,
          sampleSize: suggestion.sampleSize,
          methodology: suggestion.methodology,
          modelVersion: CURRENT_MODEL_VERSION,
          inputParameters: {
            substantiveLaw,
            category,
            exposureAmount: exposureAmount ?? null,
            liabilityEstimate: liabilityEstimate ?? null,
            jurisdictionTier,
            filtersApplied: suggestion.filtersApplied,
            filtersDropped: suggestion.filtersDropped,
          },
        },
      });
    } catch (logErr) {
      console.error('[POST /api/matters] intake prediction logging failed:', logErr);
    }

    return Response.json({ id: matter.id, name: matter.name }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/matters]', error);
    return Response.json(
      {
        error: 'Failed to create matter',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 },
    );
  }
}
