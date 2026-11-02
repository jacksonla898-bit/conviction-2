// Thesis critic (Standard mode only): "Stress-test my thesis" on the Grade tab → Thesis & target.
// Sends the thesis plus ONLY numbers already computed on this page (src/lib/thesisMetrics.js) through the
// AI gate and shows a structured counter-case. It never changes a score and nothing is written to the log.
// In Wharton mode the parent does not render these components at all (and the gate would refuse anyway).
import React, { useState } from 'react';
import { critiqueIfStandard } from '../lib/aiGate.js';
import { buildThesisCritiquePayload, describeMetric, formatMetric, MIN_THESIS_CHARS } from '../lib/thesisMetrics.js';
import { ErrorState, Notice } from './ui.jsx';

export const CRITIC_FOOTER = 'AI critique using only the numbers computed above. It never changes the score. Not investment advice.';

const IDLE = { status: 'idle', critique: null, error: null, model: null, cached: false, rateLimited: false, forThesis: null };

/**
 * State and actions for the critic. `critic` = { grade, holdings, analyses, stress } from the Grade result
 * (null when there is no grade); `def` and `analysis` come from the Thesis & target form.
 */
export function useThesisCritic({ mode, def, analysis, critic }) {
  const [state, setState] = useState(IDLE);
  const thesis = (def?.thesis || '').trim();
  const hasGrade = Boolean(critic && critic.grade && critic.grade.score !== null);
  const reason = mode !== 'standard' ? 'Standard mode only.' : !hasGrade ? 'Grade the portfolio first.' : thesis.length < MIN_THESIS_CHARS ? `Write at least ${MIN_THESIS_CHARS} characters of thesis (${thesis.length} so far).` : null;

  const run = async () => {
    if (reason || mode !== 'standard') return;
    setState({ ...IDLE, status: 'loading', forThesis: thesis });
    const payload = buildThesisCritiquePayload({ def, grade: critic.grade, holdings: critic.holdings, analyses: critic.analyses, thesisAnalysis: analysis, stress: critic.stress });
    const res = await critiqueIfStandard(mode, payload);
    if (res.skipped) return setState(IDLE);
    if (!res.ok) return setState({ ...IDLE, status: 'error', error: res.error, rateLimited: Boolean(res.rateLimited), forThesis: thesis });
    setState({ status: 'done', critique: res.data.critique, error: null, model: res.data.model, cached: Boolean(res.data.cached), rateLimited: false, forThesis: thesis });
  };

  return { state, run, reason, canRun: !reason && state.status !== 'loading', enabled: mode === 'standard' && Boolean(critic), stale: state.status === 'done' && state.forThesis !== thesis, thesisLength: thesis.length };
}

