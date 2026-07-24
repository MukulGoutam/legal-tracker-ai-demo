import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const BodySchema = z.object({
  firmId: z.string().min(1, 'firmId is required'),
  role: z.string().min(1).default('Lead Counsel'),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: matterId } = await params;

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

  const { firmId, role } = parsed.data;

  try {
    // Verify matter exists
    const matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true },
    });
    if (!matter) {
      return Response.json(
        { error: 'Matter not found', code: 'MATTER_NOT_FOUND', matterId },
        { status: 404 },
      );
    }

    // Verify firm exists
    const firm = await prisma.firm.findUnique({
      where: { id: firmId },
      select: { id: true, name: true },
    });
    if (!firm) {
      return Response.json(
        { error: 'Firm not found', code: 'FIRM_NOT_FOUND', firmId },
        { status: 404 },
      );
    }

    // Prevent duplicate assignment (same firm + matter + role)
    const existing = await prisma.firmAssignment.findFirst({
      where: { matterId, firmId, role },
    });
    if (existing) {
      return Response.json(
        {
          error: 'Duplicate assignment',
          code: 'ALREADY_ASSIGNED',
          message: `${firm.name} is already assigned as ${role} on this matter.`,
        },
        { status: 409 },
      );
    }

    const assignment = await prisma.firmAssignment.create({
      data: { matterId, firmId, role, assignedAt: new Date() },
      include: { firm: { select: { name: true } } },
    });

    return Response.json({
      success: true,
      assignment: {
        id: assignment.id,
        matterId: assignment.matterId,
        firmId: assignment.firmId,
        firmName: assignment.firm.name,
        role: assignment.role,
        assignedAt: assignment.assignedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[assign]', error);
    return Response.json(
      {
        error: 'Failed to create assignment',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 },
    );
  }
}
