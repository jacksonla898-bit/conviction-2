import React, { useMemo, useState } from 'react';
import { SECTIONS, GROUPS, searchSections } from '../lib/methodologyContent.js';
import { REPO_URL } from '../config.js';
import { MathModeBadge } from '../components/Reasoning.jsx';
import { EmptyState } from '../components/ui.jsx';

function Diagram() {
  const sources = ['Alpaca prices', 'SEC EDGAR filings', 'Finnhub earnings', 'Finnhub insiders'];
  const models = ['DCF', 'Monte Carlo', 'Risk', 'Momentum', 'Health', 'Earn & insiders'];
  const W = 720;
  return (
    <svg viewBox={`0 0 ${W} 250`} className="w-full h-auto" role="img" aria-label="Data sources feed six models, whose subscores are averaged into one conviction score">
      {sources.map((s, i) => (
        <g key={s}>
          <rect x={10} y={20 + i * 55} width={150} height={38} rx={8} fill="var(--surface-2)" stroke="var(--axis)" />
          <text x={85} y={44 + i * 55} textAnchor="middle" fill="var(--ink-2)" fontSize="12">{s}</text>
        </g>
      ))}
      {models.map((m, i) => (
        <g key={m}>
          <rect x={290} y={10 + i * 38} width={140} height={30} rx={8} fill="color-mix(in srgb, var(--accent) 12%, var(--surface))" stroke="var(--accent)" />
          <text x={360} y={30 + i * 38} textAnchor="middle" fill="var(--ink)" fontSize="12">{m}</text>
          <line x1={430} y1={25 + i * 38} x2={540} y2={125} stroke="var(--axis)" strokeWidth="1.5" />
        </g>
      ))}
      {[[0, 1], [0, 2], [0, 3], [0, 0], [1, 0], [1, 4], [2, 5], [3, 5]].map(([s, m], k) => (
        <line key={k} x1={160} y1={39 + s * 55} x2={290} y2={25 + m * 38} stroke="var(--axis)" strokeWidth="1.5" />
      ))}
      <text x={225} y={242} textAnchor="middle" fill="var(--muted)" fontSize="11">each model → 0–100 subscore + published rule</text>
      <rect x={540} y={95} width={170} height={60} rx={10} fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
      <text x={625} y={120} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="700">Conviction score</text>
      <text x={625} y={140} textAnchor="middle" fill="var(--ink-2)" fontSize="11">weighted average, 0–100</text>
      <text x={625} y={180} textAnchor="middle" fill="var(--muted)" fontSize="11">Weak · Neutral · Strong · Very Strong</text>
      <text x={625} y={200} textAnchor="middle" fill="var(--muted)" fontSize="11">missing models are excluded and</text>
      <text x={625} y={214} textAnchor="middle" fill="var(--muted)" fontSize="11">weights are rescaled</text>
    </svg>
  );
}

/** Methodology: all formulas, weights, scenario dates and data sources in one searchable place. */
export default function MethodologyPage({ mode, onTry }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const sections = useMemo(() => searchSections(q).filter((s) => group === 'all' || s.group === group), [q, group]);
  return (
    <div className="space-y-5">
      <section className="card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Methodology</h1>
            <p className="text-sm text-ink-2 mt-1 max-w-2xl leading-relaxed">Two ideas drive the design. First, nothing is a black box: every formula, every input and every intermediate number is shown. Second, the model should be testable: the Backtest scores stocks with only the information that existed on a past date and shows what happened next, including when the score was wrong.</p>
          </div>
          {mode === 'wharton' && <MathModeBadge />}
        </div>
        <div className="mt-4"><Diagram /></div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted">Try it:</span>{['AAPL', 'SPY', 'TLT', 'US10Y'].map((t) => <button key={t} className="btn btn-sm" onClick={() => onTry(t)}>{t}</button>)}<a className="text-accent hover:underline ml-1" href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a></div>
      </section>

      <section className="card p-4 md:p-5 space-y-3">
        <label className="block"><span className="sr-only">Search the methodology</span><input className="input" placeholder="Search formulas, weights, scenario dates, data sources…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="flex flex-wrap gap-1.5">
          {['all', ...GROUPS].map((g) => <button key={g} className={`btn btn-sm ${group === g ? 'bg-ink text-page border-ink' : ''}`} onClick={() => setGroup(g)}>{g === 'all' ? `All (${SECTIONS.length})` : g}</button>)}
        </div>
      </section>

      {sections.length === 0 && <EmptyState title="No match" text={`Nothing in the methodology mentions "${q}".`} action={<button className="btn" onClick={() => setQ('')}>Clear search</button>} />}
      {sections.map((s) => (
        <section key={s.id} className="card p-5 md:p-6" id={`method-${s.id}`}>
          <div className="text-[11px] uppercase tracking-wide text-muted">{s.group}</div>
          <h2 className="font-semibold text-lg mt-0.5">{s.title}</h2>
          {s.text.map((t, i) => <p key={i} className="text-sm text-ink-2 mt-2 leading-relaxed">{t}</p>)}
          {s.formulas.length > 0 && (
            <div className="overflow-x-auto mt-3">
              <table className="steps-table">
                <thead><tr><th>Item</th><th>Formula / value</th><th>Note</th></tr></thead>
                <tbody>{s.formulas.map((f, i) => <tr key={i}><td className="text-ink whitespace-nowrap">{f.label}</td><td className="num text-ink-2">{f.formula}</td><td className="text-muted">{f.note || ''}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
