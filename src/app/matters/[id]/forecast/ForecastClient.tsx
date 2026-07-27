'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  RefreshCw,
  MoreHorizontal,
  Trash2,
  Plus,
} from 'lucide-react';
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
import ForecastChangeSummary from '@/components/ForecastChangeSummary';
import {
  parseNum,
  phaseSubtotals,
  isTaskDirty,
  isTaskEmpty,
  deepCopyPhases,
  getNextTaskCode,
  getNextPhaseCode,
  diffForecasts,
  sumPhases,
} from '@/lib/forecast-utils';
import type { EditableTask, EditablePhase } from '@/lib/forecast-utils';
import type { ConfidenceLevel } from '@/lib/confidence';

// ── API response types ─────────────────────────────────────────────────────────

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

// ── Component state types ──────────────────────────────────────────────────────

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
  | { status: 'saved'; forecastId: string; toastMsg: string }
  | { status: 'error'; message: string };

interface MatterProps {
  id: string;
  name: string;
  category: string;
  status: string;
  openedAt: string;
}

// ── Streaming helper ───────────────────────────────────────────────────────────

async function streamInto(
  url: string,
  body: object,
  setter: (s: string) => void,
  setStreaming: (b: boolean) => void,
) {
  setStreaming(true);
  setter('');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      setStreaming(false);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      setter(accumulated);
    }
  } finally {
    setStreaming(false);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function apiPhasesToEditable(phases: SuggestedPhase[]): EditablePhase[] {
  return phases.map((phase) => ({
    phaseCode: phase.phaseCode,
    phaseName: phase.phaseName,
    confidence: phase.confidence,
    sampleSize: phase.sampleSize,
    isCollapsed: false,
    source: 'ai-suggested' as const,
    tasks: phase.tasks.map((task) => ({
      taskCode: task.taskCode,
      taskName: task.taskName,
      hours: String(Math.round(task.estimatedHours.p50)),
      amount: String(Math.round(task.estimatedAmount.p50)),
      suggestedHours: task.estimatedHours.p50,
      suggestedAmount: task.estimatedAmount.p50,
      source: 'ai-suggested' as const,
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

// ── Shared styles ──────────────────────────────────────────────────────────────

const inputCls =
  'block rounded-md border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums text-slate-900 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors';

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
  const [suggestedPhases, setSuggestedPhases] = useState<EditablePhase[]>([]);
  const [workingPhases, setWorkingPhases] = useState<EditablePhase[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  // AI forecast narrative
  const [forecastNarrative, setForecastNarrative] = useState('');
  const [forecastNarrativeStreaming, setForecastNarrativeStreaming] = useState(false);

  // Edit state
  const [confirmDeletePhase, setConfirmDeletePhase] = useState<{
    phaseCode: string;
    phaseName: string;
    taskCount: number;
    totalAmount: number;
  } | null>(null);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<{
    phaseCode: string;
    taskCode: string;
  } | null>(null);
  const [renamingTask, setRenamingTask] = useState<{
    phaseCode: string;
    taskCode: string;
    value: string;
  } | null>(null);
  const [addingPhase, setAddingPhase] = useState(false);
  const [activePhaseMenu, setActivePhaseMenu] = useState<string | null>(null);

  // ── Derived values ──────────────────────────────────────────────────────────
  const workingTotals = sumPhases(workingPhases);
  const suggestedTotals = sumPhases(suggestedPhases);
  const diff = diffForecasts(suggestedPhases, workingPhases);
  const totalChanges =
    diff.editedTasks + diff.addedTasks + diff.deletedTasks + diff.addedPhases + diff.deletedPhases;

  const overallConfidence: ConfidenceLevel =
    loadState.status === 'success' ? loadState.overallConfidence : 'Insufficient';
  const overallSampleSize = loadState.status === 'success' ? loadState.sampleSize : 0;

  // ── Phase menu click-outside ────────────────────────────────────────────────
  useEffect(() => {
    if (!activePhaseMenu) return;
    const handler = () => setActivePhaseMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activePhaseMenu]);

  // ── Load forecast ───────────────────────────────────────────────────────────
  const loadForecast = useCallback(async () => {
    setLoadState({ status: 'loading' });
    setSaveState({ status: 'idle' });
    setConfirmDeletePhase(null);
    setConfirmDeleteTask(null);
    setRenamingTask(null);
    setAddingPhase(false);
    setActivePhaseMenu(null);
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
      const editable = apiPhasesToEditable(data.phases);
      setSuggestedPhases(editable);
      setWorkingPhases(deepCopyPhases(editable));
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

  // Stream AI commentary when forecast loads
  const forecastNarrativeKey = loadState.status === 'success' ? loadState.sampleSize : -1;
  const forecastPhasesContext = useMemo(() => {
    if (suggestedPhases.length === 0) return null;
    const total = sumPhases(suggestedPhases).amount;
    if (total === 0) return null;
    const top5 = [...suggestedPhases]
      .sort((a, b) => phaseSubtotals(b).amount - phaseSubtotals(a).amount)
      .slice(0, 5)
      .map((p) => {
        const sub = phaseSubtotals(p);
        return {
          name: p.phaseName,
          p50Amount: Math.round(sub.amount),
          pctOfTotal: Math.round((sub.amount / total) * 100),
        };
      });
    return { phases: top5, totalP50: Math.round(total) };
  }, [suggestedPhases]);

  useEffect(() => {
    if (loadState.status !== 'success' || !forecastPhasesContext) return;
    void streamInto(
      '/api/ai/explain',
      {
        type: 'forecast',
        context: {
          category: matter.category,
          sampleSize: loadState.sampleSize,
          overallConfidence: loadState.overallConfidence,
          ...forecastPhasesContext,
        },
      },
      setForecastNarrative,
      setForecastNarrativeStreaming,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastNarrativeKey, forecastPhasesContext]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleToggleCollapse(phaseCode: string) {
    setWorkingPhases((prev) =>
      prev.map((p) => (p.phaseCode === phaseCode ? { ...p, isCollapsed: !p.isCollapsed } : p)),
    );
  }

  function handleTaskChange(
    phaseCode: string,
    taskCode: string,
    field: 'hours' | 'amount',
    value: string,
  ) {
    setWorkingPhases((prev) =>
      prev.map((p) =>
        p.phaseCode !== phaseCode
          ? p
          : {
              ...p,
              tasks: p.tasks.map((t) =>
                t.taskCode !== taskCode ? t : { ...t, [field]: value },
              ),
            },
      ),
    );
  }

  function handleResetTask(phaseCode: string, taskCode: string) {
    setWorkingPhases((prev) =>
      prev.map((p) =>
        p.phaseCode !== phaseCode
          ? p
          : {
              ...p,
              tasks: p.tasks.map((t) =>
                t.taskCode !== taskCode
                  ? t
                  : {
                      ...t,
                      hours: String(Math.round(t.suggestedHours)),
                      amount: String(Math.round(t.suggestedAmount)),
                    },
              ),
            },
      ),
    );
  }

  function handleDeleteTask(phaseCode: string, taskCode: string) {
    const phase = workingPhases.find((p) => p.phaseCode === phaseCode);
    if (!phase) return;
    if (phase.tasks.length === 1) return; // guardrail: no last-task delete
    const task = phase.tasks.find((t) => t.taskCode === taskCode);
    if (!task) return;
    if (task.source === 'user-added') {
      setWorkingPhases((prev) =>
        prev.map((p) =>
          p.phaseCode !== phaseCode
            ? p
            : { ...p, tasks: p.tasks.filter((t) => t.taskCode !== taskCode) },
        ),
      );
    } else {
      setConfirmDeleteTask({ phaseCode, taskCode });
    }
  }

  function handleConfirmDeleteTask() {
    if (!confirmDeleteTask) return;
    const { phaseCode, taskCode } = confirmDeleteTask;
    setWorkingPhases((prev) =>
      prev.map((p) =>
        p.phaseCode !== phaseCode
          ? p
          : { ...p, tasks: p.tasks.filter((t) => t.taskCode !== taskCode) },
      ),
    );
    setConfirmDeleteTask(null);
  }

  function handleRenameTask(phaseCode: string, taskCode: string, newName: string) {
    setWorkingPhases((prev) =>
      prev.map((p) =>
        p.phaseCode !== phaseCode
          ? p
          : {
              ...p,
              tasks: p.tasks.map((t) =>
                t.taskCode !== taskCode ? t : { ...t, taskName: newName.trim() || t.taskName },
              ),
            },
      ),
    );
  }

  function handleAddTask(phaseCode: string) {
    setWorkingPhases((prev) => {
      const phase = prev.find((p) => p.phaseCode === phaseCode);
      if (!phase) return prev;
      const newCode = getNextTaskCode(phase);
      const newTask: EditableTask = {
        taskCode: newCode,
        taskName: 'New Task',
        hours: '0',
        amount: '0',
        suggestedHours: 0,
        suggestedAmount: 0,
        source: 'user-added',
      };
      return prev.map((p) =>
        p.phaseCode !== phaseCode
          ? p
          : { ...p, isCollapsed: false, tasks: [...p.tasks, newTask] },
      );
    });
    setRenamingTask((prev) => {
      // We need the new code — but we need the current phase to compute it.
      // setWorkingPhases queues the update; use a ref to capture the code after next render.
      // For now just clear any existing rename and let the user click to rename.
      return prev;
    });
  }

  // Called after handleAddTask to start rename on the newly added task
  const pendingRenamePhase = useRef<string | null>(null);
  function handleAddTaskAndRename(phaseCode: string) {
    pendingRenamePhase.current = phaseCode;
    handleAddTask(phaseCode);
  }

  // After workingPhases updates, if there's a pending rename, start it for the last task of that phase
  useEffect(() => {
    if (!pendingRenamePhase.current) return;
    const phaseCode = pendingRenamePhase.current;
    const phase = workingPhases.find((p) => p.phaseCode === phaseCode);
    if (!phase) return;
    const lastTask = phase.tasks[phase.tasks.length - 1];
    if (lastTask?.source === 'user-added') {
      setRenamingTask({ phaseCode, taskCode: lastTask.taskCode, value: lastTask.taskName });
      pendingRenamePhase.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingPhases]);

  function handleDeletePhaseRequest(phaseCode: string) {
    const phase = workingPhases.find((p) => p.phaseCode === phaseCode);
    if (!phase) return;
    const sub = phaseSubtotals(phase);
    setConfirmDeletePhase({
      phaseCode,
      phaseName: phase.phaseName,
      taskCount: phase.tasks.length,
      totalAmount: sub.amount,
    });
    setActivePhaseMenu(null);
  }

  function handleConfirmDeletePhase() {
    if (!confirmDeletePhase) return;
    setWorkingPhases((prev) =>
      prev.filter((p) => p.phaseCode !== confirmDeletePhase.phaseCode),
    );
    setConfirmDeletePhase(null);
  }

  function handleResetPhase(phaseCode: string) {
    const sugPhase = suggestedPhases.find((p) => p.phaseCode === phaseCode);
    if (!sugPhase) return;
    const resetPhase = { ...deepCopyPhases([sugPhase])[0] };
    setWorkingPhases((prev) =>
      prev.map((p) =>
        p.phaseCode !== phaseCode ? p : { ...resetPhase, isCollapsed: p.isCollapsed },
      ),
    );
    setActivePhaseMenu(null);
  }

  function handleAddPhase(phaseCode: string, phaseName: string) {
    if (workingPhases.some((p) => p.phaseCode === phaseCode)) return;
    const phaseNum = parseInt(phaseCode.replace(/^L/, ''), 10);
    const firstTaskNum = isNaN(phaseNum) ? 10 : phaseNum + 10;
    const newPhase: EditablePhase = {
      phaseCode,
      phaseName,
      confidence: 'Insufficient',
      sampleSize: 0,
      isCollapsed: false,
      source: 'user-added',
      tasks: [
        {
          taskCode: `L${firstTaskNum}`,
          taskName: 'New Task',
          hours: '0',
          amount: '0',
          suggestedHours: 0,
          suggestedAmount: 0,
          source: 'user-added',
        },
      ],
    };
    setWorkingPhases((prev) => [...prev, newPhase]);
    setAddingPhase(false);
  }

  function handleResetAll() {
    setWorkingPhases(deepCopyPhases(suggestedPhases));
    setConfirmDeletePhase(null);
    setConfirmDeleteTask(null);
    setRenamingTask(null);
    setAddingPhase(false);
    setActivePhaseMenu(null);
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (saveState.status === 'saving') return;
    setSaveState({ status: 'saving' });

    const phasesToSave = workingPhases.map((phase) => {
      const sub = phaseSubtotals(phase);
      return {
        phaseCode: phase.phaseCode,
        phaseName: phase.phaseName,
        confidence: phase.confidence,
        sampleSize: phase.sampleSize,
        estimatedHours: sub.hours,
        estimatedAmount: sub.amount,
        source: phase.source,
        tasks: phase.tasks.map((t) => ({
          taskCode: t.taskCode,
          taskName: t.taskName,
          estimatedHours: parseNum(t.hours),
          estimatedAmount: parseNum(t.amount),
          source: t.source,
        })),
      };
    });

    const summaryParts: string[] = [];
    if (diff.editedTasks > 0)
      summaryParts.push(`${diff.editedTasks} edit${diff.editedTasks > 1 ? 's' : ''}`);
    if (diff.addedTasks > 0)
      summaryParts.push(`${diff.addedTasks} custom task${diff.addedTasks > 1 ? 's' : ''}`);
    if (diff.deletedTasks > 0)
      summaryParts.push(`${diff.deletedTasks} removed`);
    if (diff.addedPhases > 0)
      summaryParts.push(`${diff.addedPhases} custom phase${diff.addedPhases > 1 ? 's' : ''}`);
    const toastMsg = summaryParts.length > 0
      ? `Forecast saved. ${summaryParts.join(', ')} preserved.`
      : 'Forecast saved.';

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
      setSaveState({ status: 'saved', forecastId: id, toastMsg });
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
        <div className="flex items-center gap-2">
          {totalChanges > 0 && !isLoading && (
            <button
              type="button"
              onClick={handleResetAll}
              className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 shadow-sm transition-colors hover:bg-amber-100"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to AI Suggestion
            </button>
          )}
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
      </div>

      {/* Totals row */}
      <TotalsRow
        totalAmount={workingTotals.amount}
        totalHours={workingTotals.hours}
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

      {/* AI forecast commentary */}
      {(forecastNarrative || forecastNarrativeStreaming) && (
        <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-500">
            ✨ Strategic Commentary
          </p>
          <p className="text-xs leading-relaxed text-violet-900">
            {forecastNarrative}
            {forecastNarrativeStreaming && <span className="animate-pulse">▋</span>}
          </p>
        </div>
      )}

      {/* Error state */}
      {loadState.status === 'error' && (
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm">
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
          {/* Change summary bar */}
          {loadState.status === 'success' && !isLoading && (
            <ForecastChangeSummary
              aiTotal={suggestedTotals.amount}
              workingTotal={workingTotals.amount}
              diff={diff}
              onResetAll={handleResetAll}
            />
          )}

          {isLoading ? (
            <ForecastSkeleton />
          ) : workingPhases.length === 0 && loadState.status === 'success' ? (
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
                    <th className="px-4 py-3 w-[100px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workingPhases.map((phase) => (
                    <PhaseGroup
                      key={phase.phaseCode}
                      phase={phase}
                      isMenuOpen={activePhaseMenu === phase.phaseCode}
                      confirmingDeleteTaskCode={
                        confirmDeleteTask?.phaseCode === phase.phaseCode
                          ? confirmDeleteTask.taskCode
                          : null
                      }
                      renamingTaskCode={
                        renamingTask?.phaseCode === phase.phaseCode
                          ? renamingTask.taskCode
                          : null
                      }
                      renamingTaskValue={
                        renamingTask?.phaseCode === phase.phaseCode
                          ? renamingTask.value
                          : ''
                      }
                      onToggleCollapse={() => handleToggleCollapse(phase.phaseCode)}
                      onMenuToggle={(e) => {
                        e.stopPropagation();
                        setActivePhaseMenu((prev) =>
                          prev === phase.phaseCode ? null : phase.phaseCode,
                        );
                      }}
                      onDeletePhase={() => handleDeletePhaseRequest(phase.phaseCode)}
                      onResetPhase={() => handleResetPhase(phase.phaseCode)}
                      onTaskChange={(taskCode, field, value) =>
                        handleTaskChange(phase.phaseCode, taskCode, field, value)
                      }
                      onResetTask={(taskCode) => handleResetTask(phase.phaseCode, taskCode)}
                      onDeleteTask={(taskCode) => handleDeleteTask(phase.phaseCode, taskCode)}
                      onConfirmDeleteTask={handleConfirmDeleteTask}
                      onCancelDeleteTask={() => setConfirmDeleteTask(null)}
                      onStartRename={(taskCode) => {
                        const task = phase.tasks.find((t) => t.taskCode === taskCode);
                        if (task)
                          setRenamingTask({
                            phaseCode: phase.phaseCode,
                            taskCode,
                            value: task.taskName,
                          });
                      }}
                      onRenameChange={(value) => {
                        if (renamingTask)
                          setRenamingTask({ ...renamingTask, value });
                      }}
                      onRenameCommit={() => {
                        if (renamingTask) {
                          handleRenameTask(
                            renamingTask.phaseCode,
                            renamingTask.taskCode,
                            renamingTask.value,
                          );
                          setRenamingTask(null);
                        }
                      }}
                      onAddTask={() => handleAddTaskAndRename(phase.phaseCode)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add new phase */}
          {loadState.status === 'success' && !isLoading && (
            <div className="mt-3">
              {addingPhase ? (
                <AddPhaseDialog
                  existingCodes={workingPhases.map((p) => p.phaseCode)}
                  suggestedNextCode={getNextPhaseCode(workingPhases)}
                  onAdd={handleAddPhase}
                  onCancel={() => setAddingPhase(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingPhase(true)}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  Add New Phase
                </button>
              )}
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
                <p className="text-sm text-green-800">{saveState.toastMsg}</p>
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
            currentTotalAmount={workingTotals.amount}
            category={matter.category}
            sampleSize={overallSampleSize}
            methodology={loadState.status === 'success' ? loadState.meta.methodology : ''}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Phase delete modal */}
      {confirmDeletePhase && (
        <DeletePhaseModal
          phaseName={confirmDeletePhase.phaseName}
          taskCount={confirmDeletePhase.taskCount}
          totalAmount={confirmDeletePhase.totalAmount}
          onConfirm={handleConfirmDeletePhase}
          onCancel={() => setConfirmDeletePhase(null)}
        />
      )}
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

function StatTile({ label, value, subLabel }: { label: string; value: string; subLabel: string }) {
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
  isMenuOpen,
  confirmingDeleteTaskCode,
  renamingTaskCode,
  renamingTaskValue,
  onToggleCollapse,
  onMenuToggle,
  onDeletePhase,
  onResetPhase,
  onTaskChange,
  onResetTask,
  onDeleteTask,
  onConfirmDeleteTask,
  onCancelDeleteTask,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onAddTask,
}: {
  phase: EditablePhase;
  isMenuOpen: boolean;
  confirmingDeleteTaskCode: string | null;
  renamingTaskCode: string | null;
  renamingTaskValue: string;
  onToggleCollapse: () => void;
  onMenuToggle: (e: React.MouseEvent) => void;
  onDeletePhase: () => void;
  onResetPhase: () => void;
  onTaskChange: (taskCode: string, field: 'hours' | 'amount', value: string) => void;
  onResetTask: (taskCode: string) => void;
  onDeleteTask: (taskCode: string) => void;
  onConfirmDeleteTask: () => void;
  onCancelDeleteTask: () => void;
  onStartRename: (taskCode: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onAddTask: () => void;
}) {
  const sub = phaseSubtotals(phase);
  const isCustom = phase.source === 'user-added';
  const headerBg = isCustom ? 'bg-blue-50' : 'bg-slate-50';

  return (
    <>
      {/* Phase header row */}
      <tr className={headerBg}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="shrink-0 text-slate-400 hover:text-slate-700"
            >
              {phase.isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            <span className="font-semibold text-slate-800">{phase.phaseCode}</span>
            <span className="text-slate-600">{phase.phaseName}</span>
            {isCustom && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-600">
                Custom
              </span>
            )}
          </div>
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
        <td className="relative px-4 py-3">
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onMenuToggle}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            aria-label="Phase actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-2 top-full z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {!isCustom && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={onResetPhase}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Phase
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onDeletePhase}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Phase
              </button>
            </div>
          )}
        </td>
      </tr>

      {/* Task rows */}
      {!phase.isCollapsed &&
        phase.tasks.map((task) => (
          <TaskRow
            key={task.taskCode}
            task={task}
            phaseConfidence={phase.confidence}
            phaseSampleSize={phase.sampleSize}
            isCustomPhase={isCustom}
            isConfirmingDelete={confirmingDeleteTaskCode === task.taskCode}
            isRenaming={renamingTaskCode === task.taskCode}
            renamingValue={renamingTaskCode === task.taskCode ? renamingTaskValue : ''}
            canDelete={phase.tasks.length > 1}
            onHoursChange={(v) => onTaskChange(task.taskCode, 'hours', v)}
            onAmountChange={(v) => onTaskChange(task.taskCode, 'amount', v)}
            onReset={() => onResetTask(task.taskCode)}
            onDelete={() => onDeleteTask(task.taskCode)}
            onConfirmDelete={onConfirmDeleteTask}
            onCancelDelete={onCancelDeleteTask}
            onStartRename={() => onStartRename(task.taskCode)}
            onRenameChange={onRenameChange}
            onRenameCommit={onRenameCommit}
          />
        ))}

      {/* Add task row */}
      {!phase.isCollapsed && (
        <tr className={isCustom ? 'bg-blue-50/30' : 'bg-white'}>
          <td colSpan={5} className="px-4 py-1.5 pl-10">
            <button
              type="button"
              onClick={onAddTask}
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              <Plus className="h-3 w-3" />
              Add task to {phase.phaseCode}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

// ── TaskRow ────────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  phaseConfidence,
  phaseSampleSize,
  isCustomPhase,
  isConfirmingDelete,
  isRenaming,
  renamingValue,
  canDelete,
  onHoursChange,
  onAmountChange,
  onReset,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onStartRename,
  onRenameChange,
  onRenameCommit,
}: {
  task: EditableTask;
  phaseConfidence: ConfidenceLevel;
  phaseSampleSize: number;
  isCustomPhase: boolean;
  isConfirmingDelete: boolean;
  isRenaming: boolean;
  renamingValue: string;
  canDelete: boolean;
  onHoursChange: (v: string) => void;
  onAmountChange: (v: string) => void;
  onReset: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
}) {
  const isCustomTask = task.source === 'user-added';
  const dirty = isTaskDirty(task);
  const empty = isTaskEmpty(task);
  const rowBg = isCustomTask || isCustomPhase
    ? 'bg-blue-50/30 hover:bg-blue-50/60'
    : 'bg-white hover:bg-slate-50/50';

  if (isConfirmingDelete) {
    return (
      <tr className="bg-red-50">
        <td colSpan={5} className="px-4 py-2.5 pl-10">
          <span className="text-xs text-red-700">
            Remove <strong>{task.taskName}</strong>?{' '}
            <button
              type="button"
              onClick={onConfirmDelete}
              className="font-semibold underline underline-offset-2 hover:no-underline"
            >
              Remove
            </button>
            {' · '}
            <button
              type="button"
              onClick={onCancelDelete}
              className="underline underline-offset-2 hover:no-underline"
            >
              Cancel
            </button>
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr className={rowBg}>
      {/* Task name */}
      <td className="px-4 py-2.5 pl-10">
        {isRenaming ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-slate-400">{task.taskCode}</span>
            <input
              type="text"
              value={renamingValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') onRenameCommit();
              }}
              className={`${inputCls} w-48`}
              autoFocus
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-slate-400">{task.taskCode}</span>
            {isCustomTask ? (
              <button
                type="button"
                onClick={onStartRename}
                title="Click to rename"
                className="text-slate-700 underline underline-offset-2 hover:text-blue-600 hover:no-underline"
              >
                {task.taskName}
              </button>
            ) : (
              <span className="text-slate-700">{task.taskName}</span>
            )}
            {isCustomTask && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-600">
                Custom
              </span>
            )}
            {empty && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                ⚠ zero
              </span>
            )}
          </div>
        )}
      </td>

      {/* Hours */}
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

      {/* Amount */}
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

      {/* Confidence */}
      <td className="px-4 py-2.5">
        <ConfidenceBadge level={phaseConfidence} sampleSize={phaseSampleSize} />
      </td>

      {/* Actions */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1">
          {dirty && !isCustomTask && (
            <button
              type="button"
              onClick={onReset}
              title="Reset to AI suggestion"
              className="flex items-center gap-1 rounded text-xs text-slate-400 transition-colors hover:text-blue-600"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              title={isCustomTask ? 'Remove task' : 'Delete task'}
              className="rounded p-0.5 text-slate-300 transition-colors hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── AddPhaseDialog ─────────────────────────────────────────────────────────────

function AddPhaseDialog({
  existingCodes,
  suggestedNextCode,
  onAdd,
  onCancel,
}: {
  existingCodes: string[];
  suggestedNextCode: string;
  onAdd: (code: string, name: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(suggestedNextCode);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimCode = code.trim().toUpperCase();
    const trimName = name.trim();
    if (!trimCode) { setError('Phase code is required'); return; }
    if (!trimName) { setError('Phase name is required'); return; }
    if (existingCodes.includes(trimCode)) {
      setError(`Phase code ${trimCode} already exists`);
      return;
    }
    onAdd(trimCode, trimName);
  }

  return (
    <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <h4 className="mb-3 text-xs font-semibold text-blue-800">Add New Phase</h4>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">Phase Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
            className={`${inputCls} mt-0.5 w-24`}
            placeholder="L500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Phase Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            className={`${inputCls} mt-0.5 w-52`}
            placeholder="e.g. Settlement Negotiations"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Add Phase
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="w-full text-xs text-red-600">{error}</p>}
      </form>
    </div>
  );
}

// ── DeletePhaseModal ───────────────────────────────────────────────────────────

function DeletePhaseModal({
  phaseName,
  taskCount,
  totalAmount,
  onConfirm,
  onCancel,
}: {
  phaseName: string;
  taskCount: number;
  totalAmount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-900">Delete phase?</h3>
        <p className="mt-2 text-sm text-slate-500">
          <span className="font-medium text-slate-700">{phaseName}</span> has{' '}
          {taskCount} task{taskCount !== 1 ? 's' : ''} totaling {fmtFees(totalAmount)}.
          This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete Phase
          </button>
        </div>
      </div>
    </div>
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
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex gap-8">
          {[180, 80, 100, 80, 60].map((w, i) => (
            <div key={i} className="h-3 rounded bg-slate-200" style={{ width: w }} />
          ))}
        </div>
      </div>
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
