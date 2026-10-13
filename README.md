# Conviction 2.0

Single-stock analysis app: six hand-written models (DCF, Monte Carlo, risk, momentum, financial health, earnings & insiders) roll up into one 0–100 conviction score. Vite + React + Recharts + Tailwind on the front end; seven Vercel serverless functions in `/api` (prices, fundamentals, earnings, insiders, risk-free rate, AI reasoning, analysis log) make every external call so API keys never reach the browser. Live at https://www.tradeconviction.com.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the keys (see below)
npm run dev                  # http://localhost:5173
```

`npm run dev` serves the `/api` functions locally through a small Vite plugin in `vite.config.js`, so the Vercel CLI is not needed for development.

## Environment variables

| Name | Where to get it | Used by |
|---|---|---|
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | alpaca.markets → sign up (free) → Paper Trading dashboard → "API Keys" → Generate | `api/prices.js` (5y daily bars, IEX feed) |
| `FINNHUB_API_KEY` | finnhub.io/register (free) → dashboard shows the key | `api/earnings.js`, `api/insiders.js` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Create key (needs a small credit balance) | `api/reason.js` (Standard mode only) |
| `SEC_USER_AGENT` | No signup. SEC requires a descriptive User-Agent with a contact email, e.g. `Conviction2 you@example.com` | `api/fundamentals.js` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | supabase.com → your project → Project Settings (see "Analysis log" below). Server-side only. | `api/analyses.js` |

The risk-free rate is **not** an environment variable: enter the current 3-month T-bill yield in the app's Settings panel (FRED series `DTB3`, or treasury.gov daily yield curve).

## Deploy to Vercel (Hobby plan)

1. Push this folder to a GitHub repository (or use `vercel` CLI with `vercel --prod`).
2. On vercel.com → "Add New Project" → import the repo. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist` (defaults).
3. Project → Settings → Environment Variables → add the five variables above for Production (and Preview if you want preview deployments to work).
4. Deploy. The five files in `/api` become five serverless functions (Hobby limit is 12).
5. After changing an environment variable, redeploy (Deployments → ⋯ → Redeploy) so the functions pick it up.

## Project layout

```
api/            Vercel serverless functions (prices, fundamentals, earnings, insiders, riskfree, reason, analyses)
api/_lib/       shared helpers (not deployed as functions)
src/models/     one file per model, formulas in comments, no finance/stats libraries
src/lib/        pipeline (fetch → run models), API client, settings/history (localStorage), PDF export
src/components/ ScoreCard, ModelCard, charts, SettingsPanel, Reasoning (Standard + Wharton)
```

## What each analysis shows

- **Score attribution** (waterfall): neutral 50 → one bar per model (`weight used × (subscore − 50)`) → a labelled rounding step → the score. The steps sum exactly to the displayed score (`src/models/attribution.js`, `tests/attribution.test.js`). Unavailable models show as "Unavailable — excluded" and the weights actually used are listed.
- **DCF scenarios**: bull / base / bear toggle with fixed, on-screen deltas (`DCF_SCENARIO_CONFIG` in `src/models/dcfScenarios.js`), a tornado chart and a 5 × 5 growth × discount-rate grid. The score always uses Base.
- **Provenance**: every number has an "i" marker with its source (SEC EDGAR, Finnhub, Alpaca, U.S. Treasury, User setting, or Computed with its inputs) and as-of date; SEC values name the filing ("10-K, FY2025"). Anything that cannot be computed shows "Unavailable" with the reason. Nothing is estimated (`src/lib/provenance.js`).
- **Download report**: a two-page US Letter tear sheet generated in the browser (`src/lib/reportData.js`, `src/lib/tearSheet.js`, `src/components/report/TearSheet.jsx`). File name `Conviction_{TICKER}_{YYYY-MM-DD}_{Standard|Wharton}.pdf`.
- **History**: every completed analysis is written to the Supabase log and listed on the History tab.

## Wharton mode never touches the AI

- The AI client lives in `src/lib/ai.js` and is only ever loaded with a dynamic `import()` from Standard-mode code; in Wharton mode the file is not even downloaded.
- `requestReasoning()` throws unless called with `'standard'`; `api/reason.js` rejects any request whose mode is not `standard` with HTTP 403.
- Switching to Wharton discards any AI text held in memory, and a Wharton report is built without reading the AI text at all; the exporter refuses to write a Wharton PDF that contains an AI section.
- `tests/purity.test.js` enforces all of this.

