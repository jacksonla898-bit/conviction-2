// Bond mathematics used by the Treasury and bond-ETF models. Hand-written, no libraries.
//
//   Par bond, semiannual coupons, yield y (decimal), maturity T years, n = 2T periods, c = y/2:
//     Macaulay duration (years)  D_mac = [ (1 + c)/c · (1 − (1 + c)^(−n)) ] / 2
//     Modified duration (years)  D_mod = D_mac / (1 + c)
//   Daily total return of a constant-maturity Treasury position, approximated from its yield series:
//     r_t ≈ −D_mod(y_{t−1}) · Δy_t + y_{t−1} / 252        (Δy in decimal; the first term is the price change
//                                                        for a small yield move, the second is one day of carry)
//   Empirical duration of a bond fund from its own returns (regression):
//     D_emp = −cov(r_fund, Δy_10) / var(Δy_10)             (slope of fund returns on 10-year yield changes)
//   95% one-day historical VaR of a return series:
//     VaR_95 = −(5th percentile of daily returns)

import { covariance, variance, percentileSorted } from './_math.js';

export function parBondDuration(yieldDecimal, tenorYears) {
  const y = Math.max(yieldDecimal, 1e-6);
  const c = y / 2;
  const n = 2 * tenorYears;
  const mac = ((1 + c) / c) * (1 - Math.pow(1 + c, -n)) / 2;
  return { macaulay: mac, modified: mac / (1 + c) };
}

/**
 * Approximate daily returns of a constant-maturity Treasury from its yield history.
 * yields: [{date, value}] with value in PERCENT (as FRED reports). Returns [{date, ret}] (decimal).
 */
export function treasuryReturnsFromYields(yields, tenorYears) {
  const out = [];
  for (let i = 1; i < yields.length; i++) {
    const yPrev = yields[i - 1].value / 100;
    const yNow = yields[i].value / 100;
    const dMod = parBondDuration(yPrev, tenorYears).modified;
    out.push({ date: yields[i].date, ret: -dMod * (yNow - yPrev) + yPrev / 252 });
  }
  return out;
}

/** Empirical duration: fund daily returns regressed on daily changes in the 10-year yield (decimal). */
export function empiricalDuration(fundReturns, yieldChanges) {
  const n = Math.min(fundReturns.length, yieldChanges.length);
  if (n < 60) return null;
  const a = fundReturns.slice(-n);
  const b = yieldChanges.slice(-n);
  const v = variance(b);
  if (!(v > 0)) return null;
  return -covariance(a, b) / v;
}

/** 95% one-day historical VaR (positive number = loss) from daily returns. */
export function historicalVar95(returns) {
  if (returns.length < 60) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  return -percentileSorted(sorted, 5);
}

/** Nearest Treasury tenor (years) to a duration, from the tenors available. */
export function nearestTenor(duration, tenors) {
  let best = tenors[0];
  for (const t of tenors) if (Math.abs(t - duration) < Math.abs(best - duration)) best = t;
  return best;
}
