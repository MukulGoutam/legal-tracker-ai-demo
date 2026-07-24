'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, RotateCcw, RefreshCw } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import ConfidenceBadge from '@/components/ConfidenceBadge';
import DataSufficiencyAlert from '@/components/DataSufficiencyAlert';
import MethodologyPopover from '@/components/MethodologyPopover';
import type { ConfidenceLevel } from '@/lib/confidence';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PercentileRange {
  p25: number;
  p50: number;
  p75: number;
}

interface SuggestedTask {
  taskCode: string;
  taskName: string;
  estimatedHours: PercentileRange;
  estimatedAmount: PercentileRange;
}

interface SuggestedPhase {
  phaseCode: string;
  phaseName: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  estimatedHours: PercentileRange;
  estimatedAmount: PercentileRange;
  tasks: SuggestedTask[];
}

interface PeerBenchmarkPoint {
  matterId: string;
  totalAmount: number;
}

interface SuggestForecastResponse {
  phases: SuggestedPhase[];
  sampleSize: number;
  usedFallback: boolean;
  fallbackNote: string | null;
  peerBenchmark: PeerBenchmarkPoint[];
  overallConfidence: ConfidenceLevel;
  _meta: {
    generatedAt: string;
    methodology: string;
    sampleSize: number;
    disclaimer: string;
  };
}

interface EditableTask {
  taskCode: string;
  taskName: string;
  hours: string;
  amount: string;
  suggestedHours: number;
  suggestedAmount: number;
}

interface EditablePhase {
  phaseCode: string;
  phaseName: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  isCollapsed: boolean;
  tasks: EditableTask[];
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      meta: SuggestForecastResponse['_meta'];
      sampleSize: number;
      usedFallback: boolean;
      fallbackNote: string | null;
      overallConfidence: ConfidenceLevel;
      peerBenchmark: PeerBenchmarkPoint[];
    };

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; forecastId: string }
  | { status: 'error'; message: string };

