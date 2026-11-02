// Thesis critic: the metric vocabulary shared by the browser and the server.
//
// The critic sends Claude ONLY numbers the app has already computed and shown on the Grade tab. Every
// number is flattened into a `metrics` map with a stable key (e.g. "NVDA.subscore.dcf", "portfolio.vol",
// "target.probability") and rounded exactly as the UI displays it. The server re-rounds with the same
// table before comparing, so a cited value either matches the screen exactly or is dropped.
//
// Pure module: no React, no fetch, no AI. Imported by src/components/ThesisCritic.jsx (browser) and
// api/_lib/thesisCritic.js (server).

import { SCENARIOS, MARKET_SHOCKS, RATE_SHOCKS } from '../models/stressTest.js';
import { MODEL_ORDER, MODEL_LABELS } from '../models/conviction.js';
import { PILLAR_LABELS } from '../models/portfolioGrade.js';
import { labelText } from './labels.js';

export const SUBSCORE_IDS = MODEL_ORDER;
export const MIN_THESIS_CHARS = 40;
export const MAX_THESIS_CHARS = 2000;

const SCENARIO_NAME = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.name]));
const SHOCK_LABEL = Object.fromEntries([...MARKET_SHOCKS, ...RATE_SHOCKS].map((s) => [s.id, s.label]));
const TICKER = '([A-Z0-9][A-Z0-9.\\-]{0,11})';

/**
 * Metric definitions. unit: 'pct' (value is already in percent units, shown with a % sign), 'score' (0–100),
 * 'num', 'days', 'count'. decimals = the rounding the UI uses. anchor = element id to scroll to when no
 * element carries data-metric="<key>".
 */
