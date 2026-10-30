import React, { useState } from 'react';
import { runStockAnalysis } from '../lib/pipeline.js';
import { MODEL_ORDER, MODEL_LABELS } from '../models/conviction.js';
import { fmt, fmtPct, fmtMoney } from '../models/_math.js';
import { labelText } from '../lib/labels.js';

function labelColor(label) {
  switch (label) {
    case 'Low': return 'var(--score-bad)';
    case 'Neutral': return 'var(--score-warn)';
    case 'High': return 'var(--score-good)';
    case 'Very High': return 'var(--score-good)';
    default: return 'var(--muted)';
  }
}

// Rows: [label, getter, formatter, higherIsBetter]
const ROWS = [
  ['Price', (a) => a.price, (v) => `$${fmt(v)}`, null],
  ['DCF intrinsic value', (a) => a.results.dcf?.metrics?.intrinsicValue ?? null, (v) => `$${fmt(v)}`, null],
  ['DCF upside vs price', (a) => a.results.dcf?.metrics?.upside ?? null, (v) => fmtPct(v, 1), true],
  ['P(higher in 1 year)', (a) => a.results.monteCarlo?.metrics?.pAbove ?? null, (v) => fmtPct(v, 1), true],
  ['Median 1-year outcome', (a) => a.results.monteCarlo?.metrics?.medianReturn ?? null, (v) => fmtPct(v, 1), true],
  ['Annual volatility', (a) => a.results.risk?.metrics?.annualVol ?? null, (v) => fmtPct(v, 1), false],
  ['Beta vs SPY', (a) => a.results.risk?.metrics?.beta ?? null, (v) => fmt(v), false],
  ['Sharpe ratio', (a) => a.results.risk?.metrics?.sharpe ?? null, (v) => fmt(v), true],
  ['Max drawdown (5y)', (a) => a.results.risk?.metrics?.maxDD ?? null, (v) => fmtPct(v, 1), true],
  ['12-1 momentum', (a) => a.results.momentum?.metrics?.momentum12_1 ?? null, (v) => fmtPct(v, 1), true],
  ['RSI (14)', (a) => a.results.momentum?.metrics?.rsi14 ?? null, (v) => fmt(v, 0), null],
  ['Revenue (latest FY)', (a) => a.results.health?.metrics?.revenue ?? null, (v) => fmtMoney(v), null],
  ['Revenue growth YoY', (a) => a.results.health?.metrics?.revGrowth ?? null, (v) => fmtPct(v, 1), true],
  ['Net margin', (a) => a.results.health?.metrics?.netMargin ?? null, (v) => fmtPct(v, 1), true],
  ['Debt / equity', (a) => a.results.health?.metrics?.debtToEquity ?? null, (v) => fmt(v), false],
  ['Free cash flow (latest)', (a) => a.results.health?.metrics?.fcfLatest ?? null, (v) => fmtMoney(v), null],
  ['Earnings beat rate', (a) => a.results.earnings?.metrics?.beatRate ?? null, (v) => fmtPct(v, 0), true],
  ['Net insider shares (6m)', (a) => a.results.earnings?.metrics?.netShares ?? null, (v) => `${v >= 0 ? '+' : ''}${fmt(v, 0)}`, true],
];