interface MatterProps {
  id: string;
  name: string;
  category: string;
  status: string;
  openedAt: string;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function parseNum(s: string): number {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function phaseSubtotals(phase: EditablePhase) {
  return phase.tasks.reduce(
    (acc, t) => ({
      hours: acc.hours + parseNum(t.hours),
      amount: acc.amount + parseNum(t.amount),
    }),
    { hours: 0, amount: 0 },
  );
}

function isDirty(task: EditableTask): boolean {
  return (
    Math.round(parseNum(task.hours)) !== Math.round(task.suggestedHours) ||
    Math.round(parseNum(task.amount)) !== Math.round(task.suggestedAmount)
  );
}

function apiPhasesToEditable(phases: SuggestedPhase[]): EditablePhase[] {
  return phases.map((phase) => ({
    phaseCode: phase.phaseCode,
    phaseName: phase.phaseName,
    confidence: phase.confidence,
    sampleSize: phase.sampleSize,
    isCollapsed: false,
    tasks: phase.tasks.map((task) => ({
      taskCode: task.taskCode,
      taskName: task.taskName,
      hours: String(Math.round(task.estimatedHours.p50)),
      amount: String(Math.round(task.estimatedAmount.p50)),
      suggestedHours: task.estimatedHours.p50,
      suggestedAmount: task.estimatedAmount.p50,
    })),
  }));
}

// ── Formatters ─────────────────────────────────────────────────────────────────

const _currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function fmtFees(n: number): string {
  return _currencyFmt.format(n);
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// ── Shared input style ─────────────────────────────────────────────────────────

const inputCls =
  'block rounded-md border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums text-slate-900 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ' +
  'transition-colors';

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ForecastClient({ matter }: { matter: MatterProps }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [editablePhases, setEditablePhases] = useState<EditablePhase[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  // ── Derived totals ──────────────────────────────────────────────────────────
  const grandTotals = editablePhases.reduce(
    (acc, phase) => {
      const sub = phaseSubtotals(phase);
      return { hours: acc.hours + sub.hours, amount: acc.amount + sub.amount };
    },
    { hours: 0, amount: 0 },
  );

  // Weighted average from API — falls back to Insufficient during load.
  const overallConfidence: ConfidenceLevel =
    loadState.status === 'success' ? loadState.overallConfidence : 'Insufficient';

  const overallSampleSize =
    loadState.status === 'success' ? loadState.sampleSize : 0;

  // ── Load forecast ───────────────────────────────────────────────────────────
  const loadForecast = useCallback(async () => {
    setLoadState({ status: 'loading' });
    setSaveState({ status: 'idle' });
    try {
      const res = await fetch('/api/suggest-forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId: matter.id }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? `Server error (${res.status})`);
      }
      const data = (await res.json()) as SuggestForecastResponse;
      setEditablePhases(apiPhasesToEditable(data.phases));
      setLoadState({
        status: 'success',
        meta: data._meta,
        sampleSize: data.sampleSize,
        usedFallback: data.usedFallback,
        fallbackNote: data.fallbackNote,
        overallConfidence: data.overallConfidence,
        peerBenchmark: data.peerBenchmark,
      });
    } catch (err) {
      setLoadState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to load suggestions',
      });
    }
  }, [matter.id]);

  useEffect(() => {
    void loadForecast();
  }, [loadForecast]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleToggleCollapse(phaseCode: string) {
    setEditablePhases((prev) =>
      prev.map((p) =>
        p.phaseCode === phaseCode ? { ...p, isCollapsed: !p.isCollapsed } : p,
      ),
    );
  }

  function handleTaskChange(
    phaseCode: string,
    taskCode: string,
    field: 'hours' | 'amount',
    value: string,
  ) {
    setEditablePhases((prev) =>
      prev.map((phase) =>
        phase.phaseCode !== phaseCode
          ? phase
          : {
              ...phase,
              tasks: phase.tasks.map((task) =>
                task.taskCode !== taskCode ? task : { ...task, [field]: value },
              ),
            },
      ),
    );
  }

  function handleResetTask(phaseCode: string, taskCode: string) {
    setEditablePhases((prev) =>
      prev.map((phase) =>
        phase.phaseCode !== phaseCode
          ? phase
          : {
              ...phase,
              tasks: phase.tasks.map((task) =>
                task.taskCode !== taskCode
                  ? task
                  : {
                      ...task,
                      hours: String(Math.round(task.suggestedHours)),
                      amount: String(Math.round(task.suggestedAmount)),
                    },
              ),
            },
      ),
    );
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (saveState.status === 'saving') return;
    setSaveState({ status: 'saving' });

    const phasesToSave = editablePhases.map((phase) => {
      const sub = phaseSubtotals(phase);
      return {
        phaseCode: phase.phaseCode,
        phaseName: phase.phaseName,
        confidence: phase.confidence,
        sampleSize: phase.sampleSize,
        estimatedHours: sub.hours,
        estimatedAmount: sub.amount,
        tasks: phase.tasks.map((t) => ({
          taskCode: t.taskCode,
          taskName: t.taskName,
          estimatedHours: parseNum(t.hours),
          estimatedAmount: parseNum(t.amount),
        })),
      };
    });

    try {
      const res = await fetch('/api/forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId: matter.id,
          phases: phasesToSave,
          overallConfidence,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? `Server error (${res.status})`);
      }
      const { id } = (await res.json()) as { id: string };
      setSaveState({ status: 'saved', forecastId: id });
    } catch (err) {
      setSaveState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to save forecast',
      });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const isLoading = loadState.status === 'loading' || loadState.status === 'idle';

  return (
    <div>
      {/* Page title row */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Matter Pricing Forecast</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Phase/task breakdown auto-generated from similar historical matters
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadForecast()}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Spinner className="text-slate-400" />
              Generating…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate Suggestions
            </>
          )}
        </button>
      </div>

      {/* Total header row */}
      <TotalsRow
        totalAmount={grandTotals.amount}
        totalHours={grandTotals.hours}
        confidence={overallConfidence}
        sampleSize={overallSampleSize}
        isLoading={isLoading}
      />

      {/* DataSufficiencyAlert */}
      {loadState.status === 'success' && (
        <div className="mt-4">
          <DataSufficiencyAlert
            usedFallback={loadState.usedFallback}
            fallbackNote={loadState.fallbackNote}
            sampleSize={loadState.sampleSize}
          />
        </div>
      )}

      {/* Error state */}
      {loadState.status === 'error' && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm"
        >
          <p className="font-medium text-red-800">Failed to load forecast suggestions</p>
          <p className="mt-1 text-xs text-red-600">{loadState.message}</p>
          <button
            type="button"
            onClick={() => void loadForecast()}
            className="mt-3 text-xs text-red-700 underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Main two-column layout */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px] lg:items-start">
        {/* Left: table */}
        <div>
          {isLoading ? (
            <ForecastSkeleton />
          ) : editablePhases.length === 0 && loadState.status === 'success' ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-8 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">No phase data available</p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
                No closed peer matters were found for this category. Try regenerating or select
                a different category for the matter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 w-[200px]">Phase / Task</th>
                    <th className="px-4 py-3 text-right w-[110px]">Est. Hours</th>
                    <th className="px-4 py-3 text-right w-[130px]">Est. Amount</th>
                    <th className="px-4 py-3 w-[110px]">Confidence</th>
                    <th className="px-4 py-3 w-[80px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editablePhases.map((phase) => (
                    <PhaseGroup
                      key={phase.phaseCode}
                      phase={phase}
                      onToggleCollapse={() => handleToggleCollapse(phase.phaseCode)}
                      onTaskChange={(taskCode, field, value) =>
                        handleTaskChange(phase.phaseCode, taskCode, field, value)
                      }
                      onResetTask={(taskCode) => handleResetTask(phase.phaseCode, taskCode)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Save button */}
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={loadState.status !== 'success' || saveState.status === 'saving'}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveState.status === 'saving' ? (
                <>
                  <Spinner className="text-white/70" />
                  Saving…
                </>
              ) : (
                'Save Forecast'
              )}
            </button>

            {saveState.status === 'saved' && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center">
                <p className="text-sm text-green-800">Forecast saved.</p>
                <Link
                  href={`/matters/${matter.id}/firms`}
                  className="mt-1 inline-block text-sm font-medium text-blue-600 hover:underline"
                >
                  Continue to Firm Selection →
                </Link>
              </div>
            )}

            {saveState.status === 'error' && (
              <p role="alert" className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">
                {saveState.message}
              </p>
            )}
          </div>
        </div>

        {/* Right: benchmark sidebar */}
        <div className="lg:sticky lg:top-6">
          <BenchmarkSidebar
            peerBenchmark={loadState.status === 'success' ? loadState.peerBenchmark : []}
            currentTotalAmount={grandTotals.amount}
            category={matter.category}
            sampleSize={overallSampleSize}
            methodology={
              loadState.status === 'success' ? loadState.meta.methodology : ''
            }
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}

// ── TotalsRow ──────────────────────────────────────────────────────────────────

function TotalsRow({
  totalAmount,
  totalHours,
  confidence,
  sampleSize,
  isLoading,
}: {
  totalAmount: number;
  totalHours: number;
  confidence: ConfidenceLevel;
  sampleSize: number;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="animate-pulse grid grid-cols-3 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-3 w-28 rounded bg-slate-200" />
            <div className="mt-2 h-7 w-20 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <StatTile
        label="Total Estimated Fees"
        value={fmtFees(totalAmount)}
        subLabel="median (P50)"
      />
      <StatTile
        label="Total Hours"
        value={`${Math.round(totalHours).toLocaleString()} hrs`}
        subLabel="median (P50)"
      />
      <div>
        <p className="text-xs font-medium text-slate-500">Overall Confidence</p>
        <div className="mt-2">
          <ConfidenceBadge level={confidence} sampleSize={sampleSize} />
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  subLabel,
}: {
  label: string;
  value: string;
  subLabel: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{subLabel}</p>
    </div>
  );
}

// ── PhaseGroup ─────────────────────────────────────────────────────────────────

function PhaseGroup({
  phase,
  onToggleCollapse,
  onTaskChange,
  onResetTask,
}: {
  phase: EditablePhase;
  onToggleCollapse: () => void;
  onTaskChange: (taskCode: string, field: 'hours' | 'amount', value: string) => void;
  onResetTask: (taskCode: string) => void;
}) {
  const sub = phaseSubtotals(phase);

  return (
    <>
      {/* Phase header row */}
      <tr className="bg-slate-50">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex items-center gap-2 text-left"
          >
            {phase.isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            )}
            <span className="font-semibold text-slate-800">
              {phase.phaseCode}
            </span>
            <span className="text-slate-600">{phase.phaseName}</span>
          </button>
        </td>
        <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-700">
          {Math.round(sub.hours).toLocaleString()} hrs
        </td>
        <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-700">
          {fmtFees(sub.amount)}
        </td>
        <td className="px-4 py-3">
          <ConfidenceBadge level={phase.confidence} sampleSize={phase.sampleSize} />
        </td>
        <td className="px-4 py-3" />
      </tr>

      {/* Task rows */}
      {!phase.isCollapsed &&
        phase.tasks.map((task) => (
          <TaskRow
            key={task.taskCode}
            task={task}
            phaseConfidence={phase.confidence}
            phaseSampleSize={phase.sampleSize}
            onHoursChange={(v) => onTaskChange(task.taskCode, 'hours', v)}
            onAmountChange={(v) => onTaskChange(task.taskCode, 'amount', v)}
            onReset={() => onResetTask(task.taskCode)}
          />
        ))}
    </>
  );
}

