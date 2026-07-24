'use client';

import { Check, X, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { ReactNode } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DriverBreakdown {
  baseCategoryMedian: number;
  exposureAdjustment: number;
  liabilityAdjustment: number;
  jurisdictionAdjustment: number;
  finalEstimate: number;
}

export interface PredictionExplainerProps {
  driverBreakdown: DriverBreakdown;
  filtersApplied: string[];
  filtersDropped: string[];
  fallbackLevel: number;
  sampleSize: number;
  fallbackNote: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const LEVEL_DESC: Record<number, string> = {
  1: 'Strictest match — all four filters applied',
  2: 'Jurisdiction filter relaxed',
  3: 'Liability filter also relaxed',
  4: 'Category-only match',
  5: 'Broad practice-area fallback',
};

const FILTER_LABELS: Record<string, string> = {
  category: 'Category',
  exposureBand: 'Exposure Band',
  liabilityEstimate: 'Liability Estimate',
  jurisdictionTier: 'Jurisdiction',
  substantiveLaw: 'Practice Area',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function formatSigned(n: number): string {
  const abs = formatCurrency(Math.abs(n));
  return n >= 0 ? `+${abs}` : `−${abs}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface BreakdownRowProps {
  icon?: ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  subtitle: string;
}

function BreakdownRow({ icon, label, value, valueClass = 'text-slate-800', subtitle }: BreakdownRowProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-1.5">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <div>
          <p className="text-xs font-medium text-slate-700">{label}</p>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
      </div>
      <span className={`shrink-0 font-mono text-xs font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PredictionExplainer({
  driverBreakdown: bd,
  filtersApplied,
  filtersDropped,
  fallbackLevel,
  sampleSize,
  fallbackNote,
}: PredictionExplainerProps) {
  return (
    <TooltipProvider>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

        {/* 1. Header */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800">How we got this number</span>
          <Tooltip>
            <TooltipTrigger
              type="button"
              className="text-slate-400 hover:text-slate-500"
              aria-label="About this prediction"
            >
              <Info className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[220px] text-xs">
              Statistical prediction based on historical closed matters. Not a trained ML model.
            </TooltipContent>
          </Tooltip>
        </div>

        {/* 2. Filter Level Indicator */}
        <div className="mt-4">
          <div className="flex gap-1">
            {Array.from({ length: 5 }, (_, i) => {
              const seg = i + 1;
              let bg: string;
              if (seg < fallbackLevel) bg = 'bg-slate-200';
              else if (seg === fallbackLevel) bg = 'bg-blue-600';
              else bg = 'bg-slate-100';
              return <div key={i} className={`h-2 flex-1 rounded-full ${bg}`} />;
            })}
          </div>
          <p className="mt-1.5 text-xs font-medium text-slate-700">
            Match specificity: Level {fallbackLevel} of 5
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {LEVEL_DESC[fallbackLevel] ?? 'Custom fallback level'}
          </p>
        </div>

        {/* 3. Filter Badges */}
        {(filtersApplied.length > 0 || filtersDropped.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {filtersApplied.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
              >
                <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                {FILTER_LABELS[f] ?? f}
              </span>
            ))}
            {filtersDropped.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
              >
                <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                {FILTER_LABELS[f] ?? f} dropped
              </span>
            ))}
          </div>
        )}

        {/* 4. Fallback note */}
        {fallbackNote && (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            {fallbackNote}
          </div>
        )}

        {/* 5. Driver Breakdown */}
        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3">
          <BreakdownRow
            label="Base category median"
            value={formatCurrency(bd.baseCategoryMedian)}
            subtitle={`Median of ${sampleSize} similar historical matters`}
          />

          {bd.exposureAdjustment !== 0 && (
            <BreakdownRow
              icon={
                bd.exposureAdjustment > 0
                  ? <TrendingUp className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                  : <TrendingDown className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              }
              label="Exposure scaling"
              value={formatSigned(bd.exposureAdjustment)}
              valueClass={bd.exposureAdjustment > 0 ? 'text-rose-600' : 'text-emerald-700'}
              subtitle="Sub-linear elasticity based on amount claimed"
            />
          )}

          {bd.liabilityAdjustment !== 0 && (
            <BreakdownRow
              icon={
                bd.liabilityAdjustment > 0
                  ? <TrendingUp className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                  : <TrendingDown className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              }
              label="Liability adjustment"
              value={formatSigned(bd.liabilityAdjustment)}
              valueClass={bd.liabilityAdjustment > 0 ? 'text-rose-600' : 'text-emerald-700'}
              subtitle="Historical pattern for this liability estimate"
            />
          )}

          {bd.jurisdictionAdjustment !== 0 && (
            <BreakdownRow
              icon={
                bd.jurisdictionAdjustment > 0
                  ? <TrendingUp className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                  : <TrendingDown className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              }
              label="Jurisdiction adjustment"
              value={formatSigned(bd.jurisdictionAdjustment)}
              valueClass={bd.jurisdictionAdjustment > 0 ? 'text-rose-600' : 'text-emerald-700'}
              subtitle="Cost differential for this jurisdiction tier"
            />
          )}

          <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
            <span className="text-sm font-semibold text-slate-800">Final estimate (P50)</span>
            <span className="text-base font-bold text-slate-900">
              {formatCurrency(bd.finalEstimate)}
            </span>
          </div>
        </div>

      </div>
    </TooltipProvider>
  );
}
