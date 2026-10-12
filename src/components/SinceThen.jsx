import React from 'react';
import { fmt, fmtPct } from '../models/_math.js';
import { ForwardPathChart } from './charts.jsx';

/** Shown under an as-of analysis: what the stock actually did after the as-of date. */
export default function SinceThen({ ticker, forward, score, label }) {
  if (!forward) return null;
  const f = forward;
  const verdict =
    score === null ? null
    : score >= 60 ? (f.excess !== null && f.excess > 0 ? 'The score leaned positive and the stock went on to beat the market.' : f.excess !== null ? 'The score leaned positive but the stock trailed the market.' : 'The score leaned positive.')
    : score < 40 ? (f.excess !== null && f.excess < 0 ? 'The score leaned negative and the stock went on to trail the market.' : f.excess !== null ? 'The score leaned negative but the stock beat the market anyway.' : 'The score leaned negative.')
    : 'The score was Neutral, so it did not take a side.';
  return (
    <section className="card p-4 md:p-5" id="since-then">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">What happened next</h2>
        <span className="text-xs text-muted">{f.asOfDate} → {f.latestDate} ({f.tradingDays} trading days)</span>
      </header>
      <p className="text-sm text-ink-2 mt-1">
        Everything above was computed using only data available on {f.asOfDate}, when {ticker} closed at ${fmt(f.asOfClose)} and scored {score ?? '—'} ({label}). Since then the stock returned <span className="num text-ink">{fmtPct(f.stockReturn, 1)}</span>
        {f.spyReturn !== null && <> versus <span className="num text-ink">{fmtPct(f.spyReturn, 1)}</span> for SPY, a difference of <span className="num text-ink">{f.excess >= 0 ? '+' : ''}{fmtPct(f.excess, 1)}</span></>}. {verdict}
      </p>
      <div className="mt-3">
        <ForwardPathChart path={f.path} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
        {[['Close then', `$${fmt(f.asOfClose)}`], ['Close now', `$${fmt(f.latestClose)}`], ['Stock return', fmtPct(f.stockReturn, 1)], ['SPY return', f.spyReturn === null ? 'n/a' : fmtPct(f.spyReturn, 1)]].map(([l, v]) => (
          <div key={l}><div className="uppercase tracking-wide text-muted text-[11px]">{l}</div><div className="num text-ink">{v}</div></div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-3">One stock on one date proves nothing either way; use the Backtest tab to try many stocks at once.</p>
    </section>
  );
}