// ── TaskRow ────────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  phaseConfidence,
  phaseSampleSize,
  onHoursChange,
  onAmountChange,
  onReset,
}: {
  task: EditableTask;
  phaseConfidence: ConfidenceLevel;
  phaseSampleSize: number;
  onHoursChange: (v: string) => void;
  onAmountChange: (v: string) => void;
  onReset: () => void;
}) {
  const dirty = isDirty(task);
  return (
    <tr className="bg-white hover:bg-slate-50/50">
      <td className="px-4 py-2.5 pl-10">
        <span className="text-xs font-medium text-slate-400">{task.taskCode}</span>
        <span className="ml-2 text-slate-700">{task.taskName}</span>
      </td>

      {/* Hours input */}
      <td className="px-4 py-2.5 text-right">
        <input
          type="number"
          min="0"
          step="0.5"
          value={task.hours}
          onChange={(e) => onHoursChange(e.target.value)}
          className={`${inputCls} w-20 text-right`}
          aria-label={`Hours for ${task.taskName}`}
        />
      </td>

      {/* Amount input */}
      <td className="px-4 py-2.5 text-right">
        <div className="relative inline-flex items-center">
          <span className="pointer-events-none absolute left-2 text-xs text-slate-400">$</span>
          <input
            type="number"
            min="0"
            step="100"
            value={task.amount}
            onChange={(e) => onAmountChange(e.target.value)}
            className={`${inputCls} w-28 pl-5 text-right`}
            aria-label={`Amount for ${task.taskName}`}
          />
        </div>
      </td>

      <td className="px-4 py-2.5">
        <ConfidenceBadge level={phaseConfidence} sampleSize={phaseSampleSize} />
      </td>

      {/* Reset button */}
      <td className="px-4 py-2.5">
        {dirty && (
          <button
            type="button"
            onClick={onReset}
            title="Reset to suggestion"
            className="flex items-center gap-1 rounded text-xs text-slate-400 hover:text-blue-600 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </td>
    </tr>
  );
}

// ── BenchmarkSidebar ───────────────────────────────────────────────────────────

function pctile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const HBAR_COLORS = ['#bfdbfe', '#93c5fd', '#60a5fa', '#2563eb'];

function BenchmarkSidebar({
  peerBenchmark,
  currentTotalAmount,
  category,
  sampleSize,
  methodology,
  isLoading,
}: {
  peerBenchmark: PeerBenchmarkPoint[];
  currentTotalAmount: number;
  category: string;
  sampleSize: number;
  methodology: string;
  isLoading: boolean;
}) {
  const amounts = peerBenchmark.map((p) => p.totalAmount);
  const p25 = pctile(amounts, 25);
  const p50 = pctile(amounts, 50);
  const p75 = pctile(amounts, 75);

  const benchmarkData = [
    { name: 'P25', amount: p25 },
    { name: 'Median', amount: p50 },
    { name: 'P75', amount: p75 },
    { name: 'This Forecast', amount: currentTotalAmount },
  ];

  const hasData = !isLoading && peerBenchmark.length > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Compare to Peers</h3>
        {methodology && (
          <MethodologyPopover methodology={methodology} details={{ sampleSize }} />
        )}
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        Based on {sampleSize > 0 ? sampleSize.toLocaleString() : '—'} closed{' '}
        {sampleSize === 1 ? 'matter' : 'matters'} in {category}
      </p>

      <div className="mt-4">
        {isLoading ? (
          <div className="animate-pulse h-[200px] w-full rounded bg-slate-100" />
        ) : !hasData ? (
          <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70">
            <p className="text-xs text-slate-400">No benchmark data</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              layout="vertical"
              data={benchmarkData}
              margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
            >
              <XAxis
                type="number"
                tickFormatter={fmtK}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                formatter={(value) => [
                  typeof value === 'number' ? fmtFees(value) : value,
                  'Total Fees',
                ]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
                }}
              />
              <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
                {benchmarkData.map((_, i) => (
                  <Cell key={i} fill={HBAR_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {hasData && (
        <p className="mt-2 text-xs text-slate-500">
          Your forecast of{' '}
          <span className="font-medium tabular-nums text-blue-700">
            {fmtFees(currentTotalAmount)}
          </span>{' '}
          vs. peer median of{' '}
          <span className="font-medium tabular-nums">{fmtFees(p50)}</span>
        </p>
      )}

      <p className="mt-2 text-center text-xs italic text-slate-400">
        Statistical benchmark. Not a trained ML model.
      </p>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function ForecastSkeleton() {
  return (
    <div
      className="animate-pulse overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      aria-busy="true"
      aria-label="Loading forecast"
    >
      {/* Fake table header */}
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex gap-8">
          {[180, 80, 100, 80, 60].map((w, i) => (
            <div key={i} className="h-3 rounded bg-slate-200" style={{ width: w }} />
          ))}
        </div>
      </div>
      {/* Phase blocks */}
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="h-4 w-48 rounded bg-slate-200" />
          </div>
          {[0, 1, 2].map((j) => (
            <div key={j} className="border-b border-slate-50 px-4 py-2.5 pl-10">
              <div className="flex items-center gap-6">
                <div className="h-3 w-40 rounded bg-slate-100" />
                <div className="ml-auto h-7 w-16 rounded bg-slate-100" />
                <div className="h-7 w-24 rounded bg-slate-100" />
                <div className="h-5 w-16 rounded-full bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
