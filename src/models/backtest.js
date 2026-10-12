// Backtest statistics: did higher scores (computed with only the data available on the as-of date)
// go with better returns afterwards?
//
//   Pearson correlation    r = Σ (xᵢ − x̄)(yᵢ − ȳ) / √( Σ (xᵢ − x̄)² · Σ (yᵢ − ȳ)² )
//   Spearman correlation   ρ = Pearson correlation of the RANKS of x and y (ties get the average rank)
//   Bucket averages        mean forward return and share beating SPY for Low / Neutral / High / Very High
//   Direction hit rate     among non-Neutral names: (score ≥ 60 and beat SPY) or (score < 40 and trailed SPY)

import { mean, fmt, fmtPct } from './_math.js';
import { scoreLabel } from './conviction.js';

export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Ranks with average rank for ties (1-based). */
export function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

export function spearman(xs, ys) {
  return pearson(ranks(xs), ranks(ys));
}

export function describeCorrelation(r) {
  if (!Number.isFinite(r)) return 'could not be measured';
  const a = Math.abs(r);
  const strength = a < 0.1 ? 'essentially no' : a < 0.3 ? 'a weak' : a < 0.5 ? 'a moderate' : 'a strong';
  if (a < 0.1) return 'essentially no relationship';
  return `${strength} ${r > 0 ? 'positive' : 'negative'} relationship`;
}

/**
 * @param rows [{ticker, score, forwardReturn, spyReturn}] with numeric score and forwardReturn
 */
export function backtestStats(rows) {
  const ok = rows.filter((r) => Number.isFinite(r.score) && Number.isFinite(r.forwardReturn));
  if (ok.length < 3) return { n: ok.length, pearson: NaN, spearman: NaN, buckets: [], hitRate: null, steps: [], summary: 'Fewer than three stocks produced both a score and a forward return, so no statistics were computed.' };
  const xs = ok.map((r) => r.score);
  const ys = ok.map((r) => r.forwardReturn);
  const r = pearson(xs, ys);
  const rho = spearman(xs, ys);
  const spyReturns = ok.map((r) => r.spyReturn).filter((v) => Number.isFinite(v));
  const spyAvg = spyReturns.length ? mean(spyReturns) : null;

  const buckets = ['Low', 'Neutral', 'High', 'Very High'].map((label) => {
    const members = ok.filter((x) => scoreLabel(x.score) === label);
    const rets = members.map((x) => x.forwardReturn);
    const beat = members.filter((x) => Number.isFinite(x.spyReturn) && x.forwardReturn > x.spyReturn).length;
    return { label, n: members.length, avgReturn: members.length ? mean(rets) : null, beatSpy: members.length ? beat / members.length : null, tickers: members.map((x) => x.ticker) };
  });

  const decided = ok.filter((x) => (x.score >= 60 || x.score < 40) && Number.isFinite(x.spyReturn));
  const hits = decided.filter((x) => (x.score >= 60 && x.forwardReturn > x.spyReturn) || (x.score < 40 && x.forwardReturn < x.spyReturn)).length;
  const hitRate = decided.length ? hits / decided.length : null;

  const steps = [
    { label: 'Sample', formula: 'stocks with a score and a forward return', calc: ok.map((x) => `${x.ticker} (${x.score}, ${fmtPct(x.forwardReturn, 1)})`).join('; '), result: `n = ${ok.length}` },
    { label: 'Pearson correlation', formula: 'r = Σ(xᵢ−x̄)(yᵢ−ȳ) / √(Σ(xᵢ−x̄)²·Σ(yᵢ−ȳ)²)', calc: 'x = score, y = forward return', result: `r = ${fmt(r, 3)}` },
    { label: 'Spearman correlation', formula: 'ρ = Pearson(rank x, rank y)', calc: 'ranks with ties averaged', result: `ρ = ${fmt(rho, 3)}` },
    ...buckets.filter((b) => b.n > 0).map((b) => ({ label: `${b.label} bucket`, formula: 'mean forward return; share beating SPY', calc: b.tickers.join(', '), result: `${fmtPct(b.avgReturn, 1)} avg; ${fmtPct(b.beatSpy, 0)} beat SPY (n = ${b.n})` })),
    { label: 'Direction hit rate', formula: '(score ≥ 60 and beat SPY) or (score < 40 and trailed SPY), among non-Neutral', calc: `${hits} / ${decided.length}`, result: hitRate === null ? 'n/a' : fmtPct(hitRate, 0) },
  ];

  const hi = buckets.filter((b) => (b.label === 'High' || b.label === 'Very High') && b.n > 0);
  const lo = buckets.find((b) => b.label === 'Low' && b.n > 0);
  const hiAvg = hi.length ? mean(hi.flatMap((b) => Array(b.n).fill(b.avgReturn))) : null;
  const sentences = [
    `Across ${ok.length} stocks scored with only the information available on the as-of date, there was ${describeCorrelation(rho)} between the score and what the stock did next (Spearman ρ = ${fmt(rho, 2)}, Pearson r = ${fmt(r, 2)}).`,
  ];
  if (hiAvg !== null) sentences.push(`High-conviction names averaged ${fmtPct(hiAvg, 1)}${lo ? ` versus ${fmtPct(lo.avgReturn, 1)} for low-conviction names` : ''}${spyAvg !== null ? `, while SPY returned ${fmtPct(spyAvg, 1)} over the same period` : ''}.`);
  if (hitRate !== null) sentences.push(`When the score took a side (High or Low), it pointed the right way relative to SPY ${fmtPct(hitRate, 0)} of the time (${hits} of ${decided.length}).`);
  sentences.push(`With ${ok.length} stocks and a single start date this is a sanity check, not proof: one strong sector move can produce or erase a correlation this size. A model that scored well here should still be judged on many dates.`);

  return { n: ok.length, pearson: r, spearman: rho, buckets, hitRate, hits, decided: decided.length, spyAvg, steps, summary: sentences.join(' ') };
}
