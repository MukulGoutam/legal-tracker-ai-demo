# Legal Tracker AI

An AI-powered legal matter management demo that combines a statistical fee prediction engine with Anthropic Claude for intelligent intake parsing, narrative explanations, and deviation analysis.

---

## What it does

Legal Tracker AI walks a matter through four connected stages — each informed by data from the previous — to show how AI augments legal operations:

| Stage | Feature | AI Layer |
|---|---|---|
| 1 | **Intake** — create a matter and get a fee prediction | Smart form auto-fill via Claude |
| 2 | **Forecast** — phase/task budget from historical peer matters | Strategic commentary via Claude |
| 3 | **Firm Selection** — rank outside counsel on 4 operational metrics | — |
| 4 | **Accuracy Dashboard** — track how predictions compare to actual invoices | Deviation explanation via Claude |

---

## Tech stack

- **Next.js 16** (App Router, server components, streaming responses)
- **Prisma 6 + SQLite** — local database with full schema
- **Anthropic Claude** (`claude-haiku-4-5`) — smart parsing, streaming explanations
- **Recharts** — accuracy dashboard visualisations (scatter, line, bar)
- **Tailwind CSS + shadcn/ui**

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set environment variables

Create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Create `.env` for Prisma:

```
DATABASE_URL="file:./prisma/dev.db"
```

### 3. Set up the database

```bash
npx prisma migrate deploy
npx prisma db seed
```

### 4. Backfill prediction accuracy data

Generates historical intake predictions for all closed matters so the Accuracy Dashboard has data to show:

```bash
npm run backfill
```

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Key routes

| Route | Description |
|---|---|
| `/` | Matters list |
| `/matters/new` | Create a matter — AI auto-fill + fee estimate |
| `/matters/[id]` | Matter overview — Prediction vs Actual card |
| `/matters/[id]/forecast` | Phase/task budget editor with AI commentary |
| `/matters/[id]/firms` | Outside counsel selection |
| `/accuracy` | Accuracy dashboard with filters and charts |
| `/accuracy?demo=1` | Demo mode with preset filter views |

---

## API endpoints

### Statistical prediction

| Method | Path | Description |
|---|---|---|
| POST | `/api/suggest-intake` | Fee + duration estimate for the intake form |
| POST | `/api/suggest-forecast` | Phase/task breakdown for a matter |
| POST | `/api/matters` | Create a matter |
| POST | `/api/forecasts` | Save a forecast |
| GET | `/api/accuracy` | Accuracy metrics (filterable by category, confidence, model version) |

### Gen AI (Anthropic Claude)

| Method | Path | Description |
|---|---|---|
| POST | `/api/ai/parse-matter` | Extract structured fields from free-text description |
| POST | `/api/ai/explain` | Stream a narrative (type: `intake` / `forecast` / `deviation`) |

---

## Gen AI features

### Smart intake parsing
Paste any description, email, or case summary into the intake form and click **Auto-fill with AI →**. Claude extracts `name`, `substantiveLaw`, `category`, `liabilityEstimate`, and `jurisdiction`, then auto-fills the form and triggers the statistical fee estimate automatically.

### Prediction narrative
After the fee estimate loads, Claude streams a 2–3 sentence insight explaining the peer count, the main cost driver adjustment, and what the confidence level means in practice.

### Forecast commentary
When the phase/task budget loads, Claude streams strategic commentary: it names the dominant phase, flags any unusually sized phase, and gives one concrete cost-management suggestion.

### Deviation explanation
On closed matter overview pages, a **"Why did this deviate? ✨"** button streams an explanation of why actual cost differed from the prediction — citing confidence level, sample size, liability estimate, and jurisdiction tier.

---

## How the prediction engine works

The fee estimate is **entirely statistical — no LLM**. It uses a 5-level cascading peer filter:

1. Exact match: `substantiveLaw + category + liabilityEstimate + jurisdictionTier`
2. Drop jurisdiction tier
3. Drop liability estimate
4. Drop both
5. Category only (broadest fallback)

Each level requires ≥ 5 peer matters before accepting the result. Exposure amount is scaled with a power-law (`amount ^ 0.6`) and combined with liability and jurisdiction multipliers from `src/lib/matter-taxonomy.ts`. P25/P50/P75 percentiles are computed in JavaScript from the filtered peer set.

Claude augments this engine at the **input** (parsing natural language), **output** (explaining the numbers), and **review** (interpreting deviations) layers — it never replaces the statistical core.

---

## Project structure

```
src/
  app/
    api/
      ai/
        parse-matter/    # POST — structured extraction from free text
        explain/         # POST — streaming narrative (intake/forecast/deviation)
      accuracy/          # GET  — prediction accuracy metrics
      suggest-intake/    # POST — statistical fee estimate
      suggest-forecast/  # POST — phase/task breakdown
      matters/           # POST — create matter
      forecasts/         # POST — save forecast
    accuracy/            # Accuracy dashboard (client component + Recharts)
    matters/
      new/               # Intake form with AI parse section
      [id]/
        forecast/        # Phase editor with AI commentary
        firms/           # Firm selection
        page.tsx         # Matter overview with deviation explanation
  components/
    DeviationExplanation.tsx   # 'use client' island — click-to-stream deviation
    SuggestionCard.tsx
    PredictionExplainer.tsx
    ConfidenceBadge.tsx
    DataSufficiencyAlert.tsx
  lib/
    ai-client.ts         # Anthropic singleton + model constants
    suggestions.ts       # Core statistical prediction engine
    matter-taxonomy.ts   # Multipliers, exposure bands, jurisdiction tiers
    model-version.ts     # Simulated model version history for accuracy charts
    forecast-utils.ts    # Phase/task edit state helpers
    stats.ts             # percentile(), median() helpers
prisma/
  schema.prisma          # Matter, Firm, Invoice, Forecast, PredictionLog models
scripts/
  backfill-predictions.ts  # Backfill historical accuracy data for closed matters
```

---

## Scripts

```bash
npm run dev       # Start development server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint
npm run backfill  # Generate prediction accuracy logs for all closed matters
```

---

## Notes

- The SQLite database (`prisma/dev.db`) is excluded from git. Run `prisma db seed` after cloning.
- `.env.local` is excluded from git — never commit your `ANTHROPIC_API_KEY`.
- The prediction engine labels itself as statistical, not a trained ML model, to maintain transparency.
- The accuracy dashboard supports `?demo=1` for a guided tour with preset filters.
