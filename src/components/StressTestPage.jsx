import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { analyzeMany, unitPrice } from '../lib/portfolioData.js';
import { normalizeHoldings } from '../models/portfolioGrade.js';
import { ASSET_TYPE_LABELS } from '../models/assets.js';
import { treasuryReturnsFromYields } from '../models/bondMath.js';
import { SCENARIOS, runScenario, runShocks, summarize, betaVsSpy, SHOCK_LABEL, MIN_COVERAGE } from '../models/stressTest.js';
import { fmtPct } from '../models/_math.js';
import { IndexedChart } from './chartsExtra.jsx';
import ChartBlock from './ChartBlock.jsx';
import Methodology from './Methodology.jsx';
import { ReasoningSection, ExportPdfButton, pdfName } from './results/common.jsx';
import SavePortfolioButton from './SavePortfolioButton.jsx';
import { Tabs, SkeletonCard, ErrorState, Unavailable, EmptyState, Notice, InfoButton, MetricLabel } from './ui.jsx';
import { holdingsKey } from './GraderPage.jsx';

const usd = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (v, d = 1) => fmtPct(v, d);
const recoveryText = (s) => (s.recovered ? `${s.recoveryDays} trading days (${s.recoveryDate})` : `not yet recovered (${s.daysSinceEnd} trading days since)`);

function closeSeries(bars) {
  return bars.map((b) => ({ date: b.date, close: b.close }));
}

/** Treasury "price index" from FRED yields using the same return approximation as the rest of the app (V_0 = 100). */
function treasuryIndex(yields, tenor) {
  const rets = treasuryReturnsFromYields(yields, tenor);
  const out = [{ date: yields[0].date, close: 100 }];
  let v = 100;
  for (const r of rets) { v *= 1 + r.ret; out.push({ date: r.date, close: v }); }
  return out;
}

/** Fixed-template summary (no AI). */
export function stressSummary(r) {
  const paras = [];
  const s = r.summary;
  paras.push(`Historical scenarios replay actual daily prices with the current weights held constant. ${s.worstScenario ? `The worst available scenario is ${s.worstScenario.scenario.name} (${s.worstScenario.scenario.start} to ${s.worstScenario.scenario.end}): the portfolio returned ${pct(s.worstScenario.totalReturn)} with a worst drop of ${pct(s.worstScenario.maxDrawdown)}, ${s.worstScenario.recovered ? `recovering in ${s.worstScenario.recoveryDays} trading days` : 'and has not yet recovered'}.` : 'No historical scenario could be computed with at least 50% coverage.'}`);
  const unavailable = r.scenarios.filter((x) => x.status !== 'ok');
  if (unavailable.length) paras.push(`Unavailable: ${unavailable.map((x) => `${x.scenario.name} (${x.coverageText.replace('Coverage: ', 'coverage ')})`).join('; ')}.`);
  if (s.worstShock) paras.push(`${SHOCK_LABEL}. The worst hypothetical shock is ${s.worstShock.label}: estimated ${pct(s.worstShock.estReturn)} (${usd(s.worstShock.dollars)}) on ${(s.worstShock.coverage * 100).toFixed(0)}% coverage, using ${s.worstShock.formula}.`);
  if (s.vulnerable) paras.push(`Most vulnerable holding: ${s.vulnerable.ticker}, ${s.vulnerable.text}.`);
  paras.push('Returns are price returns (split-adjusted, no dividends). Past drawdowns do not predict future ones. Nothing here is investment advice.');
  return paras;
}

