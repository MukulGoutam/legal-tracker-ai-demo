'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Info, X } from 'lucide-react';

export interface MethodologyDetails {
  /** Defaults to "Closed matters in Legal Tracker". */
  dataSource?: string;
  /** Defaults to "Median (P50) with P25/P75 percentile range". */
  method?: string;
  /** When provided, adds a "Sample size: N matters" row. */
  sampleSize?: number;
}

interface MethodologyPopoverProps {
  /** Human-readable explanation returned by the suggestion lib. */
  methodology: string;
  details?: MethodologyDetails;
}

/**
 * Inline "ⓘ How this was calculated" trigger that opens a popover explaining
 * the data source, statistical method, sample size, and non-ML nature of the
 * estimate.
 */
export default function MethodologyPopover({
  methodology,
  details,
}: MethodologyPopoverProps) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded"
        >
          <Info className="h-3 w-3" aria-hidden="true" />
          How this was calculated
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={8}
          align="start"
          className="z-50 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">
              How this was calculated
            </h4>
            <PopoverPrimitive.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </PopoverPrimitive.Close>
          </div>

          {/* Methodology prose */}
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{methodology}</p>

          {/* Structured detail rows */}
          <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-medium text-slate-500">Data source</dt>
              <dd className="text-slate-700">
                {details?.dataSource ?? 'Closed matters in Legal Tracker'}
              </dd>
            </div>

            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-medium text-slate-500">Method</dt>
              <dd className="text-slate-700">
                {details?.method ?? 'Median (P50) with P25\u2013P75 percentile range'}
              </dd>
            </div>

            {details?.sampleSize !== undefined && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium text-slate-500">Sample size</dt>
                <dd className="text-slate-700">
                  {details.sampleSize.toLocaleString()}{' '}
                  {details.sampleSize === 1 ? 'matter' : 'matters'}
                </dd>
              </div>
            )}
          </dl>

          {/* Non-ML disclaimer */}
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
            Statistical estimate derived from historical data.{' '}
            <strong className="font-medium">Not a trained ML model.</strong>
          </p>

          <PopoverPrimitive.Arrow className="fill-slate-200" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
