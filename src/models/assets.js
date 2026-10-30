// Models for non-stock assets. Each returns a list of "component" results in the SAME shape as the
// stock models (id, name, available, subscore, scoringRule, note, metrics, provenance, inputs, steps,
// chart, keyOutput, drivers), so the conviction aggregator, attribution waterfall, methodology tables
// and AI payload all work unchanged. A component whose data the providers do not supply is returned as
// unavailable with the reason and is excluded from the score (weights re-normalize).
//
// Equity ETF components (equal weights):
//   expense    score = clamp(100 · (1 − ER / 1%))                       ER = expense ratio (provider: unavailable on the free plan)
//   liquidity  score = clamp(100 · (log10(ADV$) − 6) / 3)                ADV$ = mean(close × volume) over the last 63 trading days
//   momentum   score = clamp(50 + 100 · M),  M = P[t−21] / P[t−252] − 1
//   volatility score = clamp(100 · (60% − σ) / 45%),  σ = stdev(daily log returns, 1y) · √252
//   drawdown   score = clamp(100 + 125 · MDD),  MDD over the full window
//   sharpe     score = clamp(50 + 25 · S),  S = (mean daily log return · 252 − R_f) / σ
// Bond ETF components (equal weights):
//   yield      score = clamp(100 · Y / 6%),  Y = trailing-12-month cash distributions / price
//   duration   score = clamp(100 − 5 · D_emp),  D_emp = empirical duration vs 10-year yield changes (official effective duration: provider unavailable)
//   credit     credit quality: provider unavailable on the free plan → excluded
//   spread     score = clamp(50 + 25 · (Y − y_T)),  y_T = Treasury yield at the tenor nearest D_emp (percentage points)
//   volatility score = clamp(100 · (15% − σ) / 13%)
//   drawdown   score = clamp(100 + 250 · MDD)
// Treasury components (equal weights):
//   yield      score = clamp(100 · y / 6%)
//   duration   score = clamp(100 − 5 · D_mod),  D_mod from the par-bond formula at the tenor
//   curve      score = clamp(50 + 50 · (y − y_3mo)),  position vs the 3-month yield (percentage points)

import { logReturns, mean, stdev, clamp, smaAt, fmt, fmtPct, fmtMoney, unavailable, topDrivers } from './_math.js';
import { SRC, fetched, computed, missing, alpacaInput, settingInput } from '../lib/provenance.js';
import { parBondDuration, empiricalDuration, nearestTenor } from './bondMath.js';

export const ASSET_TYPE_LABELS = { stock: 'Stock', equity_etf: 'Equity ETF', bond_etf: 'Bond ETF', treasury: 'Treasury', unsupported: 'Unsupported' };

export const EQUITY_ETF_ORDER = ['expense', 'liquidity', 'momentum', 'volatility', 'drawdown', 'sharpe'];
export const BOND_ETF_ORDER = ['yield', 'duration', 'credit', 'spread', 'volatility', 'drawdown'];
export const TREASURY_ORDER = ['yield', 'duration', 'curve'];
export const COMPONENT_LABELS = {
  expense: 'Expense ratio', liquidity: 'Liquidity', momentum: 'Momentum (12-1)', volatility: 'Volatility', drawdown: 'Max drawdown', sharpe: 'Sharpe ratio',
  yield: 'Yield', duration: 'Duration', credit: 'Credit quality', spread: 'Spread vs Treasury', curve: 'Yield-curve position',
};
export function orderFor(assetType) {
  return assetType === 'equity_etf' ? EQUITY_ETF_ORDER : assetType === 'bond_etf' ? BOND_ETF_ORDER : assetType === 'treasury' ? TREASURY_ORDER : [];
}
export function equalWeights(order) {
  return Object.fromEntries(order.map((id) => [id, 1]));
}

function priceStats(bars, rf) {
  const closes = bars.map((b) => b.close);
  const r = logReturns(closes);
  const r1 = r.slice(-252);
  const dailyVol = stdev(r1);
  const annualVol = dailyVol * Math.sqrt(252);
  const annualMean = mean(r1) * 252;
  const sharpe = rf === null ? null : (annualMean - rf) / annualVol;
  let peak = closes[0];
  let maxDD = 0;
  let troughDate = bars[0].date;
  const drawdown = [];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    const dd = closes[i] / peak - 1;
    if (dd < maxDD) {
      maxDD = dd;
      troughDate = bars[i].date;
    }
    drawdown.push({ date: bars[i].date, drawdown: dd });
  }
  const t = closes.length - 1;
  const momentum = closes.length > 252 ? closes[t - 21] / closes[t - 252] - 1 : null;
  const series = bars.slice(-504).map((b, i, arr) => {
    const idx = bars.length - arr.length + i;
    return { date: b.date, close: b.close, sma50: idx + 1 >= 50 ? smaAt(closes, idx, 50) : null, sma200: idx + 1 >= 200 ? smaAt(closes, idx, 200) : null };
  });
  return { closes, r, r1, dailyVol, annualVol, annualMean, sharpe, maxDD, troughDate, drawdown, momentum, series, price: closes[t], priceDate: bars[t].date, returnCount: r1.length };
}

