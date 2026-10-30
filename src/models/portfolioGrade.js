// Portfolio Grader. Pure function over already-analysed holdings.
//
//   Portfolio Conviction = 40% Quality + 30% Diversification + 30% Risk   (weights re-normalize if a pillar is unavailable)
//
//   Quality          Q = Σ wᵢ·Sᵢ / Σ wᵢ over holdings with a score Sᵢ (unscored holdings excluded, shown)
//   Diversification  mean of the available component scores:
//     HHI            H = Σ wᵢ²;  score = clamp(100 · (1 − H) / 0.9)                    (one holding → 0; ten equal → 100)
//     Correlation    ρ̄ = mean pairwise correlation of 1-year daily returns;  score = clamp(100 · (1 − ρ̄))
//     Asset mix      H_c = Σ (class weight)² over {stock, equity ETF, bond ETF, Treasury};  score = clamp(100 · (1 − H_c) / 0.75)
//   Risk             mean of the available component scores (portfolio daily return R_t = Σ wᵢ R_{i,t}, constant weights):
//     Volatility     σ = stdev(R, 1y) · √252;        score = clamp(100 · (60% − σ) / 45%)
//     Beta           β = cov(R, R_SPY) / var(R_SPY);  score = clamp(125 − 50β)
//     Max drawdown   MDD over the full window;         score = clamp(100 + 125 · MDD)
//     VaR            VaR₉₅ = −(5th percentile of daily R, 1y);  score = clamp(100 · (1 − VaR₉₅ / 4%))
//     Sharpe         S = (mean(R)·252 − R_f) / σ;      score = clamp(50 + 25 · S)
//   Benchmarks for the chart: SPY, and 60/40 = 0.6·R_SPY + 0.4·R_AGG (daily rebalanced).

import { mean, stdev, covariance, variance, clamp, fmt, fmtPct } from './_math.js';
import { scoreLabel } from './conviction.js';
import { historicalVar95 } from './bondMath.js';

export const PILLAR_WEIGHTS = { quality: 40, diversification: 30, risk: 30 };
export const PILLAR_LABELS = { quality: 'Holding quality', diversification: 'Diversification', risk: 'Risk' };
export const CLASS_LABELS = { stock: 'Stocks', equity_etf: 'Equity ETFs', bond_etf: 'Bond ETFs', treasury: 'Treasuries' };

/** Intersect return series on dates. series: [{date, ret}][] → { dates, matrix: number[][] (one row per series) } */
export function alignReturns(seriesList) {
  const maps = seriesList.map((s) => new Map(s.map((r) => [r.date, r.ret])));
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  return { dates, matrix: maps.map((m) => dates.map((d) => m.get(d))) };
}

function corr(a, b) {
  const sa = stdev(a);
  const sb = stdev(b);
  return sa > 0 && sb > 0 ? covariance(a, b) / (sa * sb) : null;
}

/**
 * @param holdings [{ticker, assetType, weight, score|null, returns:[{date,ret}], name?}] weights sum to 1
 * @param spy [{date,ret}] daily SPY returns; agg [{date,ret}] daily AGG returns (may be null)
 */
