// Portfolio models. A portfolio is a set of holdings with user-chosen weights, a time horizon,
// a required growth target and a written thesis. Three portfolio-level results feed the score:
//
//   1. Weighted stock conviction   C_p = Σ wᵢ · Cᵢ            (wᵢ = normalized weights, Cᵢ = each stock's conviction score)
//      Per-model weighted subscores are reported the same way for the models that were available.
//
//   2. Target feasibility (bootstrap Monte Carlo)
//      Daily log returns for every holding over the common 1-year window are kept as joint rows, one per
//      trading day. For each of N = 10,000 paths we draw H trading days at random WITH replacement from
//      those rows (H = horizon in trading days) so the holdings' correlations are preserved exactly.
//      Holding i's growth on a path:   G_i = exp( Σ_{d=1..H} r_{i,d} ) − 1
//      Portfolio growth (buy and hold): G_p = Σ wᵢ · G_i
//      P(target) = (# paths with G_p ≥ target) / N
//      Required annualized return for the target:  (1 + target)^(252/H) − 1
//      targetScore = 100 × P(target)
//
//   3. Portfolio risk (common 5-year window, daily simple returns R_i,t = P_i,t / P_i,t−1 − 1)
//      Portfolio daily return   R_p,t = Σ wᵢ R_i,t            (constant-weight approximation)
//      Volatility               σ_p = stdev(R_p over last 252 days) · √252
//      Beta                     β_p = cov(R_p, R_SPY) / var(R_SPY)   (last 252 days)
//      Max drawdown             MDD = min_t ( V_t / max_{u≤t} V_u − 1 ),  V_t = Π (1 + R_p,u)
//      Correlation matrix       ρ_ij = cov(R_i, R_j) / (σ_i σ_j)
//      Diversification ratio    DR = ( Σ wᵢ σᵢ ) / σ_p      (1.0 = no diversification benefit)
//      riskScore = mean of: volScore = clamp(100·(60% − σ_p)/45%), betaScore = clamp(125 − 50β_p),
//                           ddScore = clamp(100 + 125·MDD), divScore = clamp(100·(DR − 1)/0.5)
//
//   Portfolio conviction = ( w_C · C_p + w_T · targetScore + w_R · riskScore ) / (w_C + w_T + w_R)
//   Default blend weights: stock conviction 50, target feasibility 30, risk 20 (editable).

import { mean, stdev, covariance, variance, clamp, percentileSorted, makeRng, fmt, fmtPct, fmtMoney, unavailable } from './_math.js';
import { MODEL_ORDER, MODEL_LABELS, scoreLabel } from './conviction.js';

export const DEFAULT_BLEND = { conviction: 50, target: 30, risk: 20 };
const PATHS = 10000;
const SEED = 20260202;

/** Normalize user amounts (dollars or percents, any scale) to weights summing to 1. */
export function normalizeWeights(holdings) {
  const total = holdings.reduce((s, h) => s + (Number(h.amount) > 0 ? Number(h.amount) : 0), 0);
  return holdings.map((h) => ({ ...h, weight: total > 0 && Number(h.amount) > 0 ? Number(h.amount) / total : 0 }));
}

/** Horizon in trading days from {value, unit}. */
export function horizonDays(h) {
  const v = Math.max(1, Number(h?.value) || 1);
  return h?.unit === 'weeks' ? Math.round(v * 5) : h?.unit === 'years' ? Math.round(v * 252) : Math.round(v * 21);
}

export function horizonLabel(h) {
  const v = Number(h?.value) || 1;
  const unit = h?.unit || 'months';
  return `${v} ${v === 1 ? unit.replace(/s$/, '') : unit}`;
}