/** Scroll to the element showing this metric (data-metric="<key>"), else to the section it belongs to. */
export function revealMetric(key) {
  if (typeof document === 'undefined') return;
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key.replace(/["\\]/g, '\\$&');
  const el = document.querySelector(`[data-metric="${esc}"]`) || document.getElementById(describeMetric(key)?.anchor || '');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('metric-flash');
  setTimeout(() => el.classList.remove('metric-flash'), 1600);
}

/** The button under the thesis box. */
export function ThesisCriticButton({ critic }) {
  const { state, run, reason, canRun } = critic;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <button type="button" className="btn" disabled={!canRun} onClick={run} title={reason || 'Ask Claude to argue the other side using only the numbers on this page'}>
        {state.status === 'loading' ? 'Stress-testing…' : state.status === 'done' ? 'Stress-test again' : 'Stress-test my thesis'}
      </button>
      <span className="text-xs text-muted">{reason || 'AI counter-case from the computed numbers only. Never changes the score.'}</span>
    </div>
  );
}

const VERDICT = {
  supported: { text: 'Supported', cls: 'bg-good/15 text-good' },
  contradicted: { text: 'Contradicted', cls: 'bg-bad/15 text-bad' },
  not_testable: { text: 'Not testable', cls: 'bg-surface-2 text-muted' },
};

function Chip({ item }) {
  const d = describeMetric(item.metric_key);
  return (
    <button type="button" className="pill bg-surface-2 text-ink-2 border border-line hover:border-ink hover:text-ink" onClick={() => revealMetric(item.metric_key)} title={`Scroll to ${item.metric_key}`}>
      <span className="truncate max-w-[220px]">{d ? d.label : item.metric_key}</span>
      <span className="num ml-1.5 text-ink">{formatMetric(item.metric_key, item.value)}</span>
    </button>
  );
}

function Evidence({ items }) {
  if (!items || !items.length) return <div className="text-xs text-muted mt-1">No number in the app bears on this.</div>;
  return <div className="flex flex-wrap gap-1.5 mt-1.5">{items.map((e, i) => <Chip key={`${e.metric_key}-${i}`} item={e} />)}</div>;
}

function Section({ title, sub, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

/** The result card: claims checked, bear case, what would change my mind, blind spots. */
export function ThesisCriticCard({ critic }) {
  const { state, run, stale } = critic;
  if (state.status === 'idle') return null;
  const c = state.critique;
  return (
    <section className="card p-4 md:p-5 space-y-5" id="thesis-critic" aria-busy={state.status === 'loading'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Thesis critic</h2>
          <p className="text-xs text-muted">Argues the other side using only the numbers computed on this page. Generated by {state.model || 'Claude'}{state.cached ? ' (cached result for identical inputs)' : ''}.</p>
        </div>
        {state.status === 'done' && <button className="btn btn-sm" onClick={run} disabled={!critic.canRun}>Run again</button>}
      </header>

      {state.status === 'loading' && (
        <div className="flex items-center gap-3 text-sm text-ink-2">
          <span className="inline-block w-4 h-4 border-2 border-s1 border-t-transparent rounded-full animate-spin" /> Asking Claude to argue the other side…
        </div>
      )}

      {state.status === 'error' && state.rateLimited && <Notice tone="warn"><span className="font-semibold">Daily limit reached.</span> {state.error}</Notice>}
      {state.status === 'error' && !state.rateLimited && <ErrorState title="No critique" text={state.error} onRetry={critic.canRun ? run : undefined} />}

      {state.status === 'done' && c && (
        <>
          {stale && <Notice tone="warn">The thesis has changed since this critique was generated. Run it again for the current text.</Notice>}
          <Section title="Claims checked" sub="Each claim in the thesis, judged only against the computed numbers.">
            {c.thesis_claims.length === 0 && <div className="text-sm text-muted">No separate claims were identified.</div>}
            {c.thesis_claims.map((cl, i) => {
              const v = VERDICT[cl.verdict] || VERDICT.not_testable;
              return (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-start gap-2"><span className={`pill ${v.cls}`}>{v.text}</span><span className="text-sm text-ink">{cl.claim}</span></div>
                  <p className="text-sm text-ink-2 mt-1.5 leading-relaxed">{cl.explanation}</p>
                  <Evidence items={cl.evidence} />
                </div>
              );
            })}
          </Section>
          <Section title="Bear case" sub="The strongest honest arguments against the thesis.">
            {c.bear_case.length === 0 && <div className="text-sm text-muted">No bear case could be built from these numbers.</div>}
            {c.bear_case.map((b, i) => (
              <div key={i} className="rounded-lg bg-surface-2 p-3">
                <p className="text-sm text-ink leading-relaxed">{b.point}</p>
                <Evidence items={b.evidence} />
              </div>
            ))}
          </Section>
          <Section title="What would change my mind" sub="Which measured numbers, moving which way, would weaken the bear case.">
            {c.would_change_my_mind.length === 0 ? <div className="text-sm text-muted">Nothing listed.</div> : <ul className="text-sm text-ink-2 space-y-1 list-disc pl-5">{c.would_change_my_mind.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          </Section>
          <Section title="Blind spots" sub="Things the thesis depends on that this app does not measure.">
            {c.blind_spots.length === 0 ? <div className="text-sm text-muted">Nothing listed.</div> : <ul className="text-sm text-ink-2 space-y-1 list-disc pl-5">{c.blind_spots.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          </Section>
        </>
      )}

      <footer className="text-[11px] text-muted border-t border-line pt-3">{CRITIC_FOOTER}</footer>
    </section>
  );
}
