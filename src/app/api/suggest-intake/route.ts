import { z } from 'zod';
import { suggestForNewMatter } from '@/lib/suggestions';
import { LIABILITY_ESTIMATES } from '@/lib/matter-taxonomy';

const DISCLAIMER =
  'Statistical suggestion based on historical Legal Tracker data. Not a trained ML model.';

const BodySchema = z.object({
  substantiveLaw: z.string().min(1, 'substantiveLaw is required'),
  category: z.string().min(1, 'category is required'),
  exposureAmount: z.number().positive().nullable().optional(),
  liabilityEstimate: z.enum(LIABILITY_ESTIMATES).nullable().optional(),
  jurisdiction: z.string().nullable().optional(),
  estimatedResolutionDate: z.string().nullable().optional(),
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
    substantiveLaw,
    category,
    exposureAmount,
    liabilityEstimate,
    jurisdiction,
    estimatedResolutionDate,
  } = parsed.data;

  // Convert ISO date string to days-until if provided
  let estimatedResolutionDays: number | null = null;
  if (estimatedResolutionDate) {
    const resDate = new Date(estimatedResolutionDate);
    if (!isNaN(resDate.getTime())) {
      const msUntil = resDate.getTime() - Date.now();
      estimatedResolutionDays = Math.round(msUntil / 86_400_000);
    }
  }

  try {
    const result = await suggestForNewMatter({
      substantiveLaw,
      category,
      exposureAmount: exposureAmount ?? null,
      liabilityEstimate: liabilityEstimate ?? null,
      jurisdiction: jurisdiction ?? null,
      estimatedResolutionDays,
    });

    return Response.json({
      ...result,
      _meta: {
        generatedAt: new Date().toISOString(),
        methodology: result.methodology,
        sampleSize: result.sampleSize,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error('[suggest-intake]', error);
    return Response.json(
      {
        error: 'Failed to generate intake suggestion',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 },
    );
  }
}
