// Every formula, weight, scenario date and data source in one place (searchable on the Methodology page).
// Text only: the calculations live in src/models and are quoted here verbatim from their header comments.

import { SCENARIOS } from '../models/stressTest.js';
export const STRESS_SCENARIOS = SCENARIOS;

export const SECTIONS = [
  {
    id: 'overview', group: 'How it works', title: 'From data to score',
    text: [
      'Every asset is analysed by hand-written models. Each model turns public data into a 0–100 subscore with a published rule; the score is the weighted average of the available subscores. A model whose data cannot be computed is shown as Unavailable, excluded, and the remaining weights are re-normalized. Nothing is estimated or substituted.',
      'Score bands: 0–39 Weak, 40–59 Neutral, 60–79 Strong, 80–100 Very Strong.',
      'Standard mode adds an AI explanation (Claude) that is given only the computed numbers and is instructed not to invent figures. Wharton mode contains no AI-generated text anywhere: every explanation is a fixed template of formula, inputs and result.',
    ],
    formulas: [
      { label: 'Conviction score (stock)', formula: 'score = Σ wᵢ·sᵢ / Σ wᵢ over available models', note: 'Default weights: DCF 20, Monte Carlo 15, Risk 15, Momentum 15, Financial health 20, Earnings & insiders 15 (editable in Settings).' },
      { label: 'Attribution', formula: '50 + Σ wᵢ·(sᵢ − 50) + rounding = score', note: 'Each model’s contribution is its re-normalized weight × (subscore − 50); the explicit rounding step is at most ±0.5.' },
    ],
  },
  {
    id: 'dcf', group: 'Stock models', title: 'Valuation (discounted cash flow)',
    text: ['5-year projection of free cash flow plus a Gordon-growth terminal value, discounted at the CAPM cost of equity. The subscore always uses the Base case; bull / bear scenarios, the tornado chart and the sensitivity grid are views only and never change the score.'],
    formulas: [
      { label: 'Free cash flow', formula: 'FCF = OperatingCashFlow − CapEx (annual, SEC EDGAR)' },
      { label: 'Historical growth', formula: 'g_hist = (FCF_last / FCF_first)^(1/years) − 1 (needs both > 0)' },
      { label: 'Growth used', formula: 'g = clamp(g_hist, g_min, g_max) or the user override' },
      { label: 'Discount rate (CAPM)', formula: 'r = R_f + β · ERP' },
      { label: 'Upside', formula: 'U = IV / Price − 1' },
      { label: 'Subscore', formula: 'clamp(50 + 100·U, 0, 100)', note: 'Fairly valued = 50, +50% upside = 100, −50% = 0.' },
      { label: 'Scenarios', formula: 'Bull / Bear shift growth, discount rate and terminal growth by fixed deltas shown on screen' },
    ],
  },
  {
    id: 'monteCarlo', group: 'Stock models', title: 'Monte Carlo simulation',
    text: ['Geometric Brownian motion fitted to the last 252 daily log returns; 10,000 paths × 252 trading days.'],
    formulas: [
      { label: 'Daily log return', formula: 'rᵢ = ln(Pᵢ / Pᵢ₋₁); m = mean(rᵢ); s = stdev(rᵢ)' },
      { label: 'Annualized', formula: 'σ = s·√252; μ = m·252 + σ²/2' },
      { label: 'GBM step', formula: 'S_{t+1} = S_t · exp(m + s·Z), Z ~ N(0,1)' },
      { label: 'Subscore', formula: '100 × P(S_T > S_0)' },
    ],
  },
  {
    id: 'risk', group: 'Stock models', title: 'Risk',
    text: ['Daily log returns over the last 252 trading days for the stock and SPY; max drawdown over 5 years.'],
    formulas: [
      { label: 'Volatility', formula: 'σ = stdev(r) · √252' },
      { label: 'Beta', formula: 'β = cov(r, mkt) / var(mkt)' },
      { label: 'Sharpe', formula: 'Sharpe = (mean(r)·252 − R_f) / σ' },
      { label: 'Max drawdown', formula: 'MDD = min_t (P_t / max_{u≤t} P_u − 1)' },
      { label: 'Rolling beta', formula: 'β₆₀(t) = cov(r[t−59..t], mkt[t−59..t]) / var(mkt[t−59..t])' },
      { label: 'Subscore', formula: 'mean of volScore = clamp(100·(60% − σ)/45%), betaScore = clamp(125 − 50β), sharpeScore = clamp(50 + 25·Sharpe), ddScore = clamp(100 + 125·MDD)', note: 'The Sharpe component is skipped when no risk-free rate is available.' },
    ],
  },
  {
    id: 'momentum', group: 'Stock models', title: 'Momentum and technicals',
    text: [],
    formulas: [
      { label: '12-1 momentum', formula: 'M = P[t−21] / P[t−252] − 1' },
      { label: 'Moving averages', formula: 'SMA_n(t) = (1/n) Σ_{k=0}^{n−1} P[t−k], n = 50 and 200' },
      { label: 'RSI(14), Wilder', formula: 'RS = avgGain / avgLoss; RSI = 100 − 100/(1 + RS)' },
      { label: 'Subscore', formula: 'mean of momScore = clamp(50 + 100·M), smaScore = 50·[P > SMA50] + 50·[P > SMA200], rsiScore = clamp(100 − 2.5·|RSI − 55|)' },
    ],
  },
  {
    id: 'health', group: 'Stock models', title: 'Financial health',
    text: ['From SEC EDGAR annual (10-K) company facts, last 4–5 fiscal years.'],
    formulas: [
      { label: 'Revenue growth', formula: 'g = Rev_t / Rev_{t−1} − 1' },
      { label: 'Margins', formula: 'GM = GrossProfit / Revenue; OM = OperatingIncome / Revenue; NM = NetIncome / Revenue' },
      { label: 'Leverage and liquidity', formula: 'D/E = TotalDebt / StockholdersEquity; CR = CurrentAssets / CurrentLiabilities' },
      { label: 'Free cash flow trend', formula: 'FCF = OperatingCashFlow − CapEx; trend = FCF CAGR (or sign change)' },
      { label: 'Subscore', formula: 'mean of growthScore = clamp(50 + 250·g), marginScore = clamp(100·NM/25%), debtScore = clamp(100 − 50·D/E), liquidScore = clamp(50·CR), fcfScore = 100 / 50 / 0', note: 'Missing components are skipped.' },
    ],
  },
  {
    id: 'earnings', group: 'Stock models', title: 'Earnings surprises and insider activity',
    text: ['Finnhub quarterly EPS surprises and Form 4 open-market insider transactions (last 6 months; code P = buy, S = sale). If there were no open-market trades the insider component is Unavailable and excluded; no neutral placeholder is substituted.'],
    formulas: [
      { label: 'Surprise', formula: 'surprise% = (actual − estimate) / |estimate|' },
      { label: 'Beat rate', formula: 'B = quarters with actual > estimate / quarters; earningsScore = 100·B' },
      { label: 'Insider net ratio', formula: 'ρ = (bought − sold) / (bought + sold) ∈ [−1, 1]; insiderScore = 50 + 50·ρ' },
      { label: 'Subscore', formula: 'mean of the available components' },
    ],
  },
  {
    id: 'equity_etf', group: 'ETFs and Treasuries', title: 'Equity ETF components (equal weights)',
    text: ['Expense ratio: the fund\'s latest 485BPOS prospectus filing on SEC EDGAR, XBRL element oef:NetExpensesOverAssets for the share class (oef:ExpensesOverAssets if no net figure is tagged). Fund size: net assets from the latest N-PORT filing. Each value is labelled with its filing type and date. A fund whose filings lack the field shows "unavailable (not in SEC filing)" and the component is excluded. Liquidity is scored from IEX-feed dollar volume; fund size is shown for reference.'],
    formulas: [
      { label: 'Expense ratio', formula: 'score = clamp(100·(1 − ER/1%))' },
      { label: 'Liquidity', formula: 'score = clamp(100·(log10(ADV$) − 6)/3), ADV$ = mean(close × volume) over 63 days' },
      { label: 'Momentum', formula: 'score = clamp(50 + 100·M), M = P[t−21]/P[t−252] − 1' },
      { label: 'Volatility', formula: 'score = clamp(100·(60% − σ)/45%)' },
      { label: 'Max drawdown', formula: 'score = clamp(100 + 125·MDD)' },
      { label: 'Sharpe', formula: 'score = clamp(50 + 25·S)' },
    ],
  },
  {
    id: 'bond_etf', group: 'ETFs and Treasuries', title: 'Bond ETF components (equal weights)',
    text: ['The yield uses trailing-12-month cash distributions (Alpaca corporate actions); the SEC 30-day yield is not a field in N-PORT or in the prospectus XBRL, so it is always "unavailable (not in SEC filing)". Duration comes from the fund\'s own N-PORT filing (Item B.3.a interest-rate risk): total DV01 divided by net assets; when a filing omits it (funds under 25% debt need not report it) the empirical duration against 10-year yield changes (FRED DGS10) is used and labelled. Credit quality is the N-PORT split of credit-spread risk between investment-grade and non-investment-grade holdings (Item B.3.b); N-PORT carries no letter ratings, so no rating-by-rating breakdown exists.'],
    formulas: [
      { label: 'Distribution yield', formula: 'score = clamp(100·Y/6%), Y = TTM distributions / price' },
      { label: 'Duration (N-PORT)', formula: 'D = Σ DV01 / net assets × 10,000; score = clamp(100 − 5·D)', note: 'DV01 summed over the 3-month, 1, 5, 10 and 30-year buckets and all currencies.' },
      { label: 'Duration (fallback)', formula: 'D_emp = −cov(fund returns, Δy_10)/var(Δy_10) over 1 year', note: 'Used only when the filing reports no DV01.' },
      { label: 'Credit quality', formula: 'IG share = DV01_IG / (DV01_IG + DV01_nonIG); score = clamp(100 × IG share)' },
      { label: 'Spread', formula: 'score = clamp(50 + 25·(Y − y_T)), y_T = Treasury yield at the tenor nearest the duration' },
      { label: 'Volatility', formula: 'score = clamp(100·(15% − σ)/13%)' },
      { label: 'Max drawdown', formula: 'score = clamp(100 + 250·MDD)' },
    ],
  },
  {
    id: 'treasury', group: 'ETFs and Treasuries', title: 'Treasury components (US2Y, US5Y, US10Y, US30Y)',
    text: ['Yields come from FRED (DGS2, DGS5, DGS10, DGS30). Daily returns are approximated from yield changes.'],
    formulas: [
      { label: 'Yield', formula: 'score = clamp(100·y/6%)' },
      { label: 'Duration', formula: 'score = clamp(100 − 5·D_mod); par bond: D_mac = [(1+c)/c·(1 − (1+c)^−n)]/2, D_mod = D_mac/(1+c)' },
      { label: 'Curve position', formula: 'score = clamp(50 + 50·(y − y_3mo))' },
      { label: 'Return approximation', formula: 'r_t = −D_mod(y_{t−1})·Δy_t + y_{t−1}/252' },
    ],
  },
  {
    id: 'grader', group: 'Portfolio', title: 'Portfolio Conviction Score (Grade)',
    text: ['Pillar weights: Holding quality 40%, Diversification 30%, Risk 30%; re-normalized over the available pillars.'],
    formulas: [
      { label: 'Holding quality', formula: 'Q = Σ wᵢ·Sᵢ / Σ wᵢ over holdings with a score' },
      { label: 'Concentration', formula: 'H = Σ wᵢ²; score = clamp(100·(1 − H)/0.9)' },
      { label: 'Correlation', formula: 'ρ̄ = mean pairwise correlation of 1-year daily returns; score = clamp(100·(1 − ρ̄))' },
      { label: 'Asset-class mix', formula: 'H_c = Σ (class weight)²; score = clamp(100·(1 − H_c)/0.75)' },
      { label: 'Risk pillar', formula: 'mean of volatility clamp(100·(60% − σ)/45%), beta clamp(125 − 50β), max drawdown clamp(100 + 125·MDD), VaR₉₅ clamp(100·(1 − VaR/4%)), Sharpe clamp(50 + 25·S)', note: 'Volatility, beta, VaR and Sharpe use the last 252 days of the constant-weight portfolio return; max drawdown uses the full common window.' },
      { label: 'Benchmarks', formula: 'SPY, and 60/40 = 0.6·R_SPY + 0.4·R_AGG (daily rebalanced)' },
    ],
  },
  {
    id: 'thesis', group: 'Portfolio', title: 'Thesis and target feasibility',
    text: ['Optional on the Grade tab: a time horizon, a required growth and a written thesis produce a blended score of weighted stock conviction, target feasibility and portfolio risk (default blend 50 / 30 / 20, editable in Settings).'],
    formulas: [
      { label: 'Weighted conviction', formula: 'C_p = Σ wᵢ·Cᵢ' },
      { label: 'Target feasibility', formula: 'bootstrap Monte Carlo, 10,000 paths of H trading days drawn with replacement from joint daily returns; G_p = Σ wᵢ·(exp(Σ r_{i,d}) − 1); targetScore = 100 × P(G_p ≥ target)' },
      { label: 'Portfolio risk', formula: 'mean of volScore, betaScore, ddScore and divScore = clamp(100·(DR − 1)/0.5), DR = (Σ wᵢσᵢ)/σ_p' },
    ],
  },
  {
    id: 'optimizer', group: 'Portfolio', title: 'Optimizer (mean-variance, max Sharpe)',
    text: ['Up to 3 years of common daily returns. Constraints: Σw = 1, 2% ≤ wᵢ ≤ 30%, σ_p ≤ cap. Caps: Conservative 8%, Moderate 14%, Aggressive 22%. If no mix meets the cap the minimum-variance mix is shown and labelled infeasible. With fewer than 4 assets the 30% ceiling is relaxed to 1/N. Always: optimized on historical data; past performance does not predict future results.'],
    formulas: [
      { label: 'Inputs', formula: 'μ = mean(daily returns)·252; Σ = cov(daily returns)·252' },
      { label: 'Portfolio', formula: 'μ_p = wᵀμ; σ_p = √(wᵀΣw); Sharpe = (μ_p − R_f)/σ_p' },
      { label: 'Frontier', formula: 'for each λ: max wᵀμ − λ·wᵀΣw by projected gradient onto {Σw = 1, lo ≤ w ≤ hi}; bisection on λ to the cap when it binds' },
      { label: 'Whole shares', formula: 'shares = floor(amount·wᵢ / priceᵢ); leftover = amount − Σ shares·price (Treasuries in $100 par units)' },
    ],
  },
  {
    id: 'stress', group: 'Portfolio', title: 'Stress test',
    text: [
      'Historical scenarios replay actual daily closes with the current weights held constant (rebalanced daily). Returns are price returns (split-adjusted, no dividends), the same basis as the rest of the app. Holdings without data for a scenario are excluded and the remaining weights re-normalized; coverage is shown. Below 50% coverage the scenario is Unavailable — insufficient history. Daily price history from the current provider (Alpaca, SIP feed) begins on 2016-01-04, so the dot-com and 2008 scenarios are unavailable for stocks and ETFs; Treasuries use FRED yields, which reach back further.',
      'Hypothetical shocks are model estimates, not historical data.',
    ],
    formulas: [
      ...STRESS_SCENARIOS.map((s) => ({ label: s.name, formula: `${s.start} to ${s.end} (SPY peak to trough)` })),
      { label: 'Scenario return', formula: 'R = Π(1 + Σ wᵢ·R_{i,t}) − 1 over the scenario days' },
      { label: 'Max drawdown', formula: 'MDD = min_t (V_t / max_{u≤t} V_u − 1) within the scenario' },
      { label: 'Recovery time', formula: 'trading days after the scenario end until V_t ≥ V_start, or "not yet recovered"' },
      { label: 'Contribution to loss', formula: 'wᵢ·R_i (share of the portfolio return)' },
      { label: 'Market shock', formula: 'estimated return = β × shock (equities and equity ETFs), shock = −10% or −20%' },
      { label: 'Rate shock', formula: 'estimated price change = −duration × Δrate (bond ETFs and Treasuries), Δrate = +1% or +2%' },
      { label: 'Coverage', formula: 'sum of weights of holdings with the needed input; excluded holdings are listed' },
    ],
  },
  {
    id: 'backtest', group: 'Analyze', title: 'Backtest statistics',
    text: ['Scores computed with only the data available on the as-of date, compared with what happened next.'],
    formulas: [
      { label: 'Pearson', formula: 'r = Σ(xᵢ − x̄)(yᵢ − ȳ) / √(Σ(xᵢ − x̄)²·Σ(yᵢ − ȳ)²)' },
      { label: 'Spearman', formula: 'Pearson correlation of the ranks (ties get the average rank)' },
      { label: 'Buckets', formula: 'mean forward return and share beating SPY per score band' },
      { label: 'Direction hit rate', formula: 'among non-Neutral names: (score ≥ 60 and beat SPY) or (score < 40 and trailed SPY)' },
    ],
  },
  {
    id: 'compare', group: 'Analyze', title: 'Compare',
    text: ['Two tickers run the full six-model analysis; every subscore and key metric is shown side by side and the better value is highlighted where "better" is unambiguous.'],
    formulas: [],
  },
  {
    id: 'track', group: 'Analyze', title: 'Track Record',
    text: [
      'Every completed analysis is saved to the log with ticker, asset type, mode, score, label, app version, timestamp and the price at run time (Alpaca latest daily close; Treasuries have no traded price). The log is private: reads need the owner passcode; the public can only append valid rows (database row-level security enforces the shape).',
      'The base date is the last completed daily close at the moment of the run (U.S. Eastern time: runs at or after 16:00 use that day\'s close, earlier runs use the previous trading day). A window whose end date has not happened yet is "pending", never a partial number. Buckets with fewer than 30 completed runs carry a "small sample, not statistically meaningful" warning.',
    ],
    formulas: [
      { label: 'Forward return', formula: 'R_h = C[t0 + h] / C[t0] − 1, h = 21, 63, 126 trading days', note: 'Alpaca SIP daily closes, split-adjusted, no dividends.' },
      { label: 'Excess return', formula: 'X_h = R_h − R_SPY,h over exactly the same two dates' },
      { label: 'Hit rate', formula: 'share of completed runs in the bucket with X_h > 0' },
      { label: 'Spearman ρ', formula: 'Pearson correlation of rank(score) and rank(X_h); ties get the average rank; needs n ≥ 3' },
      { label: 'Keep-alive', formula: 'Vercel Cron, daily 09:17 UTC, one-row SELECT through the server with a server-side secret', note: 'Prevents the free database from pausing after a week idle.' },
    ],
  },
  {
    id: 'sources', group: 'Data', title: 'Data sources and limitations',
    text: [
      'Prices: Alpaca Market Data (IEX feed for analysis, SIP feed for stress-test history), split-adjusted daily closes. Fundamentals: SEC EDGAR XBRL company facts (annual filings, can be up to a year old). Earnings and insiders: Finnhub. Treasury yields, the yield curve and the risk-free rate: FRED (DGS series), with the U.S. Treasury daily curve as a fallback. ETF cash distributions: Alpaca corporate actions. Fund facts: SEC EDGAR filings (485BPOS prospectus XBRL for the expense ratio; N-PORT for net assets, holdings, interest-rate and credit-spread risk), each labelled with filing type and date; the SEC 30-day yield and letter ratings are not in those filings and stay unavailable. Individual bonds by CUSIP: no provider. Pre-2016 price history (dot-com and 2008 stress scenarios): no free source whose terms allow display on a public site was found (Alpaca begins 2016-01-04; Tiingo\'s free tier is "Internal Use Only"; Alpha Vantage\'s free licence is "personal, non-commercial use"; Stooq blocks server requests), so those scenarios stay unavailable rather than use a proxy.',
      'Every API call runs on the server; no key reaches the browser. The analysis log stores computed values only, never AI text. Saved portfolios live only in this browser.',
      'It is not investment advice and does not predict the future. The DCF is deliberately conservative; the Monte Carlo and target simulations assume the near future resembles the recent past; the backtest exists so these weaknesses can be seen rather than hidden.',
    ],
    formulas: [],
  },
];

export const GROUPS = ['How it works', 'Stock models', 'ETFs and Treasuries', 'Portfolio', 'Analyze', 'Data'];

export function searchSections(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return SECTIONS;
  return SECTIONS.filter((s) => [s.title, s.group, ...s.text, ...s.formulas.flatMap((f) => [f.label, f.formula, f.note || ''])].join(' ').toLowerCase().includes(q));
}
