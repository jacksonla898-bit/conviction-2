import React, { useEffect, useMemo, useRef, useState } from 'react';
import ScoreHeader from './results/ScoreHeader.jsx';
import DriversCard, { driversFromAttribution } from './results/DriversCard.jsx';
import { ReasoningSection, ExportPdfButton, pdfName } from './results/common.jsx';
import Attribution from './Attribution.jsx';
import AssetModelCard from './AssetModelCard.jsx';
import DataSources from './DataSources.jsx';
import Methodology from './Methodology.jsx';
import { Tabs, SkeletonCard, EmptyState } from './ui.jsx';
import { computeAttribution } from '../models/attribution.js';
import { ASSET_TYPE_LABELS } from '../models/assets.js';
import { roundDeep } from '../lib/pipeline.js';
import { fmt } from '../models/_math.js';

/** Template summary (no AI) for an ETF or Treasury result. */
export function assetSummary(a) {
  if (!a || a.conviction.score === null) return [];
  const type = ASSET_TYPE_LABELS[a.assetType];
  const comps = a.order.map((id) => a.results[id]).filter(Boolean);
  const ok = comps.filter((c) => c.available);
  const bad = comps.filter((c) => !c.available);
  const paras = [`${a.name || a.ticker} is scored as a ${type}. It scores ${a.conviction.score} out of 100, the equal-weighted average of ${ok.length} component score${ok.length === 1 ? '' : 's'}${bad.length ? `, with ${bad.length} component${bad.length === 1 ? '' : 's'} unavailable and excluded` : ''}.`];
  const best = [...ok].sort((x, y) => y.subscore - x.subscore);
  if (best.length) paras.push(`Strongest: ${best.slice(0, 2).map((c) => `${c.name.toLowerCase()} (${c.subscore}: ${c.keyOutput})`).join('; ')}.${best.length > 2 ? ` Weakest: ${best[best.length - 1].name.toLowerCase()} (${best[best.length - 1].subscore}: ${best[best.length - 1].keyOutput}).` : ''}`);
  if (bad.length) paras.push(`Unavailable: ${bad.map((c) => `${c.name.toLowerCase()} (${c.error})`).join('; ')}.`);
  if (a.returnsNote) paras.push(a.returnsNote);
  paras.push('This is a summary of the numbers, not a recommendation. Nothing here is investment advice.');
  return paras;
}

export function assetPayload(a, settings) {
  return {
    kind: 'asset',
    ticker: a.ticker,
    assetType: a.assetType,
    name: a.name,
    score: a.conviction.score,
    label: a.conviction.label,
    components: Object.fromEntries(a.order.map((id) => { const r = a.results[id]; return [id, r && r.available ? { name: r.name, subscore: r.subscore, scoringRule: r.scoringRule, metrics: roundDeep(r.metrics), warning: r.warning || null } : { name: r ? r.name : id, available: false, reason: r ? r.error : 'not run' }]; })),
    settings: { riskFreeRatePct: settings.riskFreeRate === '' ? null : Number(settings.riskFreeRate) },
  };
}

// Details tabs group the components by category.
const GROUPS = {
  equity_etf: [['cost', 'Cost & liquidity', ['expense', 'liquidity']], ['momentum', 'Momentum', ['momentum']], ['risk', 'Risk', ['volatility', 'drawdown', 'sharpe']]],
  bond_etf: [['income', 'Yield & spread', ['yield', 'spread']], ['rates', 'Rate sensitivity & credit', ['duration', 'credit']], ['risk', 'Risk', ['volatility', 'drawdown']]],
  treasury: [['yield', 'Yield & curve', ['yield', 'curve']], ['rates', 'Rate sensitivity', ['duration']]],
};

