import React, { useEffect, useMemo, useRef, useState } from 'react';
import ScoreCard from './ScoreCard.jsx';
import Attribution from './Attribution.jsx';
import AssetModelCard from './AssetModelCard.jsx';
import DataSources from './DataSources.jsx';
import Methodology from './Methodology.jsx';
import { StandardReasoning } from './Reasoning.jsx';
import { computeAttribution } from '../models/attribution.js';
import { ASSET_TYPE_LABELS, assetHeadline } from '../models/assets.js';
import { roundDeep } from '../lib/pipeline.js';
import { fmt } from '../models/_math.js';

/** Template summary (no AI) for an ETF or Treasury result. */
export function assetSummary(a) {
  if (!a || a.conviction.score === null) return [];
  const type = ASSET_TYPE_LABELS[a.assetType];
  const comps = a.order.map((id) => a.results[id]).filter(Boolean);
  const ok = comps.filter((c) => c.available);
  const bad = comps.filter((c) => !c.available);
  const paras = [`${a.name || a.ticker} is scored as a ${type}. It scores ${a.conviction.score} out of 100 (${a.conviction.label}), the equal-weighted average of ${ok.length} component score${ok.length === 1 ? '' : 's'}${bad.length ? `, with ${bad.length} component${bad.length === 1 ? '' : 's'} unavailable and excluded` : ''}.`];
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

export default function AssetAnalysis({ analysis, loading, settings, onCopyLink, copied }) {
  const a = analysis;
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const autoFor = useRef(null);
  const attribution = useMemo(() => (a && a.conviction.score !== null ? computeAttribution(a.conviction, a.results, Object.fromEntries(a.order.map((id) => [id, 1])), a.order, a.labels) : null), [a]);
  const summary = useMemo(() => assetSummary(a), [a]);

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

  if (loading && !a) return <section className="card p-5 text-sm text-ink-2 flex items-center gap-3"><span className="inline-block w-4 h-4 border-2 border-s1 border-t-transparent rounded-full animate-spin" />Detecting asset type and loading data…</section>;
  if (!a) return null;
  if (a.assetType === 'unsupported') return <section className="card p-5"><div className="font-semibold text-[#e66767]">Unsupported: {a.ticker}</div><p className="text-sm text-ink-2 mt-1">{a.error}</p></section>;

  const priceText = a.priceKind === 'yield' ? `${fmt(a.price, 2)}% yield · ${a.priceDate}` : null;
  return (
    <div className="space-y-5">
      <ScoreCard ticker={a.ticker} companyName={`${a.name || ''}${a.name ? ' · ' : ''}${ASSET_TYPE_LABELS[a.assetType]}`} price={a.priceKind === 'yield' ? null : a.price} priceDate={a.priceDate} priceText={priceText} conviction={a.conviction} pending={loading} onCopyLink={onCopyLink} copied={copied} />
      {a.detection && <p className="text-xs text-muted">Classified as {ASSET_TYPE_LABELS[a.assetType]}: {a.detection.reason}.</p>}
      <section className="card p-5 md:p-6" id="conclusion">
        <h2 className="font-semibold mb-2">What this means</h2>
        <div className="space-y-2 text-sm text-ink-2 leading-relaxed">{summary.map((p, i) => <p key={i} className={i === 0 ? 'text-ink' : ''}>{p}</p>)}</div>
      </section>
      <Attribution attribution={attribution} />
      <div className="grid gap-5 lg:grid-cols-2">
        {a.order.map((id) => <AssetModelCard key={id} result={a.results[id]} status={loading ? 'loading' : 'done'} />)}
      </div>
      {settings.mode === 'standard'
        ? <StandardReasoning state={reasoning} onGenerate={generate} canGenerate={!loading && a.conviction.score !== null} fallback={summary} />
        : <Methodology sections={[
            { title: `${ASSET_TYPE_LABELS[a.assetType]} score`, subtitle: `${a.conviction.score} (${a.conviction.label})`, steps: [{ label: 'Equal-weight average', formula: 'score = Σ sᵢ / n over available components', calc: `(${a.conviction.breakdown.map((b) => b.subscore).join(' + ')}) / ${a.conviction.breakdown.length}`, result: `${a.conviction.score}` }, ...(a.conviction.excluded.length ? [{ label: 'Excluded', formula: 'unavailable components are dropped and weights re-normalized', calc: a.conviction.excluded.map((e) => `${a.labels[e.id]}: ${e.reason}`).join('; '), result: '—' }] : [])] },
            ...a.order.map((id) => { const r = a.results[id]; return r && r.available ? { title: r.name, subtitle: `subscore ${r.subscore}`, note: `${r.note} Inputs: ${(r.inputs || []).map((i) => `${i.label} = ${i.value} (${i.source})`).join('; ')}. Scoring rule: ${r.scoringRule}`, steps: r.steps } : { title: r ? r.name : id, subtitle: 'unavailable', unavailable: r ? r.error : 'not run' }; }),
          ]} />}
      <DataSources sources={a.sources} />
    </div>
  );
}
