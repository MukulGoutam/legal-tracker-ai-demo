'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  RotateCcw,
  RefreshCw,
  Trophy,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import FirmRankingMethodology from '@/components/FirmRankingMethodology';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FirmMetrics {
  costEfficiency: number;
  experienceVolume: number;
  cycleTimeScore: number;
  budgetPredictability: number;
}

interface FirmRawStats {
  matterCount: number;
  medianTotal: number;
  peerMedianTotal: number;
  medianCycleDays: number;
  peerMedianCycleDays: number;
  avgHourlyRate?: number;
  forecastedMatterCount: number;
  predictabilitySource: 'forecast' | 'cv';
  medianForecastError: number | null;
  coefficientOfVariation: number | null;
}

interface FirmScore {
  firmId: string;
  firmName: string;
  metrics: FirmMetrics;
  rawStats: FirmRawStats;
  compositeScore: number;
  rank: number;
  dataQualityNote: string | null;
}

interface InsufficientFirmData {
  firmId: string;
  firmName: string;
  matterCount: number;
  note: string;
}

interface PeerSetInfo {
  category: string;
  sampleSize: number;
  usedFallback: boolean;
  fallbackNote: string | null;
}

interface RankFirmsResponse {
  rankedFirms: FirmScore[];
  insufficientDataFirms: InsufficientFirmData[];
  peerSetInfo: PeerSetInfo;
  weights: { cost: number; experience: number; cycle: number; predictability: number };
  methodology: string;
  _meta: { generatedAt: string; disclaimer: string };
}

interface WeightSliders {
  cost: number;
  experience: number;
  cycle: number;
  predictability: number;
}

const DEFAULT_SLIDERS: WeightSliders = { cost: 30, experience: 20, cycle: 20, predictability: 30 };

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: RankFirmsResponse };

type AssignState = 'idle' | 'saving' | 'done' | 'error';

interface MatterProps {
  id: string;
  name: string;
  category: string;
  status: string;
  openedAt: string;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── Spinner ─────────────────────────────────────────────────────────────────────

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Composite score ring ───────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 70 ? 'text-emerald-600 ring-emerald-500' :
    score >= 50 ? 'text-blue-600 ring-blue-500' :
    'text-amber-600 ring-amber-500';
  return (
    <div className={`flex h-16 w-16 flex-col items-center justify-center rounded-full ring-4 ${color}`}>
      <span className="text-xl font-bold leading-none">{Math.round(score)}</span>
      <span className="text-[10px] font-medium text-slate-400 leading-tight">/ 100</span>
    </div>
  );
}

// ── Metric bar ─────────────────────────────────────────────────────────────────

const METRIC_CONFIG = {
  costEfficiency: {
    label: 'Cost Efficiency',
    color: 'bg-emerald-500',
    context: (m: FirmMetrics, r: FirmRawStats) =>
      `Median ${fmtCurrency(r.medianTotal)} vs peer ${fmtCurrency(r.peerMedianTotal)}`,
  },
  experienceVolume: {
    label: 'Experience',
    color: 'bg-blue-500',
    context: (_m: FirmMetrics, r: FirmRawStats) =>
      `${r.matterCount} matter${r.matterCount !== 1 ? 's' : ''}`,
  },
  cycleTimeScore: {
    label: 'Cycle Time',
    color: 'bg-violet-500',
    context: (m: FirmMetrics, r: FirmRawStats) => {
      const diff = Math.round(r.peerMedianCycleDays - r.medianCycleDays);
      const sign = diff >= 0 ? '-' : '+';
      return `${sign}${Math.abs(diff)}d vs peers (${r.medianCycleDays}d vs ${r.peerMedianCycleDays}d)`;
    },
  },
  budgetPredictability: {
    label: 'Predictability',
    color: 'bg-amber-500',
    context: (m: FirmMetrics, r: FirmRawStats) =>
      r.predictabilitySource === 'forecast' ? fmtPct(m.budgetPredictability) : `${fmtPct(m.budgetPredictability)} (spend variance proxy)`,
  },
};

