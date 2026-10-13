import React from 'react';
import { MODEL_LABELS } from '../models/conviction.js';
import Prov from './Prov.jsx';

const COLORS = { dcf: '#3987e5', monteCarlo: '#d95926', risk: '#199e70', momentum: '#c98500', health: '#d55181', earnings: '#9085e9' };

function labelColor(label) {
  switch (label) {
    case 'Low': return '#e66767';
    case 'Neutral': return '#fab219';
    case 'High': return '#3ecf3e';
    case 'Very High': return '#0ca30c';
    default: return '#898781';
  }
}

export default function ScoreCard({ ticker, companyName, price, priceDate, conviction, pending, asOf, onCopyLink, copied, priceProv, scoreProv }) {
  const { score, label, breakdown, excluded } = conviction;
  return (
    <section className="card p-5 md:p-6" id="score-card">
      {asOf && <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-[#9085e955] bg-[#9085e914] px-3 py-1 text-xs text-[#b3abf5]">Point-in-time analysis as of {asOf}: only data that existed on that date was used.</div>}
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <div className="flex items-baseline gap-4">
          <div className="num text-6xl md:text-7xl font-bold leading-none" style={{ color: labelColor(label) }}>{score === null ? '—' : score}</div>
          <div>
            <div className="text-lg font-semibold" style={{ color: labelColor(label) }}>{score === null ? 'No score yet' : `${label} conviction`}{score !== null && <Prov p={scoreProv} />}</div>
            <div className="text-xs text-muted">0–39 Low · 40–59 Neutral · 60–79 High · 80–100 Very High</div>
          </div>
        </div>
        <div className="md:ml-auto md:text-right">
          <div className="text-2xl font-bold tracking-tight">{ticker}</div>
          {companyName && <div className="text-sm text-ink-2 truncate max-w-[260px]">{companyName}</div>}
          {price && <div className="num text-sm text-muted">${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · close {priceDate}<Prov p={priceProv} /></div>}
          {onCopyLink && <button className="text-xs text-s1 hover:underline mt-1" onClick={onCopyLink}>{copied ? 'Link copied' : 'Copy link to this analysis'}</button>}
        </div>
      </div>

      {pending && <div className="mt-4 text-xs text-muted">Score updates as each model finishes…</div>}

      {breakdown.length > 0 && (
        <div className="mt-5">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">Contribution to score (re-normalized weight × subscore)</div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-2 gap-[2px]">
            {breakdown.map((b) => (
              <div key={b.id} style={{ width: `${(b.contribution / Math.max(score, 1)) * 100}%`, background: COLORS[b.id] }} title={`${MODEL_LABELS[b.id]}: ${b.contribution.toFixed(1)} pts`} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
            {breakdown.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[b.id] }} />
                <span className="text-ink-2">{MODEL_LABELS[b.id]}</span>
                <span className="num ml-auto text-ink">{b.subscore}</span>
                <span className="num text-muted">× {(b.normWeight * 100).toFixed(0)}% = {b.contribution.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {excluded.length > 0 && score !== null && (
        <div className="mt-4 text-xs">
          <span className="text-muted">Excluded (weights re-normalized): </span>
          {excluded.map((e, i) => (
            <span key={e.id} className="text-[#fab219]">{MODEL_LABELS[e.id]}{i < excluded.length - 1 ? ', ' : ''}</span>
          ))}
        </div>
      )}
    </section>
  );
}