export function gradePortfolio({ holdings, spy, agg, rf }) {
  const notes = [];
  const steps = { quality: [], diversification: [], risk: [] };

  // ---- Quality ----
  const scored = holdings.filter((h) => typeof h.score === 'number');
  const unscored = holdings.filter((h) => typeof h.score !== 'number');
  let quality = null;
  if (scored.length) {
    const wq = scored.reduce((s, h) => s + h.weight, 0);
    quality = scored.reduce((s, h) => s + h.weight * h.score, 0) / wq;
    steps.quality.push({ label: 'Weighted holding scores', formula: 'Q = Σ wᵢ·Sᵢ / Σ wᵢ', calc: `(${scored.map((h) => `${(h.weight * 100).toFixed(1)}%×${h.score}`).join(' + ')}) / ${(wq * 100).toFixed(1)}%`, result: `Q = ${quality.toFixed(1)}` });
    if (unscored.length) notes.push(`${unscored.map((h) => h.ticker).join(', ')} had no score and ${unscored.length === 1 ? 'is' : 'are'} excluded from Holding quality (weights rescaled).`);
  } else {
    steps.quality.push({ label: 'Weighted holding scores', formula: 'Q = Σ wᵢ·Sᵢ / Σ wᵢ', calc: 'no holding produced a score', result: 'Unavailable' });
  }

  // ---- Diversification ----
  const divComponents = [];
  const hhi = holdings.reduce((s, h) => s + h.weight * h.weight, 0);
  const hhiScore = clamp((100 * (1 - hhi)) / 0.9, 0, 100);
  divComponents.push({ id: 'hhi', label: 'Concentration (HHI)', value: hhi, text: `HHI ${hhi.toFixed(3)} (${holdings.length} holding${holdings.length === 1 ? '' : 's'})`, score: hhiScore });
  steps.diversification.push({ label: 'Concentration', formula: 'H = Σ wᵢ²; score = clamp(100·(1 − H)/0.9)', calc: `H = ${holdings.map((h) => `${h.weight.toFixed(3)}²`).join(' + ')} = ${hhi.toFixed(4)}`, result: `${hhiScore.toFixed(1)}` });

  const withReturns = holdings.filter((h) => h.returns && h.returns.length > 60);
  let corrMatrix = null;
  let avgCorr = null;
  let corrTickers = [];
  if (withReturns.length >= 2) {
    const { dates, matrix } = alignReturns(withReturns.map((h) => h.returns));
    const win = Math.min(252, dates.length);
    if (win >= 60) {
      const recent = matrix.map((row) => row.slice(-win));
      corrTickers = withReturns.map((h) => h.ticker);
      corrMatrix = recent.map((a) => recent.map((b) => corr(a, b)));
      let sum = 0;
      let n = 0;
      for (let i = 0; i < recent.length; i++) for (let j = i + 1; j < recent.length; j++) if (corrMatrix[i][j] !== null) {
        sum += corrMatrix[i][j];
        n++;
      }
      if (n) {
        avgCorr = sum / n;
        const cs = clamp(100 * (1 - avgCorr), 0, 100);
        divComponents.push({ id: 'corr', label: 'Average pairwise correlation', value: avgCorr, text: `ρ̄ = ${avgCorr.toFixed(2)} over ${win} days`, score: cs });
        steps.diversification.push({ label: 'Correlation', formula: 'ρ̄ = mean of pairwise correlations (1y daily); score = clamp(100·(1 − ρ̄))', calc: `${n} pairs, ${win} common days`, result: `ρ̄ = ${avgCorr.toFixed(3)} → ${cs.toFixed(1)}` });
      }
    } else {
      notes.push(`Correlation unavailable: only ${dates.length} common trading days across holdings (need 60).`);
      steps.diversification.push({ label: 'Correlation', formula: 'ρ̄ = mean of pairwise correlations', calc: `${dates.length} common days`, result: 'Unavailable (excluded)' });
    }
  } else {
    notes.push(withReturns.length === 1 ? 'Correlation unavailable with a single holding (excluded from Diversification).' : 'Correlation unavailable: fewer than two holdings have return history.');
    steps.diversification.push({ label: 'Correlation', formula: 'ρ̄ = mean of pairwise correlations', calc: `${withReturns.length} holding(s) with returns`, result: 'Unavailable (excluded)' });
  }

  const classWeights = {};
  for (const h of holdings) classWeights[h.assetType] = (classWeights[h.assetType] || 0) + h.weight;
  const hhiClass = Object.values(classWeights).reduce((s, w) => s + w * w, 0);
  const mixScore = clamp((100 * (1 - hhiClass)) / 0.75, 0, 100);
  divComponents.push({ id: 'mix', label: 'Asset-class mix', value: hhiClass, text: Object.entries(classWeights).map(([k, w]) => `${CLASS_LABELS[k] || k} ${(w * 100).toFixed(0)}%`).join(', '), score: mixScore });
  steps.diversification.push({ label: 'Asset-class mix', formula: 'H_c = Σ (class weight)²; score = clamp(100·(1 − H_c)/0.75)', calc: `H_c = ${Object.entries(classWeights).map(([k, w]) => `${w.toFixed(2)}²`).join(' + ')} = ${hhiClass.toFixed(3)}`, result: `${mixScore.toFixed(1)}` });
  const diversification = mean(divComponents.map((c) => c.score));
  steps.diversification.push({ label: 'Diversification pillar', formula: 'mean of available component scores', calc: `(${divComponents.map((c) => c.score.toFixed(1)).join(' + ')}) / ${divComponents.length}`, result: `${diversification.toFixed(1)}` });

  // ---- Risk (portfolio return series) ----
  const riskComponents = [];
  let risk = null;
  let charts = { cumulative: [], drawdown: [], window: null };
  let riskMetrics = {};
  if (withReturns.length && spy && spy.length > 60) {
    const wSum = withReturns.reduce((s, h) => s + h.weight, 0);
    const series = [...withReturns.map((h) => h.returns), spy, ...(agg && agg.length ? [agg] : [])];
    const { dates, matrix } = alignReturns(series);
    if (dates.length >= 60) {
      const n = withReturns.length;
      const port = dates.map((_, t) => withReturns.reduce((s, h, i) => s + (h.weight / wSum) * matrix[i][t], 0));
      const spyR = matrix[n];
      const aggR = agg && agg.length ? matrix[n + 1] : null;
      const win = Math.min(252, dates.length);
      const p1 = port.slice(-win);
      const s1 = spyR.slice(-win);
      const vol = stdev(p1) * Math.sqrt(252);
      const beta = variance(s1) > 0 ? covariance(p1, s1) / variance(s1) : null;
      const var95 = historicalVar95(p1);
      const annMean = mean(p1) * 252;
      const sharpe = rf === null || rf === undefined ? null : (annMean - rf) / vol;
      let V = 1;
      let peak = 1;
      let mdd = 0;
      let trough = dates[0];
      const cumulative = [];
      const drawdown = [];
      let Vs = 1;
      let Vb = 1;
      for (let t = 0; t < dates.length; t++) {
        V *= 1 + port[t];
        Vs *= 1 + spyR[t];
        if (aggR) Vb *= 1 + (0.6 * spyR[t] + 0.4 * aggR[t]);
        if (V > peak) peak = V;
        const dd = V / peak - 1;
        if (dd < mdd) {
          mdd = dd;
          trough = dates[t];
        }
        cumulative.push({ date: dates[t], portfolio: (V - 1) * 100, spy: (Vs - 1) * 100, sixtyForty: aggR ? (Vb - 1) * 100 : null });
        drawdown.push({ date: dates[t], drawdown: dd });
      }
      const volScore = clamp((100 * (0.6 - vol)) / 0.45, 0, 100);
      riskComponents.push({ id: 'vol', label: 'Volatility', value: vol, text: fmtPct(vol), score: volScore });
      steps.risk.push({ label: 'Volatility', formula: 'σ = stdev(R_p, 1y)·√252; score = clamp(100·(60% − σ)/45%)', calc: `${win} days`, result: `σ = ${fmtPct(vol)} → ${volScore.toFixed(1)}` });
      if (beta !== null) {
        const bs = clamp(125 - 50 * beta, 0, 100);
        riskComponents.push({ id: 'beta', label: 'Beta vs SPY', value: beta, text: fmt(beta), score: bs });
        steps.risk.push({ label: 'Beta', formula: 'β = cov(R_p, R_SPY)/var(R_SPY); score = clamp(125 − 50β)', calc: `${win} days`, result: `β = ${fmt(beta)} → ${bs.toFixed(1)}` });
      }
      const ds = clamp(100 + 125 * mdd, 0, 100);
      riskComponents.push({ id: 'mdd', label: 'Max drawdown', value: mdd, text: `${fmtPct(mdd)} (trough ${trough})`, score: ds });
      steps.risk.push({ label: 'Max drawdown', formula: 'MDD = min_t(V_t / max V − 1); score = clamp(100 + 125·MDD)', calc: `${dates.length} days, trough ${trough}`, result: `MDD = ${fmtPct(mdd)} → ${ds.toFixed(1)}` });
      if (var95 !== null) {
        const vs = clamp(100 * (1 - var95 / 0.04), 0, 100);
        riskComponents.push({ id: 'var', label: '95% 1-day VaR', value: var95, text: fmtPct(var95, 2), score: vs });
        steps.risk.push({ label: 'Value at risk', formula: 'VaR₉₅ = −(5th percentile of daily R_p); score = clamp(100·(1 − VaR/4%))', calc: `${win} days`, result: `VaR = ${fmtPct(var95, 2)} → ${vs.toFixed(1)}` });
      }
      if (sharpe !== null) {
        const ss = clamp(50 + 25 * sharpe, 0, 100);
        riskComponents.push({ id: 'sharpe', label: 'Sharpe ratio', value: sharpe, text: fmt(sharpe), score: ss });
        steps.risk.push({ label: 'Sharpe', formula: 'S = (mean(R_p)·252 − R_f)/σ; score = clamp(50 + 25·S)', calc: `(${fmtPct(annMean)} − ${fmtPct(rf)}) / ${fmtPct(vol)}`, result: `S = ${fmt(sharpe)} → ${ss.toFixed(1)}` });
      } else {
        notes.push('Sharpe ratio unavailable: no risk-free rate (excluded from Risk).');
      }
      risk = mean(riskComponents.map((c) => c.score));
      steps.risk.push({ label: 'Risk pillar', formula: 'mean of available component scores', calc: `(${riskComponents.map((c) => c.score.toFixed(1)).join(' + ')}) / ${riskComponents.length}`, result: `${risk.toFixed(1)}` });
      riskMetrics = { vol, beta, mdd, trough, var95, sharpe, annMean, window: { from: dates[0], to: dates[dates.length - 1], days: dates.length, oneYear: win }, coveredWeight: wSum, cumReturn: V - 1, spyCumReturn: Vs - 1, sixtyFortyCumReturn: aggR ? Vb - 1 : null };
      charts = { cumulative, drawdown, window: riskMetrics.window };
      if (!aggR) notes.push('60/40 benchmark unavailable: AGG return history could not be loaded.');
      if (wSum < 0.999) notes.push(`${holdings.filter((h) => !(h.returns && h.returns.length > 60)).map((h) => h.ticker).join(', ')} without return history ${holdings.length - withReturns.length === 1 ? 'is' : 'are'} excluded from the Risk pillar (weights rescaled).`);
    } else {
      notes.push(`Risk pillar unavailable: only ${dates.length} common trading days (need 60).`);
    }
  } else {
    notes.push(spy && spy.length > 60 ? 'Risk pillar unavailable: no holding has return history.' : 'Risk pillar unavailable: SPY return history could not be loaded.');
  }

  // ---- Blend ----
  const pillars = { quality, diversification, risk };
  let wTot = 0;
  let total = 0;
  const pillarRows = [];
  for (const [id, w] of Object.entries(PILLAR_WEIGHTS)) {
    const v = pillars[id];
    if (v === null || v === undefined || Number.isNaN(v)) {
      pillarRows.push({ id, label: PILLAR_LABELS[id], weight: w, score: null, normWeight: 0, contribution: 0 });
      continue;
    }
    wTot += w;
    pillarRows.push({ id, label: PILLAR_LABELS[id], weight: w, score: v });
  }
  for (const r of pillarRows) {
    if (r.score === null) continue;
    r.normWeight = r.weight / wTot;
    r.contribution = r.normWeight * r.score;
    total += r.contribution;
  }
  const score = wTot ? Math.round(total) : null;
  if (wTot && wTot < 100) notes.push(`Pillar weights were re-normalized over the available pillars (${pillarRows.filter((r) => r.score !== null).map((r) => `${r.label} ${(r.normWeight * 100).toFixed(0)}%`).join(', ')}).`);

  // ---- Drivers: contribution of every component relative to neutral 50 ----
  const drivers = [];
  const qRow = pillarRows.find((r) => r.id === 'quality');
  if (qRow && qRow.score !== null) {
    const wq = scored.reduce((s, h) => s + h.weight, 0);
    for (const h of scored) drivers.push({ kind: 'holding', label: `${h.ticker} (${h.assetType === 'stock' ? 'stock' : CLASS_LABELS[h.assetType]})`, detail: `score ${h.score}, weight ${(h.weight * 100).toFixed(1)}%`, points: qRow.normWeight * (h.weight / wq) * (h.score - 50) });
  }
  const dRow = pillarRows.find((r) => r.id === 'diversification');
  if (dRow && dRow.score !== null) for (const c of divComponents) drivers.push({ kind: 'diversification', label: c.label, detail: c.text, points: dRow.normWeight * (1 / divComponents.length) * (c.score - 50) });
  const rRow = pillarRows.find((r) => r.id === 'risk');
  if (rRow && rRow.score !== null) for (const c of riskComponents) drivers.push({ kind: 'risk', label: c.label, detail: c.text, points: rRow.normWeight * (1 / riskComponents.length) * (c.score - 50) });
  drivers.sort((a, b) => b.points - a.points);

  return {
    score,
    label: scoreLabel(score),
    pillars: pillarRows,
    components: { diversification: divComponents, risk: riskComponents },
    holdings: holdings.map((h) => ({ ticker: h.ticker, name: h.name || null, assetType: h.assetType, weight: h.weight, score: typeof h.score === 'number' ? h.score : null, error: h.error || null })),
    classWeights,
    corr: corrMatrix ? { tickers: corrTickers, matrix: corrMatrix } : null,
    avgCorr,
    hhi,
    riskMetrics,
    charts,
    drivers,
    notes,
    steps,
    blendStep: { formula: 'score = Σ wₖ·Pₖ / Σ wₖ', calc: pillarRows.filter((r) => r.score !== null).map((r) => `${r.weight}×${r.score.toFixed(1)}`).join(' + ') + ` / ${wTot}`, result: score === null ? 'Unavailable' : `${score} (${scoreLabel(score)})` },
  };
}