export function stressPayload(r) {
  return {
    kind: 'stress',
    amount: r.amount,
    scenarios: r.scenarios.map((s) => (s.status === 'ok' ? { name: s.scenario.name, start: s.scenario.start, end: s.scenario.end, coverage: +s.coverage.toFixed(3), totalReturn: +s.totalReturn.toFixed(4), maxDrawdown: +s.maxDrawdown.toFixed(4), recoveryDays: s.recoveryDays, spy: s.benchmarks.spy.status === 'ok' ? +s.benchmarks.spy.totalReturn.toFixed(4) : null, sixtyForty: s.benchmarks.sixtyForty.status === 'ok' ? +s.benchmarks.sixtyForty.totalReturn.toFixed(4) : null, worst: s.worst ? { ticker: s.worst.ticker, ret: +s.worst.ret.toFixed(4) } : null, best: s.best ? { ticker: s.best.ticker, ret: +s.best.ret.toFixed(4) } : null } : { name: s.scenario.name, status: 'unavailable', reason: s.reason })),
    shocks: [...r.shocks.market, ...r.shocks.rates].map((s) => ({ label: s.label, status: s.status, coverage: +s.coverage.toFixed(3), estReturn: s.estReturn === null ? null : +s.estReturn.toFixed(4), dollars: s.dollars === null ? null : +s.dollars.toFixed(0), formula: s.formula, note: SHOCK_LABEL })),
    summary: { worstScenario: r.summary.worstScenario ? r.summary.worstScenario.scenario.name : null, worstShock: r.summary.worstShock ? r.summary.worstShock.label : null, vulnerable: r.summary.vulnerable },
  };
}

const DETAIL_TABS = [{ id: 'historical', label: 'Historical scenarios' }, { id: 'shocks', label: 'Hypothetical shocks' }, { id: 'inputs', label: 'Holdings & inputs' }];

