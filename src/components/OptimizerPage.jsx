import React, { useEffect, useMemo, useRef, useState } from 'react';
import { explainIfStandard } from '../lib/aiGate.js';
import { analyzeMany, unitPrice } from '../lib/portfolioData.js';
import { optimize, RISK_LEVELS, DISCLAIMER } from '../models/optimizer.js';
import { ASSET_TYPE_LABELS } from '../models/assets.js';
import { fmtPct } from '../models/_math.js';
import { FrontierChart } from './chartsPortfolio.jsx';
import ChartBlock from './ChartBlock.jsx';
import Methodology from './Methodology.jsx';
import ScoreHeader from './results/ScoreHeader.jsx';
import DriversCard from './results/DriversCard.jsx';
import { ReasoningSection, ExportPdfButton, pdfName } from './results/common.jsx';
import SavePortfolioButton from './SavePortfolioButton.jsx';
import { Tabs, SkeletonCard, ErrorState, Unavailable, EmptyState, Notice } from './ui.jsx';
import { gradeHoldings } from './GraderPage.jsx';
import { labelText } from '../lib/labels.js';

const usd = (v) => (v === null || v === undefined ? null : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Fixed-template summary (no AI). */
export function optimizerSummary(r) {
  const o = r.opt;
  const paras = [];
  paras.push(`${o.level.label} profile, $${o.amount.toLocaleString()} across ${o.tickers.length} assets, using ${o.window.days} trading days of daily returns (${o.window.from} to ${o.window.to}). ${o.infeasible ? `No mix within the bounds met the ${(o.level.volCap * 100).toFixed(0)}% volatility ceiling, so the lowest-volatility mix is shown instead (${fmtPct(o.chosen.vol, 1)}).` : `The chosen mix has the highest historical Sharpe ratio (${o.chosen.sharpe.toFixed(2)}) among mixes with volatility at or below ${(o.level.volCap * 100).toFixed(0)}%: volatility ${fmtPct(o.chosen.vol, 1)}, historical return ${fmtPct(o.chosen.ret, 1)} a year.`}`);
  paras.push(`Allocation: ${o.alloc.map((a) => `${a.ticker} ${fmtPct(a.weight, 1)} (${a.shares === null ? 'no unit price' : `${a.shares} × ${usd(a.price)}`})`).join(', ')}. Invested ${usd(o.investedTotal)}, leftover cash ${usd(o.leftover)}.`);
  if (r.before && r.after) {
    const b = r.before.grade.score;
    const a = r.after.grade.score;
    paras.push(`Portfolio Conviction Score: equal weight ${b ?? 'unavailable'} → optimized ${a ?? 'unavailable'}. ${a !== null && b !== null && a < b ? 'The optimizer maximizes the historical Sharpe ratio, not the conviction score: it can concentrate into assets with strong past returns, which lowers the diversification and holding-quality pillars even as risk-adjusted return improves.' : ''}`);
  }
  for (const n of o.notes) paras.push(n);
  paras.push(DISCLAIMER);
  return paras;
}

export function optimizerPayload(r) {
  const o = r.opt;
  return {
    kind: 'optimize',
    riskLevel: o.level.label, volCap: o.level.volCap, amount: o.amount, window: o.window, bounds: o.bounds, infeasible: o.infeasible,
    chosen: { weights: Object.fromEntries(o.alloc.map((a) => [a.ticker, +a.weight.toFixed(4)])), vol: +o.chosen.vol.toFixed(4), expectedReturn: +o.chosen.ret.toFixed(4), sharpe: o.chosen.sharpe === null ? null : +o.chosen.sharpe.toFixed(3) },
    equalWeight: { vol: +o.equal.vol.toFixed(4), expectedReturn: +o.equal.ret.toFixed(4), sharpe: o.equal.sharpe === null ? null : +o.equal.sharpe.toFixed(3) },
    assets: o.alloc.map((a) => ({ ticker: a.ticker, histReturn: +a.expectedReturn.toFixed(4), vol: +a.vol.toFixed(4), shares: a.shares, dollars: +a.dollars.toFixed(2) })),
    leftover: +o.leftover.toFixed(2), scoreBefore: r.before ? r.before.grade.score : null, scoreAfter: r.after ? r.after.grade.score : null, notes: o.notes, disclaimer: DISCLAIMER,
  };
}

const DETAIL_TABS = [{ id: 'allocation', label: 'Allocation' }, { id: 'frontier', label: 'Efficient frontier' }, { id: 'compare', label: 'Before vs after' }];

export default function OptimizerPage({ settings, portfolio, setPortfolio, lastGrade, onOpenStock, onGoTab, onSave }) {
  const seed = portfolio.holdings.filter((h) => h.ticker.trim()).map((h) => h.ticker.trim().toUpperCase()).join(' ');
  const [tickersText, setTickersText] = useState(seed || 'SPY AGG TLT NVDA AAPL');
  const [risk, setRisk] = useState('moderate');
  const [amount, setAmount] = useState(() => String(lastGrade && lastGrade.dollarTotal ? Math.round(lastGrade.dollarTotal) : 10000));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('allocation');
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const autoFor = useRef(null);
  const ref = useRef(null);
  useEffect(() => { if (seed) setTickersText(seed); }, [seed]);

  const run = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setReasoning({ status: 'idle', text: null, error: null, model: null });
    const tickers = [...new Set(tickersText.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    const amt = Number(amount);
    if (tickers.length < 2) return setError('Enter at least two tickers.');
    if (!(amt > 0)) return setError('Enter a positive investment amount.');
    setRunning(true);
    setProgress(Object.fromEntries(tickers.map((t) => [t, 'queued'])));
    try {
      const reuse = lastGrade && lastGrade.analyses ? lastGrade.analyses : {};
      const missing = tickers.filter((t) => !reuse[t]);
      const fresh = missing.length ? await analyzeMany(missing, settings, (t, s) => setProgress((p) => ({ ...p, [t]: s }))) : {};
      const analyses = { ...Object.fromEntries(tickers.filter((t) => reuse[t]).map((t) => [t, reuse[t]])), ...fresh };
      const assets = tickers.map((t) => ({ ticker: t, returns: analyses[t]?.dailyReturns || [], price: unitPrice(analyses[t]), analysis: analyses[t] }));
      const rfMissing = settings.riskFreeRate === '' || settings.riskFreeRate === null || settings.riskFreeRate === undefined;
      const rf = rfMissing ? 0 : Number(settings.riskFreeRate) / 100;
      const opt = optimize({ assets, rf, riskLevel: risk, amount: amt });
      if (!opt.ok) return setError(opt.error + (opt.notes.length ? ` ${opt.notes.join(' ')}` : ''));
      if (rfMissing) opt.notes.push('No risk-free rate available; Sharpe ratios use R_f = 0.');
      const n = opt.tickers.length;
      const before = await gradeHoldings(opt.tickers.map((t) => ({ ticker: t, weight: 1 / n, input: 'equal' })), analyses, settings);
      const after = await gradeHoldings(opt.tickers.map((t, i) => ({ ticker: t, weight: opt.chosen.w[i], input: 'optimized' })), analyses, settings);
      setResult({ opt, before, after, analyses });
      setTab('allocation');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const generate = async () => {
    if (settings.mode !== 'standard' || !result) return;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const res = await explainIfStandard(settings.mode, 'Optimizer', optimizerPayload(result));
    if (res.skipped) return;
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

  const o = result?.opt;
  const summary = useMemo(() => (result ? optimizerSummary(result) : []), [result]);
  const optimizedRows = o ? o.alloc.map((a) => ({ ticker: a.ticker, amount: (a.weight * 100).toFixed(2) })) : [];
  const applyToGrade = () => { setPortfolio({ holdings: [...optimizedRows, { ticker: '', amount: '' }], mode: 'percent' }); onGoTab('grade'); };

  return (
    <div className="space-y-5">
      <form className="card p-4 md:p-5 space-y-4" onSubmit={run} id="optimize-form">
        <div>
          <h2 className="font-semibold">Optimize weights</h2>
          <p className="text-xs text-muted mt-1">Mean-variance optimization on up to 3 years of daily returns: maximize the Sharpe ratio with each holding between 2% and 30%, weights summing to 100%, and a volatility ceiling set by the risk level. Tickers start from your Grade holdings.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_200px_180px_auto] md:items-end">
          <label className="block"><div className="text-xs text-ink-2 mb-1">Tickers (stocks, ETFs, US2Y/US5Y/US10Y/US30Y)</div><textarea className="input min-h-[60px] uppercase" value={tickersText} onChange={(e) => setTickersText(e.target.value)} spellCheck={false} /></label>
          <label className="block"><div className="text-xs text-ink-2 mb-1">Risk level</div><select className="input" value={risk} onChange={(e) => setRisk(e.target.value)}>{Object.entries(RISK_LEVELS).map(([k, v]) => <option key={k} value={k}>{v.label} (≤ {(v.volCap * 100).toFixed(0)}% vol)</option>)}</select></label>
          <label className="block"><div className="text-xs text-ink-2 mb-1">Investment amount ($)</div><input className="input" type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={running}>{running ? 'Optimizing…' : 'Optimize'}</button>
        </div>
        {running && Object.keys(progress).length > 0 && <div className="flex flex-wrap gap-2 text-xs">{Object.entries(progress).map(([t, s]) => <span key={t} className="pill bg-surface-2 text-ink-2">{t} {s}</span>)}</div>}
        {error && <ErrorState title="Could not optimize" text={error} />}
        <Notice tone="warn">{DISCLAIMER}</Notice>
      </form>

      {running && <div className="space-y-5" aria-busy="true"><SkeletonCard lines={2} /><SkeletonCard lines={4} /><SkeletonCard chart /></div>}
      {!running && !result && !error && <EmptyState title="No optimization yet" text="Choose a risk level and amount, then press Optimize to get weights, whole shares and the efficient frontier." />}

      {result && !running && (
        <div className="space-y-5" ref={ref} id="opt-results">
          <ScoreHeader score={result.after.grade.score} label={result.after.grade.label} title={`Optimized · ${o.level.label}`} subtitle={`${o.tickers.length} assets · $${o.amount.toLocaleString()} · ${o.infeasible ? 'closest feasible mix' : `max Sharpe under ${fmtPct(o.level.volCap, 0)} volatility`}`} meta={`Before (equal weight) ${result.before.grade.score ?? 'unavailable'} → after ${result.after.grade.score ?? 'unavailable'}`} id="opt-result"
            scoreInfo={{ title: 'Score after optimization', subtitle: 'Portfolio Conviction Score of the optimized weights', steps: [{ label: 'Blend', ...result.after.grade.blendStep }] }}
            actions={<>
              <ExportPdfButton targetRef={ref} filename={pdfName('Conviction_Optimizer', settings.mode)} />
              <SavePortfolioButton defaultName={`${portfolio.name || 'Portfolio'} (optimized ${o.level.label.toLowerCase()})`} onSave={(name) => onSave(name, optimizedRows, 'percent')} />
              <button className="btn" onClick={applyToGrade}>Use these weights in Grade →</button>
              <button className="btn" onClick={() => onGoTab('stress')}>Stress test →</button>
            </>}
          >
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
              {[['Volatility', fmtPct(o.chosen.vol, 1)], ['Historical return', `${fmtPct(o.chosen.ret, 1)}/yr`], ['Sharpe', o.chosen.sharpe === null ? null : o.chosen.sharpe.toFixed(2)], ['Vol ceiling', fmtPct(o.level.volCap, 0)], ['Invested', usd(o.investedTotal)], ['Leftover cash', usd(o.leftover)]].map(([l, v]) => <div key={l}><div className="text-[11px] uppercase tracking-wide text-muted">{l}</div><div className="num text-lg text-ink">{v === null ? <Unavailable reason="no risk-free rate" /> : v}</div></div>)}
            </div>
            {o.infeasible && <div className="mt-3"><Notice tone="warn">Infeasible for this risk level. Showing the closest feasible portfolio (lowest volatility).</Notice></div>}
            {o.notes.length > 0 && <ul className="mt-3 text-xs text-ink-2 space-y-1">{o.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>}
            <p className="mt-3 text-xs font-semibold text-ink-2">{DISCLAIMER}</p>
          </ScoreHeader>

          <DriversCard drivers={result.after.grade.drivers} note="For the optimized weights." />

          <ReasoningSection mode={settings.mode} summary={summary} ai={{ state: reasoning, onGenerate: generate, canGenerate: true }}
            wharton={<Methodology intro="Objective, constraints, inputs and result. Fixed templates; nothing is generated." sections={[
              { title: 'Optimizer', subtitle: o.infeasible ? 'infeasible: closest shown' : 'feasible', steps: o.steps },
              { title: 'Before: equal weight', subtitle: result.before.grade.score === null ? 'unavailable' : `${result.before.grade.score}`, steps: [{ label: 'Blend', ...result.before.grade.blendStep }, ...result.before.grade.steps.diversification, ...result.before.grade.steps.risk] },
              { title: 'After: optimized weights', subtitle: result.after.grade.score === null ? 'unavailable' : `${result.after.grade.score}`, steps: [{ label: 'Blend', ...result.after.grade.blendStep }, ...result.after.grade.steps.diversification, ...result.after.grade.steps.risk] },
            ]} />}
          />

          <section className="space-y-4" id="details">
            <Tabs items={DETAIL_TABS} value={tab} onChange={setTab} ariaLabel="Details" />
            {tab === 'allocation' && (
              <section className="card p-4 md:p-5 overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Ticker</th><th>Type</th><th className="r">Weight</th><th className="r">Dollars</th><th className="r">Unit price</th><th className="r">Whole units</th><th className="r">Invested</th><th className="r">Hist. return</th><th className="r">Vol</th></tr></thead>
                  <tbody>
                    {o.alloc.map((a) => {
                      const an = result.analyses[a.ticker];
                      return (
                        <tr key={a.ticker}>
                          <td><button className="text-accent hover:underline font-semibold" onClick={() => onOpenStock(a.ticker)}>{a.ticker}</button></td>
                          <td className="text-ink-2">{an ? ASSET_TYPE_LABELS[an.assetType] : ''}{an?.assetType === 'treasury' ? ' (par $100 units)' : ''}</td>
                          <td className="r num">{fmtPct(a.weight, 1)}</td>
                          <td className="r num">{usd(a.dollars)}</td>
                          <td className="r num">{a.price === null ? <Unavailable reason="no unit price" /> : usd(a.price)}</td>
                          <td className="r num">{a.shares === null ? <Unavailable reason="no unit price" /> : a.shares}</td>
                          <td className="r num">{a.invested === null ? <Unavailable reason="no unit price" /> : usd(a.invested)}</td>
                          <td className="r num">{fmtPct(a.expectedReturn, 1)}</td>
                          <td className="r num">{fmtPct(a.vol, 1)}</td>
                        </tr>
                      );
                    })}
                    <tr className="font-semibold"><td colSpan={6}>Invested / leftover cash</td><td className="r num">{usd(o.investedTotal)}</td><td className="r num" colSpan={2}>leftover {usd(o.leftover)}</td></tr>
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-ink-2 font-semibold">{DISCLAIMER}</p>
              </section>
            )}
            {tab === 'frontier' && (
              <section className="card p-4 md:p-5">
                <ChartBlock title="Efficient frontier (historical, annualized)" explanation={{ what: 'Each blue point is the best historical return available for a given volatility within the bounds. The star is the chosen portfolio, the square is equal weight, and the diamonds are the individual assets.', reading: `Chosen: ${fmtPct(o.chosen.vol, 1)} volatility, ${fmtPct(o.chosen.ret, 1)} return. Equal weight: ${fmtPct(o.equal.vol, 1)}, ${fmtPct(o.equal.ret, 1)}.`, caveat: DISCLAIMER }}>
                  <FrontierChart frontier={o.frontier} chosen={o.chosen} equal={o.equal} assets={o.alloc} volCap={o.level.volCap} />
                </ChartBlock>
              </section>
            )}
            {tab === 'compare' && (
              <section className="card p-4 md:p-5 overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Pillar</th><th className="r">Before (equal weight)</th><th className="r">After (optimized)</th><th className="r">Change</th></tr></thead>
                  <tbody>
                    <tr className="font-semibold"><td>Portfolio Conviction Score</td><td className="r num">{result.before.grade.score ?? '—'} <span className="text-muted font-normal">{labelText(result.before.grade.label)}</span></td><td className="r num">{result.after.grade.score ?? '—'} <span className="text-muted font-normal">{labelText(result.after.grade.label)}</span></td><td className="r num">{result.before.grade.score !== null && result.after.grade.score !== null ? `${result.after.grade.score - result.before.grade.score >= 0 ? '+' : ''}${result.after.grade.score - result.before.grade.score}` : '—'}</td></tr>
                    {result.after.grade.pillars.map((p, i) => { const b = result.before.grade.pillars[i]; return <tr key={p.id}><td className="text-ink-2">{p.label}</td><td className="r num">{b.score === null ? <Unavailable /> : b.score.toFixed(0)}</td><td className="r num">{p.score === null ? <Unavailable /> : p.score.toFixed(0)}</td><td className="r num">{b.score !== null && p.score !== null ? `${p.score - b.score >= 0 ? '+' : ''}${(p.score - b.score).toFixed(0)}` : '—'}</td></tr>; })}
                  </tbody>
                </table>
                <p className="text-xs text-muted mt-2">The optimizer maximizes the historical Sharpe ratio, not the conviction score; a lower score after optimization is explained in "What this means".</p>
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
