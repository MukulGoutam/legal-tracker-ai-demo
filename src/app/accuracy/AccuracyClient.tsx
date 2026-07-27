'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { MODEL_VERSIONS, ModelVersionKey } from '@/lib/model-version';

// ── Types ──────────────────────────────────────────────────────────────────

interface Summary {
  totalPredictions: number;
  medianErrorPercent: number | null;
  meanErrorPercent: number | null;
  withinRangePercent: number | null;
  overpredictionRate: number | null;
  underpredictionRate: number | null;
}

interface CategoryRow {
  category: string;
  count: number;
  medianError: number;
  meanError: number;
  withinRangePct: number;
}

interface ConfidenceRow {
  confidence: string;
  count: number;
  medianError: number;
  meanError: number;
}

interface FallbackRow {
  fallbackLevel: number | null;
  label: string;
  count: number;
  medianError: number;
}

interface VersionRow {
  modelVersion: string;
  label: string;
  count: number;
  medianError: number;
  meanError: number;
  withinRangePct: number;
}

interface TimeSeriesPoint {
  month: string;
  count: number;
  medianError: number;
  meanError: number;
}

interface ScatterPoint {
  matterId: string;
  matterName: string;
  category: string;
  predicted: number;
  actual: number;
  errorPercent: number;
  confidence: string;
  modelVersion: string;
  isWithinRange: boolean | null;
}

interface AccuracyData {
  summary: Summary;
  byCategory: CategoryRow[];
  byConfidence: ConfidenceRow[];
  byFallbackLevel: FallbackRow[];
  byModelVersion: VersionRow[];
  timeSeries: TimeSeriesPoint[];
  scatterData: ScatterPoint[];
}

// ── Demo presets ──────────────────────────────────────────────────────────

