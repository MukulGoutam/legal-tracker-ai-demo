import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const TaskSchema = z.object({
  taskCode: z.string(),
  taskName: z.string(),
  estimatedHours: z.number().min(0),
  estimatedAmount: z.number().min(0),
});

const PhaseSchema = z.object({
  phaseCode: z.string(),
  phaseName: z.string(),
  confidence: z.enum(['High', 'Medium', 'Low', 'Insufficient']),
  sampleSize: z.number().int().min(0),
  estimatedHours: z.number().min(0),
  estimatedAmount: z.number().min(0),
  tasks: z.array(TaskSchema),
});

const BodySchema = z.object({
  matterId: z.string().min(1, 'matterId is required'),
  phases: z.array(PhaseSchema),
  overallConfidence: z.enum(['High', 'Medium', 'Low', 'Insufficient']),
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

  const { matterId, phases, overallConfidence } = parsed.data;

  try {
    const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { id: true } });
    if (!matter) {
      return Response.json({ error: 'Matter not found' }, { status: 404 });
    }

    const forecast = await prisma.forecast.upsert({
      where: { matterId },
      create: {
        matterId,
        phases: phases as object[],
        confidence: overallConfidence,
      },
      update: {
        phases: phases as object[],
        confidence: overallConfidence,
        createdAt: new Date(),
      },
    });

    return Response.json({ id: forecast.id }, { status: 200 });
  } catch (error) {
    console.error('[POST /api/forecasts]', error);
    return Response.json(
      {
        error: 'Failed to save forecast',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 },
    );
  }
}
