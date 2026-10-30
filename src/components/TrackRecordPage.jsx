import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { HORIZONS, LABEL_ORDER, MIN_SAMPLE, SMALL_SAMPLE, runOutcome, summarize, scatterPoints } from '../models/trackRecord.js';
import { ASSET_TYPE_LABELS } from '../models/assets.js';
import { MODE_NAMES } from '../lib/reportData.js';
import { fmt, fmtPct } from '../models/_math.js';
import { labelText, scoreClass } from '../lib/labels.js';
import { ScoreExcessScatter } from './chartsExtra.jsx';
import ChartBlock from './ChartBlock.jsx';
import LogGate from './LogGate.jsx';
import Methodology from './Methodology.jsx';
import { MathModeBadge } from './Reasoning.jsx';
import { ExportPdfButton, pdfName } from './results/common.jsx';
import { Tabs, SkeletonCard, ErrorState, EmptyState, Unavailable, InfoButton, Notice } from './ui.jsx';

const pct = (v, d = 1) => (v === null || v === undefined ? null : fmtPct(v, d));
const signedPct = (v, d = 1) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${fmtPct(v, d)}`);
const H3 = HORIZONS.find((h) => h.id === 'm3');

const FORMULAS = {
  ret: { label: 'Forward return', formula: 'R_h = C[t0 + h] / C[t0] − 1', calc: 'h = 21, 63, 126 trading days; t0 = last completed close at run time (ET)', result: 'per run' },
  excess: { label: 'Excess return', formula: 'X_h = R_h − R_SPY,h', calc: 'SPY over exactly the same two dates', result: 'per run' },
  hit: { label: 'Hit rate', formula: 'hit = (# runs with X_h > 0) / n', calc: 'completed runs in the bucket', result: 'per bucket' },
  avg: { label: 'Average', formula: 'mean over completed runs in the bucket', calc: 'pending windows are excluded, never estimated', result: 'per bucket' },
  rho: { label: 'Spearman rank correlation', formula: 'ρ = Pearson correlation of rank(score) and rank(X_h)', calc: 'ties get the average rank; needs n ≥ 3', result: 'per horizon' },
};
const infoFor = (key, extra) => ({ title: FORMULAS[key].label, subtitle: 'Track Record formula', steps: [FORMULAS[key], ...(extra || [])], note: 'Closes: Alpaca SIP daily closes, split-adjusted, no dividends, for both the asset and SPY.' });

function windowInfo(o, h, w) {
  return {
    title: `${o.ticker} · ${h.label} outcome`,
    subtitle: `Run ${o.createdAt.replace('T', ' ').slice(0, 16)} UTC · score ${o.score}`,
    steps: [
      { label: 'Forward return', formula: 'R = C1 / C0 − 1', calc: `${fmt(w.c1)} (${w.endDate}) / ${fmt(w.c0)} (${w.baseDate}) − 1`, result: signedPct(w.ret, 2) },
      { label: 'SPY return', formula: 'R_SPY = S1 / S0 − 1', calc: `${fmt(w.s1)} / ${fmt(w.s0)} − 1`, result: signedPct(w.spyRet, 2) },
      { label: 'Excess return', formula: 'X = R − R_SPY', calc: `${signedPct(w.ret, 2)} − ${signedPct(w.spyRet, 2)}`, result: signedPct(w.excess, 2) },
    ],
    note: 'Source: Alpaca SIP daily closes (split-adjusted, no dividends).',
  };
}

/** Fixed-template explanation (no AI, identical in both modes). */
export function trackSummary(sum, outcomes) {
  const c = sum.counts;
  const paras = [`${c.runs} logged run${c.runs === 1 ? '' : 's'}; ${c.usable} with price history and ${c.unavailable} unavailable (Treasuries have no traded price). Completed windows: ${HORIZONS.map((h) => `${c.completed[h.id]} at ${h.label}`).join(', ')}. Windows that have not ended are shown as pending, never as partial returns.`];
  const r3 = sum.correlation.m3;
  paras.push(r3.rho === null ? `Spearman correlation between score and 3-month excess return is unavailable: ${r3.reason}.` : `Spearman correlation between score and 3-month excess return: ρ = ${r3.rho.toFixed(2)} on n = ${r3.n}. A positive value means higher scores went with better returns than SPY.`);
  if (sum.anySmall) paras.push(`Warning: at least one bucket has fewer than ${MIN_SAMPLE} completed runs. Results there are a ${SMALL_SAMPLE}.`);
  const pend = HORIZONS.map((h) => (sum.nextToFinish[h.id] !== null ? `${h.label}: next window finishes in ${sum.nextToFinish[h.id]} trading day${sum.nextToFinish[h.id] === 1 ? '' : 's'}` : null)).filter(Boolean);
  if (pend.length) paras.push(`${pend.join('; ')}.`);
  paras.push('Past results of the score do not predict future results. Nothing here is investment advice.');
  return paras;
}

async function mapLimit(items, limit, fn) {
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++];
      out[it] = await fn(it);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export default function TrackRecordPage(props) {
  return <LogGate title="Track Record">{(onLock) => <TrackRecord {...props} onLock={onLock} />}</LogGate>;
}

function TrackRecord({ settings, onOpenStock, onLock }) {
  const [state, setState] = useState({ status: 'loading', error: null, outcomes: [], seriesErrors: {} });
  const [tab, setTab] = useState('labels');
  const ref = useRef(null);

  const load = useCallback(async () => {
    setState({ status: 'loading', error: null, outcomes: [], seriesErrors: {} });
    const res = await api.history({ limit: 1000, order: 'asc' });
    if (!res.ok) return setState({ status: 'error', error: res.error, outcomes: [], seriesErrors: {} });
    const rows = res.data.rows || [];
    const tickers = [...new Set(rows.filter((r) => r.asset_type !== 'treasury').map((r) => r.ticker))];
    const hist = await mapLimit([...new Set(['SPY', ...tickers])], 4, (t) => api.priceHistory(t));
    const series = {};
    const seriesErrors = {};
    for (const [t, r] of Object.entries(hist)) {
      if (r.ok) series[t] = r.data.bars;
      else seriesErrors[t] = r.error;
    }
    const outcomes = rows.map((row) => {
      const o = runOutcome(row, series[row.ticker], series.SPY);
      return o.status !== 'ok' && seriesErrors[row.ticker] ? { ...o, reason: `${o.reason} (${seriesErrors[row.ticker]})` } : o;
    });
    setState({ status: 'ok', error: null, outcomes, seriesErrors, latest: series.SPY ? series.SPY[series.SPY.length - 1].date : null });
  }, []);
  useEffect(() => { load(); }, [load]);

  const sum = useMemo(() => (state.status === 'ok' ? summarize(state.outcomes) : null), [state]);
  const points = useMemo(() => (state.status === 'ok' ? scatterPoints(state.outcomes, 'm3') : []), [state]);
  const summary = useMemo(() => (sum ? trackSummary(sum, state.outcomes) : []), [sum, state.outcomes]);

  if (state.status === 'loading') return <div className="space-y-5" aria-busy="true"><SkeletonCard lines={3} /><SkeletonCard lines={4} /><SkeletonCard chart /></div>;
  if (state.status === 'error') return <ErrorState title="Track Record unavailable" text={state.error} onRetry={load} />;
  if (!state.outcomes.length) return <EmptyState title="No logged runs yet" text="Every completed analysis is saved to the log. Once runs exist, their forward returns appear here as each 1, 3 and 6-month window finishes." />;

  const c = sum.counts;
  const r3 = sum.correlation.m3;
  const done3 = state.outcomes.filter((o) => o.windows.m3 && o.windows.m3.status === 'ok');
  const hit3 = done3.length ? done3.filter((o) => o.windows.m3.excess > 0).length / done3.length : null;
  const ranked = [...done3].sort((a, b) => b.windows.m3.excess - a.windows.m3.excess);
  const best = ranked.slice(0, 3);
  const worst = ranked.slice(-3).reverse().filter((o) => !best.includes(o));

  return (
    <div className="space-y-5" ref={ref} id="track-record">
      <section className="card p-5 md:p-6" id="track-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Track Record</h2>
            <p className="text-sm text-ink-2">How logged scores did afterwards, against SPY over the same dates. Latest close {state.latest || 'unavailable'}.</p>
          </div>
          {settings.mode === 'wharton' && <MathModeBadge />}
        </div>
        <div className="mt-4 grid gap-3 grid-cols-2 md:grid-cols-4">
          {[
            ['Runs logged', `${c.runs}`, { title: 'Runs logged', steps: [{ label: 'Runs', formula: 'rows in the analysis log', calc: `${c.usable} with price history, ${c.unavailable} unavailable`, result: `${c.runs}` }] }],
            ['Completed 3-month windows', `${c.completed.m3}`, { title: 'Completed windows', steps: HORIZONS.map((h) => ({ label: h.label, formula: `t0 + ${h.days} trading days has closed`, calc: `${c.pending[h.id]} pending`, result: `${c.completed[h.id]} completed` })) }],
            ['Score vs 3-month excess (Spearman ρ)', r3.rho === null ? null : `${r3.rho.toFixed(2)} (n = ${r3.n})`, infoFor('rho', [{ label: '3 months', formula: 'ρ(score, X_63)', calc: `n = ${r3.n}`, result: r3.rho === null ? `Unavailable: ${r3.reason}` : r3.rho.toFixed(3) }]), r3.reason],
            ['3-month hit rate (all runs)', hit3 === null ? null : `${pct(hit3, 0)} (n = ${done3.length})`, infoFor('hit', [{ label: 'All labels, 3 months', formula: 'share with X_63 > 0', calc: `${done3.filter((o) => o.windows.m3.excess > 0).length} / ${done3.length}`, result: hit3 === null ? 'Unavailable' : pct(hit3, 1) }]), 'no 3-month window has finished yet'],
          ].map(([label, value, info, why]) => (
            <div key={label} className="rounded-lg bg-surface-2 p-3 min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted flex items-center">{label}<InfoButton content={info} /></div>
              <div className="num text-xl font-bold mt-1">{value === null ? <Unavailable reason={why} /> : value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2" id="results-actions">
          <ExportPdfButton targetRef={ref} filename={pdfName('Conviction_TrackRecord', settings.mode)} />
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn btn-ghost" onClick={onLock}>Lock</button>
        </div>
      </section>

      {sum.anySmall && (
        <div className="rounded-lg border-2 border-warn bg-warn/10 p-3 text-sm text-ink" role="alert" id="small-sample-warning">
          <strong>Small sample, not statistically meaningful.</strong> At least one bucket below has fewer than {MIN_SAMPLE} completed runs. Those averages, hit rates and correlations can change sign with a handful of new runs; treat them as anecdotes, not evidence.
        </div>
      )}

      <section className="card p-5" id="drivers">
        <header className="mb-3"><h2 className="font-semibold">Best and worst calls</h2><p className="text-xs text-muted">3-month excess return vs SPY, completed windows only.</p></header>
        {!done3.length ? <p className="text-sm text-muted">No 3-month window has finished yet{sum.nextToFinish.m3 !== null ? `; the first finishes in ${sum.nextToFinish.m3} trading days` : ''}.</p> : (
          <div className="grid gap-5 sm:grid-cols-2">
            {[['Beat SPY by the most', best, 'var(--score-good)'], ['Trailed SPY by the most', worst, 'var(--score-bad)']].map(([t, list, color]) => (
              <div key={t}><div className="text-[11px] uppercase tracking-wide text-muted mb-2">{t}</div>
                {list.length === 0 ? <div className="text-sm text-muted">None</div> : <ul className="space-y-1.5">{list.map((o) => <li key={o.id} className="flex items-baseline gap-2 text-sm"><span className="num w-16 shrink-0 text-right font-semibold" style={{ color }}>{signedPct(o.windows.m3.excess)}</span><span><button className="text-ink hover:underline" onClick={() => onOpenStock(o.ticker)}>{o.ticker}</button><span className="text-muted"> · score {o.score} ({labelText(o.label)}) · {o.createdAt.slice(0, 10)}</span><InfoButton content={windowInfo(o, H3, o.windows.m3)} /></span></li>)}</ul>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5 md:p-6" id="conclusion">
        <header className="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 className="font-semibold">What this shows</h2>{settings.mode === 'wharton' && <MathModeBadge />}</header>
        <div className="space-y-2 text-sm text-ink-2 leading-relaxed">{summary.map((p, i) => <p key={i} className={i === 0 ? 'text-ink' : ''}>{p}</p>)}</div>
      </section>
      {settings.mode === 'wharton' && <Methodology intro="Formulas used on this page. Fixed templates; nothing is generated." sections={[{ title: 'Track Record', steps: Object.values(FORMULAS) }]} />}

      <section className="space-y-4" id="details">
        <Tabs items={[{ id: 'labels', label: 'By label' }, { id: 'corr', label: 'Rank correlation' }, { id: 'scatter', label: 'Scatter' }, { id: 'runs', label: 'All runs' }]} value={tab} onChange={setTab} ariaLabel="Details" />
        {tab === 'labels' && (
          <section className="card p-4 md:p-5 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Label</th><th>Window</th><th className="r">n<InfoButton content={{ title: 'n', steps: [{ label: 'n', formula: 'completed runs in the bucket', calc: 'pending windows not counted', result: '' }] }} /></th><th className="r">Avg forward return<InfoButton content={infoFor('avg', [FORMULAS.ret])} /></th><th className="r">Avg excess vs SPY<InfoButton content={infoFor('avg', [FORMULAS.excess])} /></th><th className="r">Hit rate<InfoButton content={infoFor('hit')} /></th><th>Sample</th></tr></thead>
              <tbody>
                {LABEL_ORDER.flatMap((label) => HORIZONS.map((h, k) => {
                  const b = sum.byLabel[label][h.id];
                  return (
                    <tr key={label + h.id}>
                      <td>{k === 0 ? <span className={`pill ${scoreClass(label === 'Low' ? 20 : label === 'Neutral' ? 50 : label === 'High' ? 70 : 90)}`}>{labelText(label)}</span> : ''}</td>
                      <td className="text-ink-2">{h.label}</td>
                      <td className="r num">{b.n}{b.pending ? <span className="text-muted"> (+{b.pending} pending)</span> : ''}</td>
                      <td className="r num">{b.n ? signedPct(b.avgReturn) : <Unavailable reason={b.pending ? `${b.pending} pending, none finished` : 'no runs in this bucket'} />}</td>
                      <td className="r num">{b.n ? signedPct(b.avgExcess) : <Unavailable reason={b.pending ? `${b.pending} pending, none finished` : 'no runs in this bucket'} />}</td>
                      <td className="r num">{b.n ? pct(b.hitRate, 0) : <Unavailable reason="no completed runs" />}</td>
                      <td>{b.small ? <span className="pill bg-warn/15 text-ink">{SMALL_SAMPLE}</span> : <span className="text-xs text-muted">n ≥ {MIN_SAMPLE}</span>}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </section>
        )}
        {tab === 'corr' && (
          <section className="card p-4 md:p-5 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Window</th><th className="r">Spearman ρ (score vs excess)<InfoButton content={infoFor('rho')} /></th><th className="r">n</th><th>Sample</th></tr></thead>
              <tbody>{HORIZONS.map((h) => { const r = sum.correlation[h.id]; return <tr key={h.id}><td>{h.label}</td><td className="r num">{r.rho === null ? <Unavailable reason={r.reason} /> : r.rho.toFixed(3)}</td><td className="r num">{r.n}</td><td>{r.small ? <span className="pill bg-warn/15 text-ink">{SMALL_SAMPLE}</span> : <span className="text-xs text-muted">n ≥ {MIN_SAMPLE}</span>}</td></tr>; })}</tbody>
            </table>
            <p className="text-xs text-muted mt-2">ρ runs from −1 to +1. +1 means the ranking by score matched the ranking by excess return exactly; 0 means no relationship.</p>
          </section>
        )}
        {tab === 'scatter' && (
          <section className="card p-4 md:p-5">
            {points.length ? (
              <ChartBlock title="Score at run vs 3-month excess return vs SPY" explanation={{ what: 'Each dot is one logged run whose 3-month window has finished. Dashed lines mark the score bands.', reading: r3.rho === null ? `${points.length} completed runs.` : `${points.length} completed runs; Spearman ρ = ${r3.rho.toFixed(2)}.`, caveat: r3.small ? `Fewer than ${MIN_SAMPLE} points: ${SMALL_SAMPLE}.` : 'Past results do not predict future results.' }}>
                <ScoreExcessScatter points={points} />
              </ChartBlock>
            ) : <Notice>No 3-month window has finished yet{sum.nextToFinish.m3 !== null ? `; the first finishes in ${sum.nextToFinish.m3} trading days` : ''}. The scatter appears once at least one has.</Notice>}
          </section>
        )}
        {tab === 'runs' && (
          <section className="card p-4 md:p-5 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Run (UTC)</th><th>Ticker</th><th>Type</th><th>Mode</th><th>Version</th><th className="r">Score</th><th className="r">Price at run</th><th>Base date</th>{HORIZONS.map((h) => <th key={h.id} className="r">{h.label}: return / excess</th>)}</tr></thead>
              <tbody>
                {[...state.outcomes].reverse().map((o) => (
                  <tr key={o.id}>
                    <td className="num text-ink-2 whitespace-nowrap">{o.createdAt.replace('T', ' ').slice(0, 16)}</td>
                    <td><button className="text-accent hover:underline font-semibold" onClick={() => onOpenStock(o.ticker)}>{o.ticker}</button></td>
                    <td className="text-xs text-ink-2">{ASSET_TYPE_LABELS[o.assetType] || o.assetType}</td>
                    <td className="text-xs text-ink-2">{MODE_NAMES[o.mode] || o.mode}</td>
                    <td className="text-xs text-muted num">{o.version || '—'}</td>
                    <td className="r"><span className={`pill num ${scoreClass(o.score)}`}>{o.score ?? '—'}</span> <span className="text-xs text-muted">{labelText(o.label)}</span></td>
                    <td className="r num">{o.priceAtRun === null ? <Unavailable reason={o.assetType === 'treasury' ? 'Treasury yields have no traded price' : 'Alpaca price was unavailable when this run was logged'} /> : <>${fmt(o.priceAtRun)}<InfoButton content={{ title: `${o.ticker} price at run`, prov: [`Source: ${o.priceSource || 'Alpaca IEX latest daily close at run time'}`, o.priceAsOf ? `Bar dated ${String(o.priceAsOf).slice(0, 10)}` : 'Bar date not stored'] }} /></>}</td>
                    <td className="num text-ink-2">{o.status === 'ok' ? o.baseDate : <Unavailable reason={o.reason} />}</td>
                    {HORIZONS.map((h) => {
                      const w = o.windows[h.id];
                      if (o.status !== 'ok' || !w) return <td key={h.id} className="r"><Unavailable reason={o.reason} /></td>;
                      if (w.status === 'pending') return <td key={h.id} className="r text-xs text-muted" title={w.reason}>pending</td>;
                      if (w.status !== 'ok') return <td key={h.id} className="r"><Unavailable reason={w.reason} /></td>;
                      return <td key={h.id} className="r num whitespace-nowrap">{signedPct(w.ret)} / <span style={{ color: w.excess >= 0 ? 'var(--score-good)' : 'var(--score-bad)' }}>{signedPct(w.excess)}</span><InfoButton content={windowInfo(o, h, w)} /></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted mt-2">"Pending" means the window has not ended yet. Every run is listed, including repeat runs of the same ticker.</p>
          </section>
        )}
      </section>
    </div>
  );
}
