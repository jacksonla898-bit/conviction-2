# Conviction 2.0

Stock, ETF, Treasury and portfolio analysis app. Six hand-written models (DCF, Monte Carlo, risk, momentum, financial health, earnings & insiders) roll up into one 0–100 conviction score for a stock; ETFs and Treasuries get their own component models; the Portfolio Grader scores a whole portfolio and the Optimizer finds the max-Sharpe mix under a volatility cap. Vite + React + Recharts + Tailwind on the front end; nine Vercel serverless functions in `/api` (prices, fundamentals, earnings, insiders, risk-free rate, AI reasoning, analysis log, FRED, asset detection) make every external call so API keys never reach the browser. Live at https://www.tradeconviction.com.

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
| `FRED_API_KEY` | fred.stlouisfed.org → My Account → API Keys (free) | `api/fred.js` (Treasury yields, allow-listed series only), `api/riskfree.js` |

Nothing is read from a `VITE_` variable; the browser only ever talks to `/api/*`. `node scripts/push-env-to-vercel.mjs [NAMES…]` copies values from `.env.local` to Vercel (Production and Preview) without printing them.

The risk-free rate is fetched automatically: FRED series `DGS3MO` (3-month constant-maturity Treasury), with the treasury.gov daily yield curve as a fallback. It can be overridden in Settings.

## Deploy to Vercel (Hobby plan)

1. Push this folder to a GitHub repository (or use `vercel` CLI with `vercel --prod`).
2. On vercel.com → "Add New Project" → import the repo. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist` (defaults).
3. Project → Settings → Environment Variables → add the variables above for Production (and Preview if you want preview deployments to work), or run `node scripts/push-env-to-vercel.mjs`.
4. Deploy. The nine files in `/api` become nine serverless functions (Hobby limit is 12).
5. After changing an environment variable, redeploy (Deployments → ⋯ → Redeploy) so the functions pick it up.

## Project layout

```
api/            Vercel serverless functions (prices, fundamentals, earnings, insiders, riskfree, reason, analyses, fred, asset)
api/_lib/       shared helpers (not deployed as functions): http retry, asset-class detection
src/models/     one file per model, formulas in comments, no finance/stats libraries
                assets.js (ETF/Treasury components), bondMath.js, portfolioGrade.js, optimizer.js
src/lib/        pipeline (fetch → run models), assetPipeline (any asset type), portfolioData, API client, settings/history, PDF export
src/components/ ScoreCard, ModelCard, AssetAnalysis, GraderPage, OptimizerPage, charts, Methodology, Reasoning (Standard + Wharton)
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

40 unit tests: attribution sums (including 2,000 random cases with outages), DCF scenarios (bull ≥ base ≥ bear, the growth cap, the override), Wharton purity, the Portfolio Grader (diversification ordering, pillar re-normalization, risk metrics), bond math and the Optimizer (bounds, sum to 100%, Conservative < Aggressive volatility, infeasible handling).

## Views

| Tab | What it does |
|---|---|
| History | Past runs from the analysis log: date, ticker, price at run, score, mode; filter by ticker, sort by date, click a row for stored subscores and DCF values. |
| Stock | Six models on one ticker; optional **as-of date** scores the stock with only the data that existed then and shows what happened next. Deep links: `/?t=NVDA` or `/?t=NVDA&asof=2025-01-15`. The same box accepts an ETF (`SPY`, `TLT`) or a Treasury (`US2Y`, `US5Y`, `US10Y`, `US30Y`); the asset type is detected server-side (`api/asset.js`) and the matching models run (see "ETFs, Treasuries, Grader and Optimizer"). |
| Portfolio | Holdings + horizon + growth target + thesis → blended portfolio score (see below). |
| Grader | Holdings as percent, dollars or shares → Portfolio Conviction Score = 40% holding quality + 30% diversification + 30% risk, with correlation heatmap, allocation by class, cumulative return vs SPY and 60/40, drawdown, and "what drove the score". |
| Optimize | Tickers + risk level + amount → max-Sharpe weights (2–30% each, volatility cap), dollars and whole shares, leftover cash, score before vs after, efficient frontier. |
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

## ETFs, Treasuries, Grader and Optimizer

**Asset types** (`api/_lib/assetClass.js`): stock, equity ETF, bond ETF (Finnhub type "ETP" plus a bond-fund name/known-ticker check), Treasury (`US2Y`/`US5Y`/`US10Y`/`US30Y` → FRED `DGS2`/`DGS5`/`DGS10`/`DGS30`). CUSIPs and unknown symbols are reported as unsupported ("individual bond data unavailable"). Each component is scored 0–100 and the asset score is the equal-weighted mean of the available components (`src/models/assets.js`, formulas in the file header):

| Asset | Components | Unavailable with the current free data plans |
|---|---|---|
| Equity ETF | expense ratio, liquidity (IEX dollar volume), 12-1 momentum, volatility, max drawdown, Sharpe | expense ratio and AUM (Finnhub `/etf/profile` is paid) |
| Bond ETF | trailing-12-month distribution yield (Alpaca cash dividends ÷ price), empirical duration (regression of fund returns on 10-year yield changes), credit quality, spread vs the nearest-tenor Treasury, volatility, max drawdown | SEC 30-day yield, official effective duration, credit quality (same endpoint) |
| Treasury | yield (FRED), modified duration of a par bond at that tenor, yield-curve position vs the 3-month yield, with the full curve chart | — |

Anything unavailable is shown as "Unavailable" with the reason, excluded, and the remaining weights re-normalized. Treasury return series are approximated from yield changes (`r = −D_mod·Δy + y/252`, stated on screen).

**Portfolio Grader** (`src/models/portfolioGrade.js`): Holding quality = weight-averaged holding scores. Diversification = mean of HHI score `clamp(100·(1−H)/0.9)`, average pairwise correlation score `clamp(100·(1−ρ̄))` (1 year of daily returns), and asset-class mix score `clamp(100·(1−H_class)/0.75)`. Risk = mean of volatility, beta vs SPY, max drawdown, 95% 1-day historical VaR and Sharpe scores of the constant-weight portfolio return series. Pillars re-normalize when one is unavailable, and the page says so.

**Optimizer** (`src/models/optimizer.js`): mean-variance on up to 3 years of common daily returns. The frontier is traced by maximizing `wᵀμ − λ·wᵀΣw` (projected gradient onto the box-constrained simplex) for a sweep of λ; the chosen point is the max-Sharpe frontier point with volatility at or below the cap (Conservative 8%, Moderate 14%, Aggressive 22%), refined by bisection on λ when the cap binds. Bounds 2–30% per holding, weights sum to 100%. If no feasible mix exists the minimum-variance mix is shown and labelled. Output: weights, dollars, whole shares (Treasuries in $100 par units), leftover cash, score before (equal weight) vs after, frontier chart. Always displayed: "Optimized on historical data. Past performance does not predict future results."

In Wharton mode every one of these pages renders fixed templates (metric, formula, inputs, result) and never loads the AI module (`tests/purity.test.js` lists the files).

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
