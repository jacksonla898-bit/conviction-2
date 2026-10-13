// Model 4: Momentum / technicals.
//
//   12-1 momentum      M = P[t−21] / P[t−252] − 1      (12-month return skipping the most recent month)
//   Simple moving avg  SMA_n(t) = (1/n) Σ_{k=0}^{n−1} P[t−k]   for n = 50 and 200
//   RSI(14), Wilder    avgGain₀ = mean(gains over first 14), avgLoss₀ = mean(losses over first 14)
//                      avgGainₜ = (avgGainₜ₋₁·13 + gainₜ)/14  (same for loss)
//                      RS = avgGain / avgLoss,   RSI = 100 − 100/(1 + RS)
//
//   Subscore = average of three component scores:
//     momScore = clamp( 50 + 100·M, 0, 100 )              → +50% momentum scores 100, −50% scores 0
//     smaScore = 50·[P > SMA50] + 50·[P > SMA200]          → above both = 100, above one = 50, below both = 0
//     rsiScore = clamp( 100 − 2.5·|RSI − 55|, 0, 100 )     → RSI 55 scores 100; RSI 15 or 95 scores 0 (penalizes overbought/oversold)

import { clamp, smaAt, fmt, fmtPct, unavailable, topDrivers } from './_math.js';
import { SRC, fetched, computed, alpacaInput } from '../lib/provenance.js';

export const ID = 'momentum';
export const NAME = 'Momentum';
export const NOTE = 'Momentum and moving-average position capture trend persistence; RSI flags stretched short-term moves. These describe price behaviour, not business quality.';

export function runMomentum({ bars }) {
  if (!bars || bars.length < 260) return unavailable(ID, NAME, `Need at least 260 daily bars, have ${bars ? bars.length : 0}.`);
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const t = n - 1;
  const P = closes[t];

  const p21 = closes[t - 21];
  const p252 = closes[t - 252];
  const momentum = p21 / p252 - 1;

  const sma50 = smaAt(closes, t, 50);
  const sma200 = smaAt(closes, t, 200);

  // RSI(14) with Wilder smoothing over the full series
  const period = 14;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

  const momScore = clamp(50 + 100 * momentum, 0, 100);
  const aboveSma50 = P > sma50;
  const aboveSma200 = P > sma200;
  const smaScore = (aboveSma50 ? 50 : 0) + (aboveSma200 ? 50 : 0);
  const rsiScore = clamp(100 - 2.5 * Math.abs(rsi - 55), 0, 100);
  const subscore = Math.round((momScore + smaScore + rsiScore) / 3);

  // Chart: last 2 years of price with SMAs
  const start = Math.max(0, n - 504);
  const series = [];
  for (let i = start; i < n; i++) {
    series.push({ date: bars[i].date, close: closes[i], sma50: i + 1 >= 50 ? smaAt(closes, i, 50) : null, sma200: i + 1 >= 200 ? smaAt(closes, i, 200) : null });
  }

  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Average of: momentum score (50 + 100 × 12-1 return), SMA score (50 pts above the 50-day, 50 pts above the 200-day), RSI score (100 − 2.5 × |RSI − 55|).',
    note: NOTE,
    metrics: { price: P, momentum12_1: momentum, sma50, sma200, aboveSma50, aboveSma200, rsi14: rsi, momScore, smaScore, rsiScore, pctFromSma50: P / sma50 - 1, pctFromSma200: P / sma200 - 1 },
    inputs: [
      { label: 'Latest close P', value: `$${fmt(P)} (${bars[t].date})`, source: 'Alpaca IEX bars' },
      { label: 'Close 21 trading days ago', value: `$${fmt(p21)} (${bars[t - 21].date})`, source: 'Alpaca' },
      { label: 'Close 252 trading days ago', value: `$${fmt(p252)} (${bars[t - 252].date})`, source: 'Alpaca' },
      { label: 'RSI period', value: '14 (Wilder smoothing)', source: 'Fixed' },
    ],
    steps: [
      { label: '12-1 momentum', formula: 'M = P[t−21] / P[t−252] − 1', calc: `${fmt(p21)} / ${fmt(p252)} − 1`, result: `M = ${fmtPct(momentum)}` },
      { label: '50-day SMA', formula: 'SMA₅₀ = (1/50) Σ last 50 closes', calc: `price is ${fmtPct(P / sma50 - 1)} ${P >= sma50 ? 'above' : 'below'}`, result: `SMA₅₀ = $${fmt(sma50)}` },
      { label: '200-day SMA', formula: 'SMA₂₀₀ = (1/200) Σ last 200 closes', calc: `price is ${fmtPct(P / sma200 - 1)} ${P >= sma200 ? 'above' : 'below'}`, result: `SMA₂₀₀ = $${fmt(sma200)}` },
      { label: 'RSI(14)', formula: 'RSI = 100 − 100 / (1 + avgGain/avgLoss)', calc: `avgGain ${fmt(avgGain, 3)}, avgLoss ${fmt(avgLoss, 3)}, RS ${Number.isFinite(rs) ? fmt(rs, 3) : '∞'}`, result: `RSI = ${fmt(rsi, 1)}` },
      { label: 'Momentum score', formula: 'clamp(50 + 100·M, 0, 100)', calc: `50 + 100 × ${momentum.toFixed(4)}`, result: fmt(momScore, 1) },
      { label: 'SMA score', formula: '50·[P > SMA₅₀] + 50·[P > SMA₂₀₀]', calc: `${aboveSma50 ? 50 : 0} + ${aboveSma200 ? 50 : 0}`, result: fmt(smaScore, 1) },
      { label: 'RSI score', formula: 'clamp(100 − 2.5·|RSI − 55|, 0, 100)', calc: `100 − 2.5 × |${fmt(rsi, 1)} − 55|`, result: fmt(rsiScore, 1) },
      { label: 'Subscore', formula: '(momScore + smaScore + rsiScore) / 3', calc: `(${fmt(momScore, 1)} + ${fmt(smaScore, 1)} + ${fmt(rsiScore, 1)}) / 3`, result: `${subscore} / 100` },
    ],
    chart: { series },
    keyOutput: `12-1 momentum ${fmtPct(momentum)}; ${aboveSma50 && aboveSma200 ? 'above both SMAs' : aboveSma50 || aboveSma200 ? 'above one SMA' : 'below both SMAs'}; RSI ${fmt(rsi, 0)}`,
    drivers: topDrivers([
      { label: '12-1 month momentum', value: fmtPct(momentum), score: momScore },
      { label: 'Position vs 50/200-day SMA', value: aboveSma50 && aboveSma200 ? 'above both' : aboveSma50 ? 'above 50-day only' : aboveSma200 ? 'above 200-day only' : 'below both', score: smaScore },
      { label: 'RSI (14)', value: fmt(rsi, 1), score: rsiScore },
    ]),
    provenance: (() => {
      const px = alpacaInput(bars);
      const c = (v) => computed(v, [px]);
      return {
        price: fetched(P, SRC.ALPACA, bars[t].date, 'latest daily close, IEX feed'),
        momentum12_1: c(momentum),
        sma50: c(sma50),
        sma200: c(sma200),
        rsi14: c(rsi),
        trend: c(aboveSma50 && aboveSma200),
      };
    })(),
  };
}
