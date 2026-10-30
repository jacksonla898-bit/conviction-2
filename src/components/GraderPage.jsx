import React, { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeMany, benchmarkReturns, unitPrice } from '../lib/portfolioData.js';
import { gradePortfolio, normalizeHoldings, PILLAR_LABELS, CLASS_LABELS } from '../models/portfolioGrade.js';
import { ASSET_TYPE_LABELS } from '../models/assets.js';
import { fmtPct } from '../models/_math.js';
import { AllocationPie, CorrelationHeatmap, CumulativeChart } from './chartsPortfolio.jsx';
import { DrawdownChart } from './charts.jsx';
import ChartBlock from './ChartBlock.jsx';
import Methodology from './Methodology.jsx';
import PortfolioPage from './PortfolioPage.jsx';
import ScoreHeader from './results/ScoreHeader.jsx';
import DriversCard from './results/DriversCard.jsx';
import { ReasoningSection, ExportPdfButton, pdfName } from './results/common.jsx';
import SavePortfolioButton from './SavePortfolioButton.jsx';
import { Tabs, SkeletonCard, ErrorState, Unavailable, EmptyState, MetricLabel, InfoButton } from './ui.jsx';
import { labelText, scoreClass } from '../lib/labels.js';

const PILLAR_COLORS = { quality: 'var(--chart-1)', diversification: 'var(--chart-2)', risk: 'var(--chart-3)' };
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
const MODE_UNIT = { percent: '%', dollars: '$', shares: ' sh' };

export const holdingsKey = (portfolio) => JSON.stringify([portfolio.mode, portfolio.holdings.filter((h) => h.ticker.trim() && Number(h.amount) > 0).map((h) => [h.ticker.trim().toUpperCase(), Number(h.amount)])]);

/** Fixed-template summary of a grade (no AI). */
export function gradeSummary(g) {
  if (!g || g.score === null) return ['No portfolio score could be computed.', ...(g ? g.notes : [])];
  const p = Object.fromEntries(g.pillars.map((r) => [r.id, r]));
  const paras = [`This portfolio scores ${g.score} out of 100 (${labelText(g.label)}): ${p.quality.score !== null ? `holding quality ${p.quality.score.toFixed(0)}` : 'holding quality unavailable'}, ${p.diversification.score !== null ? `diversification ${p.diversification.score.toFixed(0)}` : 'diversification unavailable'}, ${p.risk.score !== null ? `risk ${p.risk.score.toFixed(0)}` : 'risk unavailable'}, blended ${g.pillars.filter((r) => r.score !== null).map((r) => `${(r.normWeight * 100).toFixed(0)}% ${r.label.toLowerCase()}`).join(', ')}.`];
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
  return { grade, holdings, bench };
}

const DETAIL_TABS = [{ id: 'holdings', label: 'Holdings' }, { id: 'diversification', label: 'Diversification' }, { id: 'risk', label: 'Risk' }, { id: 'thesis', label: 'Thesis & target' }];