const DEFS = [
  { re: /^portfolio\.grade$/, label: () => 'Portfolio Conviction Score', unit: 'score', decimals: 0, anchor: () => 'grade-score' },
  { re: /^portfolio\.pillar\.(quality|diversification|risk)$/, label: (m) => `${PILLAR_LABELS[m[1]]} pillar`, unit: 'score', decimals: 0, anchor: () => 'grade-score' },
  { re: /^portfolio\.holdings$/, label: () => 'Number of holdings', unit: 'count', decimals: 0, anchor: () => 'grade-score' },
  { re: /^portfolio\.vol$/, label: () => 'Portfolio volatility (1 year, annualized)', unit: 'pct', decimals: 1, anchor: () => 'grade-score' },
  { re: /^portfolio\.beta$/, label: () => 'Portfolio beta vs SPY', unit: 'num', decimals: 2, anchor: () => 'grade-score' },
  { re: /^portfolio\.mdd$/, label: () => 'Portfolio max drawdown', unit: 'pct', decimals: 1, anchor: () => 'grade-score' },
  { re: /^portfolio\.var95$/, label: () => 'Portfolio 95% 1-day VaR', unit: 'pct', decimals: 2, anchor: () => 'grade-score' },
  { re: /^portfolio\.sharpe$/, label: () => 'Portfolio Sharpe ratio', unit: 'num', decimals: 2, anchor: () => 'grade-score' },
  { re: /^portfolio\.corr$/, label: () => 'Average pairwise correlation', unit: 'num', decimals: 2, anchor: () => 'grade-score' },
  { re: /^portfolio\.hhi$/, label: () => 'Concentration (HHI)', unit: 'num', decimals: 3, anchor: () => 'grade-score' },
  { re: /^portfolio\.cumReturn$/, label: () => 'Portfolio cumulative return (common window)', unit: 'pct', decimals: 1, anchor: () => 'grade-score' },
  { re: /^portfolio\.spyCumReturn$/, label: () => 'SPY cumulative return (same window)', unit: 'pct', decimals: 1, anchor: () => 'grade-score' },

  { re: /^target\.growth$/, label: () => 'Growth target', unit: 'pct', decimals: 1, anchor: () => 'part-target' },
  { re: /^target\.horizonValue$/, label: () => 'Horizon length', unit: 'count', decimals: 0, anchor: () => 'part-target' },
  { re: /^target\.horizonDays$/, label: () => 'Horizon in trading days', unit: 'days', decimals: 0, anchor: () => 'part-target' },
  { re: /^target\.probability$/, label: () => 'Probability of reaching the target', unit: 'pct', decimals: 1, anchor: () => 'part-target' },
  { re: /^target\.score$/, label: () => 'Target feasibility subscore', unit: 'score', decimals: 0, anchor: () => 'part-target' },
  { re: /^target\.median$/, label: () => 'Median simulated outcome', unit: 'pct', decimals: 1, anchor: () => 'part-target' },
  { re: /^target\.p5$/, label: () => '5th percentile outcome', unit: 'pct', decimals: 1, anchor: () => 'part-target' },
  { re: /^target\.p95$/, label: () => '95th percentile outcome', unit: 'pct', decimals: 1, anchor: () => 'part-target' },
  { re: /^target\.pLoss$/, label: () => 'Probability of a loss', unit: 'pct', decimals: 1, anchor: () => 'part-target' },
  { re: /^target\.requiredAnnual$/, label: () => 'Pace needed per year', unit: 'pct', decimals: 1, anchor: () => 'part-target' },
  { re: /^target\.histAnnual$/, label: () => 'Recent pace per year', unit: 'pct', decimals: 1, anchor: () => 'part-target' },

  { re: /^thesis\.score$/, label: () => 'Thesis blend score', unit: 'score', decimals: 0, anchor: () => 'portfolio-score' },
  { re: /^thesis\.conviction$/, label: () => 'Weighted stock conviction', unit: 'score', decimals: 0, anchor: () => 'part-conviction' },
  { re: /^thesis\.risk$/, label: () => 'Portfolio risk subscore', unit: 'score', decimals: 0, anchor: () => 'part-risk' },
  { re: /^thesis\.vol$/, label: () => 'Portfolio volatility (thesis analysis)', unit: 'pct', decimals: 1, anchor: () => 'part-risk' },
  { re: /^thesis\.beta$/, label: () => 'Beta vs SPY (thesis analysis)', unit: 'num', decimals: 2, anchor: () => 'part-risk' },
  { re: /^thesis\.maxDD$/, label: () => 'Max drawdown (thesis analysis)', unit: 'pct', decimals: 1, anchor: () => 'part-risk' },
  { re: /^thesis\.divRatio$/, label: () => 'Diversification ratio', unit: 'num', decimals: 2, anchor: () => 'part-risk' },

  { re: /^stress\.scenario\.([a-z0-9_]+)\.return$/, label: (m) => `${SCENARIO_NAME[m[1]] || m[1]} return`, unit: 'pct', decimals: 1, anchor: () => 'stress-summary' },
  { re: /^stress\.scenario\.([a-z0-9_]+)\.mdd$/, label: (m) => `${SCENARIO_NAME[m[1]] || m[1]} max drawdown`, unit: 'pct', decimals: 1, anchor: () => 'stress-summary' },
  { re: /^stress\.shock\.([a-z0-9_]+)\.return$/, label: (m) => `${SHOCK_LABEL[m[1]] || m[1]} estimated return`, unit: 'pct', decimals: 1, anchor: () => 'stress-summary' },

  { re: new RegExp(`^${TICKER}\\.weight$`), label: (m) => `${m[1]} weight`, unit: 'pct', decimals: 1, anchor: (m) => `holding-${m[1]}` },
  { re: new RegExp(`^${TICKER}\\.score$`), label: (m) => `${m[1]} conviction score`, unit: 'score', decimals: 0, anchor: (m) => `holding-${m[1]}` },
  { re: new RegExp(`^${TICKER}\\.subscore\\.(${MODEL_ORDER.join('|')})$`), label: (m) => `${m[1]} ${MODEL_LABELS[m[2]]} subscore`, unit: 'score', decimals: 0, anchor: (m) => `holding-${m[1]}` },
];

/** Describe a metric key: { label, unit, decimals, anchor } or null when the key is not part of the vocabulary. */
export function describeMetric(key) {
  if (typeof key !== 'string' || key.length > 60) return null;
  for (const d of DEFS) {
    const m = d.re.exec(key);
    if (m) return { label: d.label(m), unit: d.unit, decimals: d.decimals, anchor: d.anchor(m) };
  }
  return null;
}