export default function StressTestPage({ settings, portfolio, lastGrade, onOpenStock, onGoTab, onSave }) {
  const [amount, setAmount] = useState(() => String(lastGrade && lastGrade.dollarTotal ? Math.round(lastGrade.dollarTotal) : 10000));
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('historical');
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const autoFor = useRef(null);
  const ref = useRef(null);
  const key = holdingsKey(portfolio);
  const rows = portfolio.holdings.filter((h) => h.ticker.trim() && Number(h.amount) > 0);
  const holdingRows = rows.map((r) => ({ ticker: r.ticker.trim().toUpperCase(), amount: String(r.amount) }));
  useEffect(() => { if (lastGrade && lastGrade.dollarTotal) setAmount(String(Math.round(lastGrade.dollarTotal))); }, [lastGrade]);

  const run = async (e) => {
    if (e) e.preventDefault();
    setError(null);
    setResult(null);
    setReasoning({ status: 'idle', text: null, error: null, model: null });
    const amt = Number(amount);
    if (!rows.length) return setError('Add holdings on the Grade tab first.');
    if (!(amt > 0)) return setError('Enter a positive portfolio value.');
    setRunning(true);
    try {
      const tickers = rows.map((r) => r.ticker.trim().toUpperCase());
      setStage('Analyzing holdings…');
      const reuse = lastGrade && lastGrade.key === key ? lastGrade.analyses : {};
      const missing = tickers.filter((t) => !reuse[t]);
      const fresh = missing.length ? await analyzeMany(missing, settings) : {};
      const analyses = { ...Object.fromEntries(tickers.filter((t) => reuse[t]).map((t) => [t, reuse[t]])), ...fresh };
      const prices = Object.fromEntries(Object.entries(analyses).map(([t, a]) => [t, unitPrice(a)]));
      const norm = normalizeHoldings(rows, portfolio.mode, prices);
      if (norm.error) return setError(norm.error);
      setStage('Loading price history…');
      const [spyRes, aggRes] = await Promise.all([api.priceHistory('SPY'), api.priceHistory('AGG')]);
      const spy = spyRes.ok ? closeSeries(spyRes.data.bars) : null;
      const agg = aggRes.ok ? closeSeries(aggRes.data.bars) : null;
      const spyReturns = spy ? spy.slice(1).map((b, i) => ({ date: b.date, ret: b.close / spy[i].close - 1 })) : null;
      const holdings = await Promise.all(norm.holdings.map(async (h) => {
        const a = analyses[h.ticker];
        const base = { ticker: h.ticker, weight: h.weight, assetType: a ? a.assetType : 'unsupported', name: a ? a.name : null, series: null, seriesSource: null, seriesError: null, beta: null, betaDays: null, betaReason: null, duration: null, durationKind: null, durationReason: null };
        if (!a || a.assetType === 'unsupported') return { ...base, seriesError: a ? a.error : 'not analysed', betaReason: 'asset unsupported', durationReason: 'asset unsupported' };
        if (a.assetType === 'treasury') {
          const fr = await api.fred(a.asset ? a.asset.series : a.detection?.series || 'DGS10', { start: '1962-01-01' });
          const series = fr.ok && fr.data.series && Object.values(fr.data.series)[0]?.length > 2 ? treasuryIndex(Object.values(fr.data.series)[0], a.asset ? a.asset.tenor : 10) : null;
          const d = a.results.duration && a.results.duration.available ? a.results.duration.metrics.modified : null;
          return { ...base, series, seriesSource: series ? `FRED ${a.asset ? a.asset.series : ''} yields, returns approximated as −D_mod·Δy + y/252` : null, seriesError: series ? null : fr.error || 'no yield history', duration: d, durationKind: 'modified, par bond', durationReason: d === null ? 'duration unavailable' : null, betaReason: 'Treasury: market beta is not applied' };
        }
        const hr = await api.priceHistory(h.ticker);
        const series = hr.ok ? closeSeries(hr.data.bars) : null;
        const b = betaVsSpy(a.dailyReturns, spyReturns);
        const out = { ...base, series, seriesSource: series ? hr.data.source : null, seriesError: series ? null : hr.error };
        if (a.assetType === 'stock' || a.assetType === 'equity_etf') { out.beta = b ? b.beta : null; out.betaDays = b ? b.days : null; out.betaReason = b ? null : 'fewer than 60 common days with SPY'; out.durationReason = 'equity: duration is not applied'; }
        else { const d = a.results.duration && a.results.duration.available ? a.results.duration.metrics.empiricalDuration : null; out.duration = d; out.durationKind = 'empirical vs 10-year yield'; out.durationReason = d === null ? (a.results.duration ? a.results.duration.error : 'duration unavailable') : null; out.betaReason = 'bond ETF: market beta is not applied'; }
        return out;
      }));
      setStage('Replaying scenarios…');
      const scenarios = SCENARIOS.map((sc) => runScenario(sc, holdings, spy, agg));
      const shocks = runShocks(holdings, amt);
      const summary = summarize(scenarios, shocks);
      setResult({ scenarios, shocks, summary, holdings, amount: amt, spyFirst: spy ? spy[0].date : null, aggFirst: agg ? agg[0].date : null, spyError: spyRes.ok ? null : spyRes.error, aggError: aggRes.ok ? null : aggRes.error, key });
      setTab('historical');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      setStage('');
    }
  };

  const generate = async () => {
    if (settings.mode !== 'standard' || !result) return;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const { requestReasoning } = await import('../lib/ai.js');
    const res = await requestReasoning('standard', 'Stress test', stressPayload(result));
    if (!res.ok) setReasoning({ status: 'error', text: null, error: res.error, model: null });
    else if (!res.data.text) setReasoning({ status: 'error', text: null, error: res.data.error || 'Empty response.', model: res.data.model });
    else setReasoning({ status: 'done', text: res.data.text, error: null, model: res.data.model });
  };
  useEffect(() => {
    if (settings.mode !== 'standard') { setReasoning({ status: 'idle', text: null, error: null, model: null }); autoFor.current = null; return; }
    if (!result || autoFor.current === result) return;
    autoFor.current = result;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, settings.mode]);

  const summary = useMemo(() => (result ? stressSummary(result) : []), [result]);
  const s = result?.summary;
  const stale = result && result.key !== key;

  return (
    <div className="space-y-5">
      <form className="card p-4 md:p-5 space-y-4" onSubmit={run} id="stress-form">
        <div>
          <h2 className="font-semibold">Stress test</h2>
          <p className="text-xs text-muted mt-1">Replays five past crashes with your current weights held constant, then applies hypothetical market and rate shocks. Holdings come from the Grade tab.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_200px_auto] md:items-end">
          <div>
            <div className="text-xs text-ink-2 mb-1">Holdings</div>
            {rows.length ? <div className="text-sm text-ink flex flex-wrap gap-1.5">{holdingRows.map((h) => <span key={h.ticker} className="pill bg-surface-2 text-ink-2">{h.ticker} {h.amount}{portfolio.mode === 'percent' ? '%' : portfolio.mode === 'dollars' ? '$' : ' sh'}</span>)}<button type="button" className="text-xs text-accent hover:underline ml-1" onClick={() => onGoTab('grade')}>Edit on Grade</button></div> : <div className="text-sm text-muted">None yet. <button type="button" className="text-accent hover:underline" onClick={() => onGoTab('grade')}>Add holdings on Grade</button></div>}
          </div>
          <label className="block"><div className="text-xs text-ink-2 mb-1">Portfolio value ($, for shock losses)</div><input className="input" type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={running || !rows.length}>{running ? stage || 'Running…' : 'Run stress test'}</button>
        </div>
        {error && <ErrorState title="Could not run the stress test" text={error} />}
      </form>

      {running && <div className="space-y-5" aria-busy="true"><SkeletonCard lines={2} /><SkeletonCard lines={3} /><SkeletonCard chart /></div>}
      {!running && !result && !error && <EmptyState title="No stress test yet" text="Press Run stress test to replay the dot-com crash, 2008, the 2018 Q4 selloff, the 2020 COVID crash and the 2022 rate hikes, plus market −10%/−20% and rates +1%/+2% shocks." />}

      {result && !running && (
        <div className="space-y-5" ref={ref} id="stress-results">
          {stale && <Notice tone="warn">Holdings changed since this run. Press Run stress test again to refresh.</Notice>}
          <section className="card p-5 md:p-6" id="stress-summary">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-xl font-bold tracking-tight">{portfolio.name || 'Portfolio'} · Stress test</h2><div className="text-sm text-ink-2">{result.holdings.length} holdings · value ${result.amount.toLocaleString()}</div></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">Worst historical scenario</div>
                {s.worstScenario ? <><div className="num text-2xl font-bold" style={{ color: 'var(--score-bad)' }}>{pct(s.worstScenario.totalReturn)}</div><div className="text-xs text-ink-2">{s.worstScenario.scenario.name} · drawdown {pct(s.worstScenario.maxDrawdown)}</div></> : <div className="mt-1"><Unavailable reason="No scenario with at least 50% coverage" /></div>}
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">Worst hypothetical shock</div>
                {s.worstShock ? <><div className="num text-2xl font-bold" style={{ color: 'var(--score-bad)' }}>{pct(s.worstShock.estReturn)}</div><div className="text-xs text-ink-2">{s.worstShock.label} · {usd(s.worstShock.dollars)} · {(s.worstShock.coverage * 100).toFixed(0)}% covered · estimate</div></> : <div className="mt-1"><Unavailable reason="No holding has beta or duration" /></div>}
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">Most vulnerable holding</div>
                {s.vulnerable ? <><div className="num text-2xl font-bold">{s.vulnerable.ticker}</div><div className="text-xs text-ink-2">{s.vulnerable.text}</div></> : <div className="mt-1"><Unavailable reason="No holding-level result" /></div>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ExportPdfButton targetRef={ref} filename={pdfName('Conviction_StressTest', settings.mode)} />
              <SavePortfolioButton defaultName={portfolio.name || holdingRows.map((h) => h.ticker).join(' / ')} isUpdate={Boolean(portfolio.activeId)} onSave={(name) => onSave(name, holdingRows, portfolio.mode)} />
              <button className="btn" onClick={() => onGoTab('grade')}>← Grade</button>
              <button className="btn" onClick={() => onGoTab('optimize')}>Optimize →</button>
            </div>
          </section>

          <section className="card p-5" id="stress-drivers">
            <header className="mb-3"><h2 className="font-semibold">What drove the losses</h2><p className="text-xs text-muted">Contribution to the portfolio return in the worst available scenario (weight × holding return).</p></header>
            {s.worstScenario ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {[['Largest losses', [...s.worstScenario.perHolding].filter((h) => h.contribution < 0).slice(0, 3), 'var(--score-bad)', 'No holding lost value.'], ['Held up best', [...s.worstScenario.perHolding].sort((a, b) => b.contribution - a.contribution).slice(0, 3), 'var(--score-good)', 'None']].map(([title, items, color, empty]) => (
                  <div key={title}><div className="text-[11px] uppercase tracking-wide text-muted mb-2">{title} · {s.worstScenario.scenario.name}</div>{items.length === 0 ? <div className="text-sm text-muted">{empty}</div> : <ul className="space-y-1.5">{items.map((h) => <li key={h.ticker} className="flex items-baseline gap-2 text-sm"><span className="num w-14 shrink-0 text-right font-semibold" style={{ color }}>{pct(h.contribution)}</span><span><button className="text-ink hover:underline" onClick={() => onOpenStock(h.ticker)}>{h.ticker}</button><span className="text-muted"> · returned {pct(h.ret)} at {pct(h.weight, 0)} weight</span></span></li>)}</ul>}</div>
                ))}
              </div>
            ) : <Unavailable reason="No historical scenario could be computed" />}
          </section>

          <ReasoningSection mode={settings.mode} summary={summary} ai={{ state: reasoning, onGenerate: generate, canGenerate: true }}
            wharton={<Methodology intro="Scenario dates, formulas and inputs. Fixed templates; nothing is generated." sections={[
              { title: 'Historical scenarios', note: 'R = Π(1 + Σ wᵢ′·R_{i,t}) − 1 over the scenario days, constant re-normalized weights; MDD = min_t(V_t / max V − 1); recovery = trading days after the end until V ≥ V_start. Coverage below 50% → Unavailable.', steps: result.scenarios.map((x) => ({ label: x.scenario.name, formula: `${x.scenario.start} → ${x.scenario.end}`, calc: x.coverageText, result: x.status === 'ok' ? `R = ${pct(x.totalReturn)}, MDD = ${pct(x.maxDrawdown)}, recovery ${recoveryText(x)}` : x.reason })) },
              { title: `Hypothetical shocks (${SHOCK_LABEL})`, steps: [...result.shocks.market, ...result.shocks.rates].map((x) => ({ label: x.label, formula: x.formula, calc: x.status === 'ok' ? `${x.rows.filter((r) => r.status === 'ok').map((r) => `${r.ticker}: ${pct(r.weight, 0)} × (${r.formula})`).join('; ')}; ${x.coverageText}` : x.coverageText, result: x.status === 'ok' ? `${pct(x.estReturn)} = ${usd(x.dollars)}` : x.reason })) },
              { title: 'Inputs', steps: result.holdings.map((h) => ({ label: h.ticker, formula: `${ASSET_TYPE_LABELS[h.assetType] || h.assetType}, weight ${pct(h.weight, 1)}`, calc: `${h.series ? `history ${h.series[0].date} → ${h.series[h.series.length - 1].date} (${h.seriesSource})` : `history unavailable: ${h.seriesError}`}`, result: `${h.beta !== null ? `β = ${h.beta.toFixed(2)} (${h.betaDays} days)` : h.betaReason}; ${h.duration !== null ? `D = ${h.duration.toFixed(2)}y (${h.durationKind})` : h.durationReason}` })) },
            ]} />}
          />

          <section className="space-y-4" id="details">
            <Tabs items={DETAIL_TABS} value={tab} onChange={setTab} ariaLabel="Details" />
            {tab === 'historical' && result.scenarios.map((x) => (
              <section key={x.scenario.id} className="card p-4 md:p-5 space-y-3" id={`scenario-${x.scenario.id}`}>
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <div><h3 className="font-semibold">{x.scenario.name}</h3><div className="text-xs text-muted">{x.scenario.start} to {x.scenario.end} (SPY peak to trough)</div></div>
                  <div className="text-xs text-ink-2">{x.coverageText}</div>
                </header>
                {x.status !== 'ok' ? (
                  <div><Unavailable reason={x.reason} /> <span className="text-xs text-muted ml-2">{x.reason}</span>{x.excluded.length > 0 && <div className="text-xs text-muted mt-1">Price history from the current provider begins {x.excluded.map((e) => `${e.ticker}: ${e.firstDate || 'n/a'}`).join(', ')}.</div>}</div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead><tr><th>Series</th><th className="r">Total return</th><th className="r"><MetricLabel label="Max drawdown" /></th><th className="r">Recovery time</th></tr></thead>
                        <tbody>
                          <tr className="font-semibold"><td>Portfolio</td><td className="r num" style={{ color: x.totalReturn < 0 ? 'var(--score-bad)' : 'var(--score-good)' }}>{pct(x.totalReturn)}</td><td className="r num">{pct(x.maxDrawdown)}</td><td className="r num">{recoveryText(x)}</td></tr>
                          {[['SPY', x.benchmarks.spy], ['60/40 (SPY/AGG)', x.benchmarks.sixtyForty]].map(([name, b]) => <tr key={name}><td className="text-ink-2">{name}</td>{b.status === 'ok' ? <><td className="r num">{pct(b.totalReturn)}</td><td className="r num">{pct(b.maxDrawdown)}</td><td className="r num">{recoveryText(b)}</td></> : <td colSpan={3} className="r"><Unavailable reason={b.reason} /></td>}</tr>)}
                        </tbody>
                      </table>
                    </div>
                    <ChartBlock title="Portfolio vs SPY vs 60/40, indexed to 100 at the scenario start" explanation={{ what: 'Each line starts at 100 on the first day of the scenario and follows actual daily closes with weights held constant.', reading: `Portfolio ended at ${(100 * (1 + x.totalReturn)).toFixed(1)}${x.benchmarks.spy.status === 'ok' ? `, SPY at ${(100 * (1 + x.benchmarks.spy.totalReturn)).toFixed(1)}` : ''}${x.benchmarks.sixtyForty.status === 'ok' ? `, 60/40 at ${(100 * (1 + x.benchmarks.sixtyForty.totalReturn)).toFixed(1)}` : ''}.`, caveat: 'Price returns without dividends; constant weights mean daily rebalancing.' }}><IndexedChart data={x.chart} /></ChartBlock>
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead><tr><th>Holding</th><th className="r">Weight used</th><th className="r">Return</th><th className="r">Contribution</th></tr></thead>
                        <tbody>{x.perHolding.map((h) => <tr key={h.ticker} className={h.ticker === x.worst?.ticker ? 'bg-bad/10' : h.ticker === x.best?.ticker ? 'bg-good/10' : ''}><td><button className="text-accent hover:underline font-semibold" onClick={() => onOpenStock(h.ticker)}>{h.ticker}</button>{h.ticker === x.worst?.ticker && <span className="ml-2 pill bg-bad/15 text-bad">worst</span>}{h.ticker === x.best?.ticker && x.best.ticker !== x.worst?.ticker && <span className="ml-2 pill bg-good/15 text-good">best</span>}</td><td className="r num">{pct(h.weight, 1)}</td><td className="r num">{pct(h.ret)}</td><td className="r num">{pct(h.contribution)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            ))}
            {tab === 'shocks' && (
              <div className="space-y-4">
                <Notice tone="warn">{SHOCK_LABEL}. Market shocks use each equity holding's beta vs SPY (last 252 common days); rate shocks use each bond holding's duration. Holdings without the needed input are excluded and coverage is shown.</Notice>
                {[...result.shocks.market, ...result.shocks.rates].map((x) => (
                  <section key={x.id} className="card p-4 md:p-5 space-y-3" id={`shock-${x.id}`}>
                    <header className="flex flex-wrap items-baseline justify-between gap-2">
                      <div><h3 className="font-semibold inline-flex items-center">{x.label}<InfoButton content={{ title: x.label, subtitle: SHOCK_LABEL, steps: x.rows.filter((r) => r.status === 'ok').map((r) => ({ label: r.ticker, formula: x.formula, calc: `${pct(r.weight, 0)} × (${r.formula})`, result: pct(r.contribution) })) }} /></h3><div className="text-xs text-muted">{x.formula}</div></div>
                      <div className="text-xs text-ink-2">{x.coverageText}</div>
                    </header>
                    {x.status !== 'ok' ? <Unavailable reason={x.reason} /> : (
                      <>
                        <div className="flex flex-wrap gap-x-8 gap-y-2"><div><div className="text-[11px] uppercase tracking-wide text-muted">Estimated portfolio loss</div><div className="num text-2xl font-bold" style={{ color: 'var(--score-bad)' }}>{usd(x.dollars)}</div></div><div><div className="text-[11px] uppercase tracking-wide text-muted">As % of portfolio</div><div className="num text-2xl font-bold">{pct(x.estReturn)}</div></div><div><div className="text-[11px] uppercase tracking-wide text-muted">Coverage</div><div className="num text-2xl font-bold">{(x.coverage * 100).toFixed(0)}%</div></div></div>
                        <div className="overflow-x-auto">
                          <table className="data-table">
                            <thead><tr><th>Holding</th><th className="r">Weight</th><th>Input</th><th className="r">Est. return</th><th className="r">Contribution</th><th className="r">Est. $</th></tr></thead>
                            <tbody>{x.rows.map((r) => <tr key={r.ticker} className={x.worst && r.ticker === x.worst.ticker ? 'bg-bad/10' : ''}><td><button className="text-accent hover:underline font-semibold" onClick={() => onOpenStock(r.ticker)}>{r.ticker}</button></td><td className="r num">{pct(r.weight, 1)}</td>{r.status === 'ok' ? <><td className="num text-ink-2">{r.inputLabel}</td><td className="r num">{pct(r.estReturn)}</td><td className="r num">{pct(r.contribution)}</td><td className="r num">{usd(r.dollars)}</td></> : <td colSpan={4}><Unavailable reason={r.reason} /> <span className="text-xs text-muted ml-1">{r.reason}</span></td>}</tr>)}</tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </section>
                ))}
              </div>
            )}
            {tab === 'inputs' && (
              <section className="card p-4 md:p-5 overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Holding</th><th>Type</th><th className="r">Weight</th><th>Price history</th><th className="r"><MetricLabel label="Beta vs SPY" /></th><th className="r"><MetricLabel label="Rate sensitivity (duration)" /></th></tr></thead>
                  <tbody>{result.holdings.map((h) => <tr key={h.ticker}><td><button className="text-accent hover:underline font-semibold" onClick={() => onOpenStock(h.ticker)}>{h.ticker}</button>{h.name && <div className="text-muted truncate max-w-[180px]">{h.name}</div>}</td><td className="text-ink-2">{ASSET_TYPE_LABELS[h.assetType] || h.assetType}</td><td className="r num">{pct(h.weight, 1)}</td><td className="text-xs text-ink-2">{h.series ? `${h.series[0].date} → ${h.series[h.series.length - 1].date}` : <Unavailable reason={h.seriesError} />}<div className="text-muted">{h.seriesSource}</div></td><td className="r num">{h.beta !== null ? h.beta.toFixed(2) : <Unavailable reason={h.betaReason} />}</td><td className="r num">{h.duration !== null ? `${h.duration.toFixed(2)}y` : <Unavailable reason={h.durationReason} />}</td></tr>)}</tbody>
                </table>
                <p className="text-xs text-muted mt-2">Benchmarks: SPY history {result.spyFirst ? `from ${result.spyFirst}` : <Unavailable reason={result.spyError} />}; AGG history {result.aggFirst ? `from ${result.aggFirst}` : <Unavailable reason={result.aggError} />}. Scenarios need at least {MIN_COVERAGE * 100}% of the portfolio covered.</p>
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
