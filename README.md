# Conviction 2.0

Stock, ETF, Treasury and portfolio analysis with every number shown. Six hand-written models (DCF, Monte Carlo, risk, momentum, financial health, earnings & insiders) roll up into one 0–100 conviction score for a stock; ETFs and Treasuries get their own component models; the Portfolio pages grade a mix, optimize its weights, stress-test it against past crashes and rate shocks, and keep portfolios in the browser. Vite + React + Recharts + Tailwind on the front end; ten Vercel serverless functions in `/api` make every external call so API keys never reach the browser. Live at https://www.tradeconviction.com.

## Navigation

| Page | What is there |
|---|---|
| Home | One search box (stock, ETF, bond ETF or Treasury), "Build a portfolio", recently analyzed tickers. |
| Analyze | Tabs: **Analysis** (single-asset results; optional as-of date for point-in-time scoring, deep links `/?t=NVDA&asof=2025-01-15`), **Compare** (two tickers side by side), **Backtest** (score many tickers as of a past date vs what happened next), **History** (the analysis log, owner only) and **Track Record** (forward and excess returns of every logged score, owner only). |
| Portfolio | Tabs: **Grade**, **Optimize**, **Stress Test**, **My Portfolios**. Holdings carry over between the first three; the thesis-and-target analysis lives under Grade → Details → "Thesis & target". |
| Methodology | Every formula, weight, scenario date and data source, searchable. |

The Standard / Wharton toggle is in the header on every page. In Wharton mode a persistent badge reads "Wharton mode: no AI-generated text." and nothing on any page is AI-written. All other settings (theme, risk-free rate, DCF assumptions, model weights, portfolio blend) are behind the gear icon.

