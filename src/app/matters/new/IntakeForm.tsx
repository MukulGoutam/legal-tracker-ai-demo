'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import SuggestionCard from '@/components/SuggestionCard';
import DataSufficiencyAlert from '@/components/DataSufficiencyAlert';
import MethodologyPopover from '@/components/MethodologyPopover';
import PredictionExplainer from '@/components/PredictionExplainer';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import type { ConfidenceLevel } from '@/lib/confidence';
import {
  bandExposure,
  bandLabel,
  tierJurisdiction,
  tierLabel,
  LIABILITY_ESTIMATES,
  type LiabilityEstimate,
} from '@/lib/matter-taxonomy';

// ── AI parse types ─────────────────────────────────────────────────────────────

interface ParsedMatter {
  name?: string;
  substantiveLaw?: string;
  category?: string;
  liabilityEstimate?: string | null;
  jurisdiction?: string | null;
  description?: string;
  extractionNotes?: string;
}

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

// ── Taxonomy ───────────────────────────────────────────────────────────────────

const SUBSTANTIVE_LAWS = ['Litigation', 'IP', 'Employment', 'Corporate'] as const;
type SubstantiveLaw = (typeof SUBSTANTIVE_LAWS)[number];

const CATEGORY_MAP: Record<SubstantiveLaw, readonly string[]> = {
  Litigation: ['Commercial Litigation', 'Employment Litigation', 'IP Litigation', 'Product Liability'],
  IP:         ['Patent Prosecution', 'Trademark'],
  Employment: ['Advice & Counseling'],
  Corporate:  ['M&A'],
};

// ── Demo quick-fill cases ──────────────────────────────────────────────────────

type DemoConfig = {
  substantiveLaw: string;
  category: string;
  exposureAmount: string;
  liabilityEstimate: LiabilityEstimate;
  jurisdiction: string;
};

const DEMO_CASES: { label: string; desc: string; config: DemoConfig }[] = [
  {
    label: '🎯 Case A — High Confidence',
    desc: 'Expect: Level 1, High confidence',
    config: {
      substantiveLaw: 'Litigation',
      category: 'Commercial Litigation',
      exposureAmount: '2000000',
      liabilityEstimate: 'Reasonably Possible',
      jurisdiction: 'US - Federal - S.D.N.Y.',
    },
  },
  {
    label: '📈 Case B — 10x Exposure',
    desc: 'Expect: ~2.5x higher prediction',
    config: {
      substantiveLaw: 'Litigation',
      category: 'Commercial Litigation',
      exposureAmount: '20000000',
      liabilityEstimate: 'Reasonably Possible',
      jurisdiction: 'US - Federal - S.D.N.Y.',
    },
  },
  {
    label: '⚠️ Case C — Sparse Data',
    desc: 'Expect: fallback filters, Low confidence',
    config: {
      substantiveLaw: 'Litigation',
      category: 'Product Liability',
      exposureAmount: '15000000',
      liabilityEstimate: 'Remote',
      jurisdiction: 'US - Federal - D. Del.',
    },
  },
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface SuggestionResponse {
  estimatedFees: { p25: number; p50: number; p75: number };
  estimatedDurationDays: { p25: number; p50: number; p75: number };
  confidence: ConfidenceLevel;
  sampleSize: number;
  fallbackNote: string | null;
  methodology: string;
  filtersApplied: string[];
  filtersDropped: string[];
  fallbackLevel: 1 | 2 | 3 | 4 | 5;
  driverBreakdown: {
    baseCategoryMedian: number;
    exposureAdjustment: number;
    liabilityAdjustment: number;
    jurisdictionAdjustment: number;
    finalEstimate: number;
  };
  _meta: { generatedAt: string; sampleSize: number; disclaimer: string; methodology: string };
}

type FetchedFor = {
  substantiveLaw: string;
  category: string;
  exposureAmount: string;
  liabilityEstimate: string;
  jurisdiction: string;
  estimatedResolutionDate: string;
};

type SuggestionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: SuggestionResponse; fetchedFor: FetchedFor };

