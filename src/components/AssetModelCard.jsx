import React, { useState } from 'react';
import ChartBlock from './ChartBlock.jsx';
import Prov from './Prov.jsx';
import { fmt, fmtPct, fmtMoney } from '../models/_math.js';
import { PriceSmaChart, DrawdownChart } from './charts.jsx';
import { YieldCurveChart, YieldHistoryChart, DollarVolumeChart, DividendsChart } from './chartsPortfolio.jsx';

function scoreColor(s) {
  if (s === null || s === undefined) return 'bg-surface-2 text-muted';
  if (s < 40) return 'bg-[#d03b3b22] text-[#e66767]';
  if (s < 60) return 'bg-[#c9850022] text-[#fab219]';
  return 'bg-[#0ca30c22] text-[#3ecf3e]';
}

function chartFor(r) {
  const c = r.chart;
  if (!c || c.kind === 'none') return null;
  switch (c.kind) {
    case 'priceSma': return ['Price with 50- and 200-day SMAs (2 years)', <PriceSmaChart series={c.series} />, 'The blue line is the price; orange and green are the 50- and 200-day averages. Above both means an uptrend.'];
    case 'drawdown': return ['Drawdown from running peak', <DrawdownChart drawdown={c.drawdown} />, 'How far the price sat below its previous high at every point in the window.'];
    case 'yieldCurve': return ['U.S. Treasury yield curve (latest, FRED)', <YieldCurveChart points={c.points} />, 'Yield at each maturity today. The highlighted point is this holding. A curve that slopes down (short rates above long rates) is inverted.'];
    case 'yieldHistory': return ['Yield history (3 years, FRED)', <YieldHistoryChart series={c.series} />, 'The yield this maturity has paid over time. When yields rise, existing bonds fall in price.'];
    case 'volume': return ['Daily dollar volume, IEX feed (1 year)', <DollarVolumeChart series={c.series} />, 'Dollars traded each day on the IEX exchange only. Consolidated volume across all exchanges is larger; the IEX share is a consistent fraction, so funds remain comparable.'];
    case 'dividends': return ['Cash distributions per share (12 months)', <DividendsChart series={c.series} />, 'Each bar is a cash dividend paid per share. Their sum divided by the price is the trailing distribution yield.'];
    default: return null;
  }
}

function metricRows(r) {
  const m = r.metrics || {};
  const p = r.provenance || {};
  const rows = [];
  const add = (label, value, key) => rows.push([label, value, p[key]]);
  switch (r.id) {
    case 'expense': add('Expense ratio', fmtPct(m.expenseRatio, 2), 'expenseRatio'); break;
    case 'liquidity': add('Avg daily $ volume (IEX)', fmtMoney(m.avgDollarVolume, 1), 'avgDollarVolume'); add('Avg shares/day (IEX)', fmt(m.avgShareVolume, 0), 'avgDollarVolume'); add('AUM', m.aum ? fmtMoney(m.aum) : null, 'aum'); break;
    case 'momentum': add('12-1 momentum', fmtPct(m.momentum12_1), 'momentum12_1'); add('Price', `$${fmt(m.price)}`, 'price'); break;
    case 'volatility': add('Annual volatility', fmtPct(m.annualVol), 'annualVol'); break;
    case 'drawdown': add('Max drawdown', fmtPct(m.maxDD), 'maxDD'); add('Trough', m.troughDate, 'maxDD'); break;
    case 'sharpe': add('Sharpe ratio', fmt(m.sharpe), 'sharpe'); add('Annual mean return', fmtPct(m.annualMean), 'sharpe'); break;
    case 'yield':
      if (m.ttmYield !== undefined) { add('TTM distribution yield', fmtPct(m.ttmYield), 'ttmYield'); add('TTM cash per share', `$${fmt(m.ttmDistributions, 4)}`, 'ttmYield'); add('SEC 30-day yield', null, 'secYield'); }
      else { add('Yield', `${fmt(m.yieldPct, 2)}%`, 'yield'); add('As of', m.asOf, 'yield'); }
      break;
    case 'duration':
      if (m.empiricalDuration !== undefined) { add('Empirical duration', `${fmt(m.empiricalDuration, 2)}y`, 'empiricalDuration'); add('Effective duration (official)', null, 'effectiveDuration'); }
      else { add('Modified duration', `${fmt(m.modified, 2)}y`, 'modified'); add('Macaulay duration', `${fmt(m.macaulay, 2)}y`, 'modified'); }
      break;
    case 'spread': add('Spread vs Treasury', `${m.spreadPts >= 0 ? '+' : ''}${fmt(m.spreadPts, 2)} pts`, 'spreadPts'); add('Matched tenor', `${m.matchedTenor}y at ${fmtPct(m.treasuryYield, 2)}`, 'spreadPts'); break;
    case 'curve': add('Yield minus 3-month', `${m.slopeVs3m >= 0 ? '+' : ''}${fmt(m.slopeVs3m, 2)} pts`, 'slopeVs3m'); add('3-month yield', fmtPct(m.threeMonth, 2), 'slopeVs3m'); break;
    default: break;
  }
  return rows;
}