Every results page has the same order: score card (0–100, Weak / Neutral / Strong / Very Strong, red / amber / green), "What drove this score" (top 3 positive and negative contributors with their numbers), the reasoning section (AI in Standard, templates in Wharton), then Details tabs that group the charts by category. Every metric has an "i" that opens a side drawer with the formula, inputs and result. Unavailable data is always a grey "Unavailable" with the reason in a tooltip. "Export PDF" sits in the same place on every results page. Light and dark mode; works down to phone width.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the keys (see below)
npm run dev                  # http://localhost:5173
```

`npm run dev` serves the `/api` functions locally through a small Vite plugin in `vite.config.js`, so the Vercel CLI is not needed for development. Files under `api/_lib` are cached by the dev server; restart it after editing them.

## Environment variables

| Name | Where to get it | Used by |
|---|---|---|
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | alpaca.markets → sign up (free) → Paper Trading dashboard → "API Keys" → Generate | `api/prices.js` (5y daily bars, IEX feed), `api/history.js` (daily closes since 2016, SIP feed), `api/asset.js` |
| `FINNHUB_API_KEY` | finnhub.io/register (free) → dashboard shows the key | `api/earnings.js`, `api/insiders.js`, `api/asset.js` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Create key (needs a small credit balance) | `api/reason.js` (Standard mode only) |
| `SEC_USER_AGENT` | No signup. SEC requires a descriptive User-Agent with a contact email, e.g. `Conviction2 you@example.com` | `api/fundamentals.js` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | supabase.com → your project → Project Settings (see "Analysis log" below). Server-side only. | `api/analyses.js` |
| `FRED_API_KEY` | fred.stlouisfed.org → My Account → API Keys (free) | `api/fred.js` (Treasury yields, allow-listed series only), `api/riskfree.js` |
| `LOG_PASSCODE` | Choose it (8+ characters). The owner passcode for History and Track Record. | `api/analyses.js` (checked server-side; sets an HttpOnly session cookie) |
| `CRON_SECRET` | Any long random string; Vercel sends it as a bearer token with the daily keep-alive. | `api/analyses.js` (cron ping) |

Nothing is read from a `VITE_` variable; the browser only ever talks to `/api/*`. `node scripts/push-env-to-vercel.mjs [NAMES…]` copies values from `.env.local` to Vercel (Production and Preview) without printing them.

The risk-free rate is fetched automatically: FRED series `DGS3MO` (3-month constant-maturity Treasury), with the treasury.gov daily yield curve as a fallback. It can be overridden in Settings.

## Deploy to Vercel (Hobby plan)

1. Push this folder to a GitHub repository (or use `vercel` CLI with `vercel --prod`).
2. On vercel.com → "Add New Project" → import the repo. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist` (defaults).
3. Project → Settings → Environment Variables → add the variables above for Production (and Preview if you want preview deployments to work), or run `node scripts/push-env-to-vercel.mjs`.
4. Deploy. The eleven files in `/api` become eleven serverless functions (Hobby limit is 12). `vercel.json` also schedules a daily cron (09:17 UTC) that pings the log so the free Supabase project never pauses for inactivity.
5. After changing an environment variable, redeploy (Deployments → ⋯ → Redeploy) so the functions pick it up.

## Project layout

```
api/            Vercel serverless functions (prices, fundamentals, earnings, insiders, riskfree, reason, analyses, fred, asset, history, fund)
api/_lib/       shared helpers (not deployed as functions): http retry, Alpaca bars, asset-class detection, owner session (HMAC cookie)
supabase/       schema.sql plus migrations/ (row-level security for the log: anon INSERT-only with a shape check; no anon SELECT/UPDATE/DELETE)
src/models/     one file per model, formulas in comments, no finance/stats libraries
                assets.js (ETF/Treasury components), bondMath.js, portfolioGrade.js, optimizer.js, stressTest.js, portfolio.js (thesis)
src/lib/        pipeline (fetch → run models), assetPipeline, portfolioData, savedPortfolios (localStorage), labels (plain-English names), methodologyContent, API client, PDF export
src/pages/      HomePage, AnalyzePage, PortfolioHub, MethodologyPage
src/components/ StockResults, AssetAnalysis, GraderPage, OptimizerPage, StressTestPage, MyPortfoliosPage, ModelCard, charts, results/ (ScoreHeader, DriversCard), ui.jsx (Unavailable, skeletons, tabs, info drawer)
```

## What each analysis shows

- **Score attribution** (Details → Score breakdown): neutral 50 → one bar per model (`weight used × (subscore − 50)`) → a labelled rounding step → the score. The steps sum exactly to the displayed score (`src/models/attribution.js`, `tests/attribution.test.js`). Unavailable models show as "Unavailable — excluded" and the weights actually used are listed.
- **DCF scenarios** (Details → Valuation): bull / base / bear toggle with fixed, on-screen deltas (`DCF_SCENARIO_CONFIG` in `src/models/dcfScenarios.js`), a tornado chart and a 5 × 5 growth × discount-rate grid. The score always uses Base.
- **Provenance**: every number has an "i" that opens the formula drawer with its source (SEC EDGAR, Finnhub, Alpaca, FRED, U.S. Treasury, User setting, or Computed with its inputs) and as-of date. Anything that cannot be computed shows "Unavailable" with the reason. Nothing is estimated (`src/lib/provenance.js`).
- **Export PDF**: stocks get the two-page US Letter tear sheet (`src/lib/reportData.js`, `src/lib/tearSheet.js`, `src/components/report/TearSheet.jsx`); every other results page is captured as it appears. File names `Conviction_{TICKER|Portfolio|Optimizer|StressTest}_{YYYY-MM-DD}_{Standard|Wharton}.pdf`.
- **History and Track Record** (owner only, passcode): every completed stock, ETF and Treasury analysis is written to the Supabase log with ticker, asset type, mode, score, label, app version, timestamp and the Alpaca close at run time. Track Record computes each run's 1, 3 and 6-month forward return and excess return vs SPY over the same dates (pending until the window ends), average and hit rate by label, Spearman rank correlation with n, a score vs 3-month excess scatter and a per-run table; any bucket under 30 runs is flagged as a small sample.
- **Fund facts from SEC EDGAR** (`api/fund.js`): expense ratio from the prospectus XBRL, net assets and holdings from N-PORT, and for bond funds duration (DV01 / net assets) and the investment-grade share of credit-spread risk, each labelled with its filing; fields a filing lacks show "unavailable (not in SEC filing)".

## Wharton mode never touches the AI

- The AI client lives in `src/lib/ai.js` and is loaded only by `src/lib/aiGate.js`, with a dynamic `import()` placed after the Standard-mode check; in Wharton mode the file is not even downloaded. `tests/wharton-network.test.js` records every fetch while calling the gate in Wharton mode for every explanation kind and asserts that none happened.
- `requestReasoning()` throws unless called with `'standard'`; `api/reason.js` rejects any request whose mode is not `standard` with HTTP 403.
- Switching to Wharton discards any AI text held in memory, and a Wharton report is built without reading the AI text at all; the exporter refuses to write a Wharton PDF that contains an AI section.
- `tests/purity.test.js` enforces all of this and lists every file on the Wharton path.

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

57 unit tests: attribution sums (including 2,000 random cases with outages), DCF scenarios, Wharton purity, the Portfolio Grader, bond math, the Optimizer, the stress test (60/40 equals its benchmark, coverage and exclusion rules, recovery time, TLT vs SHY rate shock, beta window) backup-file validation, the Track Record (base-date rule, pending windows, excess vs SPY, Spearman, small-sample flags) and the Wharton no-network proof.

## Portfolio

**Grade** (`src/models/portfolioGrade.js`): holdings as percent, dollars or shares. Portfolio Conviction Score = 40% holding quality (the holdings' own scores, weighted) + 30% diversification (HHI `clamp(100·(1−H)/0.9)`, average pairwise correlation `clamp(100·(1−ρ̄))` over 1 year, asset-class mix `clamp(100·(1−H_class)/0.75)`) + 30% risk (volatility, beta vs SPY, max drawdown, 95% 1-day VaR, Sharpe of the constant-weight portfolio). Pillars re-normalize when one is unavailable, and the page says so. Details: holdings, allocation pie, correlation heatmap, cumulative return vs SPY and 60/40, drawdown, and the optional **Thesis & target** analysis (horizon, growth target, thesis → weighted conviction, bootstrap target feasibility, portfolio risk; `src/models/portfolio.js`).

**Optimize** (`src/models/optimizer.js`): mean-variance on up to 3 years of common daily returns; the frontier is traced by maximizing `wᵀμ − λ·wᵀΣw` with projected gradient; the chosen point is the max-Sharpe frontier point with volatility at or below the cap (Conservative 8%, Moderate 14%, Aggressive 22%), refined by bisection on λ when the cap binds. Bounds 2–30% per holding, weights sum to 100%. Infeasible → minimum-variance mix shown and labelled. Output: weights, dollars, whole shares, leftover cash, score before (equal weight) vs after, efficient frontier. Always: "Optimized on historical data. Past performance does not predict future results."

**Stress Test** (`src/models/stressTest.js`): five historical scenarios replayed on actual daily closes with weights held constant (Dot-com 2000-03-24→2002-10-09, 2008 crisis 2007-10-09→2009-03-09, 2018 Q4 2018-09-20→2018-12-24, COVID 2020-02-19→2020-03-23, 2022 rate hikes 2022-01-03→2022-10-12): total return, max drawdown, recovery time (or "not yet recovered"), the same for SPY and 60/40, each holding's return and contribution, and an indexed line chart. Holdings without data are excluded with weights re-normalized and coverage shown; below 50% coverage the scenario is "Unavailable — insufficient history". Price history comes from Alpaca's SIP feed and begins 2016-01-04, so the dot-com and 2008 scenarios are unavailable for stocks and ETFs (Treasuries use FRED yields). Hypothetical shocks, labelled "Model estimate — not historical data": market −10% / −20% = beta × shock (equities), rates +1% / +2% = −duration × Δrate (bond ETFs and Treasuries), with per-holding breakdown, $ and % loss, and coverage.

**My Portfolios** (`src/lib/savedPortfolios.js`): local only (localStorage, every read/write in try/catch). Save from Grade, Optimize or Stress Test; open, rename, duplicate, delete; a score snapshot (date, total, three pillars) is appended each time a saved portfolio is graded, shown as a line chart and a table; export a JSON backup and import it back (malformed files are rejected with the reason).

## ETFs and Treasuries

Asset types (`api/_lib/assetClass.js`): stock, equity ETF, bond ETF, Treasury (`US2Y`/`US5Y`/`US10Y`/`US30Y` → FRED `DGS2`/`DGS5`/`DGS10`/`DGS30`). CUSIPs and unknown symbols are reported as unsupported. Components are scored 0–100 and averaged (`src/models/assets.js`):

| Asset | Components | Unavailable with the current free data plans |
|---|---|---|
| Equity ETF | expense ratio, liquidity (IEX dollar volume), 12-1 momentum, volatility, max drawdown, Sharpe | expense ratio and AUM (Finnhub `/etf/profile` is paid) |
| Bond ETF | trailing-12-month distribution yield, empirical duration vs the 10-year yield, credit quality, spread vs the nearest-tenor Treasury, volatility, max drawdown | SEC 30-day yield, official effective duration, credit quality |
| Treasury | yield (FRED), modified duration of a par bond, yield-curve position, curve chart | — |

## Modes

- **Standard**: after a run, the computed metrics and subscores (never raw data) are sent to Claude Sonnet, which explains what drove the score and is told not to invent figures.
- **Wharton**: no AI calls at all. Every page renders fixed templates: formula, inputs, step-by-step calculation with the real numbers, result, and how it mapped to the subscore. "Export PDF" produces the same content with no AI text.

## Scoring rules (summary)

| Model | Subscore rule |
|---|---|
| DCF | `clamp(50 + 100 × upside)` where upside = intrinsic value / price − 1 |
| Monte Carlo | `100 × P(ending price > today)` over 10,000 GBM paths, 252 days |
| Risk | mean of vol score, beta score, drawdown score, and Sharpe score (if a risk-free rate is set) |
| Momentum | mean of momentum score, SMA-position score, RSI score |
| Financial health | mean of growth, net-margin, debt, liquidity and FCF-trend scores (missing ones skipped) |
| Earnings & insiders | mean of beat-rate score and open-market insider net-ratio score |

Conviction = weighted average of available subscores (weights editable; re-normalized when a model is unavailable). Bands: 0–39 Weak, 40–59 Neutral, 60–79 Strong, 80–100 Very Strong. The full list is on the Methodology page.
