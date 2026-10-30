import React, { useEffect, useRef, useState } from 'react';
import { analyzeMany, benchmarkReturns, unitPrice } from '../lib/portfolioData.js';
import { gradePortfolio, normalizeHoldings, PILLAR_LABELS, CLASS_LABELS } from '../models/portfolioGrade.js';
import { ASSET_TYPE_LABELS } from '../models/assets.js';
import { fmt, fmtPct } from '../models/_math.js';
import { AllocationPie, CorrelationHeatmap, CumulativeChart } from './chartsPortfolio.jsx';
import { DrawdownChart } from './charts.jsx';
import ChartBlock from './ChartBlock.jsx';
import Methodology from './Methodology.jsx';
import { StandardReasoning } from './Reasoning.jsx';
import { loadJson, saveJson } from '../lib/storage.js';

const DRAFT_KEY = 'conviction2.graderDraft.v1';
const PILLAR_COLORS = { quality: '#3987e5', diversification: '#199e70', risk: '#9085e9' };

function labelColor(label) {
  switch (label) {
    case 'Low': return '#e66767';
    case 'Neutral': return '#fab219';
    case 'High': return '#3ecf3e';
    case 'Very High': return '#0ca30c';
    default: return '#898781';
  }
}
const scoreClass = (s) => (s === null || s === undefined ? 'bg-surface-2 text-muted' : s < 40 ? 'bg-[#d03b3b22] text-[#e66767]' : s < 60 ? 'bg-[#c9850022] text-[#fab219]' : 'bg-[#0ca30c22] text-[#3ecf3e]');
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;

/** Fixed-template summary of a grade (no AI). */
export function gradeSummary(g) {
  if (!g || g.score === null) return ['No portfolio score could be computed.', ...(g ? g.notes : [])];
  const p = Object.fromEntries(g.pillars.map((r) => [r.id, r]));
  const paras = [`This portfolio scores ${g.score} out of 100 (${g.label} conviction): ${p.quality.score !== null ? `holding quality ${p.quality.score.toFixed(0)}` : 'holding quality unavailable'}, ${p.diversification.score !== null ? `diversification ${p.diversification.score.toFixed(0)}` : 'diversification unavailable'}, ${p.risk.score !== null ? `risk ${p.risk.score.toFixed(0)}` : 'risk unavailable'}, blended ${g.pillars.filter((r) => r.score !== null).map((r) => `${(r.normWeight * 100).toFixed(0)}% ${r.label.toLowerCase()}`).join(', ')}.`];
  const top = g.drivers.filter((d) => d.points > 0).slice(0, 3);
  const bottom = g.drivers.filter((d) => d.points < 0).slice(-3).reverse();
  if (top.length) paras.push(`What helps most: ${top.map((d) => `${d.label} (${d.detail}, ${signed(d.points)} points)`).join('; ')}.`);
  if (bottom.length) paras.push(`What hurts most: ${bottom.map((d) => `${d.label} (${d.detail}, ${signed(d.points)} points)`).join('; ')}.`);
  const m = g.riskMetrics;
  if (m && m.window) paras.push(`Over ${m.window.from} to ${m.window.to} the portfolio returned ${fmtPct(m.cumReturn, 1)} versus ${fmtPct(m.spyCumReturn, 1)} for SPY${m.sixtyFortyCumReturn !== null ? ` and ${fmtPct(m.sixtyFortyCumReturn, 1)} for a 60/40 mix` : ''}, with a worst drawdown of ${fmtPct(m.mdd, 1)}.`);
  for (const n of g.notes) paras.push(n);
  paras.push('This is a summary of the numbers, not a recommendation. Nothing here is investment advice.');
  return paras;
}

