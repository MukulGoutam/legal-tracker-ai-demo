'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ConfidenceLevel } from '@/lib/confidence';

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  sampleSize: number;
}

const BADGE_CLASSES: Record<ConfidenceLevel, string> = {
  High:         'bg-green-100 text-green-700 ring-green-600/20',
  Medium:       'bg-blue-100  text-blue-700  ring-blue-600/20',
  Low:          'bg-amber-100 text-amber-700 ring-amber-600/20',
  Insufficient: 'bg-red-100   text-red-700   ring-red-600/20',
};

/**
 * Colored confidence pill with a tooltip showing the underlying sample count.
 * Wraps its own TooltipProvider so it can be dropped anywhere on the page.
 */
export default function ConfidenceBadge({ level, sampleSize }: ConfidenceBadgeProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span
            className={`inline-flex cursor-default select-none items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_CLASSES[level]}`}
          >
            {level}
          </span>
        </TooltipPrimitive.Trigger>

        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={5}
            className="z-50 rounded-md bg-slate-900 px-3 py-1.5 text-xs leading-relaxed text-white shadow-lg"
          >
            Based on {sampleSize.toLocaleString()} historical{' '}
            {sampleSize === 1 ? 'matter' : 'matters'}
            <TooltipPrimitive.Arrow className="fill-slate-900" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
