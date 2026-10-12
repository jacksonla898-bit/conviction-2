// Model 1: Monte Carlo simulation of the stock price with geometric Brownian motion (GBM).
//
//   Inputs: last 252 daily log returns  rᵢ = ln(Pᵢ / Pᵢ₋₁)
//   m = mean(rᵢ)            (mean daily log return)
//   s = stdev(rᵢ)           (daily volatility, sample standard deviation)
//   σ = s·√252              (annualized volatility)
//   μ = m·252 + σ²/2        (annualized GBM drift that reproduces the observed mean log return)
//
//   GBM step (Δt = 1/252):  S_{t+1} = S_t · exp( (μ − σ²/2)·Δt + σ·√Δt·Z ),  Z ~ N(0,1)
//   which simplifies to     S_{t+1} = S_t · exp( m + s·Z )
//
//   10,000 paths × 252 trading days. Reported: P(S_T > S_0), percentile fan, ending-price histogram.
//   Subscore = 100 × P(S_T > S_0)   (probability of finishing above today's price, as a 0–100 score)

import { logReturns, mean, stdev, percentileSorted, makeRng, makeNormal, fmt, fmtPct, unavailable } from './_math.js';

export const ID = 'monteCarlo';
export const NAME = 'Monte Carlo';
export const NOTE = 'Monte Carlo GBM projects a range of plausible future prices from the stock\'s own recent drift and volatility; it measures dispersion and odds, not fundamental value.';

const PATHS = 10000;
const DAYS = 252;
const SEED = 20260101;

export async function runMonteCarlo({ bars }) {
  if (!bars || bars.length < 260) return unavailable(ID, NAME, `Need at least 260 daily bars, have ${bars ? bars.length : 0}.`);

  const closes = bars.map((b) => b.close);
  const window = closes.slice(-(DAYS + 1)); // 253 closes -> 252 log returns
  const r = logReturns(window);
  const m = mean(r);
  const s = stdev(r);
  const sigmaAnnual = s * Math.sqrt(252);
  const muAnnual = m * 252 + (sigmaAnnual * sigmaAnnual) / 2;
  const S0 = closes[closes.length - 1];
  const lastDate = bars[bars.length - 1].date;

  const rng = makeRng(SEED);
  const normal = makeNormal(rng);

  const prices = new Float64Array(PATHS).fill(S0);
  const fan = [{ day: 0, p5: S0, p25: S0, p50: S0, p75: S0, p95: S0 }];
  const scratch = new Float64Array(PATHS);

  for (let d = 1; d <= DAYS; d++) {
    for (let p = 0; p < PATHS; p++) {
      // S_{t+1} = S_t · exp(m + s·Z)
      prices[p] *= Math.exp(m + s * normal());
    }
    scratch.set(prices);
    scratch.sort();
    fan.push({
      day: d,
      p5: percentileSorted(scratch, 5),
      p25: percentileSorted(scratch, 25),
      p50: percentileSorted(scratch, 50),
      p75: percentileSorted(scratch, 75),
      p95: percentileSorted(scratch, 95),
    });
    if (d % 42 === 0) await new Promise((resolve) => setTimeout(resolve, 0)); // keep the UI responsive
  }

  // Ending-price statistics
  const ending = Array.from(prices).sort((a, b) => a - b);
  let above = 0;
  for (const v of ending) if (v > S0) above++;
  const pAbove = above / PATHS;
  const median = percentileSorted(ending, 50);
  const meanEnd = mean(ending);
  const p5 = percentileSorted(ending, 5);
  const p95 = percentileSorted(ending, 95);

  // Histogram of ending prices (40 bins between the 1st and 99th percentile to keep the tails readable)
  const lo = percentileSorted(ending, 1);
  const hi = percentileSorted(ending, 99);
  const BINS = 40;
  const width = (hi - lo) / BINS || 1;
  const histogram = Array.from({ length: BINS }, (_, i) => ({ price: lo + (i + 0.5) * width, count: 0, from: lo + i * width, to: lo + (i + 1) * width }));
  for (const v of ending) {
    if (v < lo || v > hi) continue;
    const idx = Math.min(BINS - 1, Math.floor((v - lo) / width));
    histogram[idx].count++;
  }

  const subscore = Math.round(pAbove * 100);

  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Subscore = 100 × P(ending price > current price). 50 means a coin flip; higher means the simulated drift favors gains.',
    note: NOTE,
    metrics: {
      currentPrice: S0,
      meanDailyLogReturn: m,
      dailyVol: s,
      annualVol: sigmaAnnual,
      annualDrift: muAnnual,
      pAbove,
      medianEnd: median,
      meanEnd,
      p5End: p5,
      p95End: p95,
      medianReturn: median / S0 - 1,
      paths: PATHS,
      days: DAYS,
      seed: SEED,
    },
    inputs: [
      { label: 'Current price S₀', value: `$${fmt(S0)}`, source: `Alpaca close on ${lastDate}` },
      { label: 'Daily log returns used', value: `${r.length}`, source: `Alpaca bars ${window.length} closes ending ${lastDate}` },
      { label: 'Paths × days', value: `${PATHS.toLocaleString()} × ${DAYS}`, source: 'Fixed' },
      { label: 'Random seed', value: String(SEED), source: 'Fixed (mulberry32 + Box–Muller), so runs are reproducible' },
    ],
    steps: [
      { label: 'Mean daily log return', formula: 'm = (1/n) Σ ln(Pᵢ/Pᵢ₋₁)', calc: `n = ${r.length}`, result: `m = ${(m * 100).toFixed(4)}% per day` },
      { label: 'Daily volatility', formula: 's = √[ (1/(n−1)) Σ (rᵢ − m)² ]', calc: `sample standard deviation over ${r.length} returns`, result: `s = ${(s * 100).toFixed(3)}% per day` },
      { label: 'Annualized volatility', formula: 'σ = s · √252', calc: `${(s * 100).toFixed(3)}% × ${Math.sqrt(252).toFixed(3)}`, result: `σ = ${fmtPct(sigmaAnnual)}` },
      { label: 'Annualized drift', formula: 'μ = m·252 + σ²/2', calc: `${(m * 100).toFixed(4)}% × 252 + (${fmtPct(sigmaAnnual)})²/2`, result: `μ = ${fmtPct(muAnnual)}` },
      { label: 'Simulate', formula: 'S_{t+1} = S_t · exp((μ − σ²/2)/252 + σ·√(1/252)·Z) = S_t · exp(m + s·Z)', calc: `${PATHS.toLocaleString()} paths, ${DAYS} steps, Z ~ N(0,1)`, result: `median S_T = $${fmt(median)}, 5th–95th pct = $${fmt(p5)} – $${fmt(p95)}` },
      { label: 'Probability above current price', formula: 'P = (# paths with S_T > S₀) / N', calc: `${above.toLocaleString()} / ${PATHS.toLocaleString()}`, result: `P = ${fmtPct(pAbove)}` },
      { label: 'Subscore', formula: 'score = 100 × P', calc: `100 × ${pAbove.toFixed(4)}`, result: `${subscore} / 100` },
    ],
    chart: { fan, histogram, S0 },
  };
}
