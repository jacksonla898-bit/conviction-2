import React, { useState } from 'react';
import { EXAMPLE_TICKERS } from '../config.js';
import { labelText, scoreClass } from '../lib/labels.js';

/** Home: one large search box, "Build a portfolio", recently analyzed tickers. */
export default function HomePage({ onAnalyze, onBuildPortfolio, recent, onClearRecent, onMethodology }) {
  const [q, setQ] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (q.trim()) onAnalyze(q.trim().toUpperCase());
  };
  return (
    <div className="space-y-6">
      <section className="card p-6 md:p-10">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Six models, one score, every number shown.</h1>
        <p className="text-sm md:text-base text-ink-2 mt-2 max-w-2xl leading-relaxed">Analyze any US stock, ETF, bond ETF or Treasury, or grade, optimize and stress-test a whole portfolio. Each model shows its formula, inputs and result; nothing is estimated.</p>
        <form className="mt-6 flex flex-col sm:flex-row gap-3" onSubmit={submit}>
          <label className="flex-1">
            <span className="sr-only">Ticker</span>
            <input className="input text-lg md:text-xl py-3 uppercase" placeholder="Enter a ticker: stock, ETF, bond ETF, or Treasury" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoFocus />
          </label>
          <button type="submit" className="btn btn-primary text-base px-6" disabled={!q.trim()}>Analyze</button>
          <button type="button" className="btn text-base px-6" onClick={onBuildPortfolio}>Build a portfolio</button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Try:</span>
          {[...EXAMPLE_TICKERS, 'SPY', 'TLT', 'US10Y'].map((t) => <button key={t} className="btn btn-sm" onClick={() => onAnalyze(t)}>{t}</button>)}
          <button className="text-accent hover:underline ml-1" onClick={onMethodology}>How it works →</button>
        </div>
      </section>

      {recent && recent.length > 0 && (
        <section className="card p-5">
          <header className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Recently analyzed</h2>
            <button className="btn btn-ghost btn-sm" onClick={onClearRecent}>Clear</button>
          </header>
          <div className="flex flex-wrap gap-2">
            {recent.slice(0, 12).map((h) => (
              <button key={h.time || h.ticker + h.date} className="btn btn-sm" onClick={() => onAnalyze(h.ticker)} title={`${h.date}`}>
                <span className="font-bold">{h.ticker}</span>
                <span className={`pill num ${scoreClass(h.score)}`}>{h.score ?? '—'}</span>
                <span className="text-muted">{labelText(h.label)} · {h.date}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-2">Saved in this browser only. The full log of runs is under Analyze → History.</p>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['Analyze', 'A stock gets six models: valuation, Monte Carlo, risk, momentum, financial health, earnings and insiders. ETFs and Treasuries get their own components. Compare two tickers or backtest the score on a past date.'],
          ['Portfolio', 'Grade a mix on holding quality, diversification and risk; optimize weights for a risk level; stress-test against past crashes and rate shocks; keep portfolios in this browser.'],
          ['Methodology', 'Every weight, formula, scenario date and data source in one searchable place. Wharton mode shows only these templates, never AI text.'],
        ].map(([t, d]) => <div key={t} className="card p-5"><h3 className="font-semibold">{t}</h3><p className="text-sm text-ink-2 mt-1 leading-relaxed">{d}</p></div>)}
      </section>
    </div>
  );
}
