'use client';

import { RotateCcw } from 'lucide-react';
import type { ForecastDiff } from '@/lib/forecast-utils';

const _fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function ForecastChangeSummary({
  aiTotal,
  workingTotal,
  diff,
  onResetAll,
}: {
  aiTotal: number;
  workingTotal: number;
  diff: ForecastDiff;
  onResetAll: () => void;
}) {
  const totalChanges =
    diff.editedTasks + diff.addedTasks + diff.deletedTasks + diff.addedPhases + diff.deletedPhases;
  if (totalChanges === 0) return null;

  const deviationPct = aiTotal > 0 ? ((workingTotal - aiTotal) / aiTotal) * 100 : 0;
  const isAbove = deviationPct > 0;
  const showWarning = Math.abs(deviationPct) > 25;

  const parts: string[] = [];
  if (diff.editedTasks > 0) parts.push(`${diff.editedTasks} edited`);
  if (diff.addedTasks > 0) parts.push(`${diff.addedTasks} added`);
  if (diff.deletedTasks > 0) parts.push(`${diff.deletedTasks} removed`);
  if (diff.addedPhases > 0) parts.push(`${diff.addedPhases} new phase${diff.addedPhases > 1 ? 's' : ''}`);
  if (diff.deletedPhases > 0)
    parts.push(`${diff.deletedPhases} phase${diff.deletedPhases > 1 ? 's' : ''} deleted`);

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-amber-800">
          Unsaved changes: {parts.join(', ')}
        </span>
        {showWarning && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
              isAbove
                ? 'bg-red-100 text-red-700 ring-red-600/20'
                : 'bg-blue-100 text-blue-700 ring-blue-600/20'
            }`}
          >
            {isAbove ? '▲' : '▼'} {Math.abs(Math.round(deviationPct))}%{' '}
            {isAbove ? 'above' : 'below'} AI suggestion ({_fmt.format(aiTotal)})
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onResetAll}
        className="flex items-center gap-1 text-xs text-amber-700 underline underline-offset-2 hover:no-underline"
      >
        <RotateCcw className="h-3 w-3" />
        Reset all
      </button>
    </div>
  );
}