/** Align close series of several holdings (and SPY) on common dates. */
function alignCloses(series, spyBars) {
  const maps = series.map((bars) => new Map(bars.map((b) => [b.date, b.close])));
  const spyMap = new Map(spyBars.map((b) => [b.date, b.close]));
  const dates = [...spyMap.keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  return { dates, closes: maps.map((m) => dates.map((d) => m.get(d))), spy: dates.map((d) => spyMap.get(d)) };
}

/** 1. Weighted conviction across holdings. */
export function weightedConviction(holdings) {
  const scored = holdings.filter((h) => h.conviction && h.conviction.score !== null && h.weight > 0);
  if (scored.length === 0) return unavailable('conviction', 'Weighted stock conviction', 'No holding produced a conviction score.');
  const wSum = scored.reduce((s, h) => s + h.weight, 0);
  const score = scored.reduce((s, h) => s + h.weight * h.conviction.score, 0) / wSum;
  const perModel = {};
  for (const id of MODEL_ORDER) {
    const avail = scored.filter((h) => h.results[id]?.available);
    if (!avail.length) {
      perModel[id] = null;
      continue;
    }
    const w = avail.reduce((s, h) => s + h.weight, 0);
    perModel[id] = { score: avail.reduce((s, h) => s + h.weight * h.results[id].subscore, 0) / w, holdings: avail.length };
  }
  const missing = holdings.filter((h) => !h.conviction || h.conviction.score === null);
  return {
    id: 'conviction',
    name: 'Weighted stock conviction',
    available: true,
    subscore: Math.round(score),
    scoringRule: 'Weighted average of each holding\'s conviction score, weights = position size ÷ total.',
    note: 'The single-stock models run on every holding; this is simply those scores combined in proportion to how much of the portfolio each stock is.',
    warning: missing.length ? `${missing.map((h) => h.ticker).join(', ')} produced no score and ${missing.length === 1 ? 'is' : 'are'} excluded (weights rescaled).` : null,
    metrics: { score, perModel, holdingsScored: scored.length, coveredWeight: wSum },
    inputs: scored.map((h) => ({ label: h.ticker, value: `${fmtPct(h.weight)} × ${h.conviction.score}`, source: `${h.conviction.label} conviction` })),
    steps: [
      { label: 'Weights', formula: 'wᵢ = amountᵢ / Σ amounts', calc: scored.map((h) => `${h.ticker} ${fmtPct(h.weight)}`).join(', '), result: `Σ = ${fmtPct(wSum)} scored` },
      { label: 'Weighted conviction', formula: 'C_p = Σ wᵢ·Cᵢ / Σ wᵢ', calc: `(${scored.map((h) => `${h.weight.toFixed(3)}×${h.conviction.score}`).join(' + ')}) / ${wSum.toFixed(3)}`, result: `${Math.round(score)} / 100` },
    ],
    chart: { perModel },
  };
}

/** 2. Bootstrap Monte Carlo of the portfolio over the horizon vs the growth target. */
export async function targetFeasibility(holdings, spyBars, params) {
  const live = holdings.filter((h) => h.weight > 0 && h.bars && h.bars.length > 60);
  if (live.length === 0) return unavailable('target', 'Target feasibility', 'No holding has price history.');
  const dropped = holdings.filter((h) => h.weight > 0 && !(h.bars && h.bars.length > 60)).map((h) => h.ticker);
  const wSum = live.reduce((s, h) => s + h.weight, 0);
  const w = live.map((h) => h.weight / wSum);

  const { dates, closes } = alignCloses(live.map((h) => h.bars), spyBars);
  const n = closes.length;
  const WINDOW = 252;
  const usable = Math.min(WINDOW, dates.length - 1);
  if (usable < 60) return unavailable('target', 'Target feasibility', `Only ${usable} common trading days across holdings; need at least 60.`);
  // Joint daily log-return rows over the common window
  const rows = [];
  for (let t = dates.length - usable; t < dates.length; t++) {
    const row = new Float64Array(n);
    for (let i = 0; i < n; i++) row[i] = Math.log(closes[i][t] / closes[i][t - 1]);
    rows.push(row);
  }
  const H = horizonDays(params.horizon);
  const target = Number(params.targetGrowth) / 100;
  const rng = makeRng(SEED);

  const cum = new Float64Array(PATHS * n);
  const fan = [{ day: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }];
  const scratch = new Float64Array(PATHS);
  const portfolioValue = (p) => {
    let g = 0;
    for (let i = 0; i < n; i++) g += w[i] * (Math.exp(cum[p * n + i]) - 1);
    return g;
  };
  for (let d = 1; d <= H; d++) {
    for (let p = 0; p < PATHS; p++) {
      const row = rows[Math.floor(rng() * rows.length)];
      const base = p * n;
      for (let i = 0; i < n; i++) cum[base + i] += row[i];
    }
    if (d % Math.max(1, Math.round(H / 60)) === 0 || d === H) {
      for (let p = 0; p < PATHS; p++) scratch[p] = portfolioValue(p);
      scratch.sort();
      fan.push({ day: d, p5: percentileSorted(scratch, 5), p25: percentileSorted(scratch, 25), p50: percentileSorted(scratch, 50), p75: percentileSorted(scratch, 75), p95: percentileSorted(scratch, 95) });
    }
    if (d % 21 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const ending = Array.from({ length: PATHS }, (_, p) => portfolioValue(p)).sort((a, b) => a - b);
  const hits = ending.filter((g) => g >= target).length;
  const pTarget = hits / PATHS;
  const median = percentileSorted(ending, 50);
  const p5 = percentileSorted(ending, 5);
  const p95 = percentileSorted(ending, 95);
  const pLoss = ending.filter((g) => g < 0).length / PATHS;

  const lo = percentileSorted(ending, 1);
  const hi = percentileSorted(ending, 99);
  const BINS = 40;
  const width = (hi - lo) / BINS || 1;
  const histogram = Array.from({ length: BINS }, (_, i) => ({ ret: lo + (i + 0.5) * width, from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const g of ending) {
    if (g < lo || g > hi) continue;
    histogram[Math.min(BINS - 1, Math.floor((g - lo) / width))].count++;
  }

  const requiredAnnual = Math.pow(1 + target, 252 / H) - 1;
  // Historical annualized return of the same blend over the window
  let histLog = 0;
  for (const row of rows) for (let i = 0; i < n; i++) histLog += w[i] * row[i];
  const histAnnual = Math.exp((histLog / rows.length) * 252) - 1;
  const subscore = Math.round(pTarget * 100);

  return {
    id: 'target',
    name: 'Target feasibility',
    available: true,
    subscore,
    scoringRule: 'Subscore = 100 × P(portfolio growth ≥ target by the end of the horizon), from 10,000 bootstrap paths.',
    note: 'This replays real historical days for all holdings together, so it keeps their correlations; it asks how often this basket would have met the target over a window of this length.',
    warning: dropped.length ? `${dropped.join(', ')} excluded from the simulation (no price history).` : usable < WINDOW ? `Only ${usable} common trading days were available (a holding listed recently), so the simulation draws from a shorter history.` : null,
    metrics: { pTarget, target, horizonDays: H, horizon: horizonLabel(params.horizon), median, p5, p95, pLoss, requiredAnnual, histAnnual, windowDays: usable, holdingsUsed: live.length, paths: PATHS, seed: SEED },
    inputs: [
      { label: 'Holdings simulated', value: live.map((h, i) => `${h.ticker} ${fmtPct(w[i])}`).join(', '), source: 'Alpaca daily closes' },
      { label: 'Common history window', value: `${usable} trading days (${dates[dates.length - usable]} → ${dates[dates.length - 1]})`, source: 'Intersection of all holdings\' dates' },
      { label: 'Horizon H', value: `${horizonLabel(params.horizon)} = ${H} trading days`, source: 'Your parameters' },
      { label: 'Growth target', value: fmtPct(target, 1), source: 'Your parameters' },
      { label: 'Paths / seed', value: `${PATHS.toLocaleString()} / ${SEED}`, source: 'Fixed, reproducible' },
    ],
    steps: [
      { label: 'Joint return rows', formula: 'r_{i,d} = ln(P_{i,d} / P_{i,d−1}) for every holding on the same day', calc: `${usable} days × ${n} holdings`, result: `${usable} joint rows` },
      { label: 'Bootstrap paths', formula: 'draw H days with replacement; G_i = exp(Σ r_{i,d}) − 1; G_p = Σ wᵢ·G_i', calc: `${PATHS.toLocaleString()} paths × ${H} days`, result: `median G_p = ${fmtPct(median, 1)}, 5th–95th = ${fmtPct(p5, 1)} to ${fmtPct(p95, 1)}` },
      { label: 'Required pace', formula: '(1 + target)^(252/H) − 1', calc: `(1 + ${target.toFixed(3)})^(252/${H}) − 1`, result: `${fmtPct(requiredAnnual, 1)} per year needed vs ${fmtPct(histAnnual, 1)} per year historically` },
      { label: 'Probability of target', formula: 'P = (# paths with G_p ≥ target) / N', calc: `${hits.toLocaleString()} / ${PATHS.toLocaleString()}`, result: `P = ${fmtPct(pTarget, 1)}` },
      { label: 'Subscore', formula: '100 × P', calc: `100 × ${pTarget.toFixed(4)}`, result: `${subscore} / 100` },
    ],
    chart: { fan, histogram, target },
  };
}

/** 3. Portfolio risk: blended volatility, beta, drawdown, correlation, diversification. */
export function portfolioRisk(holdings, spyBars) {
  const live = holdings.filter((h) => h.weight > 0 && h.bars && h.bars.length > 60);
  if (live.length === 0) return unavailable('risk', 'Portfolio risk', 'No holding has price history.');
  const wSum = live.reduce((s, h) => s + h.weight, 0);
  const w = live.map((h) => h.weight / wSum);
  const { dates, closes, spy } = alignCloses(live.map((h) => h.bars), spyBars);
  if (dates.length < 61) return unavailable('risk', 'Portfolio risk', `Only ${dates.length} common trading days; need at least 61.`);
  const n = closes.length;
  const T = dates.length - 1;
  const R = closes.map((c) => Array.from({ length: T }, (_, t) => c[t + 1] / c[t] - 1));
  const Rspy = Array.from({ length: T }, (_, t) => spy[t + 1] / spy[t] - 1);
  const Rp = Array.from({ length: T }, (_, t) => w.reduce((s, wi, i) => s + wi * R[i][t], 0));
  const retDates = dates.slice(1);

  const win = Math.min(252, T);
  const Rp1 = Rp.slice(-win);
  const Rspy1 = Rspy.slice(-win);
  const vol = stdev(Rp1) * Math.sqrt(252);
  const beta = covariance(Rp1, Rspy1) / variance(Rspy1);
  const stockVols = R.map((r) => stdev(r.slice(-win)) * Math.sqrt(252));
  const weightedAvgVol = w.reduce((s, wi, i) => s + wi * stockVols[i], 0);
  const divRatio = vol > 0 ? weightedAvgVol / vol : 1;

  // Correlation matrix over the 1-year window
  const corr = R.map((ri) => R.map((rj) => {
    const a = ri.slice(-win);
    const b = rj.slice(-win);
    return covariance(a, b) / (stdev(a) * stdev(b));
  }));
  let pairSum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    pairSum += corr[i][j];
    pairs++;
  }
  const avgCorr = pairs ? pairSum / pairs : null;

  // Blended value index and drawdown over the full common window
  let V = 1;
  let peak = 1;
  let maxDD = 0;
  let troughDate = retDates[0];
  const curve = [];
  for (let t = 0; t < T; t++) {
    V *= 1 + Rp[t];
    if (V > peak) peak = V;
    const dd = V / peak - 1;
    if (dd < maxDD) {
      maxDD = dd;
      troughDate = retDates[t];
    }
    curve.push({ date: retDates[t], drawdown: dd, value: V });
  }

  const volScore = clamp((100 * (0.6 - vol)) / 0.45, 0, 100);
  const betaScore = clamp(125 - 50 * beta, 0, 100);
  const ddScore = clamp(100 + 125 * maxDD, 0, 100);
  const divScore = clamp((100 * (divRatio - 1)) / 0.5, 0, 100);
  const parts = [volScore, betaScore, ddScore, divScore];
  const subscore = Math.round(parts.reduce((s, x) => s + x, 0) / parts.length);

  return {
    id: 'risk',
    name: 'Portfolio risk',
    available: true,
    subscore,
    scoringRule: 'Average of: volatility score (15%→100, 60%→0), beta score (125 − 50β), drawdown score (100 + 125·MDD), diversification score (DR 1.0→0, DR 1.5→100).',
    note: 'A basket is less risky than its parts only to the extent its holdings do not move together; the diversification ratio and correlation table show how much of that benefit this portfolio actually gets.',
    metrics: { vol, beta, maxDD, troughDate, divRatio, weightedAvgVol, avgCorr, stockVols, tickers: live.map((h) => h.ticker), windowDays: dates.length, volScore, betaScore, ddScore, divScore },
    inputs: [
      { label: 'Holdings', value: live.map((h, i) => `${h.ticker} ${fmtPct(w[i])}`).join(', '), source: 'Alpaca daily closes' },
      { label: 'Common window', value: `${dates.length} trading days (${dates[0]} → ${dates[dates.length - 1]})`, source: 'Intersection of dates' },
      { label: '1-year window', value: `${win} daily returns`, source: 'Used for σ, β, correlations' },
    ],
    steps: [
      { label: 'Portfolio daily return', formula: 'R_p,t = Σ wᵢ R_i,t', calc: `${n} holdings, constant weights`, result: `${T} daily returns` },
      { label: 'Volatility', formula: 'σ_p = stdev(R_p) · √252', calc: `weighted average of holdings\' σ = ${fmtPct(weightedAvgVol)}`, result: `σ_p = ${fmtPct(vol)}` },
      { label: 'Beta vs SPY', formula: 'β_p = cov(R_p, R_SPY) / var(R_SPY)', calc: `${win}-day window`, result: `β_p = ${fmt(beta)}` },
      { label: 'Max drawdown', formula: 'MDD = min_t (V_t / max V − 1)', calc: `trough ${troughDate}`, result: `MDD = ${fmtPct(maxDD)}` },
      { label: 'Diversification ratio', formula: 'DR = Σ wᵢσᵢ / σ_p', calc: `${fmtPct(weightedAvgVol)} / ${fmtPct(vol)}`, result: `DR = ${fmt(divRatio)}${avgCorr !== null ? ` (avg pairwise correlation ${fmt(avgCorr)})` : ''}` },
      { label: 'Component scores', formula: 'vol, beta, drawdown, diversification', calc: `${fmt(volScore, 1)}, ${fmt(betaScore, 1)}, ${fmt(ddScore, 1)}, ${fmt(divScore, 1)}`, result: `${subscore} / 100` },
    ],
    chart: { corr, tickers: live.map((h) => h.ticker), curve },
  };
}

/** Blend the three portfolio results into the portfolio conviction score. */
export function portfolioScore(parts, blend = DEFAULT_BLEND) {
  const entries = [
    ['conviction', 'Stock conviction', parts.conviction],
    ['target', 'Target feasibility', parts.target],
    ['risk', 'Portfolio risk', parts.risk],
  ];
  const included = [];
  const excluded = [];
  let sumW = 0;
  for (const [id, label, r] of entries) {
    const wgt = Number(blend[id]) || 0;
    if (r && r.available && wgt > 0) {
      included.push({ id, label, weight: wgt, subscore: r.subscore });
      sumW += wgt;
    } else excluded.push({ id, label, reason: !r ? 'not run' : !r.available ? r.error : 'weight is 0' });
  }
  if (!sumW) return { score: null, label: 'n/a', breakdown: [], excluded, sumWeights: 0 };
  let total = 0;
  const breakdown = included.map((m) => {
    const normWeight = m.weight / sumW;
    const contribution = normWeight * m.subscore;
    total += contribution;
    return { ...m, normWeight, contribution };
  });
  const score = Math.round(total);
  return { score, label: scoreLabel(score), breakdown, excluded, sumWeights: sumW };
}

export { MODEL_LABELS };