export function gradePayload(g, holdings) {
  return {
    kind: 'grade',
    score: g.score,
    label: g.label,
    pillars: g.pillars.map((p) => ({ id: p.id, weight: p.weight, weightUsed: p.normWeight, score: p.score === null ? null : +p.score.toFixed(1) })),
    components: { diversification: g.components.diversification.map((c) => ({ label: c.label, detail: c.text, score: +c.score.toFixed(1) })), risk: g.components.risk.map((c) => ({ label: c.label, detail: c.text, score: +c.score.toFixed(1) })) },
    holdings: holdings.map((h) => ({ ticker: h.ticker, assetType: h.assetType, weight: +h.weight.toFixed(4), score: h.score, error: h.error || null })),
    riskMetrics: Object.fromEntries(Object.entries(g.riskMetrics || {}).filter(([k]) => k !== 'window').map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v])),
    drivers: g.drivers.slice(0, 8).map((d) => ({ label: d.label, detail: d.detail, points: +d.points.toFixed(2) })),
    notes: g.notes,
  };
}

/** Run the grader for a set of normalized holdings. Shared with the Optimizer. */
export async function gradeHoldings(holdingRows, analyses, settings) {
  const bench = await benchmarkReturns(analyses);
  const rf = settings.riskFreeRate === '' || settings.riskFreeRate === null || settings.riskFreeRate === undefined ? null : Number(settings.riskFreeRate) / 100;
  const holdings = holdingRows.map((h) => {
    const a = analyses[h.ticker];
    return { ticker: h.ticker, name: a?.name || null, assetType: a?.assetType || 'unsupported', weight: h.weight, score: a && a.conviction.score !== null ? a.conviction.score : null, returns: a?.dailyReturns || [], error: a?.error || null, input: h.input };
  });
  const grade = gradePortfolio({ holdings, spy: bench.spy, agg: bench.agg, rf });
  if (!bench.spy) grade.notes.unshift(`SPY history unavailable: ${bench.spyError}`);
  if (!bench.agg) grade.notes.unshift(`AGG history unavailable: ${bench.aggError}`);
  return { grade, holdings };
}

