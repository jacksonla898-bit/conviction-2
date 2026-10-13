// Model 3: Risk.
//
//   Daily log returns over the last 252 trading days for the stock (r) and SPY (mkt):
//   Annualized volatility     σ = stdev(r) · √252
//   Beta vs SPY               β = cov(r, mkt) / var(mkt)
//   Sharpe ratio              Sharpe = (R̄ − R_f) / σ,   R̄ = mean(r)·252 (annualized mean log return), R_f = user's risk-free rate
//   Max drawdown (5 years)    MDD = min over t of ( P_t / max_{u≤t} P_u − 1 )
//   Rolling 60-day beta       β₆₀(t) = cov(r[t−59..t], mkt[t−59..t]) / var(mkt[t−59..t])
//
//   Subscore = average of the available component scores (each 0–100):
//     volScore    = clamp( 100 × (60% − σ) / 45%, 0, 100 )      → σ = 15% scores 100, σ = 60% scores 0
//     betaScore   = clamp( 125 − 50·β, 0, 100 )                   → β = 0.5 scores 100, β = 1.0 scores 75, β = 2.5 scores 0
//     sharpeScore = clamp( 50 + 25·Sharpe, 0, 100 )               → Sharpe 0 scores 50, Sharpe 2 scores 100 (skipped if no risk-free rate)
//     ddScore     = clamp( 100 + 125·MDD, 0, 100 )                → MDD −20% scores 75, MDD −80% scores 0

import { logReturns, mean, stdev, covariance, variance, clamp, fmt, fmtPct, unavailable, topDrivers } from './_math.js';
import { computed, missing, alpacaInput, settingInput } from '../lib/provenance.js';

export const ID = 'risk';
export const NAME = 'Risk';
export const NOTE = 'Volatility, beta, Sharpe and drawdown describe how bumpy the ride has been and how much of that bumpiness tracks the market; they say nothing about whether the price is right.';

/** Align two bar arrays by date and return matched close arrays. */
function alignByDate(a, b) {
  const map = new Map(b.map((x) => [x.date, x.close]));
  const outA = [];
  const outB = [];
  const dates = [];
  for (const x of a) {
    if (map.has(x.date)) {
      outA.push(x.close);
      outB.push(map.get(x.date));
      dates.push(x.date);
    }
  }
  return { a: outA, b: outB, dates };
}

