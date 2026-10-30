// Shared UI primitives: consistent Unavailable style, skeletons, empty/error states, tabs, drawer, tooltips.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { plainLabel } from '../lib/labels.js';

/** Grey "Unavailable" with the reason in a tooltip (the one style used everywhere). */
export function Unavailable({ reason, className = '' }) {
  return (
    <span className={`tip inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted ${className}`} data-tip={reason || 'This value could not be computed from the available data.'} tabIndex={0} aria-label={`Unavailable: ${reason || 'not computed'}`}>
      Unavailable
    </span>
  );
}

/** A labelled, full-width unavailable notice for a whole model/section. */
export function UnavailableBlock({ title = 'Unavailable', reason, children }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <div className="font-semibold text-muted">{title}</div>
      {reason && <div className="text-ink-2 mt-1 break-words">{reason}</div>}
      {children}
    </div>
  );
}

/** Metric label: plain English, technical name in a tooltip. */
export function MetricLabel({ label, children }) {
  const { text, tech } = plainLabel(label);
  return (
    <span className={`inline-flex items-center gap-1 ${tech ? 'tip' : ''}`} data-tip={tech ? `Technical name: ${tech}` : undefined}>
      <span className="truncate">{text}</span>
      {children}
    </span>
  );
}

export function Skeleton({ className = '', h = 16 }) {
  return <div className={`skeleton ${className}`} style={{ height: h }} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3, chart = false }) {
  return (
    <div className="card p-4 md:p-5 space-y-3" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between"><Skeleton className="w-1/3" h={18} /><Skeleton className="w-12" h={26} /></div>
      {chart && <Skeleton className="w-full" h={200} />}
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className={i % 2 ? 'w-3/4' : 'w-full'} h={12} />)}
    </div>
  );
}

export function EmptyState({ title, text, action }) {
  return (
    <section className="card p-8 text-center">
      <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-surface-2 flex items-center justify-center text-muted text-lg" aria-hidden="true">○</div>
      <h2 className="font-semibold text-ink">{title}</h2>
      {text && <p className="text-sm text-ink-2 mt-1 max-w-md mx-auto">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </section>
  );
}

export function ErrorState({ title = 'Something went wrong', text, onRetry }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
      <div className="font-semibold text-bad">{title}</div>
      {text && <div className="text-ink-2 mt-1 break-words">{text}</div>}
      {onRetry && <button className="btn btn-sm mt-2" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Notice({ children, tone = 'muted' }) {
  const cls = tone === 'warn' ? 'border-warn/40 bg-warn/10 text-ink-2' : 'border-line bg-surface-2 text-ink-2';
  return <div className={`rounded-lg border p-2.5 text-xs leading-relaxed ${cls}`}>{children}</div>;
}

/** Horizontal tab strip. items: [{id, label, count?}] */
export function Tabs({ items, value, onChange, ariaLabel = 'Sections', size = 'md' }) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} className={`tab ${size === 'sm' ? 'text-xs py-2' : ''}`} onClick={() => onChange(it.id)} id={`tab-${it.id}`}>
          {it.label}{it.badge !== undefined && it.badge !== null && <span className="ml-1.5 pill bg-surface-2 text-muted">{it.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** Section header used on every results page. */
export function SectionTitle({ title, sub, right }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div><h2 className="font-semibold text-ink">{title}</h2>{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>
      {right}
    </header>
  );
}

/* ---------------- Info drawer ---------------- */
const DrawerCtx = createContext({ open: () => {}, close: () => {} });
export const useDrawer = () => useContext(DrawerCtx);

/**
 * Side drawer that shows a metric's formula, inputs and result (fixed template content from the model).
 * content: { title, subtitle?, prov?, steps?: [{label, formula, calc, result}], inputs?: [{label, value, source}], scoringRule?, note?, reason? }
 */
export function DrawerProvider({ children }) {
  const [content, setContent] = useState(null);
  useEffect(() => {
    if (!content) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setContent(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [content]);
  return (
    <DrawerCtx.Provider value={{ open: setContent, close: () => setContent(null) }}>
      {children}
      {content && (
        <>
          <div className="drawer-backdrop" onClick={() => setContent(null)} />
          <aside className="drawer p-5 space-y-4" role="dialog" aria-modal="true" aria-label={content.title}>
            <header className="flex items-start justify-between gap-3">
              <div><h2 className="font-semibold text-ink">{content.title}</h2>{content.subtitle && <p className="text-xs text-muted mt-0.5">{content.subtitle}</p>}</div>
              <button className="btn btn-sm" onClick={() => setContent(null)} aria-label="Close">Close</button>
            </header>
            {content.reason && <UnavailableBlock reason={content.reason} />}
            {content.prov && content.prov.length > 0 && (
              <div className="text-xs space-y-0.5">{content.prov.map((l, i) => <div key={i} className={i === 0 ? 'text-ink' : 'text-ink-2'}>{l}</div>)}</div>
            )}
            {content.steps && content.steps.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Formula and calculation</div>
                <table className="steps-table"><thead><tr><th>Step</th><th>Formula</th><th>Calculation</th><th>Result</th></tr></thead>
                  <tbody>{content.steps.map((s, i) => <tr key={i}><td className="text-ink-2">{s.label}</td><td className="num text-ink-2 break-words">{s.formula}</td><td className="num text-ink-2 break-words">{s.calc}</td><td className="num text-ink font-semibold">{s.result}</td></tr>)}</tbody></table>
              </div>
            )}
            {content.inputs && content.inputs.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Inputs used</div>
                <ul className="text-xs space-y-1">{content.inputs.map((inp, i) => <li key={i} className="flex flex-wrap gap-x-2"><span className="text-muted">{inp.label}:</span><span className="num text-ink">{inp.value}</span><span className="text-muted">— {inp.source}</span></li>)}</ul>
              </div>
            )}
            {content.scoringRule && <div className="text-xs text-ink-2"><span className="text-muted">Scoring rule: </span>{content.scoringRule}</div>}
            {content.note && <div className="text-xs text-muted">{content.note}</div>}
          </aside>
        </>
      )}
    </DrawerCtx.Provider>
  );
}

/** Small "i" button that opens the drawer with the given content. */
export function InfoButton({ content, label = 'Show formula and inputs' }) {
  const { open } = useDrawer();
  if (!content) return null;
  return (
    <button type="button" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); open(content); }} className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-axis text-[9px] font-semibold leading-none text-muted hover:border-ink hover:text-ink normal-case tracking-normal">i</button>
  );
}

/** One metric tile with plain-English label, info drawer and consistent Unavailable state. */
export function MetricTile({ label, value, prov, drawer, reason }) {
  const unavailable = (prov && prov.status === 'unavailable') || value === null || value === undefined;
  return (
    <div className="min-w-0">
      <div className="flex items-center text-[11px] uppercase tracking-wide text-muted min-w-0">
        <MetricLabel label={label} />
        <InfoButton content={drawer} />
      </div>
      {unavailable ? <div className="mt-0.5"><Unavailable reason={reason || (prov && prov.reason)} /></div> : <div className="num text-sm text-ink truncate" title={typeof value === 'string' ? value : undefined}>{value}</div>}
    </div>
  );
}