// ── Formatters ─────────────────────────────────────────────────────────────────

const _currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function fmtFees(n: number): string {
  return _currencyFmt.format(n);
}

function fmtMonths(n: number): string {
  const mo = Math.max(1, Math.round(n / 30.44));
  return `${mo} mo`;
}

// ── Shared style constants ─────────────────────────────────────────────────────

const inputBase =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ' +
  'transition-colors';

// ── Field wrapper ──────────────────────────────────────────────────────────────

function Field({
  id,
  label,
  required = false,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// ── Section row (TR Legal Tracker style) ──────────────────────────────────────

function SectionRow({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[32%_1fr] items-start gap-4 px-4 py-3.5">
      <div className="flex items-center justify-end gap-1 pt-1.5">
        <span className="text-right text-sm font-medium text-slate-600">{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger
              type="button"
              className="shrink-0 text-slate-400 hover:text-slate-500"
              aria-label={`Help: ${label}`}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px] text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

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
      <path
        fill="currentColor"
        className="opacity-75"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function IntakeForm({ demoMode = false }: { demoMode?: boolean }) {
  const router = useRouter();

  // Core fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [substantiveLaw, setSubstantiveLaw] = useState('');
  const [category, setCategory] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');

  // Financial context fields
  const [exposureAmount, setExposureAmount] = useState('');
  const [liabilityEstimate, setLiabilityEstimate] = useState<LiabilityEstimate | ''>('');
  const [estimatedResolutionDate, setEstimatedResolutionDate] = useState('');
  const insurerInvolved = false;

  // Suggestion + submit state
  const [suggestion, setSuggestion] = useState<SuggestionState>({ status: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // AI parse state
  const [parseText, setParseText] = useState('');
  const [parseState, setParseState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [parsedFields, setParsedFields] = useState<ParsedMatter | null>(null);

  // AI narrative state
  const [narrative, setNarrative] = useState('');
  const [narrativeStreaming, setNarrativeStreaming] = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────

  const availableCategories =
    substantiveLaw in CATEGORY_MAP ? CATEGORY_MAP[substantiveLaw as SubstantiveLaw] : [];
  const canGetSuggestions = substantiveLaw !== '' && category !== '';
  const canCreate = name.trim() !== '' && substantiveLaw !== '' && category !== '';

  const derivedBand = exposureAmount !== '' ? bandExposure(Number(exposureAmount)) : null;
  const derivedTier = jurisdiction.trim() ? tierJurisdiction(jurisdiction.trim()) : null;

  const isStale =
    suggestion.status === 'success' &&
    (suggestion.fetchedFor.substantiveLaw !== substantiveLaw ||
      suggestion.fetchedFor.category !== category ||
      suggestion.fetchedFor.exposureAmount !== exposureAmount ||
      suggestion.fetchedFor.liabilityEstimate !== liabilityEstimate ||
      suggestion.fetchedFor.jurisdiction !== jurisdiction ||
      suggestion.fetchedFor.estimatedResolutionDate !== estimatedResolutionDate);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleLawChange(val: string) {
    setSubstantiveLaw(val);
    const cats = val in CATEGORY_MAP ? CATEGORY_MAP[val as SubstantiveLaw] : [];
    setCategory(cats.length === 1 ? cats[0] : '');
  }

  async function doFetchSuggestions(values: FetchedFor) {
    setSuggestion({ status: 'loading' });
    try {
      const body: Record<string, unknown> = {
        substantiveLaw: values.substantiveLaw,
        category: values.category,
      };
      if (values.exposureAmount !== '') body.exposureAmount = Number(values.exposureAmount);
      if (values.liabilityEstimate !== '') body.liabilityEstimate = values.liabilityEstimate;
      if (values.jurisdiction.trim() !== '') body.jurisdiction = values.jurisdiction.trim();
      if (values.estimatedResolutionDate !== '') body.estimatedResolutionDate = values.estimatedResolutionDate;

      const res = await fetch('/api/suggest-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? `Server error (${res.status})`);
      }
      const data = (await res.json()) as SuggestionResponse;
      setSuggestion({ status: 'success', data, fetchedFor: values });
    } catch (err) {
      setSuggestion({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to load suggestions',
      });
    }
  }

  async function handleGetSuggestions() {
    if (!canGetSuggestions) return;
    await doFetchSuggestions({
      substantiveLaw, category, exposureAmount, liabilityEstimate, jurisdiction, estimatedResolutionDate,
    });
  }

  async function handleParse() {
    if (!parseText.trim() || parseState === 'loading') return;
    setParseState('loading');
    setParsedFields(null);
    try {
      const res = await fetch('/api/ai/parse-matter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: parseText }),
      });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data = (await res.json()) as ParsedMatter;
      setParsedFields(data);

      // Fill form fields
      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
      if (data.jurisdiction) setJurisdiction(data.jurisdiction);
      if (data.liabilityEstimate && data.liabilityEstimate !== 'null')
        setLiabilityEstimate(data.liabilityEstimate as LiabilityEstimate);

      // Law + category cascade
      const lawVal = data.substantiveLaw ?? '';
      const catVal = data.category ?? '';
      if (lawVal) {
        handleLawChange(lawVal);
        if (catVal) setCategory(catVal);
      }

      setParseState('done');

      // Auto-trigger suggestions if law + category filled
      if (lawVal && catVal) {
        await doFetchSuggestions({
          substantiveLaw: lawVal,
          category: catVal,
          exposureAmount,
          liabilityEstimate: (data.liabilityEstimate ?? liabilityEstimate) as LiabilityEstimate | '',
          jurisdiction: data.jurisdiction ?? jurisdiction,
          estimatedResolutionDate,
        });
      }
    } catch {
      setParseState('error');
    }
  }

  // Stream narrative when suggestion succeeds
  useEffect(() => {
    if (suggestion.status !== 'success') return;
    const d = suggestion.data;
    void streamInto(
      '/api/ai/explain',
      {
        type: 'intake',
        context: {
          category: suggestion.fetchedFor.category,
          sampleSize: d.sampleSize,
          confidence: d.confidence,
          filtersApplied: d.filtersApplied,
          filtersDropped: d.filtersDropped,
          estimatedFees: d.estimatedFees,
          driverBreakdown: d.driverBreakdown,
        },
      },
      setNarrative,
      setNarrativeStreaming,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion.status === 'success' ? suggestion.data : null]);

  async function fillAndSuggest(config: DemoConfig) {
    setSubstantiveLaw(config.substantiveLaw);
    setCategory(config.category);
    setExposureAmount(config.exposureAmount);
    setLiabilityEstimate(config.liabilityEstimate);
    setJurisdiction(config.jurisdiction);
    await new Promise((r) => setTimeout(r, 300));
    await doFetchSuggestions({
      substantiveLaw: config.substantiveLaw,
      category: config.category,
      exposureAmount: config.exposureAmount,
      liabilityEstimate: config.liabilityEstimate,
      jurisdiction: config.jurisdiction,
      estimatedResolutionDate: '',
    });
  }

  async function handleCreate() {
    if (!canCreate || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        substantiveLaw,
        category,
        jurisdiction: jurisdiction.trim() || undefined,
        estimatedValue: estimatedValue !== '' ? Number(estimatedValue) : undefined,
        insurerInvolved,
      };
      if (exposureAmount !== '') body.exposureAmount = Number(exposureAmount);
      if (liabilityEstimate !== '') body.liabilityEstimate = liabilityEstimate;
      if (estimatedResolutionDate !== '') body.estimatedResolutionDate = estimatedResolutionDate;

      const res = await fetch('/api/matters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? `Server error (${res.status})`);
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/matters/${id}/forecast`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create matter');
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    {/* ─── Demo Quick-Fill panel (fixed overlay) ────────────────────────────── */}
    {demoMode && (
      <div className="fixed right-4 top-24 z-50 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
        <h3 className="text-sm font-semibold text-slate-800">🎬 Demo Quick-Fill</h3>
        <div className="mt-3 space-y-3">
          {DEMO_CASES.map((c) => (
            <div key={c.label}>
              <button
                type="button"
                onClick={() => fillAndSuggest(c.config)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                {c.label}
              </button>
              <p className="mt-0.5 px-1 text-xs text-slate-400">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    )}

    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
      {/* ─── Left column: form ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Matter Details</h2>
        <p className="mt-0.5 text-xs text-slate-500">Fields marked * are required</p>

        {/* ─── AI Parse Section ────────────────────────────────────────────── */}
        <div className="mt-5 rounded-lg border border-violet-100 bg-violet-50 p-4">
          <p className="text-xs font-semibold text-violet-700">✨ Describe your matter (optional)</p>
          <p className="mt-0.5 text-[10px] text-violet-500">Paste a description, email, or case summary — AI will auto-fill the form fields below.</p>
          <textarea
            rows={3}
            placeholder="e.g. Our client is a software company facing a patent infringement claim from a competitor in the Northern District of California..."
            value={parseText}
            onChange={(e) => setParseText(e.target.value)}
            className="mt-2 block w-full resize-none rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-xs">
              {parseState === 'done' && parsedFields && (
                <span className="text-green-700">
                  Filled: {[
                    parsedFields.name && 'name',
                    parsedFields.substantiveLaw && 'law',
                    parsedFields.category && 'category',
                    parsedFields.jurisdiction && 'jurisdiction',
                  ].filter(Boolean).join(', ')} ✓
                </span>
              )}
              {parseState === 'error' && (
                <span className="text-red-600">Failed to parse — try again</span>
              )}
              {parsedFields?.extractionNotes && (
                <span className="text-slate-400"> · {parsedFields.extractionNotes}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleParse()}
              disabled={!parseText.trim() || parseState === 'loading'}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {parseState === 'loading' ? (
                <><Spinner className="text-white/70" /> Parsing…</>
              ) : (
                'Auto-fill with AI →'
              )}
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {/* Name */}
          <Field id="name" label="Matter Name" required>
            <input
              id="name"
              type="text"
              autoComplete="off"
              placeholder="e.g. Acme Corp v. Beta LLC"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputBase}
            />
          </Field>

          {/* Description */}
          <Field id="description" label="Description">
            <textarea
              id="description"
              rows={3}
              placeholder="Brief description of the matter (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputBase} resize-none`}
            />
          </Field>

          {/* Substantive Law */}
          <Field id="substantiveLaw" label="Substantive Law" required>
            <select
              id="substantiveLaw"
              value={substantiveLaw}
              onChange={(e) => handleLawChange(e.target.value)}
              className={inputBase}
            >
              <option value="">Select law area…</option>
              {SUBSTANTIVE_LAWS.map((law) => (
                <option key={law} value={law}>
                  {law}
                </option>
              ))}
            </select>
          </Field>

          {/* Category */}
          <Field id="category" label="Category" required>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={availableCategories.length === 0}
              className={inputBase}
            >
              <option value="">
                {substantiveLaw ? 'Select category…' : 'Select a law area first'}
              </option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* ─── Financial & Legal Context ───────────────────────────────────── */}
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
          <div className="border-l-4 border-blue-500 bg-slate-50 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Financial &amp; Legal Context
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {/* 1. Exposure Amount */}
            <SectionRow
              label="Exposure Amount"
              tooltip="The potential dollar amount at risk. Used to calibrate fee estimates — a $50M exposure typically drives higher spend than a $500K matter."
            >
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                  $
                </span>
                <input
                  id="exposureAmount"
                  type="number"
                  min="0"
                  step="100000"
                  placeholder="0"
                  value={exposureAmount}
                  onChange={(e) => setExposureAmount(e.target.value)}
                  className={`${inputBase} pl-7`}
                />
              </div>
              {derivedBand && (
                <p className="mt-1 text-xs text-slate-500">
                  Band:{' '}
                  <span className="font-medium text-slate-700">{bandLabel(derivedBand)}</span>
                </p>
              )}
            </SectionRow>

            {/* 2. Liability Estimate */}
            <SectionRow
              label="Liability Estimate"
              tooltip="Your current assessment of the likely outcome. 'Remote' matters tend to cost more due to extended litigation effort."
            >
              <RadioGroup
                value={liabilityEstimate}
                onValueChange={(v) => setLiabilityEstimate(v as LiabilityEstimate)}
                className="flex flex-wrap gap-x-4 gap-y-2"
              >
                {LIABILITY_ESTIMATES.map((opt) => (
                  <div key={opt} className="flex items-center gap-1.5">
                    <RadioGroupItem value={opt} id={`liability-${opt}`} className="h-3.5 w-3.5" />
                    <label
                      htmlFor={`liability-${opt}`}
                      className="cursor-pointer text-sm text-slate-700"
                    >
                      {opt}
                    </label>
                  </div>
                ))}
              </RadioGroup>
              {liabilityEstimate && (
                <p className="mt-1 text-xs italic text-slate-400">Required 20/9/2026</p>
              )}
            </SectionRow>

            {/* 3. Insurer / Reinsurer */}
            <SectionRow
              label="Insurer / Reinsurer"
              tooltip="Track insurer involvement. Full insurer management is coming in a future release."
            >
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  aria-disabled="true"
                  className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
                >
                  Select insurer…
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-500">
                    Coming soon
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  Insurer management will be available in a future release
                </TooltipContent>
              </Tooltip>
            </SectionRow>

            {/* 4. Estimated Date of Resolution */}
            <SectionRow
              label="Est. Resolution Date"
              tooltip="Expected resolution date. Longer timelines correlate with higher total fees."
            >
              <input
                id="estimatedResolutionDate"
                type="date"
                value={estimatedResolutionDate}
                onChange={(e) => setEstimatedResolutionDate(e.target.value)}
                className={inputBase}
              />
            </SectionRow>

            {/* 5. Budget Approval Route */}
            <SectionRow
              label="Budget Approval Route"
              tooltip="Approval workflow for this matter's budget. Configurable at the organisation level."
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700">Default</span>
                <button
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-400"
                >
                  Change…
                </button>
              </div>
              <p className="mt-1 text-xs italic text-slate-400">
                Approval routing is configured by your legal ops administrator.
              </p>
            </SectionRow>
          </div>
        </div>

        {/* ─── Get AI Suggestions ──────────────────────────────────────────── */}
        <div className="mt-5">
          <button
            type="button"
            onClick={handleGetSuggestions}
            disabled={!canGetSuggestions || suggestion.status === 'loading'}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {suggestion.status === 'loading' ? (
              <>
                <Spinner />
                Fetching suggestions…
              </>
            ) : (
              '✦ Get AI Suggestions'
            )}
          </button>
          {!canGetSuggestions && (
            <p className="mt-1.5 text-center text-xs text-slate-400">
              Select a law area and category to enable
            </p>
          )}
        </div>

        <hr className="mt-5 border-slate-100" />

        <div className="mt-5 space-y-5">
          {/* Jurisdiction */}
          <Field id="jurisdiction" label="Jurisdiction">
            <input
              id="jurisdiction"
              type="text"
              placeholder="e.g. US — Federal — S.D.N.Y."
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className={inputBase}
            />
            {derivedTier && (
              <p className="mt-1 text-xs text-slate-500">
                Tier:{' '}
                <span className="font-medium text-slate-700">{tierLabel(derivedTier)}</span>
              </p>
            )}
          </Field>

          {/* Estimated Value */}
          <Field
            id="estimatedValue"
            label="Estimated Matter Value"
            hint="Optional — used for internal tracking only"
          >
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                $
              </span>
              <input
                id="estimatedValue"
                type="number"
                min="0"
                step="1000"
                placeholder="0"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                className={`${inputBase} pl-7`}
              />
            </div>
          </Field>
        </div>

        {/* Demo hint */}
        {demoMode && (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            💡 Try selecting <strong>Litigation → Product Liability</strong> to see the data-sufficiency guardrail — notice the amber fallback alert and lower confidence badge.
          </p>
        )}

        {/* Submit error */}
        {submitError && (
          <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {submitError}
          </p>
        )}

        {/* Create Matter */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Spinner className="text-white/70" />
                Creating matter…
              </>
            ) : (
              'Create Matter →'
            )}
          </button>
          {!canCreate && !submitting && (
            <p className="mt-2 text-center text-xs text-slate-400">
              Name, law area, and category are required
            </p>
          )}
        </div>
      </div>

      {/* ─── Right column: suggestions panel ────────────────────────────────── */}
      <div className="lg:sticky lg:top-6 space-y-3">
        {isStale && (
          <div className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            <span aria-hidden="true">⟳</span>
            <span>Inputs changed — click &lsquo;Get AI Suggestions&rsquo; to refresh</span>
          </div>
        )}
        <SuggestionsPanel
          state={suggestion}
          isStale={isStale}
          onRefetch={handleGetSuggestions}
          narrative={narrative}
          narrativeStreaming={narrativeStreaming}
        />
      </div>
    </div>
    </>
  );
}

// ── Suggestions panel ──────────────────────────────────────────────────────────

interface SuggestionsPanelProps {
  state: SuggestionState;
  isStale: boolean;
  onRefetch: () => void;
  narrative: string;
  narrativeStreaming: boolean;
}

function SuggestionsPanel({ state, isStale, onRefetch, narrative, narrativeStreaming }: SuggestionsPanelProps) {
  if (state.status === 'idle') {
    return (
      <div className="space-y-4">
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-8 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-500">
            <span className="text-lg leading-none">✦</span>
          </div>
          <h3 className="mt-3 text-sm font-medium text-slate-700">No suggestions yet</h3>
          <p className="mt-1 max-w-[200px] text-xs leading-relaxed text-slate-400">
            Select a law area and category, then click{' '}
            <span className="font-medium text-slate-500">&ldquo;Get AI Suggestions&rdquo;</span>
          </p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
          <span className="font-medium">💡 Tip:</span> For a more precise prediction, fill in
          exposure amount, liability estimate, and jurisdiction. Skipping any of these will still
          work — we&apos;ll just use broader historical averages.
        </div>
      </div>
    );
  }

  if (state.status === 'loading') {
    return <SuggestionsSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm">
        <p className="font-medium text-red-800">Failed to load suggestions</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          type="button"
          onClick={onRefetch}
          className="mt-3 text-xs text-red-700 underline underline-offset-2 hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const { data } = state;
  const usedFallback = data.fallbackLevel > 1;

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-blue-900">Data-Driven Suggestions</h2>
            <p className="mt-0.5 text-xs text-blue-700">
              Based on historical matters in Legal Tracker
            </p>
          </div>
          {isStale && (
            <button
              type="button"
              onClick={onRefetch}
              className="shrink-0 rounded text-xs font-medium text-blue-600 underline underline-offset-2 hover:no-underline"
            >
              Refresh
            </button>
          )}
        </div>
        {isStale && (
          <p className="mt-2 text-xs text-amber-700">
            ↻ Your selection changed — refresh to update suggestions
          </p>
        )}
      </div>

      {/* Fallback alert */}
      <DataSufficiencyAlert
        usedFallback={usedFallback}
        fallbackNote={data.fallbackNote}
        sampleSize={data.sampleSize}
      />

      {/* Fees card */}
      <SuggestionCard
        title="Estimated Lifetime Fees"
        range={data.estimatedFees}
        confidenceLevel={data.confidence}
        sampleSize={data.sampleSize}
        methodology={data.methodology}
        methodologyDetails={{ sampleSize: data.sampleSize }}
        formatter={fmtFees}
      />

      {/* Duration card */}
      <SuggestionCard
        title="Estimated Duration"
        range={data.estimatedDurationDays}
        confidenceLevel={data.confidence}
        sampleSize={data.sampleSize}
        methodology={data.methodology}
        methodologyDetails={{
          sampleSize: data.sampleSize,
          method: 'Median (P50) with P25/P75 range — displayed in calendar months',
        }}
        formatter={fmtMonths}
      />

      {/* Prediction explainer */}
      <PredictionExplainer
        driverBreakdown={data.driverBreakdown}
        filtersApplied={data.filtersApplied}
        filtersDropped={data.filtersDropped}
        fallbackLevel={data.fallbackLevel}
        sampleSize={data.sampleSize}
        fallbackNote={data.fallbackNote}
      />

      {/* AI narrative */}
      {(narrative || narrativeStreaming) && (
        <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-500">
            ✨ AI Insight
          </p>
          <p className="text-xs leading-relaxed text-violet-900">
            {narrative}
            {narrativeStreaming && <span className="animate-pulse">▋</span>}
          </p>
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between px-1 text-xs text-slate-500">
        <span>
          Based on {data.sampleSize.toLocaleString()} similar{' '}
          {data.sampleSize === 1 ? 'matter' : 'matters'}
        </span>
        <MethodologyPopover
          methodology={data.methodology}
          details={{ sampleSize: data.sampleSize }}
        />
      </div>

      {/* Footer disclaimer */}
      <p className="text-center text-xs italic text-slate-400">
        Suggestions are statistical, based on historical data. Not a trained ML model.
      </p>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function SuggestionsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading suggestions">
      {/* Panel header skeleton */}
      <div className="animate-pulse rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="h-4 w-44 rounded bg-slate-200" />
        <div className="mt-2 h-3 w-56 rounded bg-slate-200" />
      </div>

      {/* Suggestion card skeletons */}
      {[0, 1].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between">
            <div className="h-4 w-36 rounded bg-slate-200" />
            <div className="h-5 w-14 rounded-full bg-slate-200" />
          </div>
          <div className="mt-3 h-8 w-32 rounded bg-slate-200" />
          <div className="mt-1.5 h-3 w-20 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-28 rounded bg-slate-200" />
          <div className="mt-3 h-1.5 w-full rounded-full bg-slate-200" />
          <div className="mt-4 h-3 w-32 rounded bg-slate-200" />
        </div>
      ))}

      {/* PredictionExplainer skeleton */}
      <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="h-4 w-4 rounded bg-slate-200" />
        </div>
        <div className="mt-4 flex gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-2 flex-1 rounded-full bg-slate-200" />
          ))}
        </div>
        <div className="mt-2 h-3 w-32 rounded bg-slate-200" />
        <div className="mt-1 h-3 w-48 rounded bg-slate-200" />
        <div className="mt-3 flex gap-1.5">
          <div className="h-5 w-20 rounded bg-slate-200" />
          <div className="h-5 w-24 rounded bg-slate-200" />
        </div>
        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="h-3 w-28 rounded bg-slate-200" />
                <div className="h-2.5 w-36 rounded bg-slate-200" />
              </div>
              <div className="h-3 w-16 rounded bg-slate-200" />
            </div>
          ))}
          <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
            <div className="h-4 w-32 rounded bg-slate-200" />
            <div className="h-5 w-20 rounded bg-slate-200" />
          </div>
        </div>
      </div>

      {/* Footer skeleton */}
      <div className="flex animate-pulse items-center justify-between px-1">
        <div className="h-3 w-40 rounded bg-slate-200" />
        <div className="h-3 w-28 rounded bg-slate-200" />
      </div>
    </div>
  );
}
