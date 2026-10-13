import React, { useState } from 'react';
import { fmt, fmtPct, fmtMoney, fmtShares } from '../models/_math.js';
import {
  FanChart, EndingHistogram, DrawdownChart, RollingBetaChart,
  PriceSmaChart, MarginsChart, RevenueFcfChart, SurpriseChart, InsiderFlowChart,
} from './charts.jsx';
import { MODEL_LABELS } from '../models/conviction.js';
import { SOURCE_LABELS } from '../lib/pipeline.js';
import { chartExplanations } from '../lib/plainEnglish.js';
import ChartBlock from './ChartBlock.jsx';
import DcfScenarios, { DcfUnavailableViews } from './DcfScenarios.jsx';
import Prov from './Prov.jsx';

function scoreColor(s) {
  if (s === null || s === undefined) return 'bg-surface-2 text-muted';
  if (s < 40) return 'bg-[#d03b3b22] text-[#e66767]';
  if (s < 60) return 'bg-[#c9850022] text-[#fab219]';
  return 'bg-[#0ca30c22] text-[#3ecf3e]';
}

/** One metric tile. A value whose provenance is "unavailable" shows the word Unavailable and the reason. */
function Metric({ label, value, prov }) {
  const unavailable = (prov && prov.status === 'unavailable') || value === null || value === undefined;
  return (
    <div className="min-w-0">
      <div className="flex items-center text-[11px] uppercase tracking-wide text-muted">
        <span className="truncate" title={label}>{label}</span>
        <Prov p={prov} />
      </div>
      {unavailable ? (
        <>
          <div className="text-sm font-semibold text-[#fab219]">Unavailable</div>
          <div className="text-[10px] leading-snug text-muted">{(prov && prov.reason) || 'This value could not be computed from the available data.'}</div>
        </>
      ) : (
        <div className="num text-sm text-ink truncate" title={typeof value === 'string' ? value : undefined}>{value}</div>
      )}
    </div>
  );
}

/** [label, formatted value, provenance key] for each tile. */
function metricsFor(r) {
  const m = r.metrics;
  switch (r.id) {
    case 'monteCarlo':
      return [
        ['P(above today)', fmtPct(m.pAbove), 'pAbove'],
        ['Median in 1y', `$${fmt(m.medianEnd)} (${fmtPct(m.medianReturn)})`, 'medianEnd'],
        ['5th–95th pct', `$${fmt(m.p5End, 0)} – $${fmt(m.p95End, 0)}`, 'range'],
        ['Annual vol σ', fmtPct(m.annualVol), 'annualVol'],
        ['Drift μ', fmtPct(m.annualDrift), 'annualDrift'],
        ['Paths', m.paths.toLocaleString(), 'paths'],
      ];
    case 'dcf':
      return [
        ['Base fair value / share', `$${fmt(m.intrinsicValue)}`, 'intrinsicValue'],
        ['Price', `$${fmt(m.price)}`, 'price'],
        ['Upside (Base)', fmtPct(m.upside), 'upside'],
        ['FCF growth g', fmtPct(m.growth), 'growth'],
        ['Discount rate r', fmtPct(m.discountRate), 'discountRate'],
        ['Terminal share of EV', fmtPct(m.terminalShare, 0), 'terminalShare'],
      ];
    case 'risk':
      return [
        ['Annual volatility', fmtPct(m.annualVol), 'annualVol'],
        ['Beta vs SPY', fmt(m.beta), 'beta'],
        ['Sharpe', m.sharpe === null ? null : fmt(m.sharpe), 'sharpe'],
        ['Max drawdown (5y)', fmtPct(m.maxDD), 'maxDD'],
        ['Ann. mean return', fmtPct(m.annualMean), 'annualMean'],
        ['Drawdown trough', m.troughDate, 'troughDate'],
      ];
    case 'momentum':
      return [
        ['12-1 momentum', fmtPct(m.momentum12_1), 'momentum12_1'],
        ['Price', `$${fmt(m.price)}`, 'price'],
        ['vs SMA 50', `${fmtPct(m.pctFromSma50)} (${fmt(m.sma50)})`, 'sma50'],
        ['vs SMA 200', `${fmtPct(m.pctFromSma200)} (${fmt(m.sma200)})`, 'sma200'],
        ['RSI (14)', fmt(m.rsi14, 1), 'rsi14'],
        ['Trend', m.aboveSma50 && m.aboveSma200 ? 'above both SMAs' : m.aboveSma50 || m.aboveSma200 ? 'mixed' : 'below both SMAs', 'trend'],
      ];
    case 'health': {
      const part = (x) => (x === null || x === undefined ? 'Unavailable' : fmtPct(x, 0));
      return [
        ['Revenue (latest FY)', fmtMoney(m.revenue), 'revenue'],
        ['Revenue growth YoY', m.revGrowth === null ? null : fmtPct(m.revGrowth), 'revGrowth'],
        ['Gross / Op / Net margin', `${part(m.grossMargin)} / ${part(m.opMargin)} / ${part(m.netMargin)}`, 'margins'],
        ['Debt / equity', m.debtToEquity === null ? null : fmt(m.debtToEquity), 'debtToEquity'],
        ['Current ratio', m.currentRatio === null ? null : fmt(m.currentRatio), 'currentRatio'],
        ['FCF (latest)', m.fcfLatest === null ? null : `${fmtMoney(m.fcfLatest)}${m.fcfCagr !== null ? ` · CAGR ${fmtPct(m.fcfCagr)}` : ''}`, 'fcfLatest'],
      ];
    }
    case 'earnings':
      return [
        ['Beat rate', m.beatRate !== undefined ? `${fmtPct(m.beatRate, 0)} (${m.beats}/${m.quarters})` : null, 'beatRate'],
        ['Avg EPS surprise', m.avgSurprise !== undefined ? fmtPct(m.avgSurprise) : null, 'avgSurprise'],
        ['Insider buys (6m)', m.sharesBought !== undefined ? `${fmtShares(m.sharesBought)} sh · ${fmtMoney(m.usdBought, 1)}` : null, 'sharesBought'],
        ['Insider sells (6m)', m.sharesSold !== undefined ? `${fmtShares(m.sharesSold)} sh · ${fmtMoney(m.usdSold, 1)}` : null, 'sharesSold'],
        ['Net insider shares', m.netShares !== undefined ? `${m.netShares >= 0 ? '+' : ''}${fmtShares(m.netShares)}` : null, 'netShares'],
        ['Net ratio ρ', m.netRatio !== undefined && m.netRatio !== null ? fmt(m.netRatio, 2) : null, 'netRatio'],
      ];
    default:
      return [];
  }
}

