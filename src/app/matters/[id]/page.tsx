import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PrismaClient } from '@prisma/client';
import { MODEL_VERSIONS, ModelVersionKey } from '@/lib/model-version';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

function parseForecastTotal(phases: unknown): { total: number; phaseCount: number; taskCount: number } | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  let total = 0;
  let taskCount = 0;
  for (const p of phases) {
    if (typeof p !== 'object' || p === null) return null;
    const phase = p as Record<string, unknown>;
    total += Number(phase.estimatedAmount ?? 0);
    if (Array.isArray(phase.tasks)) taskCount += phase.tasks.length;
  }
  return { total, phaseCount: phases.length, taskCount };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const matter = await prisma.matter.findUnique({
    where: { id },
    include: {
      forecast: true,
      assignments: { include: { firm: true }, orderBy: { assignedAt: 'asc' } },
      predictionLogs: {
        where: { predictionType: 'intake', actualValue: { not: null } },
        orderBy: { predictedAt: 'asc' },
        take: 1,
      },
    },
  });

  if (!matter) notFound();

  const intakePrediction = matter.predictionLogs[0] ?? null;

  const forecastSummary = matter.forecast
    ? parseForecastTotal(matter.forecast.phases)
    : null;

  const timelineNodes: Array<{ label: string; date: Date | null; done: boolean }> = [
    { label: 'Created', date: matter.openedAt, done: true },
    { label: 'Forecast Set', date: matter.forecast?.createdAt ?? null, done: !!matter.forecast },
    {
      label: 'Firm Assigned',
      date: matter.assignments[0]?.assignedAt ?? null,
      done: matter.assignments.length > 0,
    },
    {
      label: matter.status === 'Closed' ? 'Closed' : 'Open',
      date: matter.closedAt ?? null,
      done: matter.status === 'Closed',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-slate-400">
          <Link href="/" className="hover:text-slate-600">Matters</Link>
          <span>/</span>
          <span className="max-w-[200px] truncate text-slate-500">{matter.name}</span>
          <span>/</span>
          <span className="font-medium text-slate-700">Overview</span>
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
                <span>Opened {fmtDate(matter.openedAt)}</span>
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
            <Link
              href={`/matters/${matter.id}/forecast`}
              className="border-b-2 border-transparent pb-3 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
            >
              Forecast
            </Link>
            <Link
              href={`/matters/${matter.id}/firms`}
              className="border-b-2 border-transparent pb-3 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
            >
              Firm Selection
            </Link>
            <span className="border-b-2 border-blue-600 pb-3 text-sm font-semibold text-blue-600">
              Overview
            </span>
          </nav>
        </div>

        <div className="space-y-6">

          {/* Three-column summary grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

            {/* Column 1: Intake prediction — not stored separately; link to /new */}
            <SummaryCard
              title="Intake Prediction"
              feature="Feature 1"
              subtitle="AI fee estimate at intake"
              emptyMessage="Created at /matters/new"
              emptyAction={{ label: 'Create new matter', href: '/matters/new' }}
              date={matter.openedAt}
              dateLabel="Made at intake"
            >
              <div className="text-xs text-slate-500">
                Estimate generated at the time the matter was created.
                See the intake form for prediction details.
              </div>
            </SummaryCard>

            {/* Column 2: Forecast */}
            <SummaryCard
              title="Forecast"
              feature="Feature 2"
              subtitle={forecastSummary ? `${forecastSummary.phaseCount} phases, ${forecastSummary.taskCount} tasks` : 'Not configured'}
              date={matter.forecast?.createdAt ?? null}
              dateLabel="Configured on"
              action={matter.forecast ? { label: 'View forecast →', href: `/matters/${matter.id}/forecast` } : undefined}
              emptyMessage="No forecast saved yet"
              emptyAction={{ label: 'Create forecast →', href: `/matters/${matter.id}/forecast` }}
            >
              {forecastSummary && (
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {fmtCurrency(forecastSummary.total)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">Grand total (P50)</p>
                </div>
              )}
            </SummaryCard>

            {/* Column 3: Assigned firms */}
            <SummaryCard
              title="Assigned Firms"
              feature="Feature 3"
              subtitle={matter.assignments.length > 0 ? `${matter.assignments.length} firm${matter.assignments.length !== 1 ? 's' : ''} assigned` : 'No firms assigned'}
              date={matter.assignments[0]?.assignedAt ?? null}
              dateLabel="First assigned"
              action={matter.assignments.length > 0 ? { label: 'View firm selection →', href: `/matters/${matter.id}/firms` } : undefined}
              emptyMessage="No firms assigned yet"
              emptyAction={{ label: 'Select firms →', href: `/matters/${matter.id}/firms` }}
            >
              {matter.assignments.length > 0 && (
                <ul className="space-y-1">
                  {matter.assignments.slice(0, 3).map((a) => (
                    <li key={a.id} className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">{a.firm.name}</span>
                      <span className="text-xs text-slate-400">{a.role}</span>
                    </li>
                  ))}
                  {matter.assignments.length > 3 && (
                    <li className="text-xs text-slate-400">
                      +{matter.assignments.length - 3} more
                    </li>
                  )}
                </ul>
              )}
            </SummaryCard>
          </div>

          {/* Timeline */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-6 text-sm font-semibold text-slate-700">Matter Timeline</h2>
            <div className="relative flex items-start justify-between">
              {/* Connecting line */}
              <div className="absolute left-8 right-8 top-4 h-0.5 bg-slate-200" aria-hidden="true" />

              {timelineNodes.map((node, i) => (
                <div key={i} className="relative flex flex-col items-center" style={{ width: `${100 / timelineNodes.length}%` }}>
                  <div
                    className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      node.done
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 bg-white text-slate-400'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <p className="mt-2 text-center text-xs font-medium text-slate-700">{node.label}</p>
                  <p className="mt-0.5 text-center text-[10px] text-slate-400">
                    {node.date ? fmtDate(node.date) : '—'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Financial & Legal Context */}
          {(matter.exposureAmount || matter.liabilityEstimate || matter.jurisdictionTier || matter.estimatedResolution) && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">Financial & Legal Context</h2>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {matter.exposureAmount !== null && (
                  <ContextRow
                    label="Exposure Amount"
                    value={fmtCurrency(Number(matter.exposureAmount))}
                  />
                )}
                {matter.liabilityEstimate && (
                  <ContextRow label="Liability Estimate" value={matter.liabilityEstimate} />
                )}
                {matter.jurisdictionTier && (
                  <ContextRow label="Jurisdiction Tier" value={matter.jurisdictionTier} />
                )}
                {matter.estimatedResolution && (
                  <ContextRow label="Est. Resolution" value={fmtDate(matter.estimatedResolution)} />
                )}
              </dl>
            </div>
          )}

          {/* Prediction vs Actual card (closed matters only) */}
          {matter.status === 'Closed' && intakePrediction && (
            <PredictionActualCard log={intakePrediction} matterId={matter.id} />
          )}

          {/* Footer */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <p className="text-xs leading-relaxed text-blue-700">
              <strong className="font-semibold">Connected workflow:</strong> This matter was created via the intake form (Feature 1: AI fee prediction), a phase/task forecast was built from historical data (Feature 2), and outside counsel was ranked and assigned using four operational metrics (Feature 3). Each step was informed by data from the previous.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({
  title,
  feature,
  subtitle,
  date,
  dateLabel,
  action,
  emptyMessage,
  emptyAction,
  children,
}: {
  title: string;
  feature: string;
  subtitle: string;
  date?: Date | null | string;
  dateLabel?: string;
  action?: { label: string; href: string };
  emptyMessage: string;
  emptyAction?: { label: string; href: string };
  children?: React.ReactNode;
}) {
  const hasContent = !!children;

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {feature}
          </span>
          <h3 className="mt-0.5 text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs text-blue-600 hover:underline">
            {action.label}
          </Link>
        )}
      </div>

      <div className="mt-3 flex-1">
        {hasContent ? (
          <div className="space-y-2">{children}</div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">{emptyMessage}</p>
            {emptyAction && (
              <Link href={emptyAction.href} className="text-xs text-blue-600 hover:underline">
                {emptyAction.label}
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-400">{subtitle}</p>
        {date && dateLabel && (
          <p className="mt-0.5 text-[10px] text-slate-300">
            {dateLabel} {fmtDate(date)}
          </p>
        )}
      </div>
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

// ── Prediction vs Actual card ──────────────────────────────────────────────

type PredictionLog = {
  predictedValue: unknown;
  predictedP25: unknown;
  predictedP75: unknown;
  actualValue: unknown;
  errorPercent: unknown;
  isWithinRange: boolean | null;
  confidence: string;
  modelVersion: string;
  sampleSize: number | null;
};

function PredictionActualCard({ log, matterId }: { log: PredictionLog; matterId: string }) {
  const predicted = Math.round(Number(log.predictedValue));
  const actual = Math.round(Number(log.actualValue));
  const p25 = Math.round(Number(log.predictedP25));
  const p75 = Math.round(Number(log.predictedP75));
  const errorPct = Math.round(Number(log.errorPercent) * 10) / 10;
  const modelKey = log.modelVersion as ModelVersionKey;
  const modelInfo = MODEL_VERSIONS[modelKey] ?? null;

  // Bar visualization: show predicted range and actual marker on a relative scale
  const maxVal = Math.max(p75, actual) * 1.1;
  const pct = (v: number) => `${Math.min(100, Math.round((v / maxVal) * 100))}%`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Prediction vs. Actual</h2>
          <p className="text-xs text-slate-400">How the intake AI estimate compared to final invoices</p>
        </div>
        <Link
          href={`/accuracy?category=`}
          className="text-xs text-blue-600 hover:underline"
        >
          View accuracy dashboard →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Predicted (P50)</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">{fmtCurrency(predicted)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Actual</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">{fmtCurrency(actual)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Error</p>
          <p className={`mt-0.5 text-lg font-bold ${errorPct <= 20 ? 'text-green-600' : errorPct <= 40 ? 'text-amber-600' : 'text-red-600'}`}>
            {errorPct}%
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">In Range</p>
          <p className={`mt-0.5 text-lg font-bold ${log.isWithinRange ? 'text-green-600' : 'text-slate-500'}`}>
            {log.isWithinRange ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      {/* Range bar */}
      <div className="mb-4">
        <p className="mb-1.5 text-[10px] text-slate-400">Predicted range (P25–P75) vs. actual</p>
        <div className="relative h-6 rounded-full bg-slate-100">
          {/* P25-P75 band */}
          <div
            className="absolute h-full rounded-full bg-blue-100"
            style={{ left: pct(p25), width: `${Math.round(((p75 - p25) / maxVal) * 100)}%` }}
          />
          {/* Predicted median marker */}
          <div
            className="absolute top-0 h-full w-0.5 bg-blue-500"
            style={{ left: pct(predicted) }}
            title={`Predicted: ${fmtCurrency(predicted)}`}
          />
          {/* Actual marker */}
          <div
            className="absolute top-0 h-full w-0.5 bg-green-600"
            style={{ left: pct(actual) }}
            title={`Actual: ${fmtCurrency(actual)}`}
          />
        </div>
        <div className="mt-1 flex gap-4 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-200" />P25–P75 range</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-0.5 bg-blue-500" />Predicted</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-0.5 bg-green-600" />Actual</span>
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        <span>Confidence: <strong className="text-slate-700">{log.confidence}</strong></span>
        {log.sampleSize !== null && <span>Sample: <strong className="text-slate-700">{log.sampleSize} matters</strong></span>}
        {modelInfo && (
          <span>Model: <strong className="text-slate-700">{modelInfo.name}</strong> — {modelInfo.description}</span>
        )}
      </div>
    </div>
  );
}
