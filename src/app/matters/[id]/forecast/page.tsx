import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PrismaClient } from '@prisma/client';
import ForecastClient from './ForecastClient';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const matter = await prisma.matter.findUnique({
    where: { id },
    select: { id: true, name: true, category: true, status: true, openedAt: true },
  });

  if (!matter) notFound();

  const matterForClient = {
    id: matter.id,
    name: matter.name,
    category: matter.category,
    status: matter.status,
    openedAt: matter.openedAt.toISOString(),
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-slate-400">
          <Link href="/" className="hover:text-slate-600">Matters</Link>
          <span>/</span>
          <span className="max-w-[200px] truncate text-slate-500">{matter.name}</span>
          <span>/</span>
          <span className="font-medium text-slate-700">Forecast</span>
        </nav>

        {/* Matter header card */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{matter.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                  {matter.category}
                </span>
                <span>·</span>
                <span>
                  Opened{' '}
                  {new Date(matter.openedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                matter.status === 'Open'
                  ? 'bg-green-50 text-green-700 ring-green-600/20'
                  : 'bg-slate-100 text-slate-600 ring-slate-500/20'
              }`}
            >
              {matter.status}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-slate-200">
          <nav className="-mb-px flex gap-6" aria-label="Tabs">
            <span className="border-b-2 border-blue-600 pb-3 text-sm font-semibold text-blue-600">
              Forecast
            </span>
            <Link
              href={`/matters/${matter.id}/firm-selection`}
              className="border-b-2 border-transparent pb-3 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
            >
              Firm Selection
            </Link>
            <Link
              href={`/matters/${matter.id}`}
              className="border-b-2 border-transparent pb-3 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
            >
              Overview
            </Link>
          </nav>
        </div>

        {/* Main content — client */}
        <ForecastClient matter={matterForClient} />
      </div>
    </div>
  );
}
