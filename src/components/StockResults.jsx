import React, { useMemo, useState } from 'react';
import ScoreHeader from './results/ScoreHeader.jsx';
import DriversCard, { driversFromAttribution } from './results/DriversCard.jsx';
import { ReasoningSection, ExportPdfButton } from './results/common.jsx';
import ModelCard from './ModelCard.jsx';
import Attribution from './Attribution.jsx';
import DataSources from './DataSources.jsx';
import SinceThen from './SinceThen.jsx';
import { WhartonReasoning } from './Reasoning.jsx';
import { Tabs, SkeletonCard, InfoButton } from './ui.jsx';
import { MODEL_ORDER, MODEL_LABELS } from '../models/conviction.js';
import { MODEL_SOURCES } from '../lib/pipeline.js';
import { provLines } from '../lib/provenance.js';

const MODEL_COLORS = { dcf: 'var(--chart-1)', monteCarlo: 'var(--chart-5)', risk: 'var(--chart-2)', momentum: 'var(--chart-6)', health: 'var(--chart-4)', earnings: 'var(--chart-3)' };
const DETAIL_TABS = [
  { id: 'overview', label: 'Score breakdown' },
  { id: 'dcf', label: 'Valuation' },
  { id: 'monteCarlo', label: 'Simulation' },
  { id: 'risk', label: 'Risk' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'health', label: 'Financial health' },
  { id: 'earnings', label: 'Earnings & insiders' },
  { id: 'sources', label: 'Data sources' },
];

/** Single-stock results in the standard page order: score, drivers, reasoning, details tabs. */
export default function StockResults({ ticker, companyName, price, priceDate, conviction, attribution, results, raw, complete, fetching, asOf, forward, sources, settings, reasoning, onGenerate, onExportPdf, reportWaiting, logState, onCopyLink, copied, priceProv, scoreProv, fallbackParas }) {
  const [tab, setTab] = useState('overview');
  const drivers = useMemo(() => driversFromAttribution(attribution, results), [attribution, results]);
  const { score, label, breakdown, excluded } = conviction;
  const scoreInfo = score !== null ? {
    title: 'Conviction score', subtitle: 'Weighted average of the available model subscores',
    prov: scoreProv ? provLines(scoreProv) : null,
    steps: [{ label: 'Weighted average', formula: 'score = Σ wᵢ·sᵢ / Σ wᵢ', calc: `(${breakdown.map((b) => `${b.weight}×${b.subscore}`).join(' + ')}) / ${conviction.sumWeights}`, result: `${score}` }, ...(excluded.length ? [{ label: 'Excluded', formula: 're-normalized over available models', calc: excluded.map((e) => `${MODEL_LABELS[e.id]}: ${e.reason}`).join('; '), result: '—' }] : [])],
  } : null;
  const priceMeta = price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · close ${priceDate}` : null;
  const priceInfo = priceProv ? { title: 'Price', prov: provLines(priceProv) } : null;

  return (
    <div className="space-y-5" id="stock-results">
      <ScoreHeader
        score={score} label={label} pending={!complete} title={ticker} subtitle={companyName ? `${companyName} · Stock` : 'Stock'}
        meta={priceMeta && <span className="inline-flex items-center">{priceMeta}<InfoButton content={priceInfo} label="Price source" /></span>}
        asOfNote={asOf ? `Point-in-time analysis as of ${asOf}: only data that existed on that date was used.` : null}
        scoreInfo={scoreInfo}
        actions={
          <>
            <ExportPdfButton onExport={onExportPdf} disabled={!complete || score === null || reportWaiting} title="Two-page tear sheet of this analysis" />
            {reportWaiting && <span className="text-xs text-muted">Waiting for reasoning…</span>}
            <button className="btn" onClick={onCopyLink}>{copied ? 'Link copied' : 'Copy link'}</button>
            <span className="text-xs text-muted">{settings.mode === 'wharton' ? 'PDF contains template text only (no AI).' : 'PDF includes the AI-generated reasoning, labelled.'}</span>
            <span className="ml-auto text-xs" aria-live="polite">
              {logState.status === 'saving' && <span className="text-muted">Saving to log…</span>}
              {logState.status === 'saved' && <span className="text-muted" title={logState.reason || 'One row was written to the analysis log.'}>Saved to log{logState.reason ? ' (price unavailable)' : ''}</span>}
              {logState.status === 'failed' && <span className="pill border border-warn/40 bg-warn/10 text-ink-2" title={logState.reason}>Run not saved to log</span>}
            </span>
          </>
        }
      >
        {breakdown.length > 0 && (
          <div className="mt-5">
            <div className="text-xs uppercase tracking-wide text-muted mb-2">Contribution to score (re-normalized weight × subscore)</div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2 gap-[2px]">
              {breakdown.map((b) => <div key={b.id} style={{ width: `${(b.contribution / Math.max(score, 1)) * 100}%`, background: MODEL_COLORS[b.id] }} title={`${MODEL_LABELS[b.id]}: ${b.contribution.toFixed(1)} pts`} />)}
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              {breakdown.map((b) => (
                <div key={b.id} className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: MODEL_COLORS[b.id] }} /><span className="text-ink-2">{MODEL_LABELS[b.id]}</span><span className="num ml-auto text-ink">{b.subscore}</span><span className="num text-muted">× {(b.normWeight * 100).toFixed(0)}% = {b.contribution.toFixed(1)}</span></div>
              ))}
            </div>
            {excluded.length > 0 && score !== null && <div className="mt-3 text-xs text-muted">Excluded (weights re-normalized): {excluded.map((e) => MODEL_LABELS[e.id]).join(', ')}</div>}
          </div>
        )}
      </ScoreHeader>

      <DriversCard drivers={drivers} pending={!complete} />

      <ReasoningSection
        mode={settings.mode}
        summary={fallbackParas || []}
        ai={{ state: reasoning, onGenerate, canGenerate: Boolean(complete && score !== null) }}
        wharton={<WhartonReasoning results={results} conviction={conviction} />}
        pending={!complete}
      />

      <section className="space-y-4" id="details">
        <Tabs items={DETAIL_TABS} value={tab} onChange={setTab} ariaLabel="Details" />
        {tab === 'overview' && (
          <div className="space-y-5">
            {attribution && attribution.rows && attribution.rows.length ? <Attribution attribution={attribution} /> : <SkeletonCard chart />}
            {asOf && !fetching && <SinceThen ticker={ticker} forward={forward} score={score} label={label} />}
          </div>
        )}
        {MODEL_ORDER.includes(tab) && (() => {
          const id = tab;
          const srcs = MODEL_SOURCES[id];
          const loadingSources = srcs.filter((s) => raw[s].status === 'loading' || raw[s].status === 'idle');
          const status = results[id] ? 'done' : 'loading';
          return <ModelCard id={id} status={status} result={results[id]} loadingSources={loadingSources.length ? loadingSources : srcs} ticker={ticker} />;
        })()}
        {tab === 'sources' && (complete ? <DataSources sources={sources} /> : <SkeletonCard lines={5} />)}
      </section>
    </div>
  );
}
