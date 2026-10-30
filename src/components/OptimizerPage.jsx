import React, { useEffect, useRef, useState } from 'react';
import { analyzeMany, unitPrice } from '../lib/portfolioData.js';
import { optimize, RISK_LEVELS, DISCLAIMER } from '../models/optimizer.js';
import { ASSET_TYPE_LABELS } from '../models/assets.js';
import { fmt, fmtPct } from '../models/_math.js';
import { FrontierChart } from './chartsPortfolio.jsx';
import ChartBlock from './ChartBlock.jsx';
import Methodology from './Methodology.jsx';
import { StandardReasoning } from './Reasoning.jsx';
import { gradeHoldings, gradeSummary } from './GraderPage.jsx';

const usd = (v) => (v === null || v === undefined ? 'Unavailable' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

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
    riskLevel: o.level.label,
    volCap: o.level.volCap,
    amount: o.amount,
    window: o.window,
    bounds: o.bounds,
    infeasible: o.infeasible,
    chosen: { weights: Object.fromEntries(o.alloc.map((a) => [a.ticker, +a.weight.toFixed(4)])), vol: +o.chosen.vol.toFixed(4), expectedReturn: +o.chosen.ret.toFixed(4), sharpe: o.chosen.sharpe === null ? null : +o.chosen.sharpe.toFixed(3) },
    equalWeight: { vol: +o.equal.vol.toFixed(4), expectedReturn: +o.equal.ret.toFixed(4), sharpe: o.equal.sharpe === null ? null : +o.equal.sharpe.toFixed(3) },
    assets: o.alloc.map((a) => ({ ticker: a.ticker, histReturn: +a.expectedReturn.toFixed(4), vol: +a.vol.toFixed(4), shares: a.shares, dollars: +a.dollars.toFixed(2) })),
    leftover: +o.leftover.toFixed(2),
    scoreBefore: r.before ? r.before.grade.score : null,
    scoreAfter: r.after ? r.after.grade.score : null,
    notes: o.notes,
    disclaimer: DISCLAIMER,
  };
}