/** One component card for an ETF or Treasury (same layout as the stock model cards). */
export default function AssetModelCard({ result, status }) {
  const [showInputs, setShowInputs] = useState(false);
  const r = result;
  const chart = r && r.available ? chartFor(r) : null;
  return (
    <section className="card p-4 md:p-5 flex flex-col gap-4" id={`model-${r?.id || 'pending'}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{r?.name || '…'}</h3>
          {r?.available && <p className="text-xs text-muted mt-0.5">{r.scoringRule}</p>}
        </div>
        <div className={`pill num text-base px-3 py-1 ${scoreColor(r?.available ? r.subscore : null)}`}>{r?.available ? r.subscore : status === 'loading' ? '…' : '—'}</div>
      </header>
      {status === 'loading' && <div className="flex items-center gap-3 text-sm text-ink-2"><span className="inline-block w-4 h-4 border-2 border-s1 border-t-transparent rounded-full animate-spin" />Loading…</div>}
      {status !== 'loading' && r && !r.available && (
        <div className="rounded-lg border border-[#d03b3b55] bg-[#d03b3b14] p-3 text-sm">
          <div className="font-semibold text-[#e66767]">Unavailable — excluded from the score</div>
          <div className="text-ink-2 mt-1 break-words">{r.error}</div>
        </div>
      )}
      {status !== 'loading' && r?.available && (
        <>
          {r.warning && <div className="rounded-lg border border-[#fab21955] bg-[#fab21914] p-2 text-xs text-[#fab219]">{r.warning}</div>}
          {chart && <ChartBlock title={chart[0]} explanation={{ what: chart[2], reading: r.keyOutput, caveat: r.note }}>{chart[1]}</ChartBlock>}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 pt-2 border-t border-line">
            {metricRows(r).map(([label, value, prov]) => {
              const unavailable = value === null || value === undefined || (prov && prov.status === 'unavailable');
              return (
                <div key={label} className="min-w-0">
                  <div className="flex items-center text-[11px] uppercase tracking-wide text-muted"><span className="truncate">{label}</span><Prov p={prov} /></div>
                  {unavailable ? <><div className="text-sm font-semibold text-[#fab219]">Unavailable</div><div className="text-[10px] leading-snug text-muted">{(prov && prov.reason) || 'Not provided by the current data providers.'}</div></> : <div className="num text-sm text-ink truncate">{value}</div>}
                </div>
              );
            })}
          </div>
          {r.inputs && r.inputs.length > 0 && (
            <div>
              <button className="text-xs text-s1 hover:underline" onClick={() => setShowInputs((v) => !v)}>{showInputs ? 'Hide' : 'Show'} inputs used ({r.inputs.length})</button>
              {showInputs && <ul className="mt-2 text-xs space-y-1">{r.inputs.map((inp, i) => <li key={i} className="flex flex-wrap gap-x-2"><span className="text-muted">{inp.label}:</span><span className="num text-ink">{inp.value}</span><span className="text-muted">— {inp.source}</span></li>)}</ul>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
