import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { rankFirms, DEFAULT_WEIGHTS, type ScoringWeights } from '@/lib/firm-scoring';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const DISCLAIMER =
  'Statistical ranking based on historical Legal Tracker data. Not a trained ML model. No outcome/success data available.';

const WeightsSchema = z
  .object({
    cost: z.number().min(0),
    experience: z.number().min(0),
    cycle: z.number().min(0),
    predictability: z.number().min(0),
  })
  .partial()
  .optional();

const BodySchema = z.object({
  matterId: z.string().min(1, 'matterId is required'),
  weights: WeightsSchema,
});

export async function POST(request: Request) {
  // ── Input validation ────────────────────────────────────────────────────────
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

  const { matterId, weights: partialWeights } = parsed.data;

  // Merge caller-supplied weights with defaults before passing to scoreFirms.
  // scoreFirms normalises the weights internally, so the values need not sum to 1.
  const weights: ScoringWeights = { ...DEFAULT_WEIGHTS, ...partialWeights };

  // ── Load matter ─────────────────────────────────────────────────────────────
  let matter: {
    substantiveLaw: string;
    category: string;
    exposureAmount: { toString(): string } | null;
    liabilityEstimate: string | null;
    jurisdictionTier: string | null;
  } | null;
  try {
    matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: {
        substantiveLaw: true,
        category: true,
        exposureAmount: true,
        liabilityEstimate: true,
        jurisdictionTier: true,
      },
    });
  } catch (error) {
    console.error('[rank-firms] matter lookup failed', error);
    return Response.json(
      {
        error: 'Database error while loading matter',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 },
    );
  }

  if (!matter) {
    return Response.json(
      { error: 'Matter not found', code: 'MATTER_NOT_FOUND', matterId },
      { status: 404 },
    );
  }

  // ── Business logic ──────────────────────────────────────────────────────────
  try {
    const result = await rankFirms({
      substantiveLaw: matter.substantiveLaw,
      category: matter.category,
      weights,
      ...(matter.liabilityEstimate ? { liabilityEstimate: matter.liabilityEstimate } : {}),
      ...(matter.jurisdictionTier ? { jurisdictionTier: matter.jurisdictionTier } : {}),
    });

    const totalFirms = result.rankedFirms.length + result.insufficientDataFirms.length;

    return Response.json({
      ...result,
      _meta: {
        generatedAt: new Date().toISOString(),
        methodology: result.methodology,
        sampleSize: totalFirms,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error('[rank-firms]', error);
    return Response.json(
      {
        error: 'Failed to rank firms',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 },
    );
  }
}

