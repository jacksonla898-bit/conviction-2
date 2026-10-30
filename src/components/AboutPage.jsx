import React from 'react';
import { REPO_URL, EXAMPLE_TICKERS, MATH_MODE_LABEL } from '../config.js';

const MODELS = [
  ['Valuation (DCF)', 'What is the business worth based on the cash it generates? Projects five years of free cash flow from SEC filings, discounts it at a rate that reflects the stock\'s risk, and compares the result with the price.', '20%'],
  ['Monte Carlo', 'What range of prices is plausible a year from now? Simulates 10,000 possible years from the stock\'s own recent drift and volatility and reports the odds of ending higher than today.', '15%'],
  ['Risk', 'How bumpy is the ride? Volatility, how closely the stock tracks the market (beta), return per unit of risk (Sharpe), and the worst fall from a peak in five years.', '15%'],
  ['Momentum', 'Is the trend up or down? The past year\'s return, position against the 50- and 200-day averages, and whether the recent move is stretched (RSI).', '15%'],
  ['Financial health', 'Is this a good business? Revenue growth, margins, debt relative to equity, liquidity and the free-cash-flow trend, all from annual filings.', '20%'],
  ['Earnings & insiders', 'Does the company clear the bar, and what do insiders do with their own money? Analyst-estimate beat rate and six months of open-market insider buying versus selling.', '15%'],
];

