import React, { useCallback, useEffect, useRef, useState } from 'react';
import { analyzePortfolio, buildPortfolioPayload } from '../lib/portfolioPipeline.js';
import { loadPortfolioDraft, savePortfolioDraft, loadPortfolios, savePortfolioEntry, deletePortfolioEntry, DEFAULT_PORTFOLIO } from '../lib/settings.js';
import { portfolioConclusion, portfolioChartExplanations } from '../lib/plainEnglishPortfolio.js';
import { horizonLabel, normalizeWeights } from '../models/portfolio.js';
import { MODEL_ORDER, MODEL_LABELS } from '../models/conviction.js';
import { fmt, fmtPct } from '../models/_math.js';
import { PortfolioFanChart, PortfolioHistogram, CorrelationTable, PerModelBars, DrawdownChart } from './charts.jsx';
import { StandardReasoning, MathModeBadge } from './Reasoning.jsx';
import { exportElementToPdf } from '../lib/exportPdf.js';
import { labelText, labelColor, scoreClass } from '../lib/labels.js';
import { Unavailable, UnavailableBlock, SkeletonCard, ErrorState } from './ui.jsx';

const PART_COLORS = { conviction: 'var(--chart-1)', target: 'var(--chart-3)', risk: 'var(--chart-2)' };
const SHORT = { dcf: 'DCF', monteCarlo: 'MC', risk: 'Risk', momentum: 'Mom', health: 'Health', earnings: 'Earn' };