/** Parse holdings typed by the user into normalized weights. mode: 'percent' | 'dollars' | 'shares' (shares need prices). */
export function normalizeHoldings(rows, mode, prices = {}) {
  const items = rows.filter((r) => r.ticker && r.ticker.trim() && Number(r.amount) > 0).map((r) => ({ ticker: r.ticker.trim().toUpperCase(), amount: Number(r.amount) }));
  if (!items.length) return { holdings: [], error: 'Enter at least one holding with a positive amount.' };
  if (mode === 'percent') {
    const sum = items.reduce((s, i) => s + i.amount, 0);
    if (Math.abs(sum - 100) > 0.5) return { holdings: [], error: `Weights must add up to 100% (they add up to ${sum.toFixed(1)}%).` };
    return { holdings: items.map((i) => ({ ticker: i.ticker, weight: i.amount / sum, input: `${i.amount}%` })) };
  }
  if (mode === 'dollars') {
    const sum = items.reduce((s, i) => s + i.amount, 0);
    return { holdings: items.map((i) => ({ ticker: i.ticker, weight: i.amount / sum, input: `$${i.amount.toLocaleString()}` })) };
  }
  // shares → needs a price for every ticker
  const missing = items.filter((i) => !(prices[i.ticker] > 0)).map((i) => i.ticker);
  if (missing.length) return { holdings: [], error: `No price for ${missing.join(', ')}, so share counts cannot be converted to weights.` };
  const values = items.map((i) => ({ ...i, value: i.amount * prices[i.ticker] }));
  const sum = values.reduce((s, i) => s + i.value, 0);
  return { holdings: values.map((i) => ({ ticker: i.ticker, weight: i.value / sum, input: `${i.amount} sh × $${prices[i.ticker].toFixed(2)}` })) };
}