export function runRisk({ bars, spyBars }, settings) {
  if (!bars || bars.length < 260) return unavailable(ID, NAME, `Need at least 260 daily bars, have ${bars ? bars.length : 0}.`);
  if (!spyBars || spyBars.length < 260) return unavailable(ID, NAME, 'SPY history unavailable, cannot compute beta.');

  const rfRaw = settings?.riskFreeRate;
  const rf = rfRaw === '' || rfRaw === null || rfRaw === undefined ? null : Number(rfRaw) / 100;

  const { a: closes, b: spyCloses, dates } = alignByDate(bars, spyBars);
  if (closes.length < 260) return unavailable(ID, NAME, 'Fewer than 260 overlapping trading days between the stock and SPY.');

  const r = logReturns(closes);
  const mkt = logReturns(spyCloses);
  const retDates = dates.slice(1);

  // One-year window
  const r1 = r.slice(-252);
  const m1 = mkt.slice(-252);
  const dailyVol = stdev(r1);
  const annualVol = dailyVol * Math.sqrt(252);
  const covRM = covariance(r1, m1);
  const varM = variance(m1);
  const beta = covRM / varM;
  const annualMean = mean(r1) * 252;
  const sharpe = rf === null ? null : (annualMean - rf) / annualVol;

  // Max drawdown over the full window
  let peak = closes[0];
  let maxDD = 0;
  let troughDate = dates[0];
  let peakDate = dates[0];
  let curPeakDate = dates[0];
  const drawdown = [];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peak) {
      peak = closes[i];
      curPeakDate = dates[i];
    }
    const dd = closes[i] / peak - 1;
    if (dd < maxDD) {
      maxDD = dd;
      troughDate = dates[i];
      peakDate = curPeakDate;
    }
    drawdown.push({ date: dates[i], drawdown: dd });
  }

  // Rolling 60-day beta
  const W = 60;
  const rollingBeta = [];
  for (let i = W - 1; i < r.length; i++) {
    const rs = r.slice(i - W + 1, i + 1);
    const ms = mkt.slice(i - W + 1, i + 1);
    const v = variance(ms);
    rollingBeta.push({ date: retDates[i], beta: v > 0 ? covariance(rs, ms) / v : null });
  }

  const volScore = clamp((100 * (0.6 - annualVol)) / 0.45, 0, 100);
  const betaScore = clamp(125 - 50 * beta, 0, 100);
  const sharpeScore = sharpe === null ? null : clamp(50 + 25 * sharpe, 0, 100);
  const ddScore = clamp(100 + 125 * maxDD, 0, 100);
  const parts = [volScore, betaScore, ddScore];
  if (sharpeScore !== null) parts.push(sharpeScore);
  const subscore = Math.round(parts.reduce((s, x) => s + x, 0) / parts.length);

  const steps = [
    { label: 'Annualized volatility', formula: 'σ = stdev(daily log returns) · √252', calc: `${(dailyVol * 100).toFixed(3)}% × 15.875`, result: `σ = ${fmtPct(annualVol)}` },
    { label: 'Beta vs SPY', formula: 'β = cov(r, mkt) / var(mkt)', calc: `${covRM.toExponential(3)} / ${varM.toExponential(3)}`, result: `β = ${fmt(beta)}` },
    sharpe === null
      ? { label: 'Sharpe ratio', formula: 'Sharpe = (R̄ − R_f) / σ', calc: 'Risk-free rate not entered in Settings', result: 'skipped' }
      : { label: 'Sharpe ratio', formula: 'Sharpe = (R̄ − R_f) / σ', calc: `(${fmtPct(annualMean)} − ${fmtPct(rf)}) / ${fmtPct(annualVol)}`, result: `Sharpe = ${fmt(sharpe)}` },
    { label: 'Max drawdown (5y)', formula: 'MDD = min_t ( P_t / max_{u≤t} P_u − 1 )', calc: `peak ${peakDate} → trough ${troughDate}`, result: `MDD = ${fmtPct(maxDD)}` },
    { label: 'Volatility score', formula: 'clamp(100 × (60% − σ) / 45%, 0, 100)', calc: `100 × (0.60 − ${annualVol.toFixed(4)}) / 0.45`, result: fmt(volScore, 1) },
    { label: 'Beta score', formula: 'clamp(125 − 50·β, 0, 100)', calc: `125 − 50 × ${fmt(beta)}`, result: fmt(betaScore, 1) },
    sharpeScore === null
      ? { label: 'Sharpe score', formula: 'clamp(50 + 25·Sharpe, 0, 100)', calc: 'skipped (no risk-free rate)', result: 'excluded' }
      : { label: 'Sharpe score', formula: 'clamp(50 + 25·Sharpe, 0, 100)', calc: `50 + 25 × ${fmt(sharpe)}`, result: fmt(sharpeScore, 1) },
    { label: 'Drawdown score', formula: 'clamp(100 + 125·MDD, 0, 100)', calc: `100 + 125 × (${maxDD.toFixed(4)})`, result: fmt(ddScore, 1) },
    { label: 'Subscore', formula: 'average of component scores', calc: `(${parts.map((p) => p.toFixed(1)).join(' + ')}) / ${parts.length}`, result: `${subscore} / 100` },
  ];

  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Average of: volatility score (15%→100, 60%→0), beta score (125 − 50β), Sharpe score (50 + 25·Sharpe, only if a risk-free rate is set), drawdown score (100 + 125·MDD).',
    note: NOTE,
    warning: rf === null ? 'Sharpe ratio skipped: no risk-free rate available (see Settings).' : null,
    metrics: { annualVol, beta, sharpe, annualMean, maxDD, peakDate, troughDate, riskFreeRate: rf, volScore, betaScore, sharpeScore, ddScore },
    inputs: [
      { label: 'Stock daily closes', value: `${closes.length} days (${dates[0]} → ${dates[dates.length - 1]})`, source: 'Alpaca IEX bars, split-adjusted' },
      { label: 'SPY daily closes', value: `${spyCloses.length} days, aligned by date`, source: 'Alpaca IEX bars' },
      { label: '1-year window', value: `${r1.length} daily returns`, source: 'Used for σ, β, Sharpe' },
      { label: 'Risk-free rate R_f', value: rf === null ? 'not set' : fmtPct(rf, 2), source: settings?.riskFreeSource || 'Settings (3-month T-bill yield)' },
    ],
    steps,
    chart: { drawdown, rollingBeta },
    keyOutput: `Volatility ${fmtPct(annualVol)}; beta ${fmt(beta)}; max drawdown ${fmtPct(maxDD)}`,
    drivers: topDrivers([
      { label: 'Annual volatility', value: fmtPct(annualVol), score: volScore },
      { label: 'Beta vs SPY', value: fmt(beta), score: betaScore },
      { label: 'Max drawdown (5y)', value: fmtPct(maxDD), score: ddScore },
      ...(sharpeScore === null ? [] : [{ label: 'Sharpe ratio', value: fmt(sharpe), score: sharpeScore }]),
    ]),
    provenance: (() => {
      const px = alpacaInput(bars);
      const spx = alpacaInput(spyBars, 'SPY daily closes');
      const rfP = settings?.riskFreeProv || settingInput('risk-free rate');
      return {
        annualVol: computed(annualVol, [px]),
        beta: computed(beta, [px, spx]),
        sharpe: sharpe === null ? missing('No risk-free rate available (Treasury lookup failed and none entered in Settings).') : computed(sharpe, [px, rfP]),
        maxDD: computed(maxDD, [px]),
        annualMean: computed(annualMean, [px]),
        troughDate: computed(troughDate, [px]),
      };
    })(),
  };
}