export default function GraderPage({ settings, onOpenStock, onOptimize }) {
  const [draft, setDraft] = useState(() => loadJson(DRAFT_KEY, null) || { rows: [{ ticker: 'SPY', amount: '60' }, { ticker: 'AGG', amount: '40' }, { ticker: '', amount: '' }], mode: 'percent' });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const autoFor = useRef(null);
  useEffect(() => { saveJson(DRAFT_KEY, draft); }, [draft]);

  const setRow = (i, patch) => setDraft((d) => ({ ...d, rows: d.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const pctSum = draft.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const run = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setReasoning({ status: 'idle', text: null, error: null, model: null });
    const pre = normalizeHoldings(draft.rows, draft.mode === 'shares' ? 'dollars' : draft.mode); // validation only (shares need prices)
    if (draft.mode !== 'shares' && pre.error) return setError(pre.error);
    const tickers = draft.rows.filter((r) => r.ticker.trim() && Number(r.amount) > 0).map((r) => r.ticker.trim().toUpperCase());
    if (!tickers.length) return setError('Enter at least one holding.');
    setRunning(true);
    setProgress(Object.fromEntries(tickers.map((t) => [t, 'queued'])));
    try {
      const analyses = await analyzeMany(tickers, settings, (t, s) => setProgress((p) => ({ ...p, [t]: s })));
      const prices = Object.fromEntries(Object.entries(analyses).map(([t, a]) => [t, unitPrice(a)]));
      const norm = normalizeHoldings(draft.rows, draft.mode, prices);
      if (norm.error) return setError(norm.error);
      const { grade, holdings } = await gradeHoldings(norm.holdings, analyses, settings);
      setResult({ grade, holdings, analyses, mode: draft.mode });
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const generate = async () => {
    if (settings.mode !== 'standard' || !result || result.grade.score === null) return;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const { requestReasoning } = await import('../lib/ai.js');
    const res = await requestReasoning('standard', 'Portfolio', gradePayload(result.grade, result.holdings));
    if (!res.ok) setReasoning({ status: 'error', text: null, error: res.error, model: null });
    else if (!res.data.text) setReasoning({ status: 'error', text: null, error: res.data.error || 'Empty response.', model: res.data.model });
    else setReasoning({ status: 'done', text: res.data.text, error: null, model: res.data.model });
  };
  useEffect(() => {
    if (settings.mode !== 'standard') { setReasoning({ status: 'idle', text: null, error: null, model: null }); autoFor.current = null; return; }
    if (!result || result.grade.score === null || autoFor.current === result) return;
    autoFor.current = result;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, settings.mode]);

  const g = result?.grade;
  const summary = g ? gradeSummary(g) : [];

  return (
    <div className="space-y-5">
      <form className="card p-4 md:p-5 space-y-4" onSubmit={run}>
        <div>
          <h2 className="font-semibold">Portfolio Grader</h2>
          <p className="text-xs text-muted mt-1">Enter holdings as percent, dollars or shares. Stocks, equity ETFs, bond ETFs and Treasuries (US2Y, US5Y, US10Y, US30Y) are supported; each is analysed with its own models, then the mix is scored on quality, diversification and risk.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><div className="text-xs text-ink-2 mb-1">Amounts are</div>
            <select className="input w-44" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
              <option value="percent">percent (must total 100)</option>
              <option value="dollars">dollar amounts</option>
              <option value="shares">share counts</option>
            </select></label>
          {draft.mode === 'percent' && <div className={`text-xs self-center ${Math.abs(pctSum - 100) > 0.5 ? 'text-[#fab219]' : 'text-muted'}`}>Total {pctSum.toFixed(1)}%</div>}
        </div>
        <div className="space-y-2">
          {draft.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
              <input className="input uppercase" placeholder="Ticker or US10Y" value={r.ticker} onChange={(e) => setRow(i, { ticker: e.target.value.toUpperCase() })} spellCheck={false} />
              <input className="input" type="number" min="0" step="any" placeholder={draft.mode === 'percent' ? 'Percent' : draft.mode === 'dollars' ? 'Dollars' : 'Shares'} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
              <div className="text-xs text-muted w-16 text-right">{progress[r.ticker.toUpperCase()] || ''}</div>
              <button type="button" className="btn px-2" aria-label="Remove holding" disabled={draft.rows.length <= 1} onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, k) => k !== i) })}>×</button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className="btn" onClick={() => setDraft({ ...draft, rows: [...draft.rows, { ticker: '', amount: '' }] })}>+ Add holding</button>
          <button type="submit" className="btn btn-primary" disabled={running}>{running ? 'Grading…' : 'Grade portfolio'}</button>
          <span className="text-xs text-muted">About 10 seconds per holding.</span>
        </div>
        {error && <div className="rounded-lg border border-[#d03b3b55] bg-[#d03b3b14] p-3 text-sm text-[#e66767]">{error}</div>}
      </form>

      {g && (
        <>
          <section className="card p-5 md:p-6" id="grade-score">
            <div className="flex flex-col md:flex-row md:items-center gap-5">
              <div className="flex items-baseline gap-4">
                <div className="num text-6xl md:text-7xl font-bold leading-none" style={{ color: labelColor(g.label) }}>{g.score ?? '—'}</div>
                <div><div className="text-lg font-semibold" style={{ color: labelColor(g.label) }}>{g.score === null ? 'No score' : `${g.label} conviction`}</div><div className="text-xs text-muted">Portfolio Conviction Score · 0–39 Low · 40–59 Neutral · 60–79 High · 80–100 Very High</div></div>
              </div>
              <div className="md:ml-auto flex gap-2">
                <button className="btn" onClick={() => onOptimize(result.holdings.map((h) => h.ticker))}>Optimize this portfolio →</button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {g.pillars.map((p) => (
                <div key={p.id} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center justify-between text-xs"><span className="text-ink-2">{p.label}</span><span className="text-muted">{p.score === null ? 'excluded' : `${(p.normWeight * 100).toFixed(0)}% weight`}</span></div>
                  <div className="num text-2xl font-bold mt-1" style={{ color: PILLAR_COLORS[p.id] }}>{p.score === null ? 'Unavailable' : p.score.toFixed(0)}</div>
                  <div className="h-2 rounded-full bg-page mt-2 overflow-hidden"><div className="h-full" style={{ width: `${p.score ?? 0}%`, background: PILLAR_COLORS[p.id] }} /></div>
                </div>
              ))}
            </div>
            {g.notes.length > 0 && <ul className="mt-3 text-xs text-[#fab219] space-y-1">{g.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </section>

          <section className="card p-5 md:p-6" id="grade-conclusion">
            <h2 className="font-semibold mb-2">What this means</h2>
            <div className="space-y-2 text-sm text-ink-2 leading-relaxed">{summary.map((p, i) => <p key={i} className={i === 0 ? 'text-ink' : ''}>{p}</p>)}</div>
          </section>

          <section className="card p-4 md:p-5 overflow-x-auto" id="grade-holdings">
            <h3 className="font-semibold mb-3">Holdings</h3>
            <table className="w-full text-xs">
              <thead><tr className="text-muted"><th className="p-1 text-left font-medium">Ticker</th><th className="p-1 text-left font-medium">Type</th><th className="p-1 text-right font-medium">Input</th><th className="p-1 text-right font-medium">Weight</th><th className="p-1 text-right font-medium">Score</th><th className="p-1 text-left font-medium">Note</th></tr></thead>
              <tbody>
                {result.holdings.map((h) => (
                  <tr key={h.ticker} className="border-t border-line">
                    <td className="p-1"><button className="text-s1 hover:underline font-semibold" onClick={() => onOpenStock(h.ticker)}>{h.ticker}</button>{h.name && <div className="text-muted truncate max-w-[180px]">{h.name}</div>}</td>
                    <td className="p-1 text-ink-2">{ASSET_TYPE_LABELS[h.assetType] || h.assetType}</td>
                    <td className="p-1 text-right num text-muted">{h.input}</td>
                    <td className="p-1 text-right num">{fmtPct(h.weight, 1)}</td>
                    <td className="p-1 text-right"><span className={`pill num ${scoreClass(h.score)}`}>{h.score ?? 'Unavailable'}</span></td>
                    <td className="p-1 text-[#fab219]">{h.error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card p-4 md:p-5" id="grade-drivers">
            <h3 className="font-semibold mb-1">What drove the score</h3>
            <p className="text-xs text-muted mb-3">Points above or below a neutral 50, by component: pillar weight × component weight × (score − 50). Holdings are shown by their weight within Holding quality.</p>
            <div className="grid gap-4 md:grid-cols-2">
              {[['Biggest positive contributors', g.drivers.filter((d) => d.points > 0).slice(0, 6), '#3ecf3e'], ['Biggest negative contributors', g.drivers.filter((d) => d.points < 0).slice(-6).reverse(), '#e66767']].map(([title, list, color]) => (
                <div key={title}>
                  <div className="text-xs uppercase tracking-wide text-muted mb-2">{title}</div>
                  {list.length === 0 ? <div className="text-sm text-muted">None</div> : list.map((d, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-sm py-1 border-t border-line"><span className="num w-14 text-right" style={{ color }}>{signed(d.points)}</span><span className="text-ink">{d.label}</span><span className="text-muted text-xs">{d.detail}</span></div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card p-4 md:p-5"><ChartBlock title="Allocation by asset class" explanation={{ what: 'How the portfolio splits across stocks, equity ETFs, bond ETFs and Treasuries.', reading: Object.entries(g.classWeights).map(([k, w]) => `${CLASS_LABELS[k] || k} ${(w * 100).toFixed(0)}%`).join(', ') + '.', caveat: 'An equity ETF counts as one class even though it holds many stocks; the correlation table below shows whether holdings actually move differently.' }}><AllocationPie classWeights={g.classWeights} labels={CLASS_LABELS} /></ChartBlock></section>
            <section className="card p-4 md:p-5"><ChartBlock title="Correlation between holdings" explanation={{ what: 'Whether each pair of holdings tends to move together day to day.', reading: g.avgCorr === null ? 'Correlation could not be computed (see notes).' : `Average pairwise correlation ${g.avgCorr.toFixed(2)}.`, caveat: 'Correlations tend to rise in sell-offs, so diversification is usually weakest when it matters most.' }}>{g.corr ? <CorrelationHeatmap corr={g.corr.matrix} tickers={g.corr.tickers} /> : <div className="text-sm text-muted">Unavailable: {g.notes.find((n) => /Correlation/.test(n)) || 'not enough holdings with return history'}</div>}</ChartBlock></section>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card p-4 md:p-5"><ChartBlock title="Cumulative return vs SPY and 60/40" explanation={{ what: 'Growth of the portfolio at today\'s weights (rebalanced daily) against SPY alone and a 60/40 SPY/AGG mix, over the common history of all holdings.', reading: g.riskMetrics.window ? `${g.riskMetrics.window.days} trading days from ${g.riskMetrics.window.from}: portfolio ${fmtPct(g.riskMetrics.cumReturn, 1)}, SPY ${fmtPct(g.riskMetrics.spyCumReturn, 1)}${g.riskMetrics.sixtyFortyCumReturn !== null ? `, 60/40 ${fmtPct(g.riskMetrics.sixtyFortyCumReturn, 1)}` : ''}.` : 'Unavailable.', caveat: 'Treasury holdings use returns approximated from yield changes; ETFs and stocks use split-adjusted prices without dividends.' }}>{g.charts.cumulative.length ? <CumulativeChart data={g.charts.cumulative} /> : <div className="text-sm text-muted">Unavailable: {g.notes.find((n) => /Risk pillar/.test(n)) || 'no return history'}</div>}</ChartBlock></section>
            <section className="card p-4 md:p-5"><ChartBlock title="Portfolio drawdown" explanation={{ what: 'How far the portfolio sat below its previous high at each point.', reading: g.riskMetrics.mdd !== undefined ? `Worst drawdown ${fmtPct(g.riskMetrics.mdd, 1)}, bottoming on ${g.riskMetrics.trough}.` : 'Unavailable.', caveat: 'Constant weights are assumed, which quietly rebalances every day.' }}>{g.charts.drawdown.length ? <DrawdownChart drawdown={g.charts.drawdown} /> : <div className="text-sm text-muted">Unavailable</div>}</ChartBlock></section>
          </div>

          {settings.mode === 'standard'
            ? <StandardReasoning state={reasoning} onGenerate={generate} canGenerate={g.score !== null} fallback={summary} />
            : <Methodology intro="Weights and formulas used for this grade. Fixed templates; nothing is generated." sections={[
                { title: 'Portfolio Conviction Score', subtitle: g.blendStep.result, note: 'Pillar weights: Holding quality 40, Diversification 30, Risk 30 (re-normalized over available pillars).', steps: [{ label: 'Blend', ...g.blendStep }] },
                { title: PILLAR_LABELS.quality, subtitle: g.pillars[0].score === null ? 'unavailable' : g.pillars[0].score.toFixed(1), steps: g.steps.quality },
                { title: PILLAR_LABELS.diversification, subtitle: g.pillars[1].score === null ? 'unavailable' : g.pillars[1].score.toFixed(1), steps: g.steps.diversification },
                { title: PILLAR_LABELS.risk, subtitle: g.pillars[2].score === null ? 'unavailable' : g.pillars[2].score.toFixed(1), steps: g.steps.risk.length ? g.steps.risk : [{ label: 'Risk pillar', formula: 'portfolio return series', calc: g.notes.find((n) => /Risk pillar/.test(n)) || '', result: 'Unavailable' }] },
                { title: 'Per-holding scores', note: 'Each holding is scored by its own models (stock: six models; ETF and Treasury: the components shown on its page). Open a holding for its full methodology.', steps: result.holdings.map((h) => ({ label: h.ticker, formula: `${ASSET_TYPE_LABELS[h.assetType] || h.assetType} score`, calc: `weight ${fmtPct(h.weight, 1)}`, result: h.score === null ? `Unavailable: ${h.error || 'no score'}` : `${h.score}` })) },
              ]} />}
        </>
      )}
    </div>
  );
}
