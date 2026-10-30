// Mean-variance optimizer (simple mode). Hand-written: no solver library.
//
//   Inputs:  daily simple returns for each asset over up to 3 years (common dates), risk-free rate R_f
//   μ = mean(daily returns) · 252            annualized expected return (historical)
//   Σ = cov(daily returns) · 252             annualized covariance matrix
//   Portfolio:  return μ_p = wᵀμ,  volatility σ_p = √(wᵀΣw),  Sharpe = (μ_p − R_f) / σ_p
//
//   Constraints: Σ wᵢ = 1,  lo ≤ wᵢ ≤ hi (default 2%–30%),  σ_p ≤ cap(risk level)
//     Conservative ≤ 8%, Moderate ≤ 14%, Aggressive ≤ 22%
//
//   Method: the efficient frontier is traced by maximizing  wᵀμ − λ·wᵀΣw  for a sweep of λ with
//   projected gradient ascent; each step projects back onto {Σw = 1, lo ≤ w ≤ hi} (bisection on a
//   shift τ with w = clip(v − τ, lo, hi)). The chosen portfolio is the frontier point with the highest
//   Sharpe ratio among those with σ_p ≤ cap. If no frontier point meets the cap, the problem is
//   infeasible: the minimum-variance portfolio is shown as the closest feasible alternative.
//   With fewer than 4 assets the 30% ceiling cannot sum to 100%; the ceiling is relaxed to 1/N and this is reported.

import { mean, covariance, variance } from './_math.js';
import { alignReturns } from './portfolioGrade.js';

export const RISK_LEVELS = {
  conservative: { label: 'Conservative', volCap: 0.08 },
  moderate: { label: 'Moderate', volCap: 0.14 },
  aggressive: { label: 'Aggressive', volCap: 0.22 },
};
export const DEFAULT_BOUNDS = { lo: 0.02, hi: 0.3 };
export const DISCLAIMER = 'Optimized on historical data. Past performance does not predict future results.';