export default function AssetAnalysis({ analysis, loading, settings, onCopyLink, copied }) {
  const a = analysis;
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const [tab, setTab] = useState('overview');
  const autoFor = useRef(null);
  const ref = useRef(null);
  const attribution = useMemo(() => (a && a.conviction.score !== null ? computeAttribution(a.conviction, a.results, Object.fromEntries(a.order.map((id) => [id, 1])), a.order, a.labels) : null), [a]);
  const summary = useMemo(() => assetSummary(a), [a]);
  const drivers = useMemo(() => driversFromAttribution(attribution, a ? a.results : null), [attribution, a]);

  const generate = async () => {
    if (settings.mode !== 'standard' || !a || a.conviction.score === null) return;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const { requestReasoning } = await import('../lib/ai.js');
    const res = await requestReasoning('standard', a.ticker, assetPayload(a, settings));
    if (!res.ok) setReasoning({ status: 'error', text: null, error: res.error, model: null });
    else if (!res.data.text) setReasoning({ status: 'error', text: null, error: res.data.error || 'Empty response.', model: res.data.model });
    else setReasoning({ status: 'done', text: res.data.text, error: null, model: res.data.model });
  };
  useEffect(() => {
    if (settings.mode !== 'standard') { setReasoning({ status: 'idle', text: null, error: null, model: null }); autoFor.current = null; return; }
    if (!a || loading || a.conviction.score === null || autoFor.current === a) return;
    autoFor.current = a;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, loading, settings.mode]);

  if (loading && !a) return <div className="space-y-5" aria-busy="true"><SkeletonCard lines={2} /><SkeletonCard lines={4} /><SkeletonCard chart /></div>;
  if (!a) return null;
  if (a.assetType === 'unsupported') return <EmptyState title={`Unsupported: ${a.ticker}`} text={a.error} />;

  const groups = GROUPS[a.assetType] || [];
  const tabs = [{ id: 'overview', label: 'Score breakdown' }, ...groups.map(([id, label]) => ({ id, label })), { id: 'sources', label: 'Data sources' }];
  const meta = a.priceKind === 'yield' ? `${fmt(a.price, 2)}% yield · ${a.priceDate}` : a.price ? `$${a.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · close ${a.priceDate}` : null;
  const scoreInfo = { title: `${ASSET_TYPE_LABELS[a.assetType]} score`, subtitle: 'Equal-weighted average of the available components', steps: [{ label: 'Equal-weight average', formula: 'score = Σ sᵢ / n over available components', calc: `(${a.conviction.breakdown.map((b) => b.subscore).join(' + ')}) / ${a.conviction.breakdown.length}`, result: `${a.conviction.score}` }, ...(a.conviction.excluded.length ? [{ label: 'Excluded', formula: 'unavailable components are dropped and weights re-normalized', calc: a.conviction.excluded.map((e) => `${a.labels[e.id]}: ${e.reason}`).join('; '), result: '—' }] : [])] };

  return (
    <div className="space-y-5" ref={ref} id="asset-results">
      <ScoreHeader score={a.conviction.score} label={a.conviction.label} pending={loading} title={a.ticker} subtitle={`${a.name ? `${a.name} · ` : ''}${ASSET_TYPE_LABELS[a.assetType]}`} meta={meta} scoreInfo={a.conviction.score !== null ? scoreInfo : null}
        actions={<><ExportPdfButton targetRef={ref} filename={pdfName(`Conviction_${a.ticker}`, settings.mode)} disabled={loading || a.conviction.score === null} /><button className="btn" onClick={onCopyLink}>{copied ? 'Link copied' : 'Copy link'}</button>{a.detection && <span className="text-xs text-muted">Classified as {ASSET_TYPE_LABELS[a.assetType]}: {a.detection.reason}.</span>}</>}
      />
      <DriversCard drivers={drivers} pending={loading} />
      <ReasoningSection mode={settings.mode} summary={summary} ai={{ state: reasoning, onGenerate: generate, canGenerate: !loading && a.conviction.score !== null }} pending={loading}
        wharton={<Methodology sections={[
          { title: `${ASSET_TYPE_LABELS[a.assetType]} score`, subtitle: `${a.conviction.score}`, steps: scoreInfo.steps },
          ...a.order.map((id) => { const r = a.results[id]; return r && r.available ? { title: r.name, subtitle: `subscore ${r.subscore}`, note: `${r.note} Inputs: ${(r.inputs || []).map((i) => `${i.label} = ${i.value} (${i.source})`).join('; ')}. Scoring rule: ${r.scoringRule}`, steps: r.steps } : { title: r ? r.name : id, subtitle: 'unavailable', unavailable: r ? r.error : 'not run' }; }),
        ]} />}
      />
      <section className="space-y-4" id="details">
        <Tabs items={tabs} value={tab} onChange={setTab} ariaLabel="Details" />
        {tab === 'overview' && (attribution ? <Attribution attribution={attribution} /> : <SkeletonCard chart />)}
        {groups.filter(([id]) => id === tab).map(([id, , ids]) => (
          <div key={id} className="grid gap-5 lg:grid-cols-2">{ids.filter((cid) => a.order.includes(cid)).map((cid) => <AssetModelCard key={cid} result={a.results[cid]} status={loading ? 'loading' : 'done'} />)}</div>
        ))}
        {tab === 'sources' && <DataSources sources={a.sources} />}
      </section>
    </div>
  );
}