export default function AboutPage({ onTry }) {
  return (
    <div className="space-y-5">
      <section className="card p-5 md:p-6 space-y-3 text-sm text-ink-2 leading-relaxed">
        <h2 className="text-lg font-semibold text-ink">How Conviction 2.0 works</h2>
        <p>Type a ticker and the app pulls five years of prices, the company's annual SEC filings, its earnings history and its insider trades, then runs six independent models on that data in your browser. Each model turns its findings into a 0 to 100 subscore using a fixed, published rule. The conviction score is the weighted average of the subscores that could be computed.</p>
        <p>Two ideas drive the design. First, <strong className="text-ink">nothing is a black box</strong>: every formula, every input and every intermediate number is shown in "{MATH_MODE_LABEL}" mode, and the AI in Standard mode is only allowed to explain numbers the models already produced. Second, <strong className="text-ink">the model should be testable</strong>: the Backtest tab scores stocks using only the information that existed on a past date and shows what happened next, including when the score was wrong.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {EXAMPLE_TICKERS.map((t) => <button key={t} className="btn text-xs" onClick={() => onTry(t)}>Try {t}</button>)}
        </div>
      </section>

      <section className="card p-5 md:p-6">
        <h3 className="font-semibold mb-3">From data to score</h3>
        <Diagram />
      </section>

      <section className="card p-5 md:p-6">
        <h3 className="font-semibold mb-3">The six models</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {MODELS.map(([name, text, w]) => (
            <div key={name} className="rounded-lg bg-surface-2 p-3">
              <div className="flex items-baseline justify-between"><div className="font-semibold text-sm">{name}</div><div className="text-[11px] text-muted">default weight {w}</div></div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5 md:p-6 space-y-3 text-sm text-ink-2 leading-relaxed">
        <h3 className="font-semibold text-ink">Portfolio mode</h3>
        <p>Enter several holdings with any weights, a time horizon, the growth you need and your thesis in your own words. Every holding gets the full six-model treatment; then the app combines their scores by weight, simulates the whole basket over your horizon by replaying real historical days for all holdings together (so correlations are kept), and measures the basket's risk and how much diversification it really gets. The result is one score for the plan, not just for the stocks.</p>
      </section>

      <section className="card p-5 md:p-6 space-y-3 text-sm text-ink-2 leading-relaxed">
        <h3 className="font-semibold text-ink">ETFs, Treasuries, the Grader and the Optimizer</h3>
        <p>The Stock box also accepts an equity ETF, a bond ETF or a Treasury (US2Y, US5Y, US10Y, US30Y). The asset type is detected on the server and the matching components run: for an equity ETF, expense ratio, liquidity, momentum, volatility, drawdown and Sharpe; for a bond ETF, distribution yield, duration, credit quality, spread versus the matching Treasury, volatility and drawdown; for a Treasury, its yield, duration and where it sits on the yield curve. Fund facts the free data plans do not provide (expense ratio, assets under management, SEC yield, official duration, credit quality) are shown as unavailable and left out of the score, with the remaining weights re-normalized.</p>
        <p>The <strong className="text-ink">Grader</strong> scores a whole portfolio: 40% holding quality (the holdings' own scores, weighted), 30% diversification (concentration, average correlation, mix of asset classes) and 30% risk (volatility, beta, drawdown, value at risk, Sharpe). The <strong className="text-ink">Optimizer</strong> finds the weights with the best historical Sharpe ratio for a chosen risk level, keeping every holding between 2% and 30%, and turns them into whole shares for your dollar amount. It is optimized on historical data; past performance does not predict future results.</p>
      </section>

      <section className="card p-5 md:p-6 space-y-3 text-sm text-ink-2 leading-relaxed">
        <h3 className="font-semibold text-ink">What it is not</h3>
        <p>It is not investment advice, and it does not predict the future. The DCF is deliberately conservative and will call most fast-growing, highly valued companies expensive. The Monte Carlo and target simulations assume the near future resembles the recent past. Fundamentals come from annual filings and can be up to a year old. The backtest lets you see these weaknesses for yourself rather than hiding them.</p>
        <h3 className="font-semibold text-ink pt-2">Data and code</h3>
        <p>Prices: Alpaca Market Data (IEX feed). Fundamentals: SEC EDGAR XBRL company facts. Earnings and insider transactions: Finnhub. Treasury yields, risk-free rate and the yield curve: FRED (Federal Reserve Bank of St. Louis), with the U.S. Treasury daily yield curve as a fallback. ETF cash distributions: Alpaca corporate actions. Explanations in Standard mode: Claude (Anthropic), fed only computed numbers. All model math is hand-written JavaScript with no finance libraries; the source is at <a className="text-s1 hover:underline" href={REPO_URL} target="_blank" rel="noreferrer">{REPO_URL.replace('https://', '')}</a>.</p>
      </section>
    </div>
  );
}

function Diagram() {
  const sources = ['Alpaca prices', 'SEC EDGAR filings', 'Finnhub earnings', 'Finnhub insiders'];
  const models = ['DCF', 'Monte Carlo', 'Risk', 'Momentum', 'Health', 'Earn & insiders'];
  const W = 720;
  return (
    <svg viewBox={`0 0 ${W} 250`} className="w-full h-auto" role="img" aria-label="Data sources feed six models, whose subscores are averaged into one conviction score">
      {sources.map((s, i) => (
        <g key={s}>
          <rect x={10} y={20 + i * 55} width={150} height={38} rx={8} fill="#222221" stroke="#383835" />
          <text x={85} y={44 + i * 55} textAnchor="middle" fill="#c3c2b7" fontSize="12">{s}</text>
        </g>
      ))}
      {models.map((m, i) => (
        <g key={m}>
          <rect x={290} y={10 + i * 38} width={140} height={30} rx={8} fill="#1c2a3f" stroke="#3987e5" />
          <text x={360} y={30 + i * 38} textAnchor="middle" fill="#ffffff" fontSize="12">{m}</text>
          <line x1={430} y1={25 + i * 38} x2={540} y2={125} stroke="#383835" strokeWidth="1.5" />
        </g>
      ))}
      {[[0, 1], [0, 2], [0, 3], [0, 0], [1, 0], [1, 4], [2, 5], [3, 5]].map(([s, m], k) => (
        <line key={k} x1={160} y1={39 + s * 55} x2={290} y2={25 + m * 38} stroke="#383835" strokeWidth="1.5" />
      ))}
      <text x={225} y={242} textAnchor="middle" fill="#898781" fontSize="11">each model → 0–100 subscore + published rule</text>
      <rect x={540} y={95} width={170} height={60} rx={10} fill="#1a1a19" stroke="#9085e9" strokeWidth="1.5" />
      <text x={625} y={120} textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="700">Conviction score</text>
      <text x={625} y={140} textAnchor="middle" fill="#c3c2b7" fontSize="11">weighted average, 0–100</text>
      <text x={625} y={180} textAnchor="middle" fill="#898781" fontSize="11">Low · Neutral · High · Very High</text>
      <text x={625} y={200} textAnchor="middle" fill="#898781" fontSize="11">missing models are excluded and</text>
      <text x={625} y={214} textAnchor="middle" fill="#898781" fontSize="11">weights are rescaled</text>
    </svg>
  );
}
