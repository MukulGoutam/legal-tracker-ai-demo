import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { suggestForecast } from '@/lib/suggestions';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const DISCLAIMER =
  'Statistical suggestion based on historical Legal Tracker data. Not a trained ML model.';

const BodySchema = z.object({
  matterId: z.string().min(1, 'matterId is required'),
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

  const { matterId } = parsed.data;

  // ── Load matter ─────────────────────────────────────────────────────────────
  let matter: { substantiveLaw: string; category: string } | null;
  try {
    matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { substantiveLaw: true, category: true },
    });
  } catch (error) {
    console.error('[suggest-forecast] matter lookup failed', error);
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
    const result = await suggestForecast({
      matterId,
      substantiveLaw: matter.substantiveLaw,
      category: matter.category,
    });

    const methodology =
      `Phase/task budget breakdown derived from ${result.sampleSize} closed peer` +
      ` matter${result.sampleSize !== 1 ? 's' : ''}` +
      (result.usedFallback ? ` (broadened cohort; ${result.fallbackNote})` : '') +
      '. Estimates are p25/p50/p75 of per-matter totals.';

    return Response.json({
      ...result,
      _meta: {
        generatedAt: new Date().toISOString(),
        methodology,
        sampleSize: result.sampleSize,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error('[suggest-forecast]', error);
    return Response.json(
      {
        error: 'Failed to generate forecast suggestion',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 },
    );
  }
}
