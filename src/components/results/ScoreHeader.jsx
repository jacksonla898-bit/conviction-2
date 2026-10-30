import React from 'react';
import { labelText, labelColor, SCORE_BANDS } from '../../lib/labels.js';
import { InfoButton, Skeleton } from '../ui.jsx';

/**
 * The score card at the top of every results page: large 0–100 score, label, colour, name/type, as-of date.
 * `actions` holds the page's buttons (Export PDF is always first). `children` renders below (contribution bar etc.).
 */
export default function ScoreHeader({ score, label, title, subtitle, meta, asOfNote, pending, actions, scoreInfo, children, id = 'score-card' }) {
  const color = labelColor(label);
  const text = score === null || score === undefined ? (pending ? 'Computing…' : 'No score') : labelText(label);
  return (
    <section className="card p-5 md:p-6" id={id}>
      {asOfNote && <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-ink-2">{asOfNote}</div>}
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <div className="flex items-baseline gap-4 min-w-0">
          {pending && score === null ? <Skeleton className="w-24" h={64} /> : <div className="num text-6xl md:text-7xl font-extrabold leading-none tracking-tight" style={{ color: score === null ? 'var(--muted)' : color }}>{score === null ? '—' : score}</div>}
          <div className="min-w-0">
            <div className="text-lg font-semibold flex items-center" style={{ color: score === null ? 'var(--muted)' : color }}>{text}{scoreInfo && <InfoButton content={scoreInfo} />}</div>
            <div className="text-xs text-muted">{SCORE_BANDS}</div>
          </div>
        </div>
        <div className="md:ml-auto md:text-right min-w-0">
          <div className="text-2xl font-bold tracking-tight truncate">{title}</div>
          {subtitle && <div className="text-sm text-ink-2 truncate">{subtitle}</div>}
          {meta && <div className="num text-sm text-muted">{meta}</div>}
        </div>
      </div>
      {actions && <div className="mt-4 flex flex-wrap items-center gap-2" id="results-actions">{actions}</div>}
      {children}
    </section>
  );
}
