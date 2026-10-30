// One entry point for analysing any supported asset: stock (existing six models, unchanged),
// equity ETF, bond ETF or Treasury. Every result has the same shape so the score card, attribution,
// methodology tables and the portfolio grader can treat them alike.
//
//   {
//     ticker, assetType, name, order, labels, results, conviction, price, priceDate,
//     dailyReturns: [{date, ret}]   simple daily returns used by the grader and optimizer
//     sources: [...]                 data-source rows (type, source, asOf, status, reason)
//     error                          set when nothing could be scored
//   }

import { api } from './api.js';
import { runStockAnalysis, dataSources } from './pipeline.js';
import { computeConviction, MODEL_ORDER, MODEL_LABELS } from '../models/conviction.js';
import { runEquityEtf, runBondEtf, runTreasury, orderFor, equalWeights, COMPONENT_LABELS, ASSET_TYPE_LABELS } from '../models/assets.js';
import { treasuryReturnsFromYields } from '../models/bondMath.js';

const ALL_TENORS = ['DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30'];
let curveCache = null; // { at, value } — the yield curve is the same for every asset in a session

function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/** Latest yield for every tenor plus a 4-year daily history of the 10-year yield. */
export async function fetchCurve() {
  if (curveCache && Date.now() - curveCache.at < 30 * 60 * 1000) return curveCache.value;
  const [latestRes, histRes] = await Promise.all([api.fred(ALL_TENORS, { latest: true }), api.fred('DGS10', { start: yearsAgo(4) })]);
  if (!latestRes.ok) return { ok: false, error: latestRes.error };
  const latest = {};
  for (const [id, rows] of Object.entries(latestRes.data.series || {})) if (rows && rows.length) latest[id] = rows[rows.length - 1];
  const value = { ok: true, latest, tenors: latestRes.data.tenors, series: { DGS10: histRes.ok ? histRes.data.series.DGS10 || [] : [] }, histError: histRes.ok ? null : histRes.error, source: latestRes.data.source };
  curveCache = { at: Date.now(), value };
  return value;
}

function simpleReturns(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) out.push({ date: bars[i].date, ret: bars[i].close / bars[i - 1].close - 1 });
  return out;
}

function unsupportedResult(ticker, assetType, reason, name) {
  return { ticker, assetType, name: name || null, order: [], labels: {}, results: {}, conviction: { score: null, label: 'n/a', breakdown: [], excluded: [], sumWeights: 0 }, price: null, priceDate: null, dailyReturns: [], sources: [], error: reason };
}

