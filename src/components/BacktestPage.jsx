import React, { useRef, useState } from 'react';
import { runStockAnalysis } from '../lib/pipeline.js';
import { api } from '../lib/api.js';
import { backtestStats } from '../models/backtest.js';
import { scoreLabel } from '../models/conviction.js';
import { fmt, fmtPct } from '../models/_math.js';
import { ScoreReturnScatter } from './charts.jsx';
import { MathModeBadge } from './Reasoning.jsx';

const DEFAULT_TICKERS = 'AAPL MSFT NVDA AMZN GOOGL META JPM XOM UNH KO INTC BA';
const CONCURRENCY = 3;

function defaultDate(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

export default function BacktestPage({ settings, onOpenStock }) {
  const [tickersText, setTickersText] = useState(DEFAULT_TICKERS);
  const [asOf, setAsOf] = useState(defaultDate(12));
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState([]);
  const [rf, setRf] = useState(null);
  const [done, setDone] = useState(false);
  const runId = useRef(0);

  const run = async (e) => {
    e.preventDefault();
    const tickers = [...new Set(tickersText.toUpperCase().split(/[\s,;]+/).filter((t) => /^[A-Z0-9.\-]{1,10}$/.test(t)))].slice(0, 30);
    if (!tickers.length || !asOf) return;
    runId.current += 1;
    const my = runId.current;
    setRunning(true);
    setDone(false);
    setRows(tickers.map((t) => ({ ticker: t, status: 'queued' })));

    // Risk-free rate as it stood on the as-of date
    let rfInfo = null;
    const rfRes = await api.riskfree(asOf);
    if (rfRes.ok) rfInfo = rfRes.data;
    if (runId.current !== my) return;
    setRf(rfInfo);
    const runSettings = {
      ...settings,
      asOf,
      riskFreeRate: settings.riskFreeAuto === false ? settings.riskFreeRate : rfInfo ? String(rfInfo.rate) : '',
      riskFreeSource: settings.riskFreeAuto === false ? 'Settings (manual entry)' : rfInfo ? `Treasury 3-month yield as of ${rfInfo.asOf}` : 'unavailable',
    };

    const results = tickers.map((t) => ({ ticker: t, status: 'queued' }));
    const update = () => {
      if (runId.current === my) setRows(results.map((r) => ({ ...r })));
    };
    let next = 0;
    const worker = async () => {
      while (next < tickers.length) {
        const i = next++;
        results[i].status = 'loading';
        update();
        try {
          const a = await runStockAnalysis(tickers[i], runSettings, { asOf });
          results[i] = {
            ticker: tickers[i],
            status: a.error ? 'failed' : 'done',
            error: a.error,
            score: a.conviction.score,
            label: a.conviction.label,
            priceThen: a.price,
            forwardReturn: a.forward ? a.forward.stockReturn : null,
            spyReturn: a.forward ? a.forward.spyReturn : null,
            excess: a.forward ? a.forward.excess : null,
            latestDate: a.forward ? a.forward.latestDate : null,
            subscores: Object.fromEntries(Object.entries(a.results).map(([id, r]) => [id, r.available ? r.subscore : null])),
          };
        } catch (ex) {
          results[i] = { ticker: tickers[i], status: 'failed', error: ex.message };
        }
        update();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tickers.length) }, worker));
    if (runId.current !== my) return;
    setRunning(false);
    setDone(true);
  };

  const scored = rows.filter((r) => r.status === 'done');
  const stats = done ? backtestStats(scored) : null;
  const spyAvg = stats && Number.isFinite(stats.spyAvg) ? stats.spyAvg : null;

  return (
    <div className="space-y-5">
      <form className="card p-4 md:p-5 space-y-4" onSubmit={run}>
        <div>
          <h2 className="font-semibold">Backtest the score</h2>
          <p className="text-xs text-muted mt-1">Pick a date in the past. Each stock is scored using only data that existed on that date (prices up to it, filings filed by it, earnings reported by it), then compared with what the stock did afterwards. This is the honest test of whether the score means anything.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_200px_auto] md:items-end">
          <label className="block"><div className="text-xs text-ink-2 mb-1">Tickers (space or comma separated, up to 30)</div><textarea className="input min-h-[60px] uppercase" value={tickersText} onChange={(e) => setTickersText(e.target.value)} spellCheck={false} /></label>
          <label className="block"><div className="text-xs text-ink-2 mb-1">Score as of</div><input className="input" type="date" value={asOf} max={defaultDate(1)} onChange={(e) => setAsOf(e.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={running}>{running ? 'Running…' : 'Run backtest'}</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-muted self-center">Quick dates:</span>
          {[[3, '3 months ago'], [6, '6 months ago'], [12, '1 year ago'], [24, '2 years ago'], [36, '3 years ago']].map(([m, l]) => <button key={m} type="button" className="btn text-xs" onClick={() => setAsOf(defaultDate(m))}>{l}</button>)}
          <span className="text-muted self-center ml-auto">About 10 seconds per stock.</span>
        </div>
      </form>

      {rows.length > 0 && (
        <section className="card p-4 md:p-5 overflow-x-auto">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h3 className="font-semibold">Scores as of {asOf}{rows[0]?.latestDate ? ` → returns to ${scored[0]?.latestDate || ''}` : ''}</h3>
            {rf && <span className="text-xs text-muted">Risk-free rate used: {Number(rf.rate).toFixed(2)}% (Treasury, {rf.asOf})</span>}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted">
                <th className="text-left p-1 font-medium">Ticker</th>
                <th className="text-right p-1 font-medium">Score then</th>
                <th className="text-left p-1 font-medium">Label</th>
                <th className="text-right p-1 font-medium">Price then</th>
                <th className="text-right p-1 font-medium">Return since</th>
                <th className="text-right p-1 font-medium">SPY</th>
                <th className="text-right p-1 font-medium">vs SPY</th>
                <th className="text-left p-1 font-medium">Subscores (DCF/MC/Risk/Mom/Health/Earn)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker} className="border-t border-line">
                  <td className="p-1"><button className="text-s1 hover:underline font-semibold" onClick={() => onOpenStock(r.ticker, asOf)} title="Open the as-of analysis">{r.ticker}</button></td>
                  {r.status === 'done' ? (
                    <>
                      <td className="p-1 text-right num">{r.score}</td>
                      <td className="p-1" style={{ color: r.score >= 60 ? '#3ecf3e' : r.score < 40 ? '#e66767' : '#fab219' }}>{r.label}</td>
                      <td className="p-1 text-right num">${fmt(r.priceThen)}</td>
                      <td className="p-1 text-right num">{fmtPct(r.forwardReturn, 1)}</td>
                      <td className="p-1 text-right num text-muted">{r.spyReturn === null ? 'n/a' : fmtPct(r.spyReturn, 1)}</td>
                      <td className="p-1 text-right num" style={{ color: r.excess === null ? '#898781' : r.excess >= 0 ? '#3ecf3e' : '#e66767' }}>{r.excess === null ? 'n/a' : `${r.excess >= 0 ? '+' : ''}${fmtPct(r.excess, 1)}`}</td>
                      <td className="p-1 num text-muted">{['dcf', 'monteCarlo', 'risk', 'momentum', 'health', 'earnings'].map((id) => (r.subscores[id] ?? 'n/a')).join(' / ')}</td>
                    </>
                  ) : (
                    <td className="p-1 text-muted" colSpan={7}>{r.status === 'loading' ? <span className="inline-flex items-center gap-2"><span className="inline-block w-3 h-3 border-2 border-s1 border-t-transparent rounded-full animate-spin" />analyzing…</span> : r.status === 'failed' ? <span className="text-[#e66767]">{r.error}</span> : 'queued'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {stats && (
        <>
          <section className="card p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-semibold">Did the score predict anything?</h3>
              <MathModeBadge />
            </div>
            <p className="text-sm text-ink-2 leading-relaxed">{stats.summary}</p>
            {stats.n >= 3 && (
              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_280px]">
                <div>
                  <div className="text-xs text-ink-2 mb-1">Score as of {asOf} vs return since (each dot is a stock; dashed line = SPY)</div>
                  <ScoreReturnScatter rows={scored} spyReturn={spyAvg} />
                </div>
                <div className="text-xs space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Spearman ρ" value={fmt(stats.spearman, 2)} />
                    <Stat label="Pearson r" value={fmt(stats.pearson, 2)} />
                    <Stat label="Direction hit rate" value={stats.hitRate === null ? 'n/a' : `${fmtPct(stats.hitRate, 0)} (${stats.hits}/${stats.decided})`} />
                    <Stat label="SPY over period" value={spyAvg === null ? 'n/a' : fmtPct(spyAvg, 1)} />
                  </div>
                  <table className="w-full num">
                    <thead><tr className="text-muted"><th className="text-left font-medium">Bucket</th><th className="text-right font-medium">n</th><th className="text-right font-medium">Avg return</th><th className="text-right font-medium">Beat SPY</th></tr></thead>
                    <tbody>
                      {stats.buckets.map((b) => (
                        <tr key={b.label} className="border-t border-line"><td className="py-1 text-ink-2">{b.label}</td><td className="py-1 text-right">{b.n}</td><td className="py-1 text-right">{b.n ? fmtPct(b.avgReturn, 1) : '—'}</td><td className="py-1 text-right">{b.n ? fmtPct(b.beatSpy, 0) : '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
          <section className="card p-4 md:p-5">
            <h3 className="text-sm font-semibold mb-2">How these statistics were computed</h3>
            <div className="overflow-x-auto">
              <table className="steps-table">
                <thead><tr><th>Step</th><th>Formula</th><th>Calculation</th><th>Result</th></tr></thead>
                <tbody>{stats.steps.map((s, i) => <tr key={i}><td className="text-ink-2 whitespace-nowrap">{s.label}</td><td className="num text-ink-2">{s.formula}</td><td className="num text-ink-2">{s.calc}</td><td className="num text-ink font-semibold whitespace-nowrap">{s.result}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted mt-2">Point-in-time caveats: fundamentals use the filing date (so a 10-K filed after the as-of date is excluded); earnings quarters are counted only if they ended at least 35 days before the as-of date, and because the free data tier only returns the last four quarters, as-of dates older than about a year lose the earnings-surprise component (the insider half still runs); insider trades use the six months before it. Prices are split-adjusted, so very old dates on stocks with later splits are still comparable. Survivorship: you choose the tickers today, so delisted companies cannot appear.</p>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-surface-2 p-2"><div className="text-[10px] uppercase tracking-wide text-muted">{label}</div><div className="num text-ink">{value}</div></div>
  );
}

export { scoreLabel };