/** Provenance record for a value read from an SEC filing. */
const secProv = (f, detail) => ({ source: SRC.SEC, asOf: f.filingDate, detail: `${f.formType} filed ${f.filingDate}${f.reportDate ? `, period ${f.reportDate}` : ''}, accession ${f.accession}${detail ? `; ${detail}` : ''}` });
const secLabel = (f) => `SEC ${f.formType} filed ${f.filingDate}`;
export const NOT_IN_SEC = 'unavailable (not in SEC filing)';

const rfOf = (settings) => {
  const v = settings?.riskFreeRate;
  return v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v) / 100;
};

function sharedPriceComponents(bars, stats, rf, settings, volRule) {
  const px = alpacaInput(bars);
  const out = {};
  out.momentum = stats.momentum === null
    ? unavailable('momentum', COMPONENT_LABELS.momentum, `Need more than 252 daily bars, have ${bars.length}.`)
    : (() => {
        const s = clamp(50 + 100 * stats.momentum, 0, 100);
        return { id: 'momentum', name: COMPONENT_LABELS.momentum, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(50 + 100 × 12-1 month return)', note: 'Twelve-month price momentum skipping the most recent month; trend persistence, not value.', keyOutput: `12-1 momentum ${fmtPct(stats.momentum)}`, drivers: [{ label: '12-1 month return', value: fmtPct(stats.momentum) }], metrics: { momentum12_1: stats.momentum, price: stats.price }, provenance: { momentum12_1: computed(stats.momentum, [px]), price: fetched(stats.price, SRC.ALPACA, stats.priceDate, 'latest daily close, IEX feed') }, inputs: [{ label: 'Closes used', value: `${bars.length} days ending ${stats.priceDate}`, source: 'Alpaca IEX bars' }], steps: [{ label: '12-1 momentum', formula: 'M = P[t−21] / P[t−252] − 1', calc: `${fmt(stats.closes[stats.closes.length - 22])} / ${fmt(stats.closes[stats.closes.length - 253])} − 1`, result: `M = ${fmtPct(stats.momentum)}` }, { label: 'Score', formula: 'clamp(50 + 100·M, 0, 100)', calc: `50 + 100 × ${stats.momentum.toFixed(4)}`, result: `${Math.round(s)} / 100` }], chart: { kind: 'priceSma', series: stats.series } };
      })();
  const volScore = clamp((100 * (volRule.top - stats.annualVol)) / volRule.span, 0, 100);
  out.volatility = { id: 'volatility', name: COMPONENT_LABELS.volatility, available: true, subscore: Math.round(volScore), scoringRule: `score = clamp(100 × (${fmtPct(volRule.top, 0)} − σ) / ${fmtPct(volRule.span, 0)}, 0, 100)`, note: 'Annualized standard deviation of daily returns over the past year; how bumpy the ride has been.', keyOutput: `Volatility ${fmtPct(stats.annualVol)}`, drivers: [{ label: 'Annual volatility', value: fmtPct(stats.annualVol) }], metrics: { annualVol: stats.annualVol, dailyVol: stats.dailyVol }, provenance: { annualVol: computed(stats.annualVol, [px]) }, inputs: [{ label: '1-year window', value: `${stats.returnCount} daily returns`, source: 'Alpaca IEX bars' }], steps: [{ label: 'Annualized volatility', formula: 'σ = stdev(daily log returns) · √252', calc: `${(stats.dailyVol * 100).toFixed(3)}% × 15.875`, result: `σ = ${fmtPct(stats.annualVol)}` }, { label: 'Score', formula: `clamp(100 × (${fmtPct(volRule.top, 0)} − σ) / ${fmtPct(volRule.span, 0)}, 0, 100)`, calc: `100 × (${volRule.top} − ${stats.annualVol.toFixed(4)}) / ${volRule.span}`, result: `${Math.round(volScore)} / 100` }], chart: { kind: 'none' } };
  const ddScore = clamp(100 + volRule.ddMult * stats.maxDD, 0, 100);
  out.drawdown = { id: 'drawdown', name: COMPONENT_LABELS.drawdown, available: true, subscore: Math.round(ddScore), scoringRule: `score = clamp(100 + ${volRule.ddMult} × MDD, 0, 100)`, note: 'Worst peak-to-trough fall over the window; how bad holding it has been at the worst moment.', keyOutput: `Max drawdown ${fmtPct(stats.maxDD)}`, drivers: [{ label: 'Max drawdown', value: fmtPct(stats.maxDD) }], metrics: { maxDD: stats.maxDD, troughDate: stats.troughDate }, provenance: { maxDD: computed(stats.maxDD, [px]) }, inputs: [{ label: 'Window', value: `${bars[0].date} → ${stats.priceDate}`, source: 'Alpaca IEX bars' }], steps: [{ label: 'Max drawdown', formula: 'MDD = min_t (P_t / max_{u≤t} P_u − 1)', calc: `trough ${stats.troughDate}`, result: `MDD = ${fmtPct(stats.maxDD)}` }, { label: 'Score', formula: `clamp(100 + ${volRule.ddMult}·MDD, 0, 100)`, calc: `100 + ${volRule.ddMult} × (${stats.maxDD.toFixed(4)})`, result: `${Math.round(ddScore)} / 100` }], chart: { kind: 'drawdown', drawdown: stats.drawdown } };
  if (volRule.sharpe) {
    const rfP = settings?.riskFreeProv || settingInput('risk-free rate');
    out.sharpe = stats.sharpe === null
      ? unavailable('sharpe', COMPONENT_LABELS.sharpe, 'No risk-free rate available (FRED lookup failed and none entered in Settings).')
      : (() => {
          const s = clamp(50 + 25 * stats.sharpe, 0, 100);
          return { id: 'sharpe', name: COMPONENT_LABELS.sharpe, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(50 + 25 × Sharpe, 0, 100)', note: 'Return earned above the risk-free rate per unit of volatility over the past year.', keyOutput: `Sharpe ${fmt(stats.sharpe)}`, drivers: [{ label: 'Sharpe ratio', value: fmt(stats.sharpe) }], metrics: { sharpe: stats.sharpe, annualMean: stats.annualMean, riskFreeRate: rf }, provenance: { sharpe: computed(stats.sharpe, [px, rfP]) }, inputs: [{ label: 'Risk-free rate R_f', value: fmtPct(rf, 2), source: settings?.riskFreeSource || 'Settings' }], steps: [{ label: 'Sharpe ratio', formula: 'S = (R̄ − R_f) / σ', calc: `(${fmtPct(stats.annualMean)} − ${fmtPct(rf)}) / ${fmtPct(stats.annualVol)}`, result: `S = ${fmt(stats.sharpe)}` }, { label: 'Score', formula: 'clamp(50 + 25·S, 0, 100)', calc: `50 + 25 × ${stats.sharpe.toFixed(3)}`, result: `${Math.round(s)} / 100` }], chart: { kind: 'none' } };
        })();
  }
  return out;
}

/** Equity ETF. `asset` is the /api/asset payload; `bars` the ETF's Alpaca bars. */
export function runEquityEtf({ asset, bars, fund }, settings) {
  if (!bars || bars.length < 260) {
    const why = `Need at least 260 daily bars, have ${bars ? bars.length : 0}.`;
    return Object.fromEntries(EQUITY_ETF_ORDER.map((id) => [id, unavailable(id, COMPONENT_LABELS[id], why)]));
  }
  const rf = rfOf(settings);
  const stats = priceStats(bars, rf);
  const px = alpacaInput(bars);
  const out = sharedPriceComponents(bars, stats, rf, settings, { top: 0.6, span: 0.45, ddMult: 125, sharpe: true });

  // Expense ratio: SEC prospectus XBRL first, then the (paid) Finnhub profile if it ever returns data.
  const prof = asset?.etfProfile;
  const secEx = fund?.expense;
  const nport = fund?.nport && fund.nport.status === 'ok' ? fund.nport : null;
  if (secEx && secEx.status === 'ok' && Number.isFinite(secEx.value)) {
    const er = secEx.value;
    const s = clamp(100 * (1 - er / 0.01), 0, 100);
    out.expense = { id: 'expense', name: COMPONENT_LABELS.expense, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(100 × (1 − expense ratio / 1%), 0, 100)', note: `Annual fee taken from the fund; lower is better. Read from the fund's prospectus risk/return XBRL (${secEx.element}).`, keyOutput: `Expense ratio ${fmtPct(er, 2)}`, drivers: [{ label: 'Expense ratio', value: fmtPct(er, 2) }], metrics: { expenseRatio: er }, provenance: { expenseRatio: fetched(er, SRC.SEC, secEx.filingDate, `${secEx.formType} filed ${secEx.filingDate}, accession ${secEx.accession}, ${secEx.element}`) }, inputs: [{ label: 'Expense ratio', value: fmtPct(er, 2), source: `${secLabel(secEx)} (${secEx.element})` }], steps: [{ label: 'Expense ratio', formula: 'ER from prospectus XBRL', calc: `${secEx.element}, ${secLabel(secEx)}`, result: `ER = ${fmtPct(er, 2)}` }, { label: 'Score', formula: 'clamp(100 × (1 − ER / 1%), 0, 100)', calc: `100 × (1 − ${fmtPct(er, 2)} / 1%)`, result: `${Math.round(s)} / 100` }], chart: { kind: 'none' } };
  } else if (prof && prof.status === 'ok' && Number.isFinite(Number(prof.expenseRatio))) {
    const er = Number(prof.expenseRatio) / 100;
    const s = clamp(100 * (1 - er / 0.01), 0, 100);
    out.expense = { id: 'expense', name: COMPONENT_LABELS.expense, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(100 × (1 − expense ratio / 1%), 0, 100)', note: 'Annual fee taken from the fund; lower is better.', keyOutput: `Expense ratio ${fmtPct(er, 2)}`, drivers: [{ label: 'Expense ratio', value: fmtPct(er, 2) }], metrics: { expenseRatio: er, aum: prof.aum ?? null }, provenance: { expenseRatio: fetched(er, SRC.FINNHUB, null, prof.source) }, inputs: [{ label: 'Expense ratio', value: fmtPct(er, 2), source: prof.source }], steps: [{ label: 'Score', formula: 'clamp(100 × (1 − ER / 1%), 0, 100)', calc: `100 × (1 − ${fmtPct(er, 2)} / 1%)`, result: `${Math.round(s)} / 100` }], chart: { kind: 'none' } };
  } else {
    out.expense = unavailable('expense', COMPONENT_LABELS.expense, (secEx && secEx.reason) || (prof && prof.reason) || 'Expense ratio not provided by the current data providers.');
  }

  // Liquidity from IEX-feed dollar volume
  const last63 = bars.slice(-63);
  const adv = mean(last63.map((b) => b.close * b.volume));
  const liqScore = adv > 0 ? clamp((100 * (Math.log10(adv) - 6)) / 3, 0, 100) : 0;
  const avgShares = mean(last63.map((b) => b.volume));
  out.liquidity = { id: 'liquidity', name: COMPONENT_LABELS.liquidity, available: true, subscore: Math.round(liqScore), scoringRule: 'score = clamp(100 × (log10(average daily dollar volume) − 6) / 3, 0, 100): $1M → 0, $1B → 100', note: `How easily the fund trades. Volume here is the IEX feed only, a subset of consolidated volume, so it understates the true figure for every fund equally. The score uses dollar volume only; fund size (net assets) is shown for reference${nport ? ` from ${secLabel(nport)}` : ''}.`, warning: nport && nport.netAssets ? null : `Fund size ${(fund?.nport && fund.nport.reason) || NOT_IN_SEC}; liquidity is scored from IEX-feed dollar volume only.`, keyOutput: `Avg daily $ volume ${fmtMoney(adv, 1)} (IEX feed)`, drivers: [{ label: 'Avg daily dollar volume (IEX, 63d)', value: fmtMoney(adv, 1) }], metrics: { avgDollarVolume: adv, avgShareVolume: avgShares, aum: nport && nport.netAssets ? nport.netAssets : null }, provenance: { avgDollarVolume: computed(adv, [px], 'mean(close × volume) over the last 63 trading days, IEX feed'), aum: nport && nport.netAssets ? fetched(nport.netAssets, SRC.SEC, nport.filingDate, secProv(nport, 'net assets, Item B.1.c').detail) : missing((fund?.nport && fund.nport.reason) || NOT_IN_SEC, SRC.SEC) }, inputs: [{ label: '63-day average volume (IEX)', value: `${fmt(avgShares, 0)} shares/day`, source: 'Alpaca IEX bars' }], steps: [{ label: 'Average daily dollar volume', formula: 'ADV$ = mean(close × volume), last 63 days', calc: `${fmt(avgShares, 0)} shares × ~$${fmt(stats.price)}`, result: `ADV$ = ${fmtMoney(adv, 1)}` }, { label: 'Score', formula: 'clamp(100 × (log10(ADV$) − 6) / 3, 0, 100)', calc: `100 × (${Math.log10(Math.max(adv, 1)).toFixed(2)} − 6) / 3`, result: `${Math.round(liqScore)} / 100` }], chart: { kind: 'volume', series: bars.slice(-252).map((b) => ({ date: b.date, dollarVolume: b.close * b.volume })) } };
  return Object.fromEntries(EQUITY_ETF_ORDER.map((id) => [id, out[id]]));
}

/** Bond ETF. `curve` is the FRED payload with daily histories for DGS10 (for empirical duration) and latest yields for all tenors. */
export function runBondEtf({ asset, bars, curve, fund }, settings) {
  if (!bars || bars.length < 260) {
    const why = `Need at least 260 daily bars, have ${bars ? bars.length : 0}.`;
    return Object.fromEntries(BOND_ETF_ORDER.map((id) => [id, unavailable(id, COMPONENT_LABELS[id], why)]));
  }
  const rf = rfOf(settings);
  const stats = priceStats(bars, rf);
  const px = alpacaInput(bars);
  const out = sharedPriceComponents(bars, stats, rf, settings, { top: 0.15, span: 0.13, ddMult: 250, sharpe: false });

  // Yield: trailing-12-month cash distributions / price
  const div = asset?.dividends;
  let ttmYield = null;
  if (div && div.status === 'ok' && div.count > 0) {
    ttmYield = div.ttmTotal / stats.price;
    const s = clamp((100 * ttmYield) / 0.06, 0, 100);
    const divP = { source: SRC.ALPACA, asOf: div.to, detail: `${div.count} cash dividends ${div.from} → ${div.to}, ${div.source}` };
    out.yield = { id: 'yield', name: COMPONENT_LABELS.yield, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(100 × trailing-12-month distribution yield / 6%, 0, 100)', note: 'Cash actually paid out over the last twelve months as a share of today\'s price. The SEC 30-day yield is not a field in N-PORT or the prospectus XBRL, so it is unavailable.', warning: `SEC 30-day yield ${NOT_IN_SEC}; the trailing-12-month distribution yield is used instead.`, keyOutput: `TTM distribution yield ${fmtPct(ttmYield)}`, drivers: [{ label: 'TTM distribution yield', value: fmtPct(ttmYield) }], metrics: { ttmYield, ttmDistributions: div.ttmTotal, distributionCount: div.count, price: stats.price }, provenance: { ttmYield: computed(ttmYield, [divP, px]), secYield: missing((fund?.secYield && fund.secYield.reason) || `SEC 30-day yield ${NOT_IN_SEC}.`, SRC.SEC) }, inputs: [{ label: 'TTM cash distributions', value: `$${fmt(div.ttmTotal, 4)} per share over ${div.count} payments`, source: div.source }, { label: 'Price', value: `$${fmt(stats.price)} (${stats.priceDate})`, source: 'Alpaca' }], steps: [{ label: 'Distribution yield', formula: 'Y = Σ cash dividends (12 months) / price', calc: `${fmt(div.ttmTotal, 4)} / ${fmt(stats.price)}`, result: `Y = ${fmtPct(ttmYield)}` }, { label: 'Score', formula: 'clamp(100 × Y / 6%, 0, 100)', calc: `100 × ${ttmYield.toFixed(4)} / 0.06`, result: `${Math.round(s)} / 100` }], chart: { kind: 'dividends', series: div.dividends.map((d) => ({ date: d.exDate, rate: d.rate })) } };
  } else {
    out.yield = unavailable('yield', COMPONENT_LABELS.yield, (div && div.reason) || 'No cash distributions were reported by Alpaca in the last 12 months.');
  }

  // Empirical duration vs 10-year yield changes
  const dgs10 = curve?.series?.DGS10 || [];
  const yMap = new Map(dgs10.map((o) => [o.date, o.value / 100]));
  const fundR = [];
  const dY = [];
  for (let i = 1; i < bars.length; i++) {
    const a = yMap.get(bars[i - 1].date);
    const b = yMap.get(bars[i].date);
    if (a !== undefined && b !== undefined) {
      fundR.push(bars[i].close / bars[i - 1].close - 1);
      dY.push(b - a);
    }
  }
  const dEmp = empiricalDuration(fundR.slice(-252), dY.slice(-252));
  const fredP = { source: 'FRED', asOf: dgs10.length ? dgs10[dgs10.length - 1].date : null, detail: 'DGS10 daily 10-year constant-maturity yield' };
  const nport = fund?.nport && fund.nport.status === 'ok' ? fund.nport : null;
  const dSec = nport && nport.duration && nport.duration.status === 'ok' ? nport.duration.value : null;
  // Duration used below (score, spread tenor, stress test): the filing value when present, else empirical.
  const dUsed = dSec !== null ? dSec : dEmp;
  if (dSec !== null) {
    const s = clamp(100 - 5 * dSec, 0, 100);
    const nd = nport.duration;
    const sp = secProv(nport, 'interest-rate risk DV01, Item B.3.a; net assets, Item B.1.c');
    out.duration = { id: 'duration', name: COMPONENT_LABELS.duration, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(100 − 5 × duration, 0, 100)', note: `Price sensitivity to interest rates, from the fund's own N-PORT filing: total DV01 (dollar change in value for a 1 basis-point rate move) divided by net assets. It can differ from the sponsor's published effective duration, which uses its own model.${dEmp !== null ? ` For comparison, the duration measured from the fund's price moves against 10-year yields is ${fmt(dEmp, 1)} years.` : ''}`, keyOutput: `Duration ${fmt(dSec, 1)} years (N-PORT)`, drivers: [{ label: 'Duration (N-PORT DV01)', value: `${fmt(dSec, 1)}y` }], metrics: { duration: dSec, durationSource: 'nport', secDuration: dSec, empiricalDuration: dEmp, dv01: nd.dv01, netAssets: nport.netAssets }, provenance: { duration: computed(dSec, [sp], nd.formula), secDuration: computed(dSec, [sp], nd.formula), empiricalDuration: dEmp === null ? missing('Fewer than 60 overlapping days between fund prices and FRED 10-year yields.') : computed(dEmp, [px, fredP], 'regression slope of fund returns on 10-year yield changes') }, inputs: [{ label: 'Total DV01', value: `$${fmt(nd.dv01, 0)} per basis point (${nd.currencies.join(', ')})`, source: secLabel(nport) }, { label: 'Net assets', value: fmtMoney(nport.netAssets, 1), source: secLabel(nport) }], steps: [{ label: 'Duration from DV01', formula: 'D = Σ DV01 / net assets × 10,000', calc: `${fmt(nd.dv01, 0)} / ${fmt(nport.netAssets, 0)} × 10,000`, result: `D = ${fmt(dSec, 2)} years` }, { label: 'Score', formula: 'clamp(100 − 5·D, 0, 100)', calc: `100 − 5 × ${dSec.toFixed(2)}`, result: `${Math.round(s)} / 100` }], chart: { kind: 'none' } };
  } else if (dEmp !== null) {
    const d = Math.max(0, dEmp);
    const s = clamp(100 - 5 * d, 0, 100);
    out.duration = { id: 'duration', name: COMPONENT_LABELS.duration, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(100 − 5 × empirical duration, 0, 100)', note: 'Sensitivity of the fund\'s price to interest rates, measured from its own returns against 10-year yield changes. The fund\'s official effective duration is not provided by the current data providers.', warning: `Duration from the fund's N-PORT filing is ${(nport && nport.duration && nport.duration.reason) || (fund?.nport && fund.nport.reason) || NOT_IN_SEC}; empirical duration (regression on 10-year yield changes, 1 year) is used instead.`, keyOutput: `Empirical duration ${fmt(dEmp, 1)} years`, drivers: [{ label: 'Empirical duration', value: `${fmt(dEmp, 1)}y` }], metrics: { duration: dEmp, durationSource: 'empirical', empiricalDuration: dEmp, secDuration: null, observations: Math.min(fundR.length, 252) }, provenance: { duration: computed(dEmp, [px, fredP], 'regression slope of fund returns on 10-year yield changes'), empiricalDuration: computed(dEmp, [px, fredP], 'regression slope of fund returns on 10-year yield changes'), secDuration: missing((nport && nport.duration && nport.duration.reason) || (fund?.nport && fund.nport.reason) || NOT_IN_SEC, SRC.SEC) }, inputs: [{ label: 'Paired observations', value: `${Math.min(fundR.length, 252)} days`, source: 'Alpaca bars × FRED DGS10' }], steps: [{ label: 'Empirical duration', formula: 'D_emp = −cov(r_fund, Δy_10) / var(Δy_10)', calc: `${Math.min(fundR.length, 252)} daily pairs`, result: `D_emp = ${fmt(dEmp, 2)} years` }, { label: 'Score', formula: 'clamp(100 − 5·D, 0, 100)', calc: `100 − 5 × ${d.toFixed(2)}`, result: `${Math.round(s)} / 100` }], chart: { kind: 'none' } };
  } else {
    out.duration = unavailable('duration', COMPONENT_LABELS.duration, dgs10.length ? 'Fewer than 60 overlapping days between fund prices and FRED 10-year yields.' : 'FRED 10-year yield history unavailable, so empirical duration cannot be computed.');
  }

  // Credit quality: N-PORT credit-spread risk split (Item B.3.b). N-PORT carries no letter ratings.
  const cr = nport && nport.credit;
  if (cr && cr.status === 'ok') {
    const s = clamp(100 * cr.igShare, 0, 100);
    out.credit = { id: 'credit', name: COMPONENT_LABELS.credit, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(100 × investment-grade share of credit-spread risk, 0, 100)', note: 'The fund\'s own N-PORT split of credit-spread risk (DV01) between investment-grade and non-investment-grade holdings. N-PORT does not report letter ratings, so a rating-by-rating breakdown is not available.', keyOutput: `Investment-grade share ${fmtPct(cr.igShare, 1)} of credit-spread risk`, drivers: [{ label: 'Investment-grade share of spread risk', value: fmtPct(cr.igShare, 1) }], metrics: { igShare: cr.igShare, igDv01: cr.igDv01, nonIgDv01: cr.nonIgDv01, issuerBreakdown: nport.issuerBreakdown }, provenance: { igShare: computed(cr.igShare, [secProv(nport, 'credit-spread risk, Item B.3.b')], cr.formula) }, inputs: [{ label: 'Investment-grade spread DV01', value: `$${fmt(cr.igDv01, 0)}`, source: secLabel(nport) }, { label: 'Non-investment-grade spread DV01', value: `$${fmt(cr.nonIgDv01, 0)}`, source: secLabel(nport) }], steps: [{ label: 'Investment-grade share', formula: 'IG share = DV01_IG / (DV01_IG + DV01_nonIG)', calc: `${fmt(cr.igDv01, 0)} / (${fmt(cr.igDv01, 0)} + ${fmt(cr.nonIgDv01, 0)})`, result: fmtPct(cr.igShare, 2) }, { label: 'Score', formula: 'clamp(100 × IG share, 0, 100)', calc: `100 × ${cr.igShare.toFixed(4)}`, result: `${Math.round(s)} / 100` }], chart: { kind: 'none' } };
  } else {
    out.credit = unavailable('credit', COMPONENT_LABELS.credit, (cr && cr.reason) || (fund?.nport && fund.nport.reason) || `Credit quality ${NOT_IN_SEC}.`);
  }

  // Spread vs the Treasury whose tenor is nearest the duration
  const latest = curve?.latest || {};
  const tenors = Object.entries(curve?.tenors || {}).filter(([id]) => latest[id] !== undefined).map(([id, t]) => ({ id, t, y: latest[id].value }));
  if (ttmYield !== null && dUsed !== null && tenors.length) {
    const tenor = nearestTenor(Math.max(0.25, dUsed), tenors.map((x) => x.t));
    const match = tenors.find((x) => x.t === tenor);
    const spread = ttmYield * 100 - match.y; // percentage points
    const s = clamp(50 + 25 * spread, 0, 100);
    out.spread = { id: 'spread', name: COMPONENT_LABELS.spread, available: true, subscore: Math.round(s), scoringRule: 'score = clamp(50 + 25 × (fund yield − Treasury yield at the matching tenor, in percentage points), 0, 100)', note: 'Extra yield over a Treasury of similar duration; compensation for credit and liquidity risk.', keyOutput: `Spread ${spread >= 0 ? '+' : ''}${spread.toFixed(2)} pts vs ${tenor}y Treasury`, drivers: [{ label: `Spread vs ${tenor}y Treasury`, value: `${spread >= 0 ? '+' : ''}${spread.toFixed(2)} pts` }], metrics: { spreadPts: spread, matchedTenor: tenor, treasuryYield: match.y / 100 }, provenance: { spreadPts: computed(spread, [{ source: 'FRED', asOf: latest[match.id].date, detail: `${match.id} ${tenor}-year constant-maturity yield` }, px]) }, inputs: [{ label: `Treasury yield, ${tenor}y`, value: `${match.y.toFixed(2)}% (${latest[match.id].date})`, source: `FRED ${match.id}` }], steps: [{ label: 'Matching tenor', formula: 'nearest Treasury tenor to the duration', calc: `D ${fmt(dUsed, 1)}y (${dSec !== null ? 'N-PORT' : 'empirical'}) → ${tenor}y`, result: `${tenor}-year Treasury ${match.y.toFixed(2)}%` }, { label: 'Spread', formula: 'spread = Y_fund − y_T', calc: `${(ttmYield * 100).toFixed(2)} − ${match.y.toFixed(2)}`, result: `${spread.toFixed(2)} pts` }, { label: 'Score', formula: 'clamp(50 + 25·spread, 0, 100)', calc: `50 + 25 × ${spread.toFixed(2)}`, result: `${Math.round(s)} / 100` }], chart: { kind: 'none' } };
  } else {
    out.spread = unavailable('spread', COMPONENT_LABELS.spread, ttmYield === null ? 'Distribution yield unavailable, so no spread can be computed.' : dUsed === null ? 'Duration unavailable, so no matching Treasury tenor can be chosen.' : 'FRED Treasury yields unavailable.');
  }
  return Object.fromEntries(BOND_ETF_ORDER.map((id) => [id, out[id]]));
}

/** Treasury (constant maturity). `history` = FRED daily yields for this tenor (percent); `curve.latest` = latest yield per series. */
export function runTreasury({ asset, history, curve }) {
  const tenor = asset.tenor;
  if (!history || history.length < 2) return Object.fromEntries(TREASURY_ORDER.map((id) => [id, unavailable(id, COMPONENT_LABELS[id], `FRED ${asset.series} history unavailable.`)]));
  const last = history[history.length - 1];
  const y = last.value / 100;
  const fredP = { source: 'FRED', asOf: last.date, detail: `${asset.series} ${tenor}-year constant-maturity Treasury yield` };
  const ys = clamp((100 * y) / 0.06, 0, 100);
  const out = {};
  out.yield = { id: 'yield', name: COMPONENT_LABELS.yield, available: true, subscore: Math.round(ys), scoringRule: 'score = clamp(100 × yield / 6%, 0, 100)', note: 'The annual yield a buyer locks in today by holding to maturity.', keyOutput: `${tenor}-year yield ${last.value.toFixed(2)}%`, drivers: [{ label: `${tenor}y yield`, value: `${last.value.toFixed(2)}%` }], metrics: { yield: y, yieldPct: last.value, asOf: last.date }, provenance: { yield: fetched(y, 'FRED', last.date, fredP.detail) }, inputs: [{ label: 'Yield', value: `${last.value.toFixed(2)}% on ${last.date}`, source: `FRED ${asset.series}` }], steps: [{ label: 'Score', formula: 'clamp(100 × y / 6%, 0, 100)', calc: `100 × ${last.value.toFixed(2)}% / 6%`, result: `${Math.round(ys)} / 100` }], chart: { kind: 'yieldHistory', series: history.slice(-756).map((o) => ({ date: o.date, yield: o.value })) } };
  const dur = parBondDuration(y, tenor);
  const ds = clamp(100 - 5 * dur.modified, 0, 100);
  out.duration = { id: 'duration', name: COMPONENT_LABELS.duration, available: true, subscore: Math.round(ds), scoringRule: 'score = clamp(100 − 5 × modified duration, 0, 100)', note: 'Price sensitivity to a 1-point move in yields; longer maturities swing more.', keyOutput: `Modified duration ${fmt(dur.modified, 1)} years`, drivers: [{ label: 'Modified duration', value: `${fmt(dur.modified, 1)}y` }], metrics: { macaulay: dur.macaulay, modified: dur.modified, tenor }, provenance: { modified: computed(dur.modified, [fredP], 'par-bond duration formula at the current yield') }, inputs: [{ label: 'Tenor', value: `${tenor} years, semiannual coupons at par`, source: 'Fixed' }], steps: [{ label: 'Macaulay duration', formula: 'D_mac = [(1 + c)/c · (1 − (1 + c)^(−n))] / 2,  c = y/2, n = 2T', calc: `c = ${(y / 2).toFixed(5)}, n = ${2 * tenor}`, result: `D_mac = ${fmt(dur.macaulay, 2)}y` }, { label: 'Modified duration', formula: 'D_mod = D_mac / (1 + c)', calc: `${fmt(dur.macaulay, 2)} / ${(1 + y / 2).toFixed(5)}`, result: `D_mod = ${fmt(dur.modified, 2)}y` }, { label: 'Score', formula: 'clamp(100 − 5·D_mod, 0, 100)', calc: `100 − 5 × ${dur.modified.toFixed(2)}`, result: `${Math.round(ds)} / 100` }], chart: { kind: 'none' } };
  const latest = curve?.latest || {};
  const cash = latest.DGS3MO;
  if (cash) {
    const slope = last.value - cash.value;
    const cs = clamp(50 + 50 * slope, 0, 100);
    const points = Object.entries(curve.tenors || {}).filter(([id]) => latest[id]).map(([id, t]) => ({ id, tenor: t, label: t < 1 ? `${Math.round(t * 12)}M` : `${t}Y`, yield: latest[id].value, selected: id === asset.series })).sort((a, b) => a.tenor - b.tenor);
    out.curve = { id: 'curve', name: COMPONENT_LABELS.curve, available: true, subscore: Math.round(cs), scoringRule: 'score = clamp(50 + 50 × (tenor yield − 3-month yield, percentage points), 0, 100)', note: 'Whether this maturity pays more than cash. A positive gap means you are paid to extend; a negative gap (inverted curve) means you are not.', keyOutput: `${slope >= 0 ? '+' : ''}${slope.toFixed(2)} pts vs 3-month`, drivers: [{ label: 'Yield minus 3-month', value: `${slope >= 0 ? '+' : ''}${slope.toFixed(2)} pts` }], metrics: { slopeVs3m: slope, threeMonth: cash.value / 100, curve: points }, provenance: { slopeVs3m: computed(slope, [fredP, { source: 'FRED', asOf: cash.date, detail: 'DGS3MO 3-month yield' }]) }, inputs: [{ label: '3-month yield', value: `${cash.value.toFixed(2)}% (${cash.date})`, source: 'FRED DGS3MO' }], steps: [{ label: 'Curve position', formula: 'slope = y_T − y_3mo', calc: `${last.value.toFixed(2)} − ${cash.value.toFixed(2)}`, result: `${slope.toFixed(2)} pts` }, { label: 'Score', formula: 'clamp(50 + 50·slope, 0, 100)', calc: `50 + 50 × ${slope.toFixed(2)}`, result: `${Math.round(cs)} / 100` }], chart: { kind: 'yieldCurve', points } };
  } else {
    out.curve = unavailable('curve', COMPONENT_LABELS.curve, 'FRED 3-month yield unavailable.');
  }
  return out;
}

/** Plain-English one-liner per asset type for score cards. */
export function assetHeadline(assetType, results) {
  const avail = (id) => results[id] && results[id].available;
  if (assetType === 'equity_etf') return [avail('momentum') ? results.momentum.keyOutput : null, avail('volatility') ? results.volatility.keyOutput : null, avail('liquidity') ? results.liquidity.keyOutput : null].filter(Boolean).join('; ');
  if (assetType === 'bond_etf') return [avail('yield') ? results.yield.keyOutput : null, avail('duration') ? results.duration.keyOutput : null, avail('spread') ? results.spread.keyOutput : null].filter(Boolean).join('; ');
  if (assetType === 'treasury') return [avail('yield') ? results.yield.keyOutput : null, avail('duration') ? results.duration.keyOutput : null, avail('curve') ? results.curve.keyOutput : null].filter(Boolean).join('; ');
  return '';
}

export { topDrivers };