export default function OptimizerPage({ settings, seedTickers, onOpenStock }) {
  const [tickersText, setTickersText] = useState(seedTickers || 'SPY AGG TLT NVDA AAPL');
  const [risk, setRisk] = useState('moderate');
  const [amount, setAmount] = useState('10000');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const autoFor = useRef(null);
  useEffect(() => {
    if (seedTickers) setTickersText(seedTickers);
  }, [seedTickers]);

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
      const analyses = await analyzeMany(tickers, settings, (t, s) => setProgress((p) => ({ ...p, [t]: s })));
      const assets = tickers.map((t) => ({ ticker: t, returns: analyses[t]?.dailyReturns || [], price: unitPrice(analyses[t]), analysis: analyses[t] }));
      const rf = settings.riskFreeRate === '' || settings.riskFreeRate === null || settings.riskFreeRate === undefined ? 0 : Number(settings.riskFreeRate) / 100;
      const opt = optimize({ assets, rf, riskLevel: risk, amount: amt });
      if (!opt.ok) return setError(opt.error + (opt.notes.length ? ` ${opt.notes.join(' ')}` : ''));
      if (settings.riskFreeRate === '' || settings.riskFreeRate === null || settings.riskFreeRate === undefined) opt.notes.push('No risk-free rate available; Sharpe ratios use R_f = 0.');
      const n = opt.tickers.length;
      const before = await gradeHoldings(opt.tickers.map((t) => ({ ticker: t, weight: 1 / n, input: 'equal' })), analyses, settings);
      const after = await gradeHoldings(opt.tickers.map((t, i) => ({ ticker: t, weight: opt.chosen.w[i], input: 'optimized' })), analyses, settings);
      setResult({ opt, before, after, analyses });
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const generate = async () => {
    if (settings.mode !== 'standard' || !result) return;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const { requestReasoning } = await import('../lib/ai.js');
    const res = await requestReasoning('standard', 'Optimizer', optimizerPayload(result));
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
  const summary = result ? optimizerSummary(result) : [];

  return (
    <div className="space-y-5">
      <form className="card p-4 md:p-5 space-y-4" onSubmit={run}>
        <div>
          <h2 className="font-semibold">Optimize</h2>
          <p className="text-xs text-muted mt-1">Mean-variance optimization on up to 3 years of daily returns: maximize the Sharpe ratio with each holding between 2% and 30%, weights summing to 100%, and a volatility ceiling set by the risk level (Conservative ≤ 8%, Moderate ≤ 14%, Aggressive ≤ 22%).</p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_180px_180px_auto] md:items-end">
          <label className="block"><div className="text-xs text-ink-2 mb-1">Tickers (stocks, ETFs, US2Y/US5Y/US10Y/US30Y)</div><textarea className="input min-h-[60px] uppercase" value={tickersText} onChange={(e) => setTickersText(e.target.value)} spellCheck={false} /></label>
          <label className="block"><div className="text-xs text-ink-2 mb-1">Risk level</div><select className="input" value={risk} onChange={(e) => setRisk(e.target.value)}>{Object.entries(RISK_LEVELS).map(([k, v]) => <option key={k} value={k}>{v.label} (≤ {(v.volCap * 100).toFixed(0)}% vol)</option>)}</select></label>
          <label className="block"><div className="text-xs text-ink-2 mb-1">Investment amount ($)</div><input className="input" type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <button className="btn btn-primary" type="submit" disabled={running}>{running ? 'Optimizing…' : 'Optimize'}</button>
        </div>
        {Object.keys(progress).length > 0 && running && <div className="flex flex-wrap gap-2 text-xs">{Object.entries(progress).map(([t, s]) => <span key={t} className={`pill border ${s === 'done' ? 'border-[#0ca30c55] text-[#3ecf3e]' : s === 'failed' ? 'border-[#d03b3b55] text-[#e66767]' : s === 'loading' ? 'border-s1 text-s1' : 'border-axis text-muted'}`}>{t} {s}</span>)}</div>}
        {error && <div className="rounded-lg border border-[#d03b3b55] bg-[#d03b3b14] p-3 text-sm text-[#e66767]">{error}</div>}
        <p className="text-[11px] text-[#fab219]">{DISCLAIMER}</p>
      </form>

      {result && (
        <>
          <section className="card p-5 md:p-6" id="opt-result">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">Chosen portfolio · {o.level.label}</div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
                  {[['Volatility', fmtPct(o.chosen.vol, 1)], ['Historical return', `${fmtPct(o.chosen.ret, 1)}/yr`], ['Sharpe', o.chosen.sharpe === null ? 'n/a' : o.chosen.sharpe.toFixed(2)], ['Vol ceiling', fmtPct(o.level.volCap, 0)]].map(([l, v]) => <div key={l}><div className="text-[11px] uppercase tracking-wide text-muted">{l}</div><div className="num text-lg text-ink">{v}</div></div>)}
                </div>
                {o.infeasible && <div className="mt-2 rounded-lg border border-[#fab21955] bg-[#fab21914] p-2 text-xs text-[#fab219]">Infeasible for this risk level. Showing the closest feasible portfolio (lowest volatility).</div>}
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                {[['Before (equal weight)', result.before.grade], ['After (optimized)', result.after.grade]].map(([l, g]) => <div key={l} className="rounded-lg bg-surface-2 px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-muted">{l}</div><div className="num text-3xl font-bold">{g.score ?? '—'}</div><div className="text-xs text-ink-2">{g.score === null ? 'Unavailable' : g.label}</div></div>)}
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-muted"><th className="p-1 text-left font-medium">Ticker</th><th className="p-1 text-left font-medium">Type</th><th className="p-1 text-right font-medium">Weight</th><th className="p-1 text-right font-medium">Dollars</th><th className="p-1 text-right font-medium">Unit price</th><th className="p-1 text-right font-medium">Whole units</th><th className="p-1 text-right font-medium">Invested</th><th className="p-1 text-right font-medium">Hist. return</th><th className="p-1 text-right font-medium">Vol</th></tr></thead>
                <tbody>
                  {o.alloc.map((a) => {
                    const an = result.analyses[a.ticker];
                    return (
                      <tr key={a.ticker} className="border-t border-line">
                        <td className="p-1"><button className="text-s1 hover:underline font-semibold" onClick={() => onOpenStock(a.ticker)}>{a.ticker}</button></td>
                        <td className="p-1 text-ink-2">{an ? ASSET_TYPE_LABELS[an.assetType] : ''}{an?.assetType === 'treasury' ? ' (par $100 units)' : ''}</td>
                        <td className="p-1 text-right num">{fmtPct(a.weight, 1)}</td>
                        <td className="p-1 text-right num">{usd(a.dollars)}</td>
                        <td className="p-1 text-right num">{usd(a.price)}</td>
                        <td className="p-1 text-right num">{a.shares ?? 'Unavailable'}</td>
                        <td className="p-1 text-right num">{usd(a.invested)}</td>
                        <td className="p-1 text-right num">{fmtPct(a.expectedReturn, 1)}</td>
                        <td className="p-1 text-right num">{fmtPct(a.vol, 1)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-axis font-semibold"><td className="p-1" colSpan={6}>Invested / leftover cash</td><td className="p-1 text-right num">{usd(o.investedTotal)}</td><td className="p-1 text-right num" colSpan={2}>leftover {usd(o.leftover)}</td></tr>
                </tbody>
              </table>
            </div>
            {o.notes.length > 0 && <ul className="mt-3 text-xs text-[#fab219] space-y-1">{o.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            <p className="mt-3 text-xs text-[#fab219] font-semibold">{DISCLAIMER}</p>
          </section>

          <section className="card p-5 md:p-6" id="opt-conclusion">
            <h2 className="font-semibold mb-2">What this means</h2>
            <div className="space-y-2 text-sm text-ink-2 leading-relaxed">{summary.map((p, i) => <p key={i} className={i === 0 ? 'text-ink' : ''}>{p}</p>)}</div>
          </section>

          <section className="card p-4 md:p-5">
            <ChartBlock title="Efficient frontier (historical, annualized)" explanation={{ what: 'Each blue point is the best historical return available for a given volatility within the bounds. The star is the chosen portfolio, the square is equal weight, and the diamonds are the individual assets.', reading: `Chosen: ${fmtPct(o.chosen.vol, 1)} volatility, ${fmtPct(o.chosen.ret, 1)} return. Equal weight: ${fmtPct(o.equal.vol, 1)}, ${fmtPct(o.equal.ret, 1)}.`, caveat: DISCLAIMER }}>
              <FrontierChart frontier={o.frontier} chosen={o.chosen} equal={o.equal} assets={o.alloc} volCap={o.level.volCap} />
            </ChartBlock>
          </section>

          {settings.mode === 'standard'
            ? <StandardReasoning state={reasoning} onGenerate={generate} canGenerate={true} fallback={summary} />
            : <Methodology intro="Objective, constraints, inputs and result. Fixed templates; nothing is generated." sections={[
                { title: 'Optimizer', subtitle: o.infeasible ? 'infeasible: closest shown' : 'feasible', steps: o.steps },
                { title: 'Before: equal weight', subtitle: result.before.grade.score === null ? 'unavailable' : `${result.before.grade.score}`, steps: [{ label: 'Blend', ...result.before.grade.blendStep }, ...result.before.grade.steps.diversification, ...result.before.grade.steps.risk] },
                { title: 'After: optimized weights', subtitle: result.after.grade.score === null ? 'unavailable' : `${result.after.grade.score}`, steps: [{ label: 'Blend', ...result.after.grade.blendStep }, ...result.after.grade.steps.diversification, ...result.after.grade.steps.risk] },
              ]} />}
        </>
      )}
    </div>
  );
}

export { gradeSummary };
