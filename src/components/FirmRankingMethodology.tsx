'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Info, X, DollarSign, BarChart2, Clock, Target, AlertTriangle } from 'lucide-react';

export default function FirmRankingMethodology() {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 transition-colors"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          How firms are ranked
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={8}
          align="end"
          className="z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">How firms are ranked</h4>
            <PopoverPrimitive.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </PopoverPrimitive.Close>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Firms are scored on four metrics computed from historical matters in Legal Tracker.
            All metrics are relative to peer firms in the same category.
          </p>

          <div className="mt-4 space-y-3">
            <MetricRow
              icon={<DollarSign className="h-4 w-4 text-emerald-600" />}
              label="Cost Efficiency"
              description="Lower total spend per matter vs peer median. Scored 0–100. A firm billing at the peer median scores 50."
            />
            <MetricRow
              icon={<BarChart2 className="h-4 w-4 text-blue-600" />}
              label="Experience Volume"
              description="Number of matters worked in this category, log-scaled. The difference between 30 and 20 matters is much smaller than between 5 and 1."
            />
            <MetricRow
              icon={<Clock className="h-4 w-4 text-violet-600" />}
              label="Cycle Time"
              description="How quickly matters close vs peer median. Shorter cycle time = higher score. A firm matching the peer median scores 50."
            />
            <MetricRow
              icon={<Target className="h-4 w-4 text-amber-600" />}
              label="Budget Predictability"
              description="How close actual spend lands to forecast. If no forecast data exists, we use spend variance as a proxy (labeled in the UI)."
            />
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-amber-800">What we DO NOT include</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-700">
                  No win/loss or outcome data is used. Legal Tracker does not track case outcomes, so
                  any &ldquo;success rate&rdquo; would be fabricated. This ranking reflects{' '}
                  <strong>operational and financial performance only.</strong>
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-400">
              Statistical ranking based on historical data. Not a trained ML model.
            </p>
          </div>

          <PopoverPrimitive.Arrow className="fill-slate-200" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function MetricRow({
  icon,
  label,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
    </div>
  );
}
