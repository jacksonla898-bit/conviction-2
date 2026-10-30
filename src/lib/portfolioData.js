// Shared data loading for the Grader and Optimizer: analyse every ticker (a few at a time) and load
// the SPY and AGG return series used for beta, the cumulative chart and the 60/40 benchmark.
import { api } from './api.js';
import { runAssetAnalysis } from './assetPipeline.js';

const CONCURRENCY = 3;

function simpleReturns(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) out.push({ date: bars[i].date, ret: bars[i].close / bars[i - 1].close - 1 });
  return out;
}

/** Analyse unique tickers with limited concurrency. onProgress(ticker, status) is called as each settles. */
export async function analyzeMany(tickers, settings, onProgress = () => {}) {
  const unique = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
  const results = {};
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const t = unique[next++];
      onProgress(t, 'loading');
      try {
        results[t] = await runAssetAnalysis(t, settings);
      } catch (err) {
        results[t] = { ticker: t, assetType: 'unsupported', results: {}, order: [], labels: {}, conviction: { score: null, label: 'n/a', breakdown: [], excluded: [] }, dailyReturns: [], sources: [], error: `Analysis failed: ${err.message}` };
      }
      onProgress(t, results[t].error ? 'failed' : 'done');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return results;
}

/** SPY and AGG daily simple returns (5 years). Either may be null with a reason. */
export async function benchmarkReturns(analyses = {}) {
  const fromAnalysis = Object.values(analyses).find((a) => a && a.raw && a.raw.prices && a.raw.prices.data && a.raw.prices.data.spy) || Object.values(analyses).find((a) => a && a.spyBars);
  let spy = null;
  let spyError = null;
  if (fromAnalysis) spy = simpleReturns(fromAnalysis.raw ? fromAnalysis.raw.prices.data.spy : fromAnalysis.spyBars);
  else {
    const r = await api.prices('SPY');
    if (r.ok) spy = simpleReturns(r.data.spy);
    else spyError = r.error;
  }
  let agg = null;
  let aggError = null;
  const a = analyses.AGG && analyses.AGG.bars ? { ok: true, data: { stock: analyses.AGG.bars } } : await api.prices('AGG');
  if (a.ok) agg = simpleReturns(a.data.stock);
  else aggError = a.error;
  return { spy, spyError, agg, aggError };
}

/** The per-unit price used to turn dollars into whole units: last close, or 100 (par) for a Treasury. */
export function unitPrice(analysis) {
  if (!analysis) return null;
  if (analysis.assetType === 'treasury') return 100;
  return analysis.price > 0 ? analysis.price : null;
}