export default function GraderPage({ settings, portfolio, setPortfolio, lastGrade, onGraded, onOpenStock, onGoTab, onSave }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('holdings');
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const autoFor = useRef(null);
  const ref = useRef(null);
  const key = holdingsKey(portfolio);
  const result = lastGrade && lastGrade.kind === 'grade' && lastGrade.key === key ? lastGrade : null;

  const rows = portfolio.holdings;
  const setRows = (next) => setPortfolio({ holdings: next });
  const setRow = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const pctSum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const run = async (e) => {
    e.preventDefault();
    setError(null);
    setReasoning({ status: 'idle', text: null, error: null, model: null });
    if (portfolio.mode !== 'shares') {
      const pre = normalizeHoldings(rows, portfolio.mode);
      if (pre.error) return setError(pre.error);
    }
    const tickers = rows.filter((r) => r.ticker.trim() && Number(r.amount) > 0).map((r) => r.ticker.trim().toUpperCase());
    if (!tickers.length) return setError('Enter at least one holding.');
    setRunning(true);
    setProgress(Object.fromEntries(tickers.map((t) => [t, 'queued'])));
    try {
      const analyses = await analyzeMany(tickers, settings, (t, s) => setProgress((p) => ({ ...p, [t]: s })));
      const prices = Object.fromEntries(Object.entries(analyses).map(([t, a]) => [t, unitPrice(a)]));
      const norm = normalizeHoldings(rows, portfolio.mode, prices);
      if (norm.error) return setError(norm.error);
      const { grade, holdings, bench } = await gradeHoldings(norm.holdings, analyses, settings);
      const dollarTotal = portfolio.mode === 'dollars' ? rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) : portfolio.mode === 'shares' ? rows.reduce((s, r) => s + (Number(r.amount) || 0) * (prices[r.ticker.trim().toUpperCase()] || 0), 0) : null;
      onGraded({ kind: 'grade', key, grade, holdings, analyses, prices, bench, mode: portfolio.mode, dollarTotal });
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
  const summary = useMemo(() => (g ? gradeSummary(g) : []), [g]);
  const percentRows = useMemo(() => (result ? result.holdings.map((h) => ({ ticker: h.ticker, amount: (h.weight * 100).toFixed(2) })) : []), [result]);
  const thesisOverride = useMemo(() => ({ holdings: percentRows, amountMode: 'percent' }), [percentRows]);
  const holdingRows = rows.filter((r) => r.ticker.trim() && Number(r.amount) > 0).map((r) => ({ ticker: r.ticker.trim().toUpperCase(), amount: String(r.amount) }));

  return (
    <div className="space-y-5">
      <form className="card p-4 md:p-5 space-y-4" onSubmit={run} id="grade-form">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Grade a portfolio</h2>
            <p className="text-xs text-muted mt-1">Holdings as percent, dollars or shares. Stocks, equity ETFs, bond ETFs and Treasuries (US2Y, US5Y, US10Y, US30Y) are supported. The same holdings carry over to Optimize and Stress Test.</p>
          </div>
          {portfolio.activeId && <span className="pill bg-surface-2 text-ink-2">Editing saved: {portfolio.name}</span>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><div className="text-xs text-ink-2 mb-1">Amounts are</div>
            <select className="input w-48" value={portfolio.mode} onChange={(e) => setPortfolio({ mode: e.target.value })}>
              <option value="percent">percent (must total 100)</option>
              <option value="dollars">dollar amounts</option>
              <option value="shares">share counts</option>
            </select></label>
          {portfolio.mode === 'percent' && <div className={`text-xs self-center ${Math.abs(pctSum - 100) > 0.5 ? 'text-warn' : 'text-muted'}`}>Total {pctSum.toFixed(1)}%</div>}
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
              <input className="input uppercase" placeholder="Ticker or US10Y" value={r.ticker} onChange={(e) => setRow(i, { ticker: e.target.value.toUpperCase() })} spellCheck={false} aria-label={`Holding ${i + 1} ticker`} />
              <input className="input" type="number" min="0" step="any" placeholder={portfolio.mode === 'percent' ? 'Percent' : portfolio.mode === 'dollars' ? 'Dollars' : 'Shares'} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} aria-label={`Holding ${i + 1} amount`} />
              <div className="text-xs text-muted w-16 text-right">{running ? progress[r.ticker.toUpperCase()] || '' : ''}</div>
              <button type="button" className="btn btn-sm px-2" aria-label="Remove holding" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className="btn" onClick={() => setRows([...rows, { ticker: '', amount: '' }])}>+ Add holding</button>
          <button type="submit" className="btn btn-primary" disabled={running}>{running ? 'Grading…' : 'Grade portfolio'}</button>
          <span className="text-xs text-muted">About 10 seconds per holding.</span>
        </div>
        {error && <ErrorState title="Could not grade" text={error} />}
      </form>

      {running && <div className="space-y-5" aria-busy="true"><SkeletonCard lines={2} /><SkeletonCard lines={4} /><SkeletonCard chart /></div>}
      {!running && !g && !error && <EmptyState title="No grade yet" text="Add holdings above and press Grade portfolio. You get a 0–100 Portfolio Conviction Score built from holding quality, diversification and risk." />}

      {g && !running && (
        <div className="space-y-5" ref={ref} id="grade-results">
          <ScoreHeader score={g.score} label={g.label} title={portfolio.name || 'Portfolio'} subtitle={`${result.holdings.length} holdings · ${Object.entries(g.classWeights).map(([k, w]) => `${CLASS_LABELS[k] || k} ${(w * 100).toFixed(0)}%`).join(', ')}`} meta={g.riskMetrics.window ? `History ${g.riskMetrics.window.from} to ${g.riskMetrics.window.to}` : null} id="grade-score"
            scoreInfo={{ title: 'Portfolio Conviction Score', subtitle: 'Holding quality 40%, Diversification 30%, Risk 30% (re-normalized over available pillars)', steps: [{ label: 'Blend', ...g.blendStep }] }}
            actions={<>
              <ExportPdfButton targetRef={ref} filename={pdfName(`Conviction_Portfolio_${(portfolio.name || 'grade').replace(/[^a-z0-9]+/gi, '_')}`, settings.mode)} />
              <SavePortfolioButton defaultName={portfolio.name || result.holdings.map((h) => h.ticker).join(' / ')} isUpdate={Boolean(portfolio.activeId)} onSave={(name) => onSave(name, holdingRows, portfolio.mode)} />
              <button className="btn" onClick={() => onGoTab('optimize')}>Optimize this portfolio →</button>
              <button className="btn" onClick={() => onGoTab('stress')}>Stress test →</button>
            </>}
          >
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {g.pillars.map((p) => (
                <div key={p.id} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-center justify-between text-xs"><span className="text-ink-2 inline-flex items-center">{p.label}<InfoButton content={{ title: p.label, subtitle: `Pillar weight ${p.weight}%`, steps: g.steps[p.id] && g.steps[p.id].length ? g.steps[p.id] : [{ label: p.label, formula: 'see notes', calc: g.notes.join('; '), result: 'Unavailable' }] }} /></span><span className="text-muted">{p.score === null ? 'excluded' : `${(p.normWeight * 100).toFixed(0)}% weight`}</span></div>
                  <div className="num text-2xl font-bold mt-1" style={{ color: PILLAR_COLORS[p.id] }}>{p.score === null ? <Unavailable reason={g.notes.find((n) => n.toLowerCase().includes(p.id)) || 'Excluded'} /> : p.score.toFixed(0)}</div>
                  <div className="h-1.5 rounded-full bg-page mt-2 overflow-hidden"><div className="h-full" style={{ width: `${p.score ?? 0}%`, background: PILLAR_COLORS[p.id] }} /></div>
                </div>
              ))}
            </div>
            {g.notes.length > 0 && <ul className="mt-3 text-xs text-ink-2 space-y-1">{g.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>}
          </ScoreHeader>

          <DriversCard drivers={g.drivers} note="Pillar weight × component weight × (score − 50); holdings by their weight within Holding quality." />

          <ReasoningSection mode={settings.mode} summary={summary} ai={{ state: reasoning, onGenerate: generate, canGenerate: g.score !== null }}
            wharton={<Methodology intro="Weights and formulas used for this grade. Fixed templates; nothing is generated." sections={[
              { title: 'Portfolio Conviction Score', subtitle: g.blendStep.result, note: 'Pillar weights: Holding quality 40, Diversification 30, Risk 30 (re-normalized over available pillars).', steps: [{ label: 'Blend', ...g.blendStep }] },
              { title: PILLAR_LABELS.quality, subtitle: g.pillars[0].score === null ? 'unavailable' : g.pillars[0].score.toFixed(1), steps: g.steps.quality },
              { title: PILLAR_LABELS.diversification, subtitle: g.pillars[1].score === null ? 'unavailable' : g.pillars[1].score.toFixed(1), steps: g.steps.diversification },
              { title: PILLAR_LABELS.risk, subtitle: g.pillars[2].score === null ? 'unavailable' : g.pillars[2].score.toFixed(1), steps: g.steps.risk.length ? g.steps.risk : [{ label: 'Risk pillar', formula: 'portfolio return series', calc: g.notes.find((n) => /Risk pillar/.test(n)) || '', result: 'Unavailable' }] },
              { title: 'Per-holding scores', note: 'Each holding is scored by its own models (stock: six models; ETF and Treasury: the components shown on its page). Open a holding for its full methodology.', steps: result.holdings.map((h) => ({ label: h.ticker, formula: `${ASSET_TYPE_LABELS[h.assetType] || h.assetType} score`, calc: `weight ${fmtPct(h.weight, 1)}`, result: h.score === null ? `Unavailable: ${h.error || 'no score'}` : `${h.score}` })) },
            ]} />}
          />

          <section className="space-y-4" id="details">
            <Tabs items={DETAIL_TABS} value={tab} onChange={setTab} ariaLabel="Details" />
            {tab === 'holdings' && (
              <section className="card p-4 md:p-5 overflow-x-auto" id="grade-holdings">
                <table className="data-table">
                  <thead><tr><th>Ticker</th><th>Type</th><th className="r">Input</th><th className="r">Weight</th><th className="r">Score</th><th>Note</th></tr></thead>
                  <tbody>
                    {result.holdings.map((h) => (
                      <tr key={h.ticker}>
                        <td><button className="text-accent hover:underline font-semibold" onClick={() => onOpenStock(h.ticker)}>{h.ticker}</button>{h.name && <div className="text-muted truncate max-w-[200px]">{h.name}</div>}</td>
                        <td className="text-ink-2">{ASSET_TYPE_LABELS[h.assetType] || h.assetType}</td>
                        <td className="r num text-muted">{h.input}{MODE_UNIT[portfolio.mode] || ''}</td>
                        <td className="r num">{fmtPct(h.weight, 1)}</td>
                        <td className="r">{h.score === null ? <Unavailable reason={h.error || 'No score'} /> : <span className={`pill num ${scoreClass(h.score)}`}>{h.score}</span>}</td>
                        <td className="text-muted">{h.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {tab === 'diversification' && (
              <div className="grid gap-5 lg:grid-cols-2">
                <section className="card p-4 md:p-5"><ChartBlock title="Allocation by asset class" explanation={{ what: 'How the portfolio splits across stocks, equity ETFs, bond ETFs and Treasuries.', reading: Object.entries(g.classWeights).map(([k, w]) => `${CLASS_LABELS[k] || k} ${(w * 100).toFixed(0)}%`).join(', ') + '.', caveat: 'An equity ETF counts as one class even though it holds many stocks; the correlation table shows whether holdings actually move differently.' }}><AllocationPie classWeights={g.classWeights} labels={CLASS_LABELS} /></ChartBlock></section>
                <section className="card p-4 md:p-5"><ChartBlock title="How much holdings move together (correlation)" explanation={{ what: 'Whether each pair of holdings tends to move together day to day.', reading: g.avgCorr === null ? 'Correlation could not be computed (see notes).' : `Average pairwise correlation ${g.avgCorr.toFixed(2)}.`, caveat: 'Correlations tend to rise in sell-offs, so diversification is usually weakest when it matters most.' }}>{g.corr ? <CorrelationHeatmap corr={g.corr.matrix} tickers={g.corr.tickers} /> : <Unavailable reason={g.notes.find((n) => /Correlation/.test(n)) || 'not enough holdings with return history'} />}</ChartBlock></section>
                <section className="card p-4 md:p-5 lg:col-span-2">
                  <h3 className="font-semibold mb-2">Diversification components</h3>
                  <table className="data-table"><thead><tr><th>Component</th><th>Value</th><th className="r">Score</th></tr></thead><tbody>{g.components.diversification.map((c) => <tr key={c.id}><td><MetricLabel label={c.label} /></td><td className="num text-ink-2">{c.text}</td><td className="r num">{c.score.toFixed(1)}</td></tr>)}</tbody></table>
                </section>
              </div>
            )}
            {tab === 'risk' && (
              <div className="grid gap-5 lg:grid-cols-2">
                <section className="card p-4 md:p-5"><ChartBlock title="Cumulative return vs SPY and 60/40" explanation={{ what: "Growth of the portfolio at today's weights (rebalanced daily) against SPY alone and a 60/40 SPY/AGG mix, over the common history of all holdings.", reading: g.riskMetrics.window ? `${g.riskMetrics.window.days} trading days from ${g.riskMetrics.window.from}: portfolio ${fmtPct(g.riskMetrics.cumReturn, 1)}, SPY ${fmtPct(g.riskMetrics.spyCumReturn, 1)}${g.riskMetrics.sixtyFortyCumReturn !== null ? `, 60/40 ${fmtPct(g.riskMetrics.sixtyFortyCumReturn, 1)}` : ''}.` : 'Unavailable.', caveat: 'Treasury holdings use returns approximated from yield changes; ETFs and stocks use split-adjusted prices without dividends.' }}>{g.charts.cumulative.length ? <CumulativeChart data={g.charts.cumulative} /> : <Unavailable reason={g.notes.find((n) => /Risk pillar/.test(n)) || 'no return history'} />}</ChartBlock></section>
                <section className="card p-4 md:p-5"><ChartBlock title="Worst drop from peak (drawdown)" explanation={{ what: 'How far the portfolio sat below its previous high at each point.', reading: g.riskMetrics.mdd !== undefined ? `Worst drawdown ${fmtPct(g.riskMetrics.mdd, 1)}, bottoming on ${g.riskMetrics.trough}.` : 'Unavailable.', caveat: 'Constant weights are assumed, which quietly rebalances every day.' }}>{g.charts.drawdown.length ? <DrawdownChart drawdown={g.charts.drawdown} /> : <Unavailable reason="no return history" />}</ChartBlock></section>
                <section className="card p-4 md:p-5 lg:col-span-2">
                  <h3 className="font-semibold mb-2">Risk components</h3>
                  {g.components.risk.length ? <table className="data-table"><thead><tr><th>Component</th><th>Value</th><th className="r">Score</th></tr></thead><tbody>{g.components.risk.map((c) => <tr key={c.id}><td><MetricLabel label={c.label} /></td><td className="num text-ink-2">{c.text}</td><td className="r num">{c.score.toFixed(1)}</td></tr>)}</tbody></table> : <Unavailable reason={g.notes.find((n) => /Risk pillar/.test(n)) || 'no return history'} />}
                </section>
              </div>
            )}
            {tab === 'thesis' && (
              <div className="space-y-3">
                <p className="text-xs text-muted">Optional: add a time horizon, a growth target and your thesis. Uses the holdings and weights from this grade. Each stock runs the full six-model analysis.</p>
                <PortfolioPage settings={settings} onOpenStock={onOpenStock} embedded holdingsOverride={thesisOverride} />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
