@AGENTS.md

# Legal Tracker AI — Project Context for Claude

## What this project is

A Next.js 16 App Router demo app for AI-augmented legal matter management. It has four connected features:

1. **Intake** (`/matters/new`) — statistical fee prediction + Claude smart parsing + streaming narrative
2. **Forecast** (`/matters/[id]/forecast`) — phase/task budget from historical peers + Claude commentary
3. **Firm Selection** (`/matters/[id]/firms`) — ranks outside counsel using 4 operational metrics
4. **Accuracy Dashboard** (`/accuracy`) — tracks prediction accuracy over time with Recharts visualisations

The statistical prediction engine (`src/lib/suggestions.ts`) is the core. Claude (`claude-haiku-4-5-20251001`) augments it at three layers but never replaces it.

---

## Key architectural decisions

### Server vs client split
- `app/` pages default to **server components** — they query Prisma directly and pass serialised props down
- Interactive islands are `'use client'` components: `IntakeForm`, `ForecastClient`, `AccuracyClient`, `DeviationExplanation`
- `DeviationExplanation` is a client island embedded inside a server component page (`matters/[id]/page.tsx`) — do not convert the page to a client component

### Streaming responses
- `/api/ai/explain` returns `text/plain` via `ReadableStream` — do not convert to JSON
- Client consumers use `response.body.getReader()` + `TextDecoder` with an accumulator pattern (see `streamInto()` in `IntakeForm.tsx` or `ForecastClient.tsx`)
- The blinking cursor pattern is `<span className="animate-pulse">▋</span>` inline after the streamed text

### Prisma
- `PrismaClient` is instantiated with a `globalThis` cache to survive Next.js hot-reload in dev
- SQLite with Prisma Decimal fields — always wrap monetary values in `new Prisma.Decimal(Math.round(n))` when writing
- `PredictionLog.actualValue` is nullable — the backfill script populates it; real-time logs may not have it yet

### Statistical prediction engine
- `suggestForNewMatter()` in `src/lib/suggestions.ts` — 5-level cascading filter, requires ≥ 5 peers at each level
- Exposure scaling: `Math.pow(exposure / baseExposure, 0.6)` — power-law, not linear
- Multipliers in `src/lib/matter-taxonomy.ts` — edit those constants to change prediction behaviour
- `confidence` levels: `High | Medium | Low | Insufficient` — driven by `sampleSize` thresholds in `src/lib/confidence.ts`

---

## File map

| File | Purpose |
|---|---|
| `src/lib/ai-client.ts` | Anthropic singleton, `PARSE_MODEL`, `EXPLAIN_MODEL` constants |
| `src/lib/suggestions.ts` | Core statistical prediction engine |
| `src/lib/matter-taxonomy.ts` | Multipliers, exposure bands, jurisdiction tiers, valid taxonomy |
| `src/lib/model-version.ts` | `MODEL_VERSIONS` map, `versionForDate()` for accuracy history simulation |
| `src/lib/stats.ts` | `percentile()`, `median()` — used by both accuracy API and backfill |
| `src/lib/forecast-utils.ts` | `EditablePhase`, `EditableTask` types, diff/sum helpers for forecast editor |
| `src/lib/confidence.ts` | `ConfidenceLevel` type, sample-size → confidence mapping |
| `src/app/api/ai/parse-matter/route.ts` | POST — Claude extracts structured fields from free text |
| `src/app/api/ai/explain/route.ts` | POST — streaming Claude explanations (intake/forecast/deviation) |
| `src/app/api/accuracy/route.ts` | GET — aggregates PredictionLog data for the dashboard |
| `src/app/matters/new/IntakeForm.tsx` | Intake form — parse section, suggestion panel, narrative card |
| `src/app/matters/[id]/forecast/ForecastClient.tsx` | Phase/task budget editor with AI commentary |
| `src/app/matters/[id]/page.tsx` | Matter overview — server component, embeds DeviationExplanation island |
| `src/app/accuracy/AccuracyClient.tsx` | Full accuracy dashboard — Recharts, filters, demo mode |
| `src/components/DeviationExplanation.tsx` | Click-to-stream deviation analysis island |
| `scripts/backfill-predictions.ts` | Generates historical PredictionLog rows for closed matters |

---

## Valid taxonomy

Always use these exact strings — the prediction engine matches on them:

**substantiveLaw:** `Litigation | IP | Employment | Corporate`

**category:**
- Litigation → `Commercial Litigation | Employment Litigation | IP Litigation | Product Liability`
- IP → `Patent Prosecution | Trademark`
- Employment → `Advice & Counseling`
- Corporate → `M&A`

**liabilityEstimate:** `Probable | Reasonably Possible | Remote`

**jurisdictionTier:** `Tier 1 | Tier 2 | Tier 3` (derived from jurisdiction string via `tierJurisdiction()`)

---

## Prompt types for `/api/ai/explain`

| type | context fields |
|---|---|
| `intake` | `category, sampleSize, confidence, filtersApplied, filtersDropped, estimatedFees, driverBreakdown` |
| `forecast` | `category, sampleSize, overallConfidence, phases (name + p50Amount + pctOfTotal), totalP50` |
| `deviation` | `category, predicted, actual, errorPercent, isWithinRange, confidence, sampleSize, liabilityEstimate, jurisdictionTier` |

---

## Patterns to follow

### Tooltip formatter in recharts
recharts `Formatter` types are loose — use this cast pattern:
```ts
formatter={(v: unknown) => { const n = v as number; return [fmt(n), 'label']; }}
```

### Streaming helper (repeat this pattern inline, don't import)
```ts
async function streamInto(url, body, setter, setStreaming) {
  setStreaming(true); setter('');
  try {
    const res = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setter(acc);
    }
  } finally { setStreaming(false); }
}
```

### Gen AI UI colour scheme
All Gen AI cards use violet: `border-violet-100 bg-violet-50`, label `text-violet-500`, body `text-violet-900`.

---

## What NOT to do

- Do not convert `matters/[id]/page.tsx` to a client component — it queries Prisma directly
- Do not use `useRouter` or `usePathname` in server components
- Do not add `useSearchParams()` without wrapping the component in `<Suspense>` (Next.js 16 enforces this)
- Do not skip the `globalThis` Prisma cache pattern in server components — it prevents connection exhaustion in dev
- Do not change the statistical prediction engine to call Claude — keep them as separate layers
- Do not commit `.env.local` — the `ANTHROPIC_API_KEY` must stay out of git

---

## Database setup after cloning

```bash
npx prisma migrate deploy   # apply migrations
npx prisma db seed          # seed sample matters, firms, invoices
npm run backfill            # generate PredictionLog accuracy data
```
