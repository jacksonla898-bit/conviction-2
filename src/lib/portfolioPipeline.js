// Runs the single-stock pipeline for every holding (a few at a time), then the portfolio models.
import { runStockAnalysis, roundDeep } from './pipeline.js';
import { normalizeWeights, weightedConviction, targetFeasibility, portfolioRisk, portfolioScore, DEFAULT_BLEND, horizonLabel } from '../models/portfolio.js';

const CONCURRENCY = 3;

/**
 * @param {{holdings:[{ticker,amount}], horizon:{value,unit}, targetGrowth, thesis, name}} def
 * @param settings app settings (riskFreeRate, weights, dcf, portfolioBlend)
 * @param onUpdate called with {holdings, stage} as progress happens
 */
export async function analyzePortfolio(def, settings, onUpdate) {
  const holdings = normalizeWeights(def.holdings.filter((h) => h.ticker && h.ticker.trim()))
    .map((h) => ({ ...h, ticker: h.ticker.trim().toUpperCase(), status: 'queued', raw: null, results: null, conviction: null, price: null, bars: null, companyName: null }));
  const emit = (stage) => onUpdate({ holdings: holdings.map((h) => ({ ...h })), stage });
  emit('fetching');

  let next = 0;
  let spyBars = null;
  const worker = async () => {
    while (next < holdings.length) {
      const h = holdings[next++];
      h.status = 'loading';
      emit('fetching');
      try {
        const a = await runStockAnalysis(h.ticker, settings);
        Object.assign(h, { raw: a.raw, results: a.results, conviction: a.conviction, bars: a.bars, price: a.price, companyName: a.companyName });
        if (!spyBars && a.raw.prices.data?.spy) spyBars = a.raw.prices.data.spy;
        h.status = a.error ? 'failed' : 'done';
        h.error = a.error;
      } catch (err) {
        h.status = 'failed';
        h.error = err.message;
      }
      emit('fetching');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, holdings.length) }, worker));

  emit('modeling');
  const parts = {};
  parts.conviction = weightedConviction(holdings);
  parts.risk = spyBars ? portfolioRisk(holdings, spyBars) : { id: 'risk', name: 'Portfolio risk', available: false, error: 'No price history for any holding.' };
  parts.target = spyBars ? await targetFeasibility(holdings, spyBars, def) : { id: 'target', name: 'Target feasibility', available: false, error: 'No price history for any holding.' };
  const score = portfolioScore(parts, settings.portfolioBlend || DEFAULT_BLEND);
  const out = { holdings: holdings.map((h) => ({ ...h })), parts, score, stage: 'done' };
  onUpdate(out);
  return out;
}

/** Standard-mode payload for a portfolio: computed numbers plus the user's own thesis text. */
export function buildPortfolioPayload(def, analysis, settings) {
  return {
    kind: 'portfolio',
    name: def.name || 'Untitled portfolio',
    thesis: def.thesis || '',
    parameters: { horizon: horizonLabel(def.horizon), targetGrowthPct: Number(def.targetGrowth) },
    portfolioScore: analysis.score,
    portfolioModels: Object.fromEntries(
      Object.entries(analysis.parts).map(([k, r]) => [k, r.available ? { subscore: r.subscore, scoringRule: r.scoringRule, metrics: roundDeep({ ...r.metrics, stockVols: undefined, tickers: undefined }), warning: r.warning || null } : { available: false, reason: r.error }])
    ),
    holdings: analysis.holdings.map((h) => ({
      ticker: h.ticker,
      weight: Number(h.weight.toFixed(4)),
      price: h.price,
      conviction: h.conviction ? { score: h.conviction.score, label: h.conviction.label } : null,
      subscores: h.results ? Object.fromEntries(Object.entries(h.results).map(([id, r]) => [id, r.available ? r.subscore : null])) : null,
      keyMetrics: h.results
        ? roundDeep({
            dcfUpside: h.results.dcf?.metrics?.upside ?? null,
            pAboveIn1y: h.results.monteCarlo?.metrics?.pAbove ?? null,
            annualVol: h.results.risk?.metrics?.annualVol ?? null,
            beta: h.results.risk?.metrics?.beta ?? null,
            momentum12_1: h.results.momentum?.metrics?.momentum12_1 ?? null,
            revGrowth: h.results.health?.metrics?.revGrowth ?? null,
            netMargin: h.results.health?.metrics?.netMargin ?? null,
            beatRate: h.results.earnings?.metrics?.beatRate ?? null,
          })
        : null,
      error: h.error || null,
    })),
    settings: { riskFreeRatePct: settings.riskFreeRate === '' ? null : Number(settings.riskFreeRate), blend: settings.portfolioBlend || DEFAULT_BLEND },
  };
}