/** Project v onto { Σw = 1, lo ≤ w ≤ hi } by bisection on τ: w = clip(v − τ, lo, hi). */
export function projectSimplexBox(v, lo, hi) {
  const n = v.length;
  if (n * lo > 1 + 1e-12 || n * hi < 1 - 1e-12) throw new Error('Bounds make the constraint set empty.');
  let tLo = Math.min(...v) - hi - 1;
  let tHi = Math.max(...v) - lo + 1;
  const sumAt = (t) => v.reduce((s, x) => s + Math.min(hi, Math.max(lo, x - t)), 0);
  for (let i = 0; i < 100; i++) {
    const t = (tLo + tHi) / 2;
    if (sumAt(t) > 1) tLo = t;
    else tHi = t;
  }
  const t = (tLo + tHi) / 2;
  return v.map((x) => Math.min(hi, Math.max(lo, x - t)));
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const matVec = (M, w) => M.map((row) => dot(row, w));
export const portVol = (w, S) => Math.sqrt(Math.max(0, dot(w, matVec(S, w))));
export const portRet = (w, mu) => dot(w, mu);

/** Maximize wᵀμ − λ·wᵀΣw with projected gradient ascent. */
export function solveLambda(mu, S, lambda, lo, hi, w0) {
  const n = mu.length;
  let w = w0 ? [...w0] : projectSimplexBox(new Array(n).fill(1 / n), lo, hi);
  const trace = S.reduce((s, row, i) => s + row[i], 0);
  const step = 1 / (2 * lambda * Math.max(trace, 1e-6) + Math.max(...mu.map(Math.abs)) + 1e-6);
  let prev = -Infinity;
  for (let it = 0; it < 4000; it++) {
    const grad = mu.map((m, i) => m - 2 * lambda * matVec(S, w)[i]);
    const next = projectSimplexBox(w.map((x, i) => x + step * grad[i]), lo, hi);
    const obj = portRet(next, mu) - lambda * dot(next, matVec(S, next));
    const moved = next.reduce((s, x, i) => s + Math.abs(x - w[i]), 0);
    w = next;
    if (moved < 1e-9 && obj - prev < 1e-12) break;
    prev = obj;
  }
  return w;
}

/**
 * @param assets [{ticker, returns:[{date,ret}], price}]  price per unit (Treasury: 100 = par)
 * @param rf risk-free rate (decimal)
 * @param riskLevel 'conservative' | 'moderate' | 'aggressive'
 * @param amount dollars to invest
 */
export function optimize({ assets, rf, riskLevel, amount, bounds = DEFAULT_BOUNDS }) {
  const level = RISK_LEVELS[riskLevel] || RISK_LEVELS.moderate;
  const usable = assets.filter((a) => a.returns && a.returns.length > 120);
  const dropped = assets.filter((a) => !(a.returns && a.returns.length > 120)).map((a) => a.ticker);
  const notes = [];
  if (dropped.length) notes.push(`${dropped.join(', ')} excluded: fewer than 120 days of return history.`);
  if (usable.length < 2) return { ok: false, error: 'At least two assets with return history are needed.', notes };

  const { dates, matrix } = alignReturns(usable.map((a) => a.returns));
  if (dates.length < 120) return { ok: false, error: `Only ${dates.length} common trading days across the assets (need 120).`, notes };
  const n = usable.length;
  const mu = matrix.map((r) => mean(r) * 252);
  const S = matrix.map((a) => matrix.map((b) => covariance(a, b) * 252));
  const assetVols = matrix.map((r) => Math.sqrt(variance(r) * 252));

  let { lo, hi } = bounds;
  let boundsNote = null;
  if (n * hi < 1) {
    hi = 1 / n;
    boundsNote = `With ${n} assets the ${(bounds.hi * 100).toFixed(0)}% ceiling cannot reach 100%; the ceiling was relaxed to ${(hi * 100).toFixed(1)}% (equal weight is the only feasible portfolio).`;
    notes.push(boundsNote);
  }
  if (n * lo > 1) {
    lo = 1 / n;
    notes.push(`With ${n} assets the ${(bounds.lo * 100).toFixed(0)}% floor exceeds 100%; the floor was relaxed to ${(lo * 100).toFixed(1)}%.`);
  }

  // Frontier: sweep λ from very risk-tolerant to minimum variance
  const lambdas = [0.25, 0.5, 1, 2, 3, 5, 8, 12, 20, 35, 60, 100, 200, 500, 2000, 10000];
  const frontier = [];
  let w = null;
  for (const lambda of lambdas) {
    w = solveLambda(mu, S, lambda, lo, hi, w);
    const vol = portVol(w, S);
    const ret = portRet(w, mu);
    frontier.push({ lambda, w: [...w], vol, ret, sharpe: vol > 0 ? (ret - rf) / vol : null });
  }
  frontier.sort((a, b) => a.vol - b.vol);
  const minVar = frontier[0];
  const feasible = frontier.filter((p) => p.vol <= level.volCap + 1e-9);
  let chosen;
  let infeasible = false;
  if (feasible.length) {
    chosen = feasible.reduce((best, p) => (p.sharpe > best.sharpe ? p : best), feasible[0]);
    // The Sharpe ratio rises along the frontier up to the tangency point. If the cap cuts the frontier
    // before that point, the constrained optimum sits exactly at the cap, between two grid points:
    // bisect λ between the last feasible and first infeasible grid points to land on σ = cap.
    const bestOverall = frontier.reduce((best, p) => (p.sharpe > best.sharpe ? p : best), frontier[0]);
    if (bestOverall.vol > level.volCap + 1e-9) {
      const idx = frontier.indexOf(chosen);
      const above = frontier.slice(idx + 1).find((p) => p.vol > level.volCap);
      if (above) {
        let loL = Math.max(chosen.lambda, above.lambda); // larger λ → lower vol
        let hiL = Math.min(chosen.lambda, above.lambda);
        let wb = [...chosen.w];
        for (let it = 0; it < 30; it++) {
          const mid = Math.sqrt(loL * hiL);
          wb = solveLambda(mu, S, mid, lo, hi, wb);
          const v = portVol(wb, S);
          if (v > level.volCap) hiL = mid; else loL = mid; // too volatile → need larger λ
          const r = portRet(wb, mu);
          if (v <= level.volCap + 1e-9 && (r - rf) / v > chosen.sharpe) chosen = { lambda: mid, w: [...wb], vol: v, ret: r, sharpe: (r - rf) / v };
          if (Math.abs(v - level.volCap) < 1e-4) break;
        }
      }
    }
  } else {
    infeasible = true;
    chosen = minVar;
    notes.push(`No portfolio within the bounds has volatility at or below the ${level.label} ceiling of ${(level.volCap * 100).toFixed(0)}%; the lowest-volatility portfolio (${(minVar.vol * 100).toFixed(1)}%) is shown as the closest feasible alternative.`);
  }

  // Equal-weight reference ("before")
  const wEq = new Array(n).fill(1 / n);
  const equal = { w: wEq, vol: portVol(wEq, S), ret: portRet(wEq, mu) };
  equal.sharpe = equal.vol > 0 ? (equal.ret - rf) / equal.vol : null;

  // Dollar allocation and whole shares
  const alloc = usable.map((a, i) => {
    const dollars = amount * chosen.w[i];
    const unit = a.price > 0 ? a.price : null;
    const shares = unit ? Math.floor(dollars / unit) : null;
    return { ticker: a.ticker, weight: chosen.w[i], dollars, price: unit, shares, invested: shares !== null ? shares * unit : null, expectedReturn: mu[i], vol: assetVols[i] };
  });
  const investedTotal = alloc.reduce((s, a) => s + (a.invested || 0), 0);
  const leftover = amount - investedTotal;

  return {
    ok: true,
    level,
    bounds: { lo, hi, requested: bounds },
    window: { from: dates[0], to: dates[dates.length - 1], days: dates.length },
    tickers: usable.map((a) => a.ticker),
    mu,
    sigma: S,
    assetVols,
    frontier: frontier.map((p) => ({ vol: p.vol, ret: p.ret, sharpe: p.sharpe, lambda: p.lambda })),
    chosen: { w: chosen.w, vol: chosen.vol, ret: chosen.ret, sharpe: chosen.sharpe, lambda: chosen.lambda },
    equal,
    minVar: { vol: minVar.vol, ret: minVar.ret },
    infeasible,
    alloc,
    investedTotal,
    leftover,
    amount,
    rf,
    notes,
    disclaimer: DISCLAIMER,
    steps: [
      { label: 'Inputs', formula: 'daily simple returns on common dates', calc: `${n} assets × ${dates.length} days (${dates[0]} → ${dates[dates.length - 1]})`, result: 'μ, Σ annualized ×252' },
      { label: 'Objective', formula: 'maximize Sharpe = (wᵀμ − R_f) / √(wᵀΣw)', calc: `R_f = ${(rf * 100).toFixed(2)}%`, result: 'via frontier sweep of λ' },
      { label: 'Constraints', formula: `Σw = 1; ${(lo * 100).toFixed(0)}% ≤ wᵢ ≤ ${(hi * 100).toFixed(0)}%; σ_p ≤ ${(level.volCap * 100).toFixed(0)}%`, calc: `${level.label}`, result: infeasible ? 'infeasible: closest shown' : 'satisfied' },
      { label: 'Frontier', formula: 'for each λ: max wᵀμ − λ·wᵀΣw (projected gradient)', calc: `${lambdas.length} values of λ, then bisection on λ to the volatility cap when it binds`, result: `σ from ${(minVar.vol * 100).toFixed(1)}% to ${(frontier[frontier.length - 1].vol * 100).toFixed(1)}%` },
      { label: 'Chosen portfolio', formula: 'argmax Sharpe subject to σ_p ≤ cap', calc: `σ = ${(chosen.vol * 100).toFixed(1)}%, μ = ${(chosen.ret * 100).toFixed(1)}%`, result: `Sharpe ${chosen.sharpe === null ? 'n/a' : chosen.sharpe.toFixed(2)}` },
      { label: 'Shares', formula: 'sharesᵢ = floor(amount · wᵢ / priceᵢ); leftover = amount − Σ sharesᵢ·priceᵢ', calc: `$${amount.toLocaleString()}`, result: `invested $${investedTotal.toFixed(2)}, leftover $${leftover.toFixed(2)}` },
    ],
  };
}
