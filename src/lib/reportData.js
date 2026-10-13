// Builds the data for the one-page tear sheet. Pure: no DOM, no network, no AI module.
//
// Hard rule: a Wharton-mode report contains no AI-written text. In Wharton mode this function never
// reads the `reasoning` argument at all; the narrative is built only from each model's fixed template
// (formula, inputs, result). tests/purity.test.js verifies this.

import { MODEL_ORDER, MODEL_LABELS } from '../models/conviction.js';

export const MODE_NAMES = { standard: 'Standard', wharton: 'Wharton' };
export const DISCLAIMER = 'For educational and competition use. Not investment advice.';
export const WHARTON_FOOTER = 'All analysis text is template-generated from computed values. No AI-generated analysis.';
export const AI_SECTION_TITLE = 'AI-generated reasoning';

export function reportFilename(ticker, dateIso, mode) {
  return `Conviction_${ticker}_${dateIso}_${MODE_NAMES[mode]}.pdf`;
}

function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildReportData({ mode, ticker, companyName, runAt, asOf, price, priceAsOf, conviction, attribution, results, sources, reasoning, appVersion }) {
  if (mode !== 'standard' && mode !== 'wharton') throw new Error(`Unknown mode: ${mode}`);
  const when = runAt instanceof Date ? runAt : new Date(runAt || Date.now());

  const models = MODEL_ORDER.map((id) => {
    const r = results[id];
    const a = attribution ? attribution.rows.find((x) => x.id === id) : null;
    const ok = Boolean(r && r.available);
    return {
      id,
      label: MODEL_LABELS[id],
      status: ok ? 'ok' : 'unavailable',
      reason: ok ? null : (r && r.error) || 'not run',
      subscore: ok ? r.subscore : null,
      included: Boolean(a && a.included),
      weightUsed: a && a.included ? a.normWeight : null,
      contribution: a ? a.contribution : null,
      keyOutput: ok ? r.keyOutput || '' : 'Unavailable',
    };
  });

  const d = results.dcf;
  const dcf = d && d.available
    ? {
        available: true,
        price: d.metrics.price,
        scenarios: ['bear', 'base', 'bull'].map((k) => d.chart.scenarios[k]),
        deltasText: d.chart.deltasText,
        tornado: d.chart.tornado,
        warning: d.warning || null,
      }
    : { available: false, reason: (d && d.error) || 'not run' };

  const mom = results.momentum;
  const mc = results.monteCarlo;
  const charts = {
    price: mom && mom.available ? { series: mom.chart.series } : { unavailable: (mom && mom.error) || 'not run' },
    fan: mc && mc.available ? { fan: mc.chart.fan, S0: mc.chart.S0 } : { unavailable: (mc && mc.error) || 'not run' },
  };

  const common = {
    mode,
    modeName: MODE_NAMES[mode],
    ticker,
    companyName: companyName || null,
    runAtText: `${localDate(when)} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`,
    runDate: localDate(when),
    asOf: asOf || null,
    price: typeof price === 'number' ? price : null,
    priceAsOf: priceAsOf || null,
    score: conviction.score,
    label: conviction.label,
    attribution,
    models,
    dcf,
    charts,
    sources: sources || [],
    appVersion: appVersion || '',
    disclaimer: DISCLAIMER,
    filename: reportFilename(ticker, localDate(when), mode),
  };

  if (mode === 'wharton') {
    // Template methodology only. `reasoning` is intentionally not referenced in this branch.
    return {
      ...common,
      containsAiText: false,
      footerLine: WHARTON_FOOTER,
      narrative: {
        kind: 'methodology',
        title: 'Methodology: formula, inputs, result (template-generated)',
        conviction: {
          formula: 'score = Σ wᵢ·sᵢ / Σ wᵢ over available models',
          calc: `(${conviction.breakdown.map((b) => `${b.weight}×${b.subscore}`).join(' + ')}) / ${conviction.sumWeights}`,
          result: `${conviction.score} (${conviction.label})`,
        },
        models: MODEL_ORDER.map((id) => {
          const r = results[id];
          if (!r || !r.available) return { id, label: MODEL_LABELS[id], available: false, reason: (r && r.error) || 'not run' };
          return {
            id,
            label: MODEL_LABELS[id],
            available: true,
            subscore: r.subscore,
            inputs: (r.inputs || []).map((i) => `${i.label}: ${i.value} (${i.source})`),
            steps: (r.steps || []).map((s) => ({ label: s.label, formula: s.formula, result: s.result })),
            scoringRule: r.scoringRule,
          };
        }),
      },
    };
  }

  const done = reasoning && reasoning.status === 'done' && typeof reasoning.text === 'string' && reasoning.text.trim().length > 0;
  return {
    ...common,
    containsAiText: Boolean(done),
    footerLine: null,
    narrative: {
      kind: 'ai',
      title: AI_SECTION_TITLE,
      model: (reasoning && reasoning.model) || null,
      text: done ? reasoning.text : null,
      unavailableReason: done ? null : (reasoning && reasoning.error) || (reasoning && reasoning.status === 'loading' ? 'the explanation was still being generated when the report was created' : 'no explanation was generated for this run'),
      scoringRules: MODEL_ORDER.map((id) => ({ label: MODEL_LABELS[id], rule: results[id] && results[id].available ? results[id].scoringRule : `Unavailable: ${(results[id] && results[id].error) || 'not run'}` })),
    },
  };
}