export default function ComparePage({ settings, onOpenStock }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState(null);

  const run = async (e) => {
    e.preventDefault();
    const ta = a.trim().toUpperCase();
    const tb = b.trim().toUpperCase();
    if (!ta || !tb || ta === tb) return;
    setRunning(true);
    setErr(null);
    setOut(null);
    try {
      const [ra, rb] = await Promise.all([runStockAnalysis(ta, settings), runStockAnalysis(tb, settings)]);
      setOut([ra, rb]);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setRunning(false);
    }
  };

  const wins = out ? tally(out) : null;

  return (
    <div className="space-y-5">
      <form className="card p-4 md:p-5 flex flex-col sm:flex-row gap-3 sm:items-end" onSubmit={run}>
        <label className="flex-1"><div className="text-xs text-ink-2 mb-1">First ticker</div><input className="input uppercase" value={a} onChange={(e) => setA(e.target.value.toUpperCase())} placeholder="e.g. AAPL" spellCheck={false} /></label>
        <div className="text-muted text-sm self-center">vs</div>
        <label className="flex-1"><div className="text-xs text-ink-2 mb-1">Second ticker</div><input className="input uppercase" value={b} onChange={(e) => setB(e.target.value.toUpperCase())} placeholder="e.g. MSFT" spellCheck={false} /></label>
        <button className="btn btn-primary" type="submit" disabled={running || !a.trim() || !b.trim()}>{running ? 'Comparing…' : 'Compare'}</button>
      </form>

      {running && <div className="text-sm text-ink-2 flex items-center gap-2"><span className="inline-block w-4 h-4 border-2 border-s1 border-t-transparent rounded-full animate-spin" />Running all six models for both stocks…</div>}
      {err && <div className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{err}</div>}

      {out && (
        <>
          <section className="card p-5 md:p-6">
            <div className="grid grid-cols-2 gap-4">
              {out.map((r) => (
                <div key={r.ticker} className="text-center">
                  <button className="text-xl font-bold hover:underline" onClick={() => onOpenStock(r.ticker)}>{r.ticker}</button>
                  <div className="text-xs text-muted truncate">{r.companyName || ''}</div>
                  <div className="num text-5xl font-bold mt-2" style={{ color: labelColor(r.conviction.label) }}>{r.conviction.score ?? '—'}</div>
                  <div className="text-sm" style={{ color: labelColor(r.conviction.label) }}>{r.conviction.score === null ? r.error : `${labelText(r.conviction.label)} conviction`}</div>
                </div>
              ))}
            </div>
            {wins && <p className="text-sm text-ink-2 mt-4 text-center">{wins.sentence}</p>}
          </section>

          <section className="card p-4 md:p-5 overflow-x-auto">
            <h3 className="font-semibold mb-3">Model subscores</h3>
            <table className="w-full text-sm">
              <tbody>
                {MODEL_ORDER.map((id) => {
                  const va = out[0].results[id];
                  const vb = out[1].results[id];
                  const sa = va?.available ? va.subscore : null;
                  const sb = vb?.available ? vb.subscore : null;
                  return (
                    <tr key={id} className="border-t border-line">
                      <td className="py-2 text-ink-2">{MODEL_LABELS[id]}</td>
                      <Cell v={sa} other={sb} fmtv={(v) => v} better={true} note={!va?.available ? va?.error : null} />
                      <Cell v={sb} other={sa} fmtv={(v) => v} better={true} note={!vb?.available ? vb?.error : null} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="card p-4 md:p-5 overflow-x-auto">
            <h3 className="font-semibold mb-1">Key metrics</h3>
            <p className="text-xs text-muted mb-3">Green marks the better value where "better" is unambiguous (higher growth, lower volatility, and so on). Rows with no colour are informational.</p>
            <table className="w-full text-sm">
              <tbody>
                {ROWS.map(([label, get, f, higher]) => {
                  const va = get(out[0]);
                  const vb = get(out[1]);
                  return (
                    <tr key={label} className="border-t border-line">
                      <td className="py-2 text-ink-2">{label}</td>
                      <Cell v={va} other={vb} fmtv={f} better={higher} />
                      <Cell v={vb} other={va} fmtv={f} better={higher} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      {!out && !running && (
        <section className="card p-6 text-sm text-ink-2">Enter two tickers to run the full six-model analysis on both and see every subscore and key metric side by side. Click a ticker in the result to open its complete analysis.</section>
      )}
    </div>
  );
}

function Cell({ v, other, fmtv, better, note }) {
  const has = v !== null && v !== undefined && Number.isFinite(v);
  const hasOther = other !== null && other !== undefined && Number.isFinite(other);
  let color = 'var(--ink-2)';
  if (better !== null && has && hasOther && v !== other) {
    const win = better ? v > other : v < other;
    color = win ? 'var(--score-good)' : 'var(--ink-2)';
  }
  return <td className="py-2 text-right num" style={{ color }} title={note || ''}>{has ? fmtv(v) : 'n/a'}</td>;
}

function tally(out) {
  let a = 0;
  let b = 0;
  for (const id of MODEL_ORDER) {
    const sa = out[0].results[id]?.available ? out[0].results[id].subscore : null;
    const sb = out[1].results[id]?.available ? out[1].results[id].subscore : null;
    if (sa === null || sb === null) continue;
    if (sa > sb) a++;
    else if (sb > sa) b++;
  }
  const lead = a === b ? null : a > b ? out[0] : out[1];
  const trail = a === b ? null : a > b ? out[1] : out[0];
  const FRIENDLY = { dcf: 'valuation', monteCarlo: 'Monte Carlo', risk: 'risk', momentum: 'momentum', health: 'financial health', earnings: 'earnings and insiders' };
  const wonModels = (x, y) => MODEL_ORDER.filter((id) => x.results[id]?.available && y.results[id]?.available && x.results[id].subscore > y.results[id].subscore).map((id) => FRIENDLY[id] || MODEL_LABELS[id]);
  if (!lead) return { sentence: `${out[0].ticker} and ${out[1].ticker} split the models evenly (${a} each), so the overall scores are the tie-breaker.` };
  return {
    sentence: `${lead.ticker} leads on ${Math.max(a, b)} of the ${a + b} comparable models (${wonModels(lead, trail).join(', ')}); ${trail.ticker} leads on ${Math.min(a, b)}${Math.min(a, b) ? ` (${wonModels(trail, lead).join(', ')})` : ''}.`,
  };
}
