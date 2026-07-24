import type { ConfidenceLevel } from '@/lib/confidence';
import ConfidenceBadge from './ConfidenceBadge';
import MethodologyPopover, { type MethodologyDetails } from './MethodologyPopover';

interface SuggestionCardProps {
  title: string;
  /** P25/P50/P75 estimates for the metric. P50 is shown as the primary value. */
  range: { p25: number; p50: number; p75: number };
  confidenceLevel: ConfidenceLevel;
  sampleSize: number;
  /** Human-readable methodology string from the suggestion lib. */
  methodology: string;
  methodologyDetails?: MethodologyDetails;
  /**
   * Optional formatter applied to every displayed number.
   * Defaults to locale-formatted integer.
   * Pass a currency formatter for fees, a days formatter for durations, etc.
   */
  formatter?: (n: number) => string;
}

function defaultFormatter(n: number): string {
  return Math.round(n).toLocaleString();
}

/**
 * Card displaying a single statistical estimate (e.g. estimated fees or
 * duration) with its P25–P75 range, a visual range bar, a confidence badge,
 * and a methodology popover.
 */
export default function SuggestionCard({
  title,
  range,
  confidenceLevel,
  sampleSize,
  methodology,
  methodologyDetails,
  formatter = defaultFormatter,
}: SuggestionCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Title row + confidence badge */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
        <ConfidenceBadge level={confidenceLevel} sampleSize={sampleSize} />
      </div>

      {/* Primary value (median / P50) */}
      <div>
        <p className="text-2xl font-semibold tabular-nums text-slate-900">
          {formatter(range.p50)}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">median estimate</p>
      </div>

      {/* P25–P75 range label */}
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <span className="font-medium text-slate-400">P25–P75</span>
        <span className="tabular-nums">{formatter(range.p25)}</span>
        <span className="text-slate-300">–</span>
        <span className="tabular-nums">{formatter(range.p75)}</span>
      </div>

      {/* Range bar */}
      <RangeBar range={range} />

      {/* Footer: methodology popover */}
      <div className="border-t border-slate-100 pt-2">
        <MethodologyPopover
          methodology={methodology}
          details={methodologyDetails ?? { sampleSize }}
        />
      </div>
    </div>
  );
}

// ── Internal: range bar ───────────────────────────────────────────────────────

interface RangeBarProps {
  range: { p25: number; p50: number; p75: number };
}

function RangeBar({ range }: RangeBarProps) {
  const { p25, p50, p75 } = range;
  if (p75 <= 0) return null;

  // Express positions as percentage of p75 (the max end of the range)
  const pct = (v: number) => `${Math.min(100, Math.round((v / p75) * 100))}%`;

  return (
    <div
      role="img"
      aria-label={`Range bar: P25 at ${pct(p25)}, median at ${pct(p50)}, P75 at 100%`}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
    >
      {/* Interquartile fill: P25 → P75 */}
      <div
        className="absolute inset-y-0 rounded-full bg-blue-200"
        style={{ left: pct(p25), right: '0%' }}
      />
      {/* Median marker */}
      <div
        className="absolute inset-y-0 w-0.5 rounded-full bg-blue-500"
        style={{ left: pct(p50) }}
      />
    </div>
  );
}
