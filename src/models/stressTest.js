// Stress test. Pure functions over price/return series that the page has already fetched.
//
// A. Historical scenarios (actual daily closes, SPY peak to trough), current weights held constant
//    (rebalanced daily):
//      Portfolio daily return   R_t = Σ wᵢ' · R_{i,t}        wᵢ' = weights of covered holdings, re-normalized
//      Value, indexed           V_t = 100 · Π_{u≤t} (1 + R_u),  V_start = 100
//      Total return             R = V_end / 100 − 1
//      Max drawdown             MDD = min_t (V_t / max_{u≤t} V_u − 1) within the scenario
//      Recovery time            trading days after the scenario end until V_t ≥ 100, or "not yet recovered"
//      Holding return           R_i = P_{i,end} / P_{i,start} − 1;  contribution = wᵢ' · R_i
//    Coverage = Σ weights of holdings whose series contains the scenario start and end. Below 50%
//    the scenario is Unavailable — insufficient history. Benchmarks: SPY, and 60/40 = 0.6·R_SPY + 0.4·R_AGG.
//
// B. Hypothetical shocks (model estimates, not historical data):
//      Market shock   est. return_i = βᵢ · shock         (stocks and equity ETFs; βᵢ = cov(rᵢ, r_SPY)/var(r_SPY), last 252 common days)
//      Rate shock     est. return_i = −Dᵢ · Δrate        (bond ETFs and Treasuries; Dᵢ = duration from the asset's own model)
//      Portfolio      est. loss = Σ wᵢ · est. return_i over covered holdings; coverage = Σ wᵢ covered
//
// Returns are price returns (split-adjusted, no dividends) — the same basis as the rest of the app.

import { covariance, variance } from './_math.js';

export const SCENARIOS = [
  { id: 'dotcom', name: 'Dot-com crash', start: '2000-03-24', end: '2002-10-09' },
  { id: 'gfc', name: '2008 Financial Crisis', start: '2007-10-09', end: '2009-03-09' },
  { id: 'q4_2018', name: '2018 Q4 selloff', start: '2018-09-20', end: '2018-12-24' },
  { id: 'covid', name: '2020 COVID crash', start: '2020-02-19', end: '2020-03-23' },
  { id: 'rates_2022', name: '2022 Rate hikes', start: '2022-01-03', end: '2022-10-12' },
];

export const MARKET_SHOCKS = [{ id: 'mkt10', label: 'Market −10%', shock: -0.1 }, { id: 'mkt20', label: 'Market −20%', shock: -0.2 }];
export const RATE_SHOCKS = [{ id: 'rate1', label: 'Rates +1%', delta: 0.01 }, { id: 'rate2', label: 'Rates +2%', delta: 0.02 }];
export const MIN_COVERAGE = 0.5;
export const SHOCK_LABEL = 'Model estimate — not historical data';

/** Does a close series cover [start, end]? Needs a bar on or before `start` and one on or after `end`. */
export function covers(series, start, end) {
  if (!series || series.length < 2) return false;
  return series[0].date <= start && series[series.length - 1].date >= end;
}

