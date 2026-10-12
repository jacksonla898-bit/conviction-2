// Orchestrates: fetch the four data sources in parallel, then run the six models.
// Raw data is kept separately from model results so that changing a setting (risk-free rate,
// DCF assumptions, weights) re-runs the math without re-fetching anything.

import { api } from './api.js';
import { runMonteCarlo, ID as MC } from '../models/monteCarlo.js';
import { runRisk, ID as RISK } from '../models/risk.js';
import { runMomentum, ID as MOM } from '../models/momentum.js';
import { runHealth, ID as HEALTH } from '../models/health.js';
import { runDCF, ID as DCF } from '../models/dcf.js';
import { runEarnings, ID as EARN } from '../models/earnings.js';
import { unavailable } from '../models/_math.js';

export const SOURCES = ['prices', 'fundamentals', 'earnings', 'insiders'];
export const SOURCE_LABELS = { prices: 'Alpaca prices', fundamentals: 'SEC EDGAR', earnings: 'Finnhub earnings', insiders: 'Finnhub insiders' };

/** Which data sources each model waits on (drives the per-model loading state). */
export const MODEL_SOURCES = {
  [MC]: ['prices'],
  [RISK]: ['prices'],
  [MOM]: ['prices'],
  [HEALTH]: ['fundamentals'],
  [DCF]: ['prices', 'fundamentals'],
  [EARN]: ['earnings', 'insiders'],
};

export function emptyRaw() {
  const raw = {};
  for (const s of SOURCES) raw[s] = { status: 'idle', data: null, error: null, unavailable: false };
  return raw;
}

/**
 * Fetch all sources. Calls onUpdate(rawSnapshot) after each source settles so the UI can
 * show per-model loading states. Resolves with the final raw object.
 */
export async function fetchAll(ticker, onUpdate, asOf = null) {
  const raw = emptyRaw();
  for (const s of SOURCES) raw[s] = { status: 'loading', data: null, error: null, unavailable: false };
  raw.asOf = asOf;
  onUpdate({ ...raw });

  await Promise.all(
    SOURCES.map(async (s) => {
      const res = await api[s](ticker, asOf);
      raw[s] = res.ok
        ? { status: 'ok', data: res.data, error: null, unavailable: false }
        : { status: 'error', data: null, error: res.error, unavailable: res.unavailable };
      onUpdate({ ...raw });
    })
  );
  return raw;
}

function sourceError(raw, s) {
  const r = raw[s];
  if (!r || r.status === 'idle' || r.status === 'loading') return null;
  if (r.status === 'error') return r.error || 'unavailable';
  return null;
}

/**
 * Run every model whose sources have settled. Returns {results, allDone}.
 * `cache.monteCarlo` lets the caller reuse the Monte Carlo result (it only depends on the price bars).
 */
export async function runModels(raw, settings, cache = {}) {
  const results = {};
  const bars = raw.prices.data?.stock || null;
  const spyBars = raw.prices.data?.spy || null;
  const fundamentals = raw.fundamentals.data || null;
  const price = bars && bars.length ? bars[bars.length - 1].close : null;

  const pricesErr = sourceError(raw, 'prices');
  const fundErr = sourceError(raw, 'fundamentals');

  if (raw.prices.status === 'ok') {
    results[MOM] = safe(() => runMomentum({ bars }), MOM, 'Momentum');
    results[RISK] = safe(() => runRisk({ bars, spyBars }, settings), RISK, 'Risk');
    if (cache.monteCarlo && cache.monteCarloBars === bars) {
      results[MC] = cache.monteCarlo;
    } else {
      try {
        results[MC] = await runMonteCarlo({ bars });
      } catch (err) {
        results[MC] = unavailable(MC, 'Monte Carlo', `Model error: ${err.message}`);
      }
    }
  } else if (pricesErr) {
    for (const [id, name] of [[MOM, 'Momentum'], [RISK, 'Risk'], [MC, 'Monte Carlo']]) results[id] = unavailable(id, name, `Price data failed: ${pricesErr}`);
  }

  if (raw.fundamentals.status === 'ok') {
    results[HEALTH] = safe(() => runHealth({ fundamentals }), HEALTH, 'Financial health');
  } else if (fundErr) {
    results[HEALTH] = unavailable(HEALTH, 'Financial health', `EDGAR failed: ${fundErr}`);
  }

  const dcfReady = raw.prices.status !== 'loading' && raw.fundamentals.status !== 'loading' && raw.prices.status !== 'idle';
  if (dcfReady) {
    if (pricesErr) results[DCF] = unavailable(DCF, 'DCF valuation', `Price data failed: ${pricesErr}`);
    else if (fundErr) results[DCF] = unavailable(DCF, 'DCF valuation', `EDGAR failed: ${fundErr}`);
    else {
      const beta = results[RISK]?.available ? results[RISK].metrics.beta : null;
      results[DCF] = safe(() => runDCF({ fundamentals, beta, price }, settings), DCF, 'DCF valuation');
    }
  }

  const earnReady = ['earnings', 'insiders'].every((s) => raw[s].status === 'ok' || raw[s].status === 'error');
  if (earnReady) {
    const e = raw.earnings.status === 'ok' ? raw.earnings.data : { unavailable: true, error: raw.earnings.error };
    const i = raw.insiders.status === 'ok' ? raw.insiders.data : { unavailable: true, error: raw.insiders.error };
    results[EARN] = safe(() => runEarnings({ earnings: e, insiders: i }), EARN, 'Earnings & insiders');
  }

  const allDone = SOURCES.every((s) => raw[s].status === 'ok' || raw[s].status === 'error');
  return { results, allDone };
}

