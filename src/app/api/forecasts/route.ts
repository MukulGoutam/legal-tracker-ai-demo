import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { CURRENT_MODEL_VERSION } from '@/lib/model-version';
import { confidenceLevel } from '@/lib/confidence';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const TaskSchema = z.object({
  taskCode: z.string(),
  taskName: z.string(),
  estimatedHours: z.number().min(0),
  estimatedAmount: z.number().min(0),
  source: z.enum(['ai-suggested', 'user-added']).optional(),
});

const PhaseSchema = z.object({
  phaseCode: z.string(),
  phaseName: z.string(),
  confidence: z.enum(['High', 'Medium', 'Low', 'Insufficient']),
  sampleSize: z.number().int().min(0),
  estimatedHours: z.number().min(0),
  estimatedAmount: z.number().min(0),
  source: z.enum(['ai-suggested', 'user-added']).optional(),
  tasks: z.array(TaskSchema),
});

const BodySchema = z.object({
  matterId: z.string().min(1, 'matterId is required'),
  phases: z.array(PhaseSchema),
  overallConfidence: z.enum(['High', 'Medium', 'Low', 'Insufficient']),
  sampleSize: z.number().int().min(0).optional(),
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

  const { matterId, phases, overallConfidence, sampleSize } = parsed.data;

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

    // Log forecast prediction (non-critical)
    try {
      const grandTotal = phases.reduce((sum, p) => sum + p.estimatedAmount, 0);
      const phaseCount = phases.length;
      const taskCount = phases.reduce((s, p) => s + p.tasks.length, 0);

      // Compute weighted confidence from phases
      const CONF_RANK: Record<string, number> = { Insufficient: 0, Low: 1, Medium: 2, High: 3 };
      const totalWeight = phases.reduce((s, p) => s + p.sampleSize, 0);
      const weightedScore =
        totalWeight > 0
          ? phases.reduce((s, p) => s + CONF_RANK[p.confidence] * p.sampleSize, 0) / totalWeight
          : 0;
      const computedConfidence = weightedScore >= 2.5 ? 'High' : weightedScore >= 1.5 ? 'Medium' : weightedScore >= 0.5 ? 'Low' : 'Insufficient';

      // Check if there's already a forecast prediction log (upsert by matterId + type)
      const existingLog = await prisma.predictionLog.findFirst({
        where: { matterId, predictionType: 'forecast' },
      });

      const logData = {
        matterId,
        predictionType: 'forecast',
        predictedValue: new Prisma.Decimal(Math.round(grandTotal)),
        confidence: computedConfidence,
        sampleSize: sampleSize ?? null,
        modelVersion: CURRENT_MODEL_VERSION,
        inputParameters: {
          phaseCount,
          taskCount,
          overallConfidence,
          phases: phases.map((p) => ({
            phaseCode: p.phaseCode,
            phaseName: p.phaseName,
            estimatedAmount: p.estimatedAmount,
          })),
        },
      };

      if (existingLog) {
        await prisma.predictionLog.update({ where: { id: existingLog.id }, data: logData });
      } else {
        await prisma.predictionLog.create({ data: logData });
      }
    } catch (logErr) {
      console.error('[POST /api/forecasts] prediction logging failed:', logErr);
    }

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
