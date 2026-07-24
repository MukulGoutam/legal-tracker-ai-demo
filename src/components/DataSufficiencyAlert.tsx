import { TriangleAlert } from 'lucide-react';

interface DataSufficiencyAlertProps {
  usedFallback: boolean;
  /** The full fallback explanation returned by the suggestion lib, e.g.
   *  "Only 8 closed matters found in 'Product Liability'; broadened to all
   *   'Litigation' matters (240 total)." */
  fallbackNote: string | null;
  sampleSize: number;
}

/**
 * Amber alert shown when the suggestion engine fell back to a broader cohort
 * because the primary category had too few closed matters.
 * Renders nothing when usedFallback is false.
 */
export default function DataSufficiencyAlert({
  usedFallback,
  fallbackNote,
  sampleSize,
}: DataSufficiencyAlertProps) {
  if (!usedFallback) return null;

  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
    >
      <TriangleAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
        aria-hidden="true"
      />

      <div className="space-y-1">
        <p className="font-medium text-amber-900">
          ⚠️ Insufficient data in this category ({sampleSize.toLocaleString()}{' '}
          {sampleSize === 1 ? 'matter' : 'matters'}).
        </p>

        {fallbackNote && (
          <p className="text-amber-800">{fallbackNote}</p>
        )}

        <p className="text-amber-700">Precision is reduced.</p>
      </div>
    </div>
  );
}