/** Round the way roundDeep() does (toFixed, then back to a number). */
export function roundTo(v, decimals) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Number(v.toFixed(decimals));
}

/** Human-readable value for a chip: "42.3%", "71", "1.24", "63 trading days". */
export function formatMetric(key, value) {
  const d = describeMetric(key);
  if (!d || typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const v = value.toFixed(d.decimals);
  if (d.unit === 'pct') return `${v}%`;
  if (d.unit === 'days') return `${v} trading days`;
  return v;
}

const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? x * 100 : null);

function put(metrics, key, value) {
  const d = describeMetric(key);
  if (!d || typeof value !== 'number' || !Number.isFinite(value)) return;
  metrics[key] = roundTo(value, d.decimals);
}

/**
 * Build the critique payload from values already computed on the Grade tab. Nothing here fetches or
 * computes anything new; it only copies and rounds.
 *
 * @param def            { thesis, horizon: {value, unit}, targetGrowth }  (the Thesis & target form)
 * @param grade          GraderPage result.grade (gradePortfolio output) — required
 * @param holdings       GraderPage result.holdings [{ticker, assetType, weight, score, error}]
 * @param analyses       GraderPage result.analyses keyed by ticker ({assetType, conviction, results})
 * @param thesisAnalysis PortfolioPage analysis ({score, parts, holdings}) when "Analyze" has been run, else null
 * @param stress         StressTestPage result ({scenarios, shocks}) for the same holdings, else null
 */