export async function runAssetAnalysis(ticker, settings, { asOf = null, onRaw = () => {} } = {}) {
  const t = String(ticker || '').trim().toUpperCase();
  const det = await api.asset(t);
  if (!det.ok) return unsupportedResult(t, 'unsupported', `Asset lookup failed: ${det.error}`);
  const asset = det.data;
  const sym = asset.ticker || t;

  if (asset.assetType === 'unsupported') return unsupportedResult(sym, 'unsupported', asset.detection?.reason || 'unsupported', asset.name);

  if (asset.assetType === 'stock') {
    const a = await runStockAnalysis(sym, settings, { asOf, onRaw });
    return { ...a, assetType: 'stock', name: a.companyName || asset.name || null, order: MODEL_ORDER, labels: MODEL_LABELS, dailyReturns: a.bars ? simpleReturns(a.bars) : [], sources: dataSources(a.raw, settings), detection: asset.detection };
  }

  if (asset.assetType === 'treasury') {
    const [histRes, curve] = await Promise.all([api.fred(asset.series, { start: yearsAgo(3) }), fetchCurve()]);
    const history = histRes.ok ? histRes.data.series[asset.series] || [] : [];
    const order = orderFor('treasury');
    const results = histRes.ok && history.length
      ? runTreasury({ asset, history, curve: curve.ok ? curve : null })
      : Object.fromEntries(order.map((id) => [id, { id, name: COMPONENT_LABELS[id], available: false, error: `FRED ${asset.series} unavailable: ${histRes.error || 'no data'}` }]));
    const conviction = computeConviction(results, equalWeights(order), order);
    const last = history[history.length - 1];
    const rets = history.length > 1 ? treasuryReturnsFromYields(history, asset.tenor) : [];
    return {
      ticker: sym, assetType: 'treasury', name: asset.name, order, labels: COMPONENT_LABELS, results, conviction,
      price: last ? last.value : null, priceDate: last ? last.date : null, priceKind: 'yield',
      dailyReturns: rets, returnsNote: `Daily returns approximated from FRED ${asset.series} yield changes: r = −D_mod·Δy + y/252 (par-bond duration at tenor ${asset.tenor}y).`,
      sources: [
        histRes.ok ? { type: `${asset.tenor}-year Treasury yield`, source: 'FRED', asOf: last?.date || null, status: 'ok', detail: `${asset.series}, ${history.length} daily observations from ${history[0]?.date}` } : { type: `${asset.tenor}-year Treasury yield`, source: 'FRED', asOf: null, status: 'unavailable', reason: histRes.error },
        curve.ok ? { type: 'Yield curve', source: 'FRED', asOf: curve.latest.DGS10?.date || null, status: 'ok', detail: `${Object.keys(curve.latest).length} tenors, latest observations` } : { type: 'Yield curve', source: 'FRED', asOf: null, status: 'unavailable', reason: curve.error },
      ],
      detection: asset.detection, asset, error: conviction.score === null ? 'No Treasury component could be computed.' : null,
    };
  }

  // Equity or bond ETF
  const [pricesRes, curve] = await Promise.all([api.prices(sym, asOf), asset.assetType === 'bond_etf' ? fetchCurve() : Promise.resolve(null)]);
  const bars = pricesRes.ok ? pricesRes.data.stock : null;
  const order = orderFor(asset.assetType);
  let results;
  if (!bars) {
    results = Object.fromEntries(order.map((id) => [id, { id, name: COMPONENT_LABELS[id], available: false, error: `Price data failed: ${pricesRes.error}` }]));
  } else if (asset.assetType === 'equity_etf') {
    results = runEquityEtf({ asset, bars }, settings);
  } else {
    results = runBondEtf({ asset, bars, curve: curve && curve.ok ? curve : null }, settings);
  }
  const conviction = computeConviction(results, equalWeights(order), order);
  const last = bars ? bars[bars.length - 1] : null;
  const sources = [
    bars ? { type: 'Prices (fund and SPY)', source: 'Alpaca', asOf: last.date, status: 'ok', detail: `Daily bars, IEX feed, split-adjusted; ${bars.length} bars from ${bars[0].date}` } : { type: 'Prices (fund and SPY)', source: 'Alpaca', asOf: null, status: 'unavailable', reason: pricesRes.error },
    { type: 'Fund facts (expense ratio, AUM, credit quality)', source: 'Finnhub', asOf: null, status: 'unavailable', reason: asset.etfProfile?.reason || 'Not provided by the current data providers.' },
  ];
  if (asset.dividends) sources.push(asset.dividends.status === 'ok' ? { type: 'Cash distributions (12 months)', source: 'Alpaca', asOf: asset.dividends.to, status: 'ok', detail: `${asset.dividends.count} dividends from ${asset.dividends.from}` } : { type: 'Cash distributions (12 months)', source: 'Alpaca', asOf: null, status: 'unavailable', reason: asset.dividends.reason });
  if (curve) sources.push(curve.ok ? { type: 'Treasury yields', source: 'FRED', asOf: curve.latest.DGS10?.date || null, status: 'ok', detail: 'Latest curve plus 10-year daily history' } : { type: 'Treasury yields', source: 'FRED', asOf: null, status: 'unavailable', reason: curve.error });
  return {
    ticker: sym, assetType: asset.assetType, name: asset.name, order, labels: COMPONENT_LABELS, results, conviction,
    price: last ? last.close : null, priceDate: last ? last.date : null, bars, spyBars: pricesRes.ok ? pricesRes.data.spy : null,
    dailyReturns: bars ? simpleReturns(bars) : [], sources, detection: asset.detection, asset,
    error: conviction.score === null ? (bars ? 'No component could be computed.' : `Price data failed: ${pricesRes.error}`) : null,
  };
}

export { ASSET_TYPE_LABELS };