/** The charts each model shows: [key, title, element]. `key` matches chartExplanations() in plainEnglish.js. */
function chartList(r) {
  const c = r.chart;
  if (!c) return [];
  switch (r.id) {
    case 'monteCarlo':
      return [
        ['fan', '1-year price fan (5 / 25 / 50 / 75 / 95th percentiles)', <FanChart fan={c.fan} S0={c.S0} />],
        ['histogram', 'Distribution of ending prices (1st–99th pct)', <EndingHistogram histogram={c.histogram} S0={c.S0} />],
      ];
    case 'risk':
      return [
        ['drawdown', 'Drawdown from running peak (5 years)', <DrawdownChart drawdown={c.drawdown} />],
        ['rollingBeta', 'Rolling 60-day beta vs SPY', <RollingBetaChart rollingBeta={c.rollingBeta} />],
      ];
    case 'momentum':
      return [['priceSma', 'Price with 50- and 200-day SMAs (2 years)', <PriceSmaChart series={c.series} />]];
    case 'health':
      return [
        ['margins', 'Margins by fiscal year', <MarginsChart rows={c.rows} />],
        ['revenueFcf', 'Revenue and free cash flow', <RevenueFcfChart rows={c.rows} />],
      ];
    case 'earnings':
      return [
        ['surprise', 'Quarterly EPS surprise', <SurpriseChart surpriseBars={c.surpriseBars} />],
        ['insider', 'Monthly net insider shares (open-market)', <InsiderFlowChart monthly={c.monthly} />],
      ];
    default:
      return [];
  }
}

function Charts({ r, ticker }) {
  if (r.id === 'dcf') return <DcfScenarios result={r} ticker={ticker} />;
  const list = chartList(r);
  if (!list.length) return null;
  const explanations = chartExplanations(r, ticker);
  return (
    <div className={`grid gap-4 ${list.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {list.map(([key, title, el]) => (
        <ChartBlock key={key} title={title} explanation={explanations[key]}>{el}</ChartBlock>
      ))}
    </div>
  );
}

/**
 * One model card. `status` is 'loading' | 'done'; `result` is the model output (available or not).
 */
export default function ModelCard({ id, status, result, loadingSources, ticker }) {
  const [showInputs, setShowInputs] = useState(false);
  const title = MODEL_LABELS[id];

  return (
    <section className={`card p-4 md:p-5 flex flex-col gap-4 ${id === 'dcf' ? 'lg:col-span-2' : ''}`} id={`model-${id}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{title}</h3>
          {result?.available && <p className="text-xs text-muted mt-0.5">{result.scoringRule}</p>}
        </div>
        <div className={`pill num text-base px-3 py-1 ${scoreColor(result?.available ? result.subscore : null)}`}>
          {result?.available ? result.subscore : status === 'loading' ? '…' : '—'}
        </div>
      </header>

      {status === 'loading' && (
        <div className="flex items-center gap-3 text-sm text-ink-2">
          <span className="inline-block w-4 h-4 border-2 border-s1 border-t-transparent rounded-full animate-spin" />
          Loading {loadingSources.map((s) => SOURCE_LABELS[s]).join(' and ')}…
        </div>
      )}

      {status === 'done' && result && !result.available && (
        <>
          <div className="rounded-lg border border-[#d03b3b55] bg-[#d03b3b14] p-3 text-sm">
            <div className="font-semibold text-[#e66767]">Unavailable — excluded from the conviction score</div>
            <div className="text-ink-2 mt-1 break-words">{result.error}</div>
          </div>
          {id === 'dcf' && <DcfUnavailableViews reason={result.error} />}
        </>
      )}

      {status === 'done' && result?.available && (
        <>
          {result.warning && <div className="rounded-lg border border-[#fab21955] bg-[#fab21914] p-2 text-xs text-[#fab219]">{result.warning}</div>}
          <Charts r={result} ticker={ticker} />
          <div className={`grid grid-cols-2 gap-x-4 gap-y-3 pt-2 border-t border-line ${id === 'dcf' ? 'md:grid-cols-6' : 'md:grid-cols-3'}`}>
            {metricsFor(result).map(([label, value, key]) => <Metric key={label} label={label} value={value} prov={result.provenance ? result.provenance[key] : null} />)}
          </div>
          <div>
            <button className="text-xs text-s1 hover:underline" onClick={() => setShowInputs((v) => !v)}>
              {showInputs ? 'Hide' : 'Show'} inputs used ({result.inputs.length})
            </button>
            {showInputs && (
              <ul className="mt-2 text-xs space-y-1">
                {result.inputs.map((inp, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2">
                    <span className="text-muted">{inp.label}:</span>
                    <span className="num text-ink">{inp.value}</span>
                    <span className="text-muted">— {inp.source}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