function MetricBar({
  metricKey,
  value,
  metrics,
  rawStats,
}: {
  metricKey: keyof typeof METRIC_CONFIG;
  value: number;
  metrics: FirmMetrics;
  rawStats: FirmRawStats;
}) {
  const cfg = METRIC_CONFIG[metricKey];
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-slate-500">{cfg.label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${cfg.color} transition-all duration-500`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="w-48 shrink-0 text-right text-[11px] text-slate-500">
        {cfg.context(metrics, rawStats)}
      </span>
    </div>
  );
}

// ── Skeleton cards ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex gap-4">
        <div className="h-12 w-12 shrink-0 rounded-full bg-slate-200" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-48 rounded bg-slate-200" />
          <div className="h-3 w-64 rounded bg-slate-100" />
          <div className="mt-4 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-2.5 w-28 rounded bg-slate-100" />
                <div className="h-2 flex-1 rounded-full bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-16 w-16 shrink-0 rounded-full bg-slate-200" />
      </div>
    </div>
  );
}

// ── Weight slider ──────────────────────────────────────────────────────────────

function WeightSlider({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-slate-700">{label}</label>
        <span className={`text-xs font-semibold tabular-nums ${color}`}>{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
      />
    </div>
  );
}

// ── Firm card ──────────────────────────────────────────────────────────────────

function FirmCard({
  firm,
  totalFirms,
  matterId,
  category,
}: {
  firm: FirmScore;
  totalFirms: number;
  matterId: string;
  category: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assignState, setAssignState] = useState<AssignState>('idle');
  const [toastMsg, setToastMsg] = useState('');

  async function handleAssign() {
    setAssignState('saving');
    try {
      const res = await fetch(`/api/matters/${matterId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId: firm.firmId, role: 'Lead Counsel' }),
      });
      const data = (await res.json()) as { error?: string; assignment?: { firmName: string } };
      if (!res.ok) {
        if (res.status === 409) {
          setAssignState('done');
          setToastMsg(`${firm.firmName} already assigned`);
        } else {
          setAssignState('error');
          setToastMsg(data.error ?? 'Assignment failed');
        }
      } else {
        setAssignState('done');
        setToastMsg(`${firm.firmName} assigned as Lead Counsel`);
      }
    } catch {
      setAssignState('error');
      setToastMsg('Network error — please try again');
    }
  }

  return (
    <div
      className={`relative rounded-xl border bg-white p-6 shadow-sm transition-colors ${
        firm.rank === 1 ? 'border-blue-300' : 'border-slate-200 hover:border-blue-200'
      }`}
    >
      {firm.rank === 1 && (
        <div className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
          <Trophy className="h-3 w-3" aria-hidden="true" />
          Top Recommendation
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* Rank number */}
        <div className="flex w-12 shrink-0 flex-col items-center pt-1">
          <span className="text-3xl font-bold leading-none text-slate-300">
            {firm.rank}
          </span>
          <span className="mt-0.5 text-[10px] text-slate-400">of {totalFirms}</span>
        </div>

        {/* Firm details */}
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-slate-900">{firm.firmName}</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Based on {firm.rawStats.matterCount} prior matter{firm.rawStats.matterCount !== 1 ? 's' : ''} in {category}
          </p>

          <div className="mt-4 space-y-2">
            {(Object.keys(METRIC_CONFIG) as Array<keyof typeof METRIC_CONFIG>).map((key) => (
              <MetricBar
                key={key}
                metricKey={key}
                value={firm.metrics[key]}
                metrics={firm.metrics}
                rawStats={firm.rawStats}
              />
            ))}
          </div>

          {firm.dataQualityNote && (
            <p className="mt-3 text-xs italic text-amber-600">{firm.dataQualityNote}</p>
          )}

          {/* Expand toggle */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Hide' : 'Show'} full stats
          </button>

          {expanded && (
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  <StatRow label="Matters in segment" value={String(firm.rawStats.matterCount)} />
                  <StatRow label="Firm median/matter" value={fmtCurrency(firm.rawStats.medianTotal)} />
                  <StatRow label="Peer median/matter" value={fmtCurrency(firm.rawStats.peerMedianTotal)} />
                  <StatRow label="Firm median days" value={`${firm.rawStats.medianCycleDays}d`} />
                  <StatRow label="Peer median days" value={`${firm.rawStats.peerMedianCycleDays}d`} />
                  {firm.rawStats.avgHourlyRate !== undefined && (
                    <StatRow label="Avg hourly rate" value={`${fmtCurrency(firm.rawStats.avgHourlyRate)}/hr`} />
                  )}
                  <StatRow label="Forecasted matters" value={String(firm.rawStats.forecastedMatterCount)} />
                  <StatRow
                    label="Predictability source"
                    value={firm.rawStats.predictabilitySource === 'forecast' ? 'Forecast error' : 'Spend variance (CV)'}
                  />
                  {firm.rawStats.medianForecastError !== null && (
                    <StatRow
                      label="Median forecast error"
                      value={fmtPct(firm.rawStats.medianForecastError)}
                    />
                  )}
                  {firm.rawStats.coefficientOfVariation !== null && (
                    <StatRow
                      label="Coefficient of variation"
                      value={firm.rawStats.coefficientOfVariation.toFixed(3)}
                    />
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Score + assign */}
        <div className="flex shrink-0 flex-col items-center gap-3 pt-1">
          <ScoreRing score={firm.compositeScore} />
          <span className="text-center text-[10px] font-medium text-slate-400">Composite Score</span>

          {assignState === 'done' ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Assigned
            </span>
          ) : (
            <button
              type="button"
              onClick={handleAssign}
              disabled={assignState === 'saving'}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {assignState === 'saving' && <Spinner className="text-white" />}
              {assignState === 'saving' ? 'Assigning…' : 'Assign as Lead Counsel'}
            </button>
          )}

          {toastMsg && (
            <p className={`text-center text-[11px] ${assignState === 'error' ? 'text-red-500' : 'text-slate-500'}`}>
              {toastMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="px-3 py-1.5 font-medium text-slate-500">{label}</td>
      <td className="px-3 py-1.5 text-right font-mono text-slate-700">{value}</td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FirmSelectionClient({ matter }: { matter: MatterProps }) {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get('demo') === '1';

  const [sliders, setSliders] = useState<WeightSliders>(DEFAULT_SLIDERS);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [insufficientOpen, setInsufficientOpen] = useState(false);
  const [anyAssigned, setAnyAssigned] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRanking = useCallback(async (weights: WeightSliders) => {
    setLoadState({ status: 'loading' });
    try {
      const res = await fetch('/api/rank-firms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId: matter.id,
          weights: {
            cost: weights.cost / 100,
            experience: weights.experience / 100,
            cycle: weights.cycle / 100,
            predictability: weights.predictability / 100,
          },
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? `Server error (${res.status})`);
      }
      const data = (await res.json()) as RankFirmsResponse;
      setLoadState({ status: 'success', data });
    } catch (e) {
      setLoadState({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error' });
    }
  }, [matter.id]);

  // Initial load
  useEffect(() => {
    fetchRanking(sliders);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSliderChange(key: keyof WeightSliders, value: number) {
    const next = { ...sliders, [key]: value };
    setSliders(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchRanking(next), 400);
  }

  function applyPreset(preset: WeightSliders) {
    setSliders(preset);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchRanking(preset);
  }

  const rankedFirms = loadState.status === 'success' ? loadState.data.rankedFirms : [];
  const insufficientFirms = loadState.status === 'success' ? loadState.data.insufficientDataFirms : [];
  const peerSetInfo = loadState.status === 'success' ? loadState.data.peerSetInfo : null;

  return (
    <>
      {/* Demo floating panel */}
      {isDemo && (
        <div className="fixed right-4 top-24 z-50 w-60 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <p className="mb-3 text-xs font-semibold text-slate-700">Demo Controls</p>
          <div className="space-y-2">
            <DemoButton
              label="Balanced (default)"
              desc="Equal weighting"
              onClick={() => applyPreset(DEFAULT_SLIDERS)}
            />
            <DemoButton
              label="Cost-Focused"
              desc="Watch cheap firms rise"
              onClick={() => applyPreset({ cost: 70, experience: 10, cycle: 10, predictability: 10 })}
            />
            <DemoButton
              label="Predictability-Focused"
              desc="Consistent-budget firms rise"
              onClick={() => applyPreset({ cost: 10, experience: 10, cycle: 10, predictability: 70 })}
            />
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Firm Recommendations</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ranked by cost efficiency, experience, cycle time, and budget predictability — computed from historical Legal Tracker data
            </p>
          </div>
          <FirmRankingMethodology />
        </div>

        {/* Weight sliders */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setWeightsOpen(!weightsOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">Adjust Ranking Criteria</span>
              {loadState.status === 'loading' && (
                <Spinner className="text-blue-500" />
              )}
            </div>
            {weightsOpen ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {weightsOpen && (
            <div className="border-t border-slate-100 px-5 pb-5 pt-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <WeightSlider
                  label="Cost Efficiency"
                  value={sliders.cost}
                  onChange={(v) => handleSliderChange('cost', v)}
                  color="text-emerald-600"
                />
                <WeightSlider
                  label="Experience"
                  value={sliders.experience}
                  onChange={(v) => handleSliderChange('experience', v)}
                  color="text-blue-600"
                />
                <WeightSlider
                  label="Cycle Time"
                  value={sliders.cycle}
                  onChange={(v) => handleSliderChange('cycle', v)}
                  color="text-violet-600"
                />
                <WeightSlider
                  label="Predictability"
                  value={sliders.predictability}
                  onChange={(v) => handleSliderChange('predictability', v)}
                  color="text-amber-600"
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Weights auto-normalize to sum 100. Adjust to see ranking change.
                </p>
                <button
                  type="button"
                  onClick={() => applyPreset(DEFAULT_SLIDERS)}
                  className="inline-flex items-center gap-1 rounded text-xs text-slate-500 hover:text-slate-700"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to defaults
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Peer set info */}
        {peerSetInfo && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Ranking based on{' '}
              <span className="font-semibold text-slate-700">{peerSetInfo.sampleSize}</span>{' '}
              historical matters in{' '}
              <span className="font-semibold text-slate-700">{peerSetInfo.category}</span>
            </p>
            {peerSetInfo.usedFallback && peerSetInfo.fallbackNote && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-700">{peerSetInfo.fallbackNote}</p>
              </div>
            )}
          </div>
        )}

        {/* Firm cards */}
        {loadState.status === 'loading' && (
          <div className="space-y-4">
            {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {loadState.status === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm font-semibold text-red-700">Failed to load firm rankings</p>
            <p className="mt-1 text-xs text-red-600">{loadState.message}</p>
            <button
              type="button"
              onClick={() => fetchRanking(sliders)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {loadState.status === 'success' && rankedFirms.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
            <p className="text-sm font-medium text-slate-500">No firms with sufficient data in this category</p>
            <p className="mt-1 text-xs text-slate-400">At least 3 closed matters per firm are required for a ranking.</p>
          </div>
        )}

        {loadState.status === 'success' && rankedFirms.length > 0 && (
          <div className="space-y-4">
            {rankedFirms.map((firm) => (
              <div key={firm.firmId} onClick={() => setAnyAssigned(true)}>
                <FirmCard
                  firm={firm}
                  totalFirms={rankedFirms.length}
                  matterId={matter.id}
                  category={peerSetInfo?.category ?? matter.category}
                />
              </div>
            ))}
          </div>
        )}

        {/* Insufficient data section */}
        {loadState.status === 'success' && insufficientFirms.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setInsufficientOpen(!insufficientOpen)}
              className="flex w-full items-center gap-2 px-5 py-4 text-left"
            >
              {insufficientOpen ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
              <span className="text-sm font-medium text-slate-600">
                Firms with insufficient data ({insufficientFirms.length} firm{insufficientFirms.length !== 1 ? 's' : ''} with &lt;3 matters in this category)
              </span>
            </button>

            {insufficientOpen && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100 px-5">
                {insufficientFirms.map((firm) => (
                  <li key={firm.firmId} className="py-3">
                    <p className="text-sm font-medium text-slate-700">{firm.firmName}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{firm.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Post-assignment CTA */}
        {anyAssigned && (
          <div className="flex justify-end">
            <Link
              href={`/matters/${matter.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 transition-colors"
            >
              Continue to Overview →
            </Link>
          </div>
        )}

        {/* Footer methodology */}
        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-400">
            Statistical ranking based on historical billing data. Not a trained ML model.
            No outcome or win/loss data is available in Legal Tracker.
          </p>
        </div>
      </div>
    </>
  );
}

function DemoButton({
  label,
  desc,
  onClick,
}: {
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50 transition-colors"
    >
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <p className="text-[11px] text-slate-400">{desc}</p>
    </button>
  );
}