export function buildThesisCritiquePayload({ def, grade, holdings = [], analyses = {}, thesisAnalysis = null, stress = null }) {
  const metrics = {};
  const facts = {};
  const thesis = String(def?.thesis || '').trim().slice(0, MAX_THESIS_CHARS);
  const horizonValue = Math.max(1, Number(def?.horizon?.value) || 1);
  const horizonUnit = ['weeks', 'months', 'years'].includes(def?.horizon?.unit) ? def.horizon.unit : 'months';
  const horizonLabel = `${horizonValue} ${horizonValue === 1 ? horizonUnit.replace(/s$/, '') : horizonUnit}`;
  const targetGrowthPct = Number(def?.targetGrowth);

  // Portfolio grade
  if (grade) {
    put(metrics, 'portfolio.grade', grade.score);
    if (grade.label && grade.score !== null) facts['portfolio.label'] = labelText(grade.label);
    for (const p of grade.pillars || []) if (p.score !== null) put(metrics, `portfolio.pillar.${p.id}`, p.score);
    put(metrics, 'portfolio.holdings', (grade.holdings || holdings).length);
    const m = grade.riskMetrics || {};
    put(metrics, 'portfolio.vol', pct(m.vol));
    put(metrics, 'portfolio.beta', m.beta);
    put(metrics, 'portfolio.mdd', pct(m.mdd));
    put(metrics, 'portfolio.var95', pct(m.var95));
    put(metrics, 'portfolio.sharpe', m.sharpe);
    put(metrics, 'portfolio.corr', grade.avgCorr);
    put(metrics, 'portfolio.hhi', grade.hhi);
    put(metrics, 'portfolio.cumReturn', pct(m.cumReturn));
    put(metrics, 'portfolio.spyCumReturn', pct(m.spyCumReturn));
    if (m.window) facts['portfolio.window'] = `${m.window.from} to ${m.window.to}`;
    if (grade.riskMetrics && grade.riskMetrics.vol === undefined) facts['portfolio.riskPillar'] = 'unavailable (no return history)';
  }

  // Holdings: weight, conviction score, label, six subscores (stocks only)
  const holdingRows = [];
  for (const h of holdings) {
    const t = h.ticker;
    const a = analyses[t] || null;
    holdingRows.push({ ticker: t, assetType: h.assetType || a?.assetType || 'unknown' });
    put(metrics, `${t}.weight`, pct(h.weight));
    if (typeof h.score === 'number') {
      put(metrics, `${t}.score`, h.score);
      facts[`${t}.label`] = labelText(a?.conviction?.label || null);
    } else facts[`${t}.score`] = `unavailable (${h.error || 'no score'})`;
    if ((h.assetType || a?.assetType) === 'stock' && a && a.results) {
      for (const id of MODEL_ORDER) {
        const r = a.results[id];
        if (r && r.available && typeof r.subscore === 'number') put(metrics, `${t}.subscore.${id}`, r.subscore);
        else facts[`${t}.subscore.${id}`] = `unavailable${r && r.error ? ` (${String(r.error).slice(0, 80)})` : ''}`;
      }
    } else if (h.assetType && h.assetType !== 'stock') facts[`${t}.subscores`] = 'not applicable: ETFs and Treasuries use component models, not the six stock subscores';
  }

  // Thesis & target analysis (bootstrap Monte Carlo), if it has been run for these holdings
  put(metrics, 'target.growth', targetGrowthPct);
  put(metrics, 'target.horizonValue', horizonValue);
  facts['target.horizon'] = horizonLabel;
  const ta = thesisAnalysis && !thesisAnalysis.error ? thesisAnalysis : null;
  if (ta) {
    put(metrics, 'thesis.score', ta.score?.score);
    if (ta.score && ta.score.score !== null) facts['thesis.label'] = labelText(ta.score.label);
    const c = ta.parts?.conviction;
    if (c && c.available) put(metrics, 'thesis.conviction', c.subscore);
    const tg = ta.parts?.target;
    if (tg && tg.available) {
      put(metrics, 'target.score', tg.subscore);
      put(metrics, 'target.probability', pct(tg.metrics.pTarget));
      put(metrics, 'target.horizonDays', tg.metrics.horizonDays);
      put(metrics, 'target.median', pct(tg.metrics.median));
      put(metrics, 'target.p5', pct(tg.metrics.p5));
      put(metrics, 'target.p95', pct(tg.metrics.p95));
      put(metrics, 'target.pLoss', pct(tg.metrics.pLoss));
      put(metrics, 'target.requiredAnnual', pct(tg.metrics.requiredAnnual));
      put(metrics, 'target.histAnnual', pct(tg.metrics.histAnnual));
    } else facts['target.status'] = `target feasibility unavailable${tg && tg.error ? ` (${tg.error})` : ''}`;
    const r = ta.parts?.risk;
    if (r && r.available) {
      put(metrics, 'thesis.risk', r.subscore);
      put(metrics, 'thesis.vol', pct(r.metrics.vol));
      put(metrics, 'thesis.beta', r.metrics.beta);
      put(metrics, 'thesis.maxDD', pct(r.metrics.maxDD));
      put(metrics, 'thesis.divRatio', r.metrics.divRatio);
    }
  } else facts['target.status'] = 'Thesis & target analysis not run: no target-feasibility probability is available';

  // Stress test, if it has been run for these holdings
  if (stress && Array.isArray(stress.scenarios)) {
    facts['stress.status'] = 'run';
    for (const s of stress.scenarios) {
      const id = s.scenario?.id;
      if (!id) continue;
      if (s.status === 'ok') {
        put(metrics, `stress.scenario.${id}.return`, pct(s.totalReturn));
        put(metrics, `stress.scenario.${id}.mdd`, pct(s.maxDrawdown));
      } else facts[`stress.scenario.${id}`] = `unavailable (${String(s.reason || 'insufficient history').slice(0, 80)})`;
    }
    for (const sh of [...(stress.shocks?.market || []), ...(stress.shocks?.rates || [])]) {
      if (sh.status === 'ok') put(metrics, `stress.shock.${sh.id}.return`, pct(sh.estReturn));
      else facts[`stress.shock.${sh.id}`] = `unavailable (${String(sh.reason || '').slice(0, 80)})`;
    }
    facts['stress.shockNote'] = 'hypothetical shocks are model estimates, not historical data';
  } else facts['stress.status'] = 'not run';

  return {
    kind: 'thesis-critique',
    thesis,
    horizon: { value: horizonValue, unit: horizonUnit, label: horizonLabel },
    targetGrowthPct: Number.isFinite(targetGrowthPct) ? targetGrowthPct : null,
    holdings: holdingRows,
    metrics,
    facts,
  };
}
