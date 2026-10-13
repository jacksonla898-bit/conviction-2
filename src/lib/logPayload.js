// Builds the row sent to the analysis log (Supabase table public.analyses).
// Pure function: no network, no AI text. The server adds price_at_run from Alpaca itself.

import { MODEL_ORDER } from '../models/conviction.js';
import { DCF_SCENARIO_CONFIG } from '../models/dcfScenarios.js';

const r4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toFixed(4)) : null);

export function buildLogPayload({ ticker, companyName, mode, conviction, results, settings, appVersion }) {
  const modelSubscores = {};
  for (const id of MODEL_ORDER) {
    const r = results[id];
    const b = conviction.breakdown.find((x) => x.id === id);
    modelSubscores[id] = {
      subscore: r && r.available ? r.subscore : null,
      weight: b ? r4(b.normWeight) : 0, // weight actually used (re-normalized)
      nominal_weight: Number(settings.weights?.[id]) || 0,
      status: r && r.available ? 'ok' : 'unavailable',
      reason: r && r.available ? null : (r && r.error) || 'not run',
    };
  }

  const d = results.dcf;
  let dcf;
  if (d && d.available) {
    const sc = d.chart.scenarios;
    const pick = (s) => (s.available ? { status: 'ok', fair_value: r4(s.value), upside: r4(s.upside), fcf_growth: r4(s.g), discount_rate: r4(s.r), terminal_growth: r4(s.gT), growth_capped: Boolean(s.growthCapped) } : { status: 'unavailable', reason: s.reason });
    dcf = {
      status: 'ok',
      price_used: r4(d.metrics.price),
      base: pick(sc.base),
      bull: pick(sc.bull),
      bear: pick(sc.bear),
      inputs: {
        fcf0: d.metrics.fcf0,
        fcf_fiscal_year: d.metrics.fcfYear,
        shares: d.metrics.shares,
        total_debt: d.metrics.debt,
        cash: d.metrics.cash,
        risk_free_rate: r4(d.metrics.riskFreeRate),
        beta: r4(d.metrics.beta),
        equity_risk_premium: r4(d.metrics.erp),
        historical_fcf_cagr: r4(d.metrics.gHist),
        growth_source: d.metrics.growthSource,
        growth_override_set: Boolean(d.metrics.growthOverrideSet),
        growth_cap: [r4(d.metrics.growthCapMin), r4(d.metrics.growthCapMax)],
      },
      scenario_deltas: DCF_SCENARIO_CONFIG.scenarios,
    };
  } else {
    dcf = { status: 'unavailable', reason: (d && d.error) || 'not run' };
  }

  return {
    ticker,
    companyName: companyName || null,
    mode,
    score: conviction.score,
    modelSubscores,
    dcf,
    inputs: {
      weights: settings.weights,
      dcf: settings.dcf, // includes the FCF growth override (blank = not set)
      risk_free_rate_pct: settings.riskFreeRate === '' || settings.riskFreeRate === null || settings.riskFreeRate === undefined ? null : Number(settings.riskFreeRate),
      risk_free_source: settings.riskFreeSource || null,
      risk_free_auto: settings.riskFreeAuto !== false,
    },
    appVersion: appVersion || null,
  };
}
