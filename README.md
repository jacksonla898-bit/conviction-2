# Conviction 2.0

Single-stock analysis app: six hand-written models (DCF, Monte Carlo, risk, momentum, financial health, earnings & insiders) roll up into one 0–100 conviction score. Vite + React + Recharts + Tailwind on the front end; five Vercel serverless functions in `/api` make every external call so API keys never reach the browser.

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

The risk-free rate is **not** an environment variable: enter the current 3-month T-bill yield in the app's Settings panel (FRED series `DTB3`, or treasury.gov daily yield curve).

## Deploy to Vercel (Hobby plan)

1. Push this folder to a GitHub repository (or use `vercel` CLI with `vercel --prod`).
2. On vercel.com → "Add New Project" → import the repo. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist` (defaults).
3. Project → Settings → Environment Variables → add the five variables above for Production (and Preview if you want preview deployments to work).
4. Deploy. The five files in `/api` become five serverless functions (Hobby limit is 12).
5. After changing an environment variable, redeploy (Deployments → ⋯ → Redeploy) so the functions pick it up.

## Project layout

```
api/            Vercel serverless functions (prices, fundamentals, earnings, insiders, reason)
api/_lib/       shared helpers (not deployed as functions)
src/models/     one file per model, formulas in comments, no finance/stats libraries
src/lib/        pipeline (fetch → run models), API client, settings/history (localStorage), PDF export
src/components/ ScoreCard, ModelCard, charts, SettingsPanel, Reasoning (Standard + Wharton)
```

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
- **Wharton**: no AI calls at all. Every model renders a fixed template: formula, inputs, step-by-step calculation with the real numbers, result, and how it mapped to the subscore. "Export PDF" rasterizes the score card, model cards and methodology into a PDF.

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