const DEMO_PRESETS = [
  {
    label: 'All-Time View',
    params: {},
  },
  {
    label: 'v1.0 vs v2.0',
    params: { modelVersion: 'v1' },
    compare: 'v2_0',
  },
  {
    label: 'Low Confidence',
    params: { confidenceLevel: 'Low' },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  return `${n.toFixed(1)}%`;
}

const CONF_COLORS: Record<string, string> = {
  High: '#16a34a',
  Medium: '#ca8a04',
  Low: '#ea580c',
  Insufficient: '#94a3b8',
};

const VER_COLORS: Record<string, string> = {
  v1: '#94a3b8',
  v1_1: '#60a5fa',
  v1_2: '#34d399',
  v2_0: '#2563eb',
};

// ── Component ─────────────────────────────────────────────────────────────

export default function AccuracyClient() {
  const searchParams = useSearchParams();

  const isDemo = searchParams.get('demo') === '1';

  const [data, setData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [predictionType, setPredictionType] = useState<string>(searchParams.get('predictionType') || 'intake');
  const [category, setCategory] = useState<string>(searchParams.get('category') || '');
  const [confidenceLevel, setConfidenceLevel] = useState<string>(searchParams.get('confidenceLevel') || '');
  const [modelVersion, setModelVersion] = useState<string>(searchParams.get('modelVersion') || '');
  const [fromDate, setFromDate] = useState<string>(searchParams.get('fromDate') || '');
  const [toDate, setToDate] = useState<string>(searchParams.get('toDate') || '');

  const [activeDemoPreset, setActiveDemoPreset] = useState<number | null>(null);

  const fetchData = useCallback(
    async (overrides?: Record<string, string>) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      const p = { predictionType, category, confidenceLevel, modelVersion, fromDate, toDate, ...overrides };
      Object.entries(p).forEach(([k, v]) => { if (v) params.set(k, v); });
      try {
        const res = await fetch(`/api/accuracy?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    },
    [predictionType, category, confidenceLevel, modelVersion, fromDate, toDate],
  );

  useEffect(() => { fetchData(); }, [fetchData]);

  function applyDemoPreset(idx: number) {
    const preset = DEMO_PRESETS[idx];
    setActiveDemoPreset(idx);
    const p = preset.params as Record<string, string>;
    if (p.confidenceLevel !== undefined) setConfidenceLevel(p.confidenceLevel);
    if (p.modelVersion !== undefined) setModelVersion(p.modelVersion);
    fetchData(p);
  }

  function clearFilters() {
    setCategory('');
    setConfidenceLevel('');
    setModelVersion('');
    setFromDate('');
    setToDate('');
    setActiveDemoPreset(null);
    fetchData({ category: '', confidenceLevel: '', modelVersion: '', fromDate: '', toDate: '' });
  }

  const categories = data?.byCategory.map((r) => r.category) ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {isDemo && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
            <span className="text-xs font-semibold text-amber-700">Demo presets:</span>
            {DEMO_PRESETS.map((preset, i) => (
              <button
                key={i}
                onClick={() => applyDemoPreset(i)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeDemoPreset === i
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-amber-700 ring-1 ring-amber-300 hover:bg-amber-100'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Prediction Accuracy</h1>
          <p className="mt-1 text-sm text-slate-500">
            How well AI fee estimates matched actual invoices across {data?.summary.totalPredictions ?? '…'} closed matters.
          </p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <FilterSelect
            label="Type"
            value={predictionType}
            onChange={(v) => { setPredictionType(v); }}
            options={[{ value: 'intake', label: 'Intake' }, { value: 'forecast', label: 'Forecast' }]}
          />
          <FilterSelect
            label="Category"
            value={category}
            onChange={(v) => { setCategory(v); }}
            options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
          <FilterSelect
            label="Confidence"
            value={confidenceLevel}
            onChange={(v) => { setConfidenceLevel(v); }}
            options={[
              { value: '', label: 'All' },
              { value: 'High', label: 'High' },
              { value: 'Medium', label: 'Medium' },
              { value: 'Low', label: 'Low' },
              { value: 'Insufficient', label: 'Insufficient' },
            ]}
          />
          <FilterSelect
            label="Model"
            value={modelVersion}
            onChange={(v) => { setModelVersion(v); }}
            options={[
              { value: '', label: 'All versions' },
              ...Object.entries(MODEL_VERSIONS).map(([k, v]) => ({ value: k, label: v.name })),
            ]}
          />
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => fetchData()}
            className="h-8 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Apply
          </button>
          <button
            onClick={clearFilters}
            className="h-8 rounded-md border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>

        {loading && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Error loading data: {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            {/* ── Summary stat cards ── */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Predictions" value={String(data.summary.totalPredictions)} />
              <StatCard label="Median Error" value={fmtPct(data.summary.medianErrorPercent)} highlight />
              <StatCard label="Mean Error" value={fmtPct(data.summary.meanErrorPercent)} />
              <StatCard label="Within P25-P75" value={fmtPct(data.summary.withinRangePercent)} good />
              <StatCard label="Overprediction" value={fmtPct(data.summary.overpredictionRate)} />
              <StatCard label="Underprediction" value={fmtPct(data.summary.underpredictionRate)} />
            </div>

            {/* ── Two-column: scatter + time series ── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Scatter: predicted vs actual */}
              <ChartCard title="Predicted vs. Actual" subtitle="Each dot is one closed matter. Dots on the line = perfect prediction.">
                {data.scatterData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <XAxis
                        dataKey="predicted"
                        name="Predicted"
                        tickFormatter={fmtK}
                        tick={{ fontSize: 10 }}
                        label={{ value: 'Predicted ($)', position: 'insideBottom', offset: -2, fontSize: 10 }}
                      />
                      <YAxis
                        dataKey="actual"
                        name="Actual"
                        tickFormatter={fmtK}
                        tick={{ fontSize: 10 }}
                        label={{ value: 'Actual ($)', angle: -90, position: 'insideLeft', offset: 8, fontSize: 10 }}
                      />
                      <Tooltip
                        content={({ payload }) => {
                          if (!payload?.length) return null;
                          const d = payload[0].payload as ScatterPoint;
                          return (
                            <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-md">
                              <p className="font-semibold">{d.matterName}</p>
                              <p>Predicted: {fmtK(d.predicted)}</p>
                              <p>Actual: {fmtK(d.actual)}</p>
                              <p>Error: {fmtPct(d.errorPercent)}</p>
                              <p className="text-slate-400">{d.category}</p>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.max(...data.scatterData.map((d) => Math.max(d.predicted, d.actual))), y: Math.max(...data.scatterData.map((d) => Math.max(d.predicted, d.actual))) }]} stroke="#94a3b8" strokeDasharray="3 3" />
                      <Scatter
                        data={data.scatterData}
                        fill="#2563eb"
                        opacity={0.6}
                        shape={(props: { cx?: number; cy?: number; payload?: ScatterPoint }) => {
                          const { cx = 0, cy = 0, payload } = props;
                          const color = payload?.isWithinRange ? '#16a34a' : '#2563eb';
                          return <circle cx={cx} cy={cy} r={3.5} fill={color} opacity={0.65} />;
                        }}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart />
                )}
                <p className="mt-1 text-[10px] text-slate-400">Green = within P25-P75 range</p>
              </ChartCard>

              {/* Time series: median error over time */}
              <ChartCard title="Median Error Over Time" subtitle="Monthly median prediction error — lower is better.">
                {data.timeSeries.length > 1 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={data.timeSeries} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(2)} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        formatter={(v: unknown, name: unknown) => { const n = v as number; const s = name as string; return [`${n.toFixed(1)}%`, s === 'medianError' ? 'Median Error' : 'Mean Error']; }}
                        labelFormatter={(l) => `Month: ${l}`}
                      />
                      <Legend formatter={(v) => (v === 'medianError' ? 'Median Error' : 'Mean Error')} iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="medianError" stroke="#2563eb" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="meanError" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart />
                )}
              </ChartCard>
            </div>

            {/* ── Model version improvement chart ── */}
            {data.byModelVersion.length > 0 && (
              <ChartCard
                title="Model Version Improvement"
                subtitle="Median error by model version — shows how prediction accuracy improved over releases."
              >
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data.byModelVersion} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(v: unknown) => { const n = v as number; return [`${n.toFixed(1)}%`]; }} />
                      <Bar dataKey="medianError" radius={[4, 4, 0, 0]}>
                        {data.byModelVersion.map((entry) => (
                          <Cell key={entry.modelVersion} fill={VER_COLORS[entry.modelVersion] ?? '#94a3b8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Version changelog */}
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Version Changelog</h3>
                    <ul className="space-y-2">
                      {Object.entries(MODEL_VERSIONS)
                        .sort((a, b) => a[1].releasedAt.localeCompare(b[1].releasedAt))
                        .map(([key, ver]) => (
                          <li key={key} className="flex items-start gap-2">
                            <span
                              className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: VER_COLORS[key] ?? '#94a3b8' }}
                            />
                            <div>
                              <span className="text-xs font-semibold text-slate-700">{ver.name}</span>
                              <span className="ml-1.5 text-[10px] text-slate-400">~{ver.expectedMedianError}% error</span>
                              <p className="text-[10px] text-slate-500">{ver.description}</p>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              </ChartCard>
            )}

            {/* ── Three-column: confidence + fallback + category table ── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr_2fr]">
              {/* By Confidence */}
              <ChartCard title="By Confidence Level" subtitle="Error by prediction confidence.">
                {data.byConfidence.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data.byConfidence} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 64 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                      <YAxis type="category" dataKey="confidence" tick={{ fontSize: 11 }} width={64} />
                      <Tooltip formatter={(v: unknown) => { const n = v as number; return [`${n.toFixed(1)}%`, 'Median Error']; }} />
                      <Bar dataKey="medianError" radius={[0, 4, 4, 0]}>
                        {data.byConfidence.map((entry) => (
                          <Cell key={entry.confidence} fill={CONF_COLORS[entry.confidence] ?? '#94a3b8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart />
                )}
              </ChartCard>

              {/* By Fallback Level */}
              <ChartCard title="By Fallback Level" subtitle="Error by how many filters were dropped.">
                {data.byFallbackLevel.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data.byFallbackLevel} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 72 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={72} />
                      <Tooltip formatter={(v: unknown) => { const n = v as number; return [`${n.toFixed(1)}%`, 'Median Error']; }} />
                      <Bar dataKey="medianError" fill="#60a5fa" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart />
                )}
              </ChartCard>

              {/* By Category table */}
              <ChartCard title="By Practice Area" subtitle="Click a row to filter by category.">
                {data.byCategory.length > 0 ? (
                  <div className="overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="pb-2 text-left font-semibold text-slate-400">Category</th>
                          <th className="pb-2 text-right font-semibold text-slate-400">N</th>
                          <th className="pb-2 text-right font-semibold text-slate-400">Med. Error</th>
                          <th className="pb-2 text-right font-semibold text-slate-400">In Range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byCategory.map((row) => (
                          <tr
                            key={row.category}
                            onClick={() => { setCategory(row.category === category ? '' : row.category); }}
                            className={`cursor-pointer border-b border-slate-50 transition-colors hover:bg-blue-50 ${row.category === category ? 'bg-blue-50 font-semibold' : ''}`}
                          >
                            <td className="py-1.5 text-slate-700">{row.category}</td>
                            <td className="py-1.5 text-right text-slate-500">{row.count}</td>
                            <td className={`py-1.5 text-right ${row.medianError > 30 ? 'text-red-600' : row.medianError > 20 ? 'text-amber-600' : 'text-green-600'}`}>
                              {fmtPct(row.medianError)}
                            </td>
                            <td className="py-1.5 text-right text-slate-500">{fmtPct(row.withinRangePct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No data</p>
                )}
              </ChartCard>
            </div>

            {/* Disclaimer */}
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
              Predictions are computed using a cascading filter on historical invoice data. Accuracy metrics reflect simulated intake predictions for closed matters. Model version assignment is based on when each matter was opened.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small components ───────────────────────────────────────────────────────

function StatCard({ label, value, highlight, good }: { label: string; value: string; highlight?: boolean; good?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${highlight ? 'text-blue-600' : good ? 'text-green-600' : 'text-slate-900'}`}>
        {value}
      </p>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <p className="mb-3 text-[10px] text-slate-400">{subtitle}</p>
      {children}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-32 items-center justify-center text-xs text-slate-400">
      No data available
    </div>
  );
}