function ChartBlock({ title, explanation, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="text-xs text-ink-2 mb-1">{title}</div>
      {children}
      {explanation && (
        <div className="mt-1">
          <button className="text-xs text-s1 hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'Hide explanation' : 'Explain this chart'}</button>
          {open && (
            <div className="mt-2 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed space-y-2">
              <p className="text-ink-2">{explanation.what}</p>
              <p className="text-ink">{explanation.reading}</p>
              <p className="text-muted">{explanation.caveat}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted truncate">{label}</div>
      <div className="num text-sm text-ink truncate">{value}</div>
    </div>
  );
}

/* ---------------- Form ---------------- */
function PortfolioForm({ def, onChange, onRun, running, embedded }) {
  const set = (patch) => onChange({ ...def, ...patch });
  const setHolding = (i, patch) => set({ holdings: def.holdings.map((h, k) => (k === i ? { ...h, ...patch } : h)) });
  const weights = normalizeWeights(def.holdings);
  const valid = def.holdings.filter((h) => h.ticker.trim() && Number(h.amount) > 0).length;
  const unit = def.amountMode === 'dollars' ? '$' : '%';

  return (
    <form className="card p-4 md:p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid >= 1 && !running) onRun(); }}>
      {!embedded && <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <label className="block">
          <div className="text-xs text-ink-2 mb-1">Portfolio name</div>
          <input className="input" placeholder="e.g. AI capex basket" value={def.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="block">
          <div className="text-xs text-ink-2 mb-1">Amounts are</div>
          <select className="input" value={def.amountMode} onChange={(e) => set({ amountMode: e.target.value })}>
            <option value="percent">percent of portfolio</option>
            <option value="dollars">dollar amounts</option>
          </select>
        </label>
      </div>}

      {embedded ? <div className="text-xs text-ink-2">Using the {valid} holding{valid === 1 ? '' : 's'} and weights from the grade above: {def.holdings.filter((h) => h.ticker).map((h) => `${h.ticker} ${fmtPct(Number(h.amount) / 100, 1)}`).join(', ')}.</div> : <div>
        <div className="text-xs text-ink-2 mb-1">Holdings (any amounts; weights are worked out from the ratios)</div>
        <div className="space-y-2">
          {def.holdings.map((h, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
              <input className="input uppercase" placeholder="Ticker" value={h.ticker} onChange={(e) => setHolding(i, { ticker: e.target.value.toUpperCase() })} autoCapitalize="characters" spellCheck={false} />
              <input className="input" type="number" min="0" step="any" placeholder={unit === '$' ? 'Dollars' : 'Percent'} value={h.amount} onChange={(e) => setHolding(i, { amount: e.target.value })} />
              <div className="num text-xs text-muted w-14 text-right">{weights[i].weight > 0 ? fmtPct(weights[i].weight) : '—'}</div>
              <button type="button" className="btn px-2" aria-label="Remove holding" onClick={() => set({ holdings: def.holdings.filter((_, k) => k !== i) })} disabled={def.holdings.length <= 1}>×</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn mt-2" onClick={() => set({ holdings: [...def.holdings, { ticker: '', amount: '' }] })}>+ Add holding</button>
      </div>}

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <div className="text-xs text-ink-2 mb-1">Time horizon</div>
          <div className="flex gap-2">
            <input className="input" type="number" min="1" step="1" value={def.horizon.value} onChange={(e) => set({ horizon: { ...def.horizon, value: e.target.value } })} />
            <select className="input" value={def.horizon.unit} onChange={(e) => set({ horizon: { ...def.horizon, unit: e.target.value } })}>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
              <option value="years">years</option>
            </select>
          </div>
        </label>
        <label className="block">
          <div className="text-xs text-ink-2 mb-1">Growth needed over that horizon (%)</div>
          <input className="input" type="number" step="0.5" value={def.targetGrowth} onChange={(e) => set({ targetGrowth: e.target.value })} />
        </label>
        <div className="text-xs text-muted self-end pb-2">The score asks: how likely is this basket to gain at least {fmt(Number(def.targetGrowth) || 0, 1)}% in {horizonLabel(def.horizon)}?</div>
      </div>

      <label className="block">
        <div className="text-xs text-ink-2 mb-1">Thesis (your reasoning, in your words)</div>
        <textarea className="input min-h-[80px] font-sans" placeholder="e.g. Data-center spending stays strong through year end, so chip and power names outrun the market." value={def.thesis} onChange={(e) => set({ thesis: e.target.value })} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={running || valid === 0}>{running ? 'Analyzing…' : `Analyze ${valid || ''} holding${valid === 1 ? '' : 's'}`}</button>
        <button type="button" className="btn" onClick={() => onChange({ ...DEFAULT_PORTFOLIO, holdings: DEFAULT_PORTFOLIO.holdings.map((h) => ({ ...h })) })} disabled={running}>Clear</button>
        <span className="text-xs text-muted">Each holding runs the full six-model analysis, so expect roughly 10 seconds per stock.</span>
      </div>
    </form>
  );
}

/* ---------------- Results ---------------- */
function HoldingsProgress({ holdings }) {
  return (
    <section className="card p-4">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">Analyzing holdings</div>
      <div className="flex flex-wrap gap-2">
        {holdings.map((h) => (
          <span key={h.ticker} className={`pill border ${h.status === 'done' ? 'border-good/40 text-good' : h.status === 'failed' ? 'border-bad/40 text-bad' : h.status === 'loading' ? 'border-s1 text-s1' : 'border-axis text-muted'}`}>

            {h.ticker}{h.status === 'done' ? ` ${h.conviction.score}` : h.status === 'failed' ? ' failed' : ''}
          </span>
        ))}
      </div>
    </section>
  );
}

function PortfolioScoreCard({ def, analysis }) {
  const { score } = analysis;
  const paras = portfolioConclusion(def, analysis);
  return (
    <>
      <section className="card p-5 md:p-6" id="portfolio-score">
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          <div className="flex items-baseline gap-4">
            <div className="num text-6xl md:text-7xl font-bold leading-none" style={{ color: labelColor(score.label) }}>{score.score === null ? '—' : score.score}</div>
            <div>
              <div className="text-lg font-semibold" style={{ color: labelColor(score.label) }}>{score.score === null ? 'No score' : `${labelText(score.label)} conviction`}</div>
              <div className="text-xs text-muted">0–39 Weak · 40–59 Neutral · 60–79 Strong · 80–100 Very Strong</div>
            </div>
          </div>
          <div className="md:ml-auto md:text-right">
            <div className="text-2xl font-bold tracking-tight">{def.name || 'Untitled portfolio'}</div>
            <div className="text-sm text-ink-2">{analysis.holdings.length} holdings · needs {fmt(Number(def.targetGrowth), 1)}% in {horizonLabel(def.horizon)}</div>
          </div>
        </div>
        {score.breakdown.length > 0 && (
          <div className="mt-5">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">How the score is built (blend weight × subscore)</div>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-2 gap-[2px]">
              {score.breakdown.map((b) => <div key={b.id} style={{ width: `${(b.contribution / Math.max(score.score, 1)) * 100}%`, background: PART_COLORS[b.id] }} title={`${b.label}: ${b.contribution.toFixed(1)} pts`} />)}
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              {score.breakdown.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: PART_COLORS[b.id] }} />
                  <span className="text-ink-2">{b.label}</span>
                  <span className="num ml-auto text-ink">{b.subscore}</span>
                  <span className="num text-muted">× {(b.normWeight * 100).toFixed(0)}% = {b.contribution.toFixed(1)}</span>
                </div>
              ))}
            </div>
            {score.excluded.length > 0 && <div className="mt-2 text-xs text-warn">Excluded: {score.excluded.map((e) => `${e.label} (${e.reason})`).join('; ')}</div>}
          </div>
        )}
      </section>
      {paras && (
        <section className="card p-5 md:p-6" id="portfolio-conclusion">
          <h2 className="font-semibold mb-2">What this means</h2>
          <div className="space-y-2 text-sm text-ink-2 leading-relaxed">{paras.map((p, i) => <p key={i} className={i === 0 ? 'text-ink' : ''}>{p}</p>)}</div>
        </section>
      )}
    </>
  );
}

function HoldingsTable({ holdings, onOpenStock }) {
  return (
    <section className="card p-4 md:p-5" id="holdings-table">
      <h3 className="font-semibold mb-3">Holdings</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="text-left p-1 font-medium">Ticker</th>
              <th className="text-right p-1 font-medium">Weight</th>
              <th className="text-right p-1 font-medium">Price</th>
              <th className="text-right p-1 font-medium">Conviction</th>
              {MODEL_ORDER.map((id) => <th key={id} className="text-right p-1 font-medium" title={MODEL_LABELS[id]}>{SHORT[id]}</th>)}
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.ticker} className="border-t border-line">
                <td className="p-1">
                  <button className="text-s1 hover:underline font-semibold" onClick={() => onOpenStock(h.ticker)} title="Open full single-stock analysis">{h.ticker}</button>
                  {h.companyName && <div className="text-muted truncate max-w-[160px]">{h.companyName}</div>}
                  {h.status === 'failed' && <div className="text-bad">{h.error}</div>}
                </td>
                <td className="p-1 text-right num">{fmtPct(h.weight)}</td>
                <td className="p-1 text-right num">{h.price ? `$${fmt(h.price)}` : '—'}</td>
                <td className="p-1 text-right"><span className={`pill num ${scoreClass(h.conviction?.score ?? null)}`}>{h.conviction?.score ?? '—'}</span></td>
                {MODEL_ORDER.map((id) => {
                  const r = h.results?.[id];
                  return <td key={id} className="p-1 text-right num" style={{ color: r?.available ? (r.subscore >= 60 ? 'var(--score-good)' : r.subscore >= 40 ? 'var(--score-warn)' : 'var(--score-bad)') : 'var(--muted)' }}>{r?.available ? r.subscore : <Unavailable reason={r ? r.error : 'not run'} />}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-muted mt-2">n/a = that model could not run for the holding (hover for the reason). Click a ticker to open its full analysis.</div>
    </section>
  );
}

function PartCard({ part, def }) {
  if (!part) return null;
  const ex = portfolioChartExplanations(part);
  const m = part.metrics;
  let charts = null;
  let metrics = [];
  if (part.available) {
    switch (part.id) {
      case 'conviction':
        charts = <ChartBlock title="Weighted subscore by model" explanation={ex.perModel}><PerModelBars perModel={part.chart.perModel} labels={MODEL_LABELS} /></ChartBlock>;
        metrics = [['Weighted conviction', fmt(m.score, 1)], ['Holdings scored', `${m.holdingsScored}`], ['Weight covered', fmtPct(m.coveredWeight)]];
        break;
      case 'target':
        charts = (
          <div className="grid gap-4 md:grid-cols-2">
            <ChartBlock title={`Portfolio growth over ${m.horizon} (5 / 25 / 50 / 75 / 95th pct)`} explanation={ex.fan}><PortfolioFanChart fan={part.chart.fan} target={part.chart.target} /></ChartBlock>
            <ChartBlock title="Distribution of end results" explanation={ex.histogram}><PortfolioHistogram histogram={part.chart.histogram} target={part.chart.target} /></ChartBlock>
          </div>
        );
        metrics = [['P(reach target)', fmtPct(m.pTarget, 1)], ['Median outcome', fmtPct(m.median, 1)], ['5th–95th pct', `${fmtPct(m.p5, 1)} to ${fmtPct(m.p95, 1)}`], ['P(loss)', fmtPct(m.pLoss, 1)], ['Pace needed', `${fmtPct(m.requiredAnnual, 1)}/yr`], ['Recent pace', `${fmtPct(m.histAnnual, 1)}/yr`]];
        break;
      case 'risk':
        charts = (
          <div className="grid gap-4 md:grid-cols-2">
            <ChartBlock title="Correlation between holdings (1 year)" explanation={ex.corr}><CorrelationTable corr={part.chart.corr} tickers={part.chart.tickers} /></ChartBlock>
            <ChartBlock title="Drawdown of this mix (common history)" explanation={ex.drawdown}><DrawdownChart drawdown={part.chart.curve} /></ChartBlock>
          </div>
        );
        metrics = [['Portfolio volatility', fmtPct(m.vol)], ['Beta vs SPY', fmt(m.beta)], ['Max drawdown', fmtPct(m.maxDD)], ['Diversification ratio', fmt(m.divRatio)], ['Avg correlation', m.avgCorr === null ? 'n/a' : fmt(m.avgCorr)], ['Avg holding vol', fmtPct(m.weightedAvgVol)]];
        break;
      default:
        break;
    }
  }
  return (
    <section className="card p-4 md:p-5 flex flex-col gap-4" id={`part-${part.id}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{part.name}</h3>
          {part.available && <p className="text-xs text-muted mt-0.5">{part.scoringRule}</p>}
        </div>
        <div className={`pill num text-base px-3 py-1 ${scoreClass(part.available ? part.subscore : null)}`}>{part.available ? part.subscore : '—'}</div>
      </header>
      {!part.available ? (
        <UnavailableBlock title="Unavailable — excluded from the portfolio score" reason={part.error} />
      ) : (
        <>
          {part.warning && <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{part.warning}</div>}
          {charts}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 pt-2 border-t border-line">{metrics.map(([l, v]) => <Metric key={l} label={l} value={v} />)}</div>
        </>
      )}
    </section>
  );
}

function PortfolioMethodology({ def, analysis, reportRef, embedded }) {
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState(null);
  const doExport = async () => {
    setExporting(true);
    setErr(null);
    try {
      await exportElementToPdf(reportRef.current, `Conviction2_portfolio_${(def.name || 'untitled').replace(/[^a-z0-9]+/gi, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      setErr(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };
  const parts = ['conviction', 'target', 'risk'].map((k) => analysis.parts[k]).filter(Boolean);
  return (
    <section className="card p-4 md:p-5" id="portfolio-methodology">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Methodology</h2>
          <p className="text-xs text-muted">Every number is computed in the browser from the listed inputs. Fixed templates; nothing is generated.</p>
        </div>
        <div className="flex items-center gap-2">
          <MathModeBadge />
          {!embedded && <button className="btn" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export PDF'}</button>}
        </div>
      </header>
      {err && <div className="mt-3 text-sm text-bad">{err}</div>}
      <div className="mt-5">
        <h3 className="text-sm font-semibold">Portfolio conviction</h3>
        <table className="steps-table mt-2">
          <thead><tr><th>Step</th><th>Formula</th><th>Calculation</th><th>Result</th></tr></thead>
          <tbody>
            <tr>
              <td>Blend</td>
              <td className="num">score = Σ wₖ·sₖ / Σ wₖ</td>
              <td className="num">({analysis.score.breakdown.map((b) => `${b.weight}×${b.subscore}`).join(' + ')}) / {analysis.score.sumWeights}</td>
              <td className="num">{analysis.score.score} → {labelText(analysis.score.label)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-6 space-y-7">
        {parts.map((r) => (
          <div key={r.id}>
            <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold">{r.name}</h3><span className="num text-sm text-ink-2">{r.available ? `subscore ${r.subscore}` : 'unavailable'}</span></div>
            {!r.available ? <p className="text-sm text-bad mt-1">{r.error}</p> : (
              <>
                <p className="text-xs text-muted mt-1">{r.note}</p>
                <div className="mt-2 text-xs"><span className="text-muted">Inputs: </span>{r.inputs.map((inp, i) => <span key={i} className="text-ink-2">{inp.label} = <span className="num text-ink">{inp.value}</span> ({inp.source}){i < r.inputs.length - 1 ? '; ' : ''}</span>)}</div>
                <div className="overflow-x-auto mt-2">
                  <table className="steps-table">
                    <thead><tr><th>Step</th><th>Formula</th><th>Calculation</th><th>Result</th></tr></thead>
                    <tbody>{r.steps.map((s, i) => <tr key={i}><td className="text-ink-2 whitespace-nowrap">{s.label}</td><td className="num text-ink-2">{s.formula}</td><td className="num text-ink-2">{s.calc}</td><td className="num text-ink font-semibold whitespace-nowrap">{s.result}</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="text-xs text-muted mt-2">Scoring rule: {r.scoringRule}</div>
              </>
            )}
          </div>
        ))}
        <div>
          <h3 className="text-sm font-semibold">Per-holding conviction</h3>
          <p className="text-xs text-muted mt-1">Each holding's score is the weighted average of its six single-stock subscores (same rules as the Stock view). Open a holding for its full step-by-step methodology.</p>
          <table className="steps-table mt-2">
            <thead><tr><th>Holding</th><th>Weight</th><th>Subscores (DCF / MC / Risk / Mom / Health / Earn)</th><th>Conviction</th></tr></thead>
            <tbody>
              {analysis.holdings.map((h) => (
                <tr key={h.ticker}><td className="text-ink-2">{h.ticker}</td><td className="num">{fmtPct(h.weight)}</td><td className="num">{MODEL_ORDER.map((id) => (h.results?.[id]?.available ? h.results[id].subscore : 'n/a')).join(' / ')}</td><td className="num font-semibold">{h.conviction?.score ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Page ---------------- */
export default function PortfolioPage({ settings, onOpenStock, embedded = false, holdingsOverride = null }) {
  const [def, setDef] = useState(() => (holdingsOverride ? { ...loadPortfolioDraft(), holdings: holdingsOverride.holdings, amountMode: holdingsOverride.amountMode } : loadPortfolioDraft()));
  useEffect(() => { if (holdingsOverride) setDef((d) => ({ ...d, holdings: holdingsOverride.holdings, amountMode: holdingsOverride.amountMode })); }, [holdingsOverride]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [saved, setSaved] = useState(loadPortfolios);
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const reportRef = useRef(null);
  const runId = useRef(0);

  useEffect(() => { savePortfolioDraft(def); }, [def]);

  const run = useCallback(async () => {
    runId.current += 1;
    const my = runId.current;
    setRunning(true);
    setAnalysis(null);
    setReasoning({ status: 'idle', text: null, error: null, model: null });
    const cleanDef = { ...def, holdings: def.holdings.filter((h) => h.ticker.trim() && Number(h.amount) > 0) };
    try {
      const result = await analyzePortfolio(cleanDef, settings, (snap) => {
        if (runId.current === my) setProgress(snap);
      });
      if (runId.current !== my) return;
      setAnalysis(result);
      if (result.score.score !== null) {
        const id = JSON.stringify([cleanDef.holdings.map((h) => [h.ticker.toUpperCase(), Number(h.amount)]), cleanDef.horizon, Number(cleanDef.targetGrowth)]);
        const entry = { id, name: cleanDef.name || cleanDef.holdings.map((h) => h.ticker.toUpperCase()).join(' / '), def: cleanDef, date: new Date().toISOString().slice(0, 10), score: result.score.score, label: result.score.label };
        setSaved(savePortfolioEntry(entry));
      }
    } catch (err) {
      if (runId.current === my) setAnalysis({ holdings: [], parts: {}, score: { score: null, label: 'n/a', breakdown: [], excluded: [] }, error: err.message });
    } finally {
      if (runId.current === my) setRunning(false);
    }
  }, [def, settings]);

  const generate = useCallback(async () => {
    if (settings.mode !== 'standard' || !analysis || analysis.score.score === null) return;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const payload = buildPortfolioPayload(def, analysis, settings);
    // The AI module is loaded only here, and only in Standard mode.
    const { requestReasoning } = await import('../lib/ai.js');
    const res = await requestReasoning('standard', def.name || 'Untitled portfolio', payload);
    if (!res.ok) setReasoning({ status: 'error', text: null, error: res.error, model: null });
    else if (!res.data.text) setReasoning({ status: 'error', text: null, error: res.data.error || 'Empty response.', model: res.data.model });
    else setReasoning({ status: 'done', text: res.data.text, error: null, model: res.data.model });
  }, [analysis, def, settings]);

  const autoFor = useRef(null);
  useEffect(() => {
    if (settings.mode !== 'standard' || !analysis || analysis.score.score === null) return;
    const key = runId.current;
    if (autoFor.current === key) return;
    autoFor.current = key;
    generate();
  }, [settings.mode, analysis, generate]);

  return (
    <div className="space-y-5">
      <PortfolioForm def={def} onChange={setDef} onRun={run} running={running} embedded={embedded} />

      {running && progress && <HoldingsProgress holdings={progress.holdings} />}
      {running && <div className="space-y-5" aria-busy="true"><SkeletonCard lines={3} /><SkeletonCard chart /></div>}

      {analysis && analysis.error && <ErrorState title="Could not analyze" text={analysis.error} />}

      {analysis && !analysis.error && (
        <div ref={reportRef} className="space-y-5">
          <PortfolioScoreCard def={def} analysis={analysis} />
          <HoldingsTable holdings={analysis.holdings} onOpenStock={onOpenStock} />
          <PartCard part={analysis.parts.conviction} def={def} />
          <PartCard part={analysis.parts.target} def={def} />
          <PartCard part={analysis.parts.risk} def={def} />
          {settings.mode === 'standard'
            ? <StandardReasoning state={reasoning} onGenerate={generate} canGenerate={analysis.score.score !== null} fallback={portfolioConclusion(def, analysis)} />
            : <PortfolioMethodology def={def} analysis={analysis} reportRef={reportRef} embedded={embedded} />}
        </div>
      )}

      {!embedded && saved.length > 0 && (
        <section className="card p-4">
          <header className="flex items-center justify-between mb-2"><h2 className="text-sm font-semibold">Saved portfolios</h2></header>
          <div className="flex flex-wrap gap-2">
            {saved.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1">
                <button className="btn text-xs" onClick={() => setDef({ ...DEFAULT_PORTFOLIO, ...p.def, horizon: { ...DEFAULT_PORTFOLIO.horizon, ...(p.def.horizon || {}) } })} title={`${p.date} · ${p.def.holdings.map((h) => h.ticker).join(', ')}`}>
                  <span className="font-bold">{p.name}</span><span className="num">{p.score}</span><span className="text-muted">{labelText(p.label)} · {p.date}</span>
                </button>
                <button className="text-muted hover:text-ink text-xs px-1" aria-label="Delete saved portfolio" onClick={() => setSaved(deletePortfolioEntry(p.id))}>×</button>
              </span>
            ))}
          </div>
          <div className="text-[11px] text-muted mt-2">Click to load a saved setup into the form, then Analyze to re-run it with today's data.</div>
        </section>
      )}
    </div>
  );
}
