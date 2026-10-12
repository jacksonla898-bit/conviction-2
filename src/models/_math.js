// Hand-written statistics helpers shared by the models. No libraries.

/** Arithmetic mean: x̄ = (1/n) Σ xᵢ */
export function mean(xs) {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample variance: s² = (1/(n−1)) Σ (xᵢ − x̄)² */
export function variance(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

/** Sample standard deviation: s = √s² */
export function stdev(xs) {
  return Math.sqrt(variance(xs));
}

/** Sample covariance: cov(x,y) = (1/(n−1)) Σ (xᵢ − x̄)(yᵢ − ȳ) */
export function covariance(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (n - 1);
}

/** Daily log returns: rᵢ = ln(Pᵢ / Pᵢ₋₁) */
export function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

/** Percentile of a sorted array using linear interpolation (p in 0..100). */
export function percentileSorted(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/** Compound annual growth rate: (end/start)^(1/years) − 1. Needs both values > 0. */
export function cagr(start, end, years) {
  if (!(start > 0) || !(end > 0) || !(years > 0)) return NaN;
  return Math.pow(end / start, 1 / years) - 1;
}

/** Simple moving average of the last `n` values ending at index i (inclusive). */
export function smaAt(values, i, n) {
  if (i + 1 < n) return NaN;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += values[k];
  return s / n;
}

/** Deterministic PRNG (mulberry32) so a Monte Carlo run is reproducible for a given seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw via Box–Muller: Z = √(−2 ln U₁) · cos(2π U₂) */
export function makeNormal(rng) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  };
}

// ---------- formatting helpers used in the deterministic explanations ----------

export function fmt(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(x) || !Number.isFinite(x)) return 'n/a';
  return Number(x).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x) || !Number.isFinite(x)) return 'n/a';
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtMoney(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(x) || !Number.isFinite(x)) return 'n/a';
  const abs = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(digits)}K`;
  return `${sign}$${abs.toFixed(digits)}`;
}

export function fmtShares(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  const abs = Math.abs(x);
  if (abs >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(Math.round(x));
}

/** Standard "unavailable" result so the UI and score aggregator can treat every model the same way. */
export function unavailable(id, name, reason) {
  return { id, name, available: false, error: reason, subscore: null, metrics: {}, inputs: [], steps: [], chart: null };
}