## Analysis log (Supabase)

1. Create a project at supabase.com.
2. SQL Editor → New query → paste `supabase/schema.sql` → Run.
3. Project Settings → copy the Project URL and the service_role (or "secret") key.
4. Put them in `.env.local` and in Vercel (Production and Preview) as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then redeploy.

The key is used only inside `api/analyses.js`. The table has row-level security on with no public policies. If the log is unreachable or not configured the analysis still completes and a small "Run not saved to log" notice appears. `price_at_run` is fetched from Alpaca by the server at write time, or stored as null if Alpaca fails. AI text is never stored.

## Tests

```bash
npm test
```

30 unit tests: attribution sums (including 2,000 random cases with outages), DCF scenarios (bull ≥ base ≥ bear, the growth cap, the override), and Wharton purity.

## Views

| Tab | What it does |
|---|---|
| History | Past runs from the analysis log: date, ticker, price at run, score, mode; filter by ticker, sort by date, click a row for stored subscores and DCF values. |
| Stock | Six models on one ticker; optional **as-of date** scores the stock with only the data that existed then and shows what happened next. Deep links: `/?t=NVDA` or `/?t=NVDA&asof=2025-01-15`. |
| Portfolio | Holdings + horizon + growth target + thesis → blended portfolio score (see below). |
| Compare | Two tickers side by side: every subscore and key metric, better value highlighted. |
| Backtest | Score many tickers as of a past date and measure correlation with forward returns (Pearson, Spearman, bucket averages, direction hit rate), with the full calculation shown. |
| How it works | Plain-language methodology, a data-flow diagram, limitations and data sources. |

The risk-free rate is fetched automatically from the U.S. Treasury daily yield curve (`api/riskfree.js`; for as-of runs, the rate on that date), and can be overridden in Settings.

## Portfolio view

Switch to **Portfolio** in the header. Enter holdings with any amounts (percent or dollars; weights are worked out from the ratios), a time horizon, the growth you need over that horizon, and your thesis in your own words. Each holding runs the full six-model analysis, then three portfolio models (`src/models/portfolio.js`) produce the score:

| Part | What it measures | Subscore rule |
|---|---|---|
| Stock conviction | Weight-averaged conviction of the holdings, plus per-model weighted subscores | `Σ wᵢ·Cᵢ` |
| Target feasibility | Bootstrap Monte Carlo: 10,000 paths that replay real past trading days for all holdings together (correlations preserved) over the horizon | `100 × P(growth ≥ target)` |
| Portfolio risk | Blended volatility, beta, worst drawdown of the mix, correlation table, diversification ratio | mean of four component scores |

Portfolio conviction = blend of the three (default 50 / 30 / 20, editable in Settings). Standard mode asks Claude to judge the thesis against the numbers; Wharton mode shows the formulas and exports to PDF. Saved setups can be reloaded and re-run with today's data.

## Modes

- **Standard**: after a run, the computed metrics and subscores (never raw data) are sent to Claude Sonnet, which explains what drove the score and is told not to invent figures.
- **Wharton** (labelled "Show the math" in the header; change `MATH_MODE_LABEL` in `src/config.js` to rename): no AI calls at all. Every model renders a fixed template: formula, inputs, step-by-step calculation with the real numbers, result, and how it mapped to the subscore. "Download report" produces the tear sheet with the template methodology and no AI text.

## Scoring rules (summary)

| Model | Subscore rule |
|---|---|
| DCF | `clamp(50 + 100 × upside)` where upside = intrinsic value / price − 1 |
| Monte Carlo | `100 × P(ending price > today)` over 10,000 GBM paths, 252 days |
| Risk | mean of vol score, beta score, drawdown score, and Sharpe score (if a risk-free rate is set) |
| Momentum | mean of momentum score, SMA-position score, RSI score |
| Financial health | mean of growth, net-margin, debt, liquidity and FCF-trend scores (missing ones skipped) |
| Earnings & insiders | mean of beat-rate score and open-market insider net-ratio score |

Conviction = weighted average of available subscores (weights editable; re-normalized when a model is unavailable). Labels: 0–39 Low, 40–59 Neutral, 60–79 High, 80–100 Very High.