function safe(fn, id, name) {
  try {
    return fn();
  } catch (err) {
    console.error(`[${id}]`, err);
    return unavailable(id, name, `Model error: ${err.message}`);
  }
}

/**
 * For an as-of analysis: what happened after the as-of date. Uses the `forward` bars the prices
 * function returns. Returns null when there is no as-of date or no later data.
 */
export function sinceThen(raw) {
  const d = raw?.prices?.data;
  if (!d || !d.asOf || !d.forward || d.forward.length === 0) return null;
  const asOfBar = d.stock[d.stock.length - 1];
  const latest = d.forward[d.forward.length - 1];
  const spyThen = d.spy[d.spy.length - 1];
  const spyNow = d.spyForward && d.spyForward.length ? d.spyForward[d.spyForward.length - 1] : null;
  const stockReturn = latest.close / asOfBar.close - 1;
  const spyReturn = spyNow && spyThen ? spyNow.close / spyThen.close - 1 : null;
  // Path since then, for a small chart (stock vs SPY indexed to 100)
  const spyMap = new Map((d.spyForward || []).map((b) => [b.date, b.close]));
  const path = [{ date: asOfBar.date, stock: 100, spy: 100 }];
  for (const b of d.forward) {
    const sp = spyMap.get(b.date);
    path.push({ date: b.date, stock: (b.close / asOfBar.close) * 100, spy: sp && spyThen ? (sp / spyThen.close) * 100 : null });
  }
  return {
    asOfDate: asOfBar.date,
    asOfClose: asOfBar.close,
    latestDate: latest.date,
    latestClose: latest.close,
    tradingDays: d.forward.length,
    stockReturn,
    spyReturn,
    excess: spyReturn === null ? null : stockReturn - spyReturn,
    path,
  };
}

/**
 * Run the complete single-stock analysis for one ticker (used by the portfolio, compare and backtest
 * views). `onRaw` receives data snapshots as sources settle.
 */
export async function runStockAnalysis(ticker, settings, { asOf = null, onRaw = () => {} } = {}) {
  const { computeConviction } = await import('../models/conviction.js');
  const raw = await fetchAll(ticker, onRaw, asOf);
  const { results } = await runModels(raw, settings, {});
  const conviction = computeConviction(results, settings.weights);
  const bars = raw.prices.data?.stock || null;
  return {
    ticker,
    asOf,
    raw,
    results,
    conviction,
    bars,
    price: bars && bars.length ? bars[bars.length - 1].close : null,
    priceDate: bars && bars.length ? bars[bars.length - 1].date : null,
    companyName: raw.fundamentals.data?.companyName || null,
    forward: sinceThen(raw),
    error: conviction.score === null ? raw.prices.error || 'No model could run.' : null,
  };
}

/** Round every number in an object (used to build the compact payload sent to the reasoning API). */
export function roundDeep(v, digits = 4) {
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
  if (Array.isArray(v)) return v.map((x) => roundDeep(x, digits));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x, digits)]));
  return v;
}

/** Build the Standard-mode payload: computed metrics and subscores only, never raw bars or filings. */
export function buildReasoningPayload(ticker, results, conviction, settings) {
  const models = {};
  for (const [id, r] of Object.entries(results)) {
    models[id] = r.available
      ? { name: r.name, available: true, subscore: r.subscore, scoringRule: r.scoringRule, metrics: roundDeep(r.metrics), warning: r.warning || null }
      : { name: r.name, available: false, reason: r.error };
  }
  return {
    ticker,
    asOf: settings.asOf || new Date().toISOString().slice(0, 10),
    pointInTime: Boolean(settings.asOf),
    conviction: {
      score: conviction.score,
      label: conviction.label,
      breakdown: conviction.breakdown.map((b) => ({ model: b.id, weight: b.weight, normalizedWeight: Number(b.normWeight.toFixed(4)), subscore: b.subscore, pointsContributed: Number(b.contribution.toFixed(2)) })),
      excluded: conviction.excluded,
    },
    settings: { riskFreeRatePct: settings.riskFreeRate === '' ? null : Number(settings.riskFreeRate), weights: settings.weights, dcfAssumptions: settings.dcf },
    models,
  };
}