/** Index of the last bar whose date is <= d (binary search). -1 if none. */
function lastOnOrBefore(series, d) {
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Value path of one series indexed to 100 at the last close on or before `start`, for all later bars. Returns [{date, value}] (first row is the start, value 100). */
function indexedPath(series, start) {
  const i0 = lastOnOrBefore(series, start);
  if (i0 < 0) return [];
  const base = series[i0].close;
  const out = [{ date: series[i0].date, value: 100 }];
  for (let i = i0 + 1; i < series.length; i++) out.push({ date: series[i].date, value: (series[i].close / base) * 100 });
  return out;
}

/** Portfolio path from several series at constant weights (daily rebalanced), on their common dates. */
function portfolioPath(parts, start) {
  // parts: [{ weight, series }]
  const paths = parts.map((p) => indexedPath(p.series, start));
  if (paths.some((p) => p.length < 2)) return [];
  const maps = paths.map((p) => new Map(p.map((r) => [r.date, r.value])));
  const dates = paths[0].map((r) => r.date).filter((d) => maps.every((m) => m.has(d)));
  if (dates.length < 2) return [];
  const out = [{ date: dates[0], value: 100 }];
  let V = 100;
  for (let t = 1; t < dates.length; t++) {
    let R = 0;
    for (let k = 0; k < parts.length; k++) R += parts[k].weight * (maps[k].get(dates[t]) / maps[k].get(dates[t - 1]) - 1);
    V *= 1 + R;
    out.push({ date: dates[t], value: V });
  }
  return out;
}

function pathStats(path, end) {
  // path starts at the scenario start (value 100). Scenario part = rows with date <= end; the rest is post-scenario.
  const inScen = path.filter((r) => r.date <= end);
  if (inScen.length < 2) return null;
  const endValue = inScen[inScen.length - 1].value;
  let peak = 100;
  let mdd = 0;
  let trough = inScen[0].date;
  for (const r of inScen) {
    if (r.value > peak) peak = r.value;
    const dd = r.value / peak - 1;
    if (dd < mdd) { mdd = dd; trough = r.date; }
  }
  const after = path.filter((r) => r.date > end);
  let recoveryDays = null;
  let recoveryDate = null;
  for (let i = 0; i < after.length; i++) {
    if (after[i].value >= 100) { recoveryDays = i + 1; recoveryDate = after[i].date; break; }
  }
  return { totalReturn: endValue / 100 - 1, maxDrawdown: mdd, trough, endDate: inScen[inScen.length - 1].date, recoveryDays, recoveryDate, daysSinceEnd: after.length, recovered: recoveryDays !== null, scenarioDays: inScen.length - 1 };
}

/**
 * Run one historical scenario.
 * holdings: [{ ticker, weight, series: [{date, close}] | null, firstDate?: string, assetType }]
 * spy, agg: [{date, close}] | null
 */
export function runScenario(scenario, holdings, spy, agg) {
  const { start, end } = scenario;
  const covered = holdings.filter((h) => covers(h.series, start, end));
  const excluded = holdings.filter((h) => !covers(h.series, start, end)).map((h) => ({ ticker: h.ticker, weight: h.weight, firstDate: h.series && h.series.length ? h.series[0].date : null, reason: h.series && h.series.length ? (h.series[0].date > start ? `no data before ${h.series[0].date}` : `data ends ${h.series[h.series.length - 1].date}`) : 'no price history' }));
  const totalW = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  const coverage = covered.reduce((s, h) => s + h.weight, 0) / totalW;
  const base = { scenario, coverage, excluded, coverageText: `Coverage: ${(coverage * 100).toFixed(0)}% of portfolio${excluded.length ? ` — ${excluded.map((e) => e.ticker).join(', ')} excluded (${excluded.map((e) => e.reason).filter((v, i, arr) => arr.indexOf(v) === i).join('; ')})` : ''}` };
  const spyPath = spy && covers(spy, start, end) ? indexedPath(spy, start) : [];
  const spyStats = spyPath.length ? pathStats(spyPath, end) : null;
  const sixtyPath = spy && agg && covers(spy, start, end) && covers(agg, start, end) ? portfolioPath([{ weight: 0.6, series: spy }, { weight: 0.4, series: agg }], start) : [];
  const sixtyStats = sixtyPath.length ? pathStats(sixtyPath, end) : null;
  const benchmarks = {
    spy: spyStats ? { ...spyStats, status: 'ok' } : { status: 'unavailable', reason: spy && spy.length ? `SPY history begins ${spy[0].date}` : 'SPY history unavailable' },
    sixtyForty: sixtyStats ? { ...sixtyStats, status: 'ok' } : { status: 'unavailable', reason: !agg || !agg.length ? 'AGG history unavailable' : !covers(agg, start, end) ? `AGG history begins ${agg[0].date}` : spy && spy.length ? `SPY history begins ${spy[0].date}` : 'SPY history unavailable' },
  };
  if (coverage < MIN_COVERAGE) {
    return { ...base, status: 'unavailable', reason: `Unavailable — insufficient history (${(coverage * 100).toFixed(0)}% of the portfolio has price data for ${start} to ${end})`, benchmarks, chart: [] };
  }
  const wSum = covered.reduce((s, h) => s + h.weight, 0);
  const parts = covered.map((h) => ({ weight: h.weight / wSum, series: h.series, ticker: h.ticker }));
  const path = portfolioPath(parts, start);
  const stats = path.length ? pathStats(path, end) : null;
  if (!stats) return { ...base, status: 'unavailable', reason: 'Unavailable — the covered holdings share fewer than two trading days in the scenario', benchmarks, chart: [] };
  const perHolding = parts.map((p) => {
    const i0 = lastOnOrBefore(p.series, start);
    const i1 = lastOnOrBefore(p.series, end);
    const ret = p.series[i1].close / p.series[i0].close - 1;
    return { ticker: p.ticker, weight: p.weight, ret, contribution: p.weight * ret };
  }).sort((a, b) => a.contribution - b.contribution);
  const worst = perHolding[0] || null;
  const best = perHolding[perHolding.length - 1] || null;
  // Chart: portfolio vs SPY vs 60/40 indexed to 100, scenario window only
  const spyMap = new Map(spyPath.map((r) => [r.date, r.value]));
  const sixtyMap = new Map(sixtyPath.map((r) => [r.date, r.value]));
  const chart = path.filter((r) => r.date <= end).map((r) => ({ date: r.date, portfolio: r.value, spy: spyMap.has(r.date) ? spyMap.get(r.date) : null, sixtyForty: sixtyMap.has(r.date) ? sixtyMap.get(r.date) : null }));
  return { ...base, status: 'ok', ...stats, weightsUsed: parts.map((p) => ({ ticker: p.ticker, weight: p.weight })), perHolding, worst, best, benchmarks, chart };
}

/** Beta of a return series vs SPY over the last `window` common days (same formula as the risk model). */
export function betaVsSpy(returns, spyReturns, window = 252) {
  if (!returns || !spyReturns) return null;
  const m = new Map(spyReturns.map((r) => [r.date, r.ret]));
  const pairs = returns.filter((r) => m.has(r.date)).slice(-window);
  if (pairs.length < 60) return null;
  const x = pairs.map((r) => r.ret);
  const y = pairs.map((r) => m.get(r.date));
  const v = variance(y);
  return v > 0 ? { beta: covariance(x, y) / v, days: pairs.length } : null;
}

/**
 * Hypothetical shocks.
 * holdings: [{ ticker, weight, assetType, beta: number|null, betaDays?, duration: number|null, durationKind?, reason? }]
 * amount: portfolio value in dollars (for the $ figure).
 */
export function runShocks(holdings, amount) {
  const equity = (h) => h.assetType === 'stock' || h.assetType === 'equity_etf';
  const bond = (h) => h.assetType === 'bond_etf' || h.assetType === 'treasury';
  const market = MARKET_SHOCKS.map((s) => {
    const rows = holdings.map((h) => {
      if (!equity(h)) return { ticker: h.ticker, weight: h.weight, status: 'excluded', reason: `${h.assetType === 'bond_etf' ? 'bond ETF' : h.assetType === 'treasury' ? 'Treasury' : h.assetType}: market beta is not applied` };
      if (h.beta === null || h.beta === undefined) return { ticker: h.ticker, weight: h.weight, status: 'unavailable', reason: h.betaReason || 'beta unavailable' };
      const est = h.beta * s.shock;
      return { ticker: h.ticker, weight: h.weight, status: 'ok', input: h.beta, inputLabel: `β ${h.beta.toFixed(2)}`, estReturn: est, contribution: h.weight * est, dollars: amount * h.weight * est, formula: `${h.beta.toFixed(2)} × ${(s.shock * 100).toFixed(0)}% = ${(est * 100).toFixed(1)}%` };
    });
    return finishShock(s.id, s.label, `estimated return = β × ${(s.shock * 100).toFixed(0)}%`, rows, amount);
  });
  const rates = RATE_SHOCKS.map((s) => {
    const rows = holdings.map((h) => {
      if (!bond(h)) return { ticker: h.ticker, weight: h.weight, status: 'excluded', reason: `${h.assetType === 'stock' ? 'stock' : 'equity ETF'}: duration is not applied` };
      if (h.duration === null || h.duration === undefined) return { ticker: h.ticker, weight: h.weight, status: 'unavailable', reason: h.durationReason || 'duration unavailable' };
      const est = -h.duration * s.delta;
      return { ticker: h.ticker, weight: h.weight, status: 'ok', input: h.duration, inputLabel: `D ${h.duration.toFixed(2)}y${h.durationKind ? ` (${h.durationKind})` : ''}`, estReturn: est, contribution: h.weight * est, dollars: amount * h.weight * est, formula: `−${h.duration.toFixed(2)} × ${(s.delta * 100).toFixed(0)}% = ${(est * 100).toFixed(1)}%` };
    });
    return finishShock(s.id, s.label, `estimated price change = −duration × +${(s.delta * 100).toFixed(0)}%`, rows, amount);
  });
  return { market, rates, label: SHOCK_LABEL };
}

function finishShock(id, label, formula, rows, amount) {
  const ok = rows.filter((r) => r.status === 'ok');
  const coverage = ok.reduce((s, r) => s + r.weight, 0);
  const estReturn = ok.reduce((s, r) => s + r.contribution, 0); // share of the whole portfolio
  const excluded = rows.filter((r) => r.status !== 'ok');
  const coverageText = `Coverage: ${(coverage * 100).toFixed(0)}% of portfolio${excluded.length ? ` — ${excluded.map((e) => `${e.ticker} (${e.reason})`).join(', ')}` : ''}`;
  if (!ok.length) return { id, label, formula, status: 'unavailable', reason: 'No holding has the input this shock needs', rows, coverage, coverageText, estReturn: null, dollars: null, worst: null };
  const worst = [...ok].sort((a, b) => a.contribution - b.contribution)[0];
  return { id, label, formula, status: 'ok', rows, coverage, coverageText, estReturn, dollars: amount * estReturn, worst };
}

/** Summary card inputs: worst historical scenario, worst hypothetical shock, most vulnerable holding. */
export function summarize(scenarios, shocks) {
  const okScen = scenarios.filter((s) => s.status === 'ok');
  const worstScenario = okScen.length ? okScen.reduce((w, s) => (s.totalReturn < w.totalReturn ? s : w)) : null;
  const allShocks = [...shocks.market, ...shocks.rates].filter((s) => s.status === 'ok');
  const worstShock = allShocks.length ? allShocks.reduce((w, s) => (s.estReturn < w.estReturn ? s : w)) : null;
  // Most vulnerable holding: largest loss contribution in the worst scenario, else in the worst shock.
  let vulnerable = null;
  if (worstScenario && worstScenario.worst) vulnerable = { ticker: worstScenario.worst.ticker, text: `${(worstScenario.worst.ret * 100).toFixed(1)}% in ${worstScenario.scenario.name}`, value: worstScenario.worst.ret };
  else if (worstShock && worstShock.worst) vulnerable = { ticker: worstShock.worst.ticker, text: `${(worstShock.worst.estReturn * 100).toFixed(1)}% in ${worstShock.label} (estimate)`, value: worstShock.worst.estReturn };
  return { worstScenario, worstShock, vulnerable };
}
