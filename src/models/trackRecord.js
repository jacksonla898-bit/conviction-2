// Track Record: how did logged scores do afterwards? Pure functions over the log rows and daily closes.
//
//   Base date      the last completed daily close at the moment of the run (U.S. Eastern time):
//                  runs at or after 16:00 ET use that day's close; earlier runs use the previous trading day.
//   Forward return R_h = C[t0 + h] / C[t0] − 1, h = 21, 63, 126 trading days (≈ 1, 3, 6 months)
//   SPY return     R_SPY,h over exactly the same two dates;   excess return X_h = R_h − R_SPY,h
//   A window whose end date has not happened yet is "pending" — never a partial number.
//   Closes: one consistent series for the asset and SPY (Alpaca SIP daily closes, split-adjusted, no dividends).
//
//   By label       mean R_h, mean X_h and hit rate = share of runs with X_h > 0, for Weak/Neutral/Strong/Very Strong
//   Spearman ρ     Pearson correlation of the ranks of (score, X_h) over completed runs (ties get average ranks)
//   Any bucket with n < 30 is flagged "small sample, not statistically meaningful".

export const HORIZONS = [
  { id: 'm1', label: '1 month', days: 21 },
  { id: 'm3', label: '3 months', days: 63 },
  { id: 'm6', label: '6 months', days: 126 },
];
export const LABEL_ORDER = ['Low', 'Neutral', 'High', 'Very High'];
export const MIN_SAMPLE = 30;
export const SMALL_SAMPLE = 'small sample, not statistically meaningful';

const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Run timestamp → { date: 'YYYY-MM-DD' in ET, afterClose: boolean }. */
export function easternParts(iso) {
  const parts = Object.fromEntries(ET.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, afterClose: minutes >= 16 * 60 };
}

/** Index of the base bar for a run in a close series (sorted ascending by date); -1 if none. */
export function baseIndex(series, runIso) {
  const { date, afterClose } = easternParts(runIso);
  let ans = -1;
  for (let i = 0; i < series.length; i++) {
    const d = series[i].date;
    if (afterClose ? d <= date : d < date) ans = i;
    else break;
  }
  return ans;
}

export function scoreLabel(score) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
  const s = Number(score);
  return s < 40 ? 'Low' : s < 60 ? 'Neutral' : s < 80 ? 'High' : 'Very High';
}

/** Outcome of one logged run. `series` and `spy` are [{date, close}] ascending. */
export function runOutcome(row, series, spy) {
  const label = row.label || scoreLabel(row.score);
  const base = { id: row.id, ticker: row.ticker, assetType: row.asset_type || 'stock', mode: row.mode, score: row.score === null ? null : Number(row.score), label, version: row.app_version || null, createdAt: row.created_at, priceAtRun: row.price_at_run === null || row.price_at_run === undefined ? null : Number(row.price_at_run), priceAsOf: row.price_as_of || null, priceSource: row.price_source || null };
  if (base.assetType === 'treasury') return { ...base, status: 'unavailable', reason: 'Treasury yields have no traded price, so there is no forward return.', windows: {} };
  if (base.score === null) return { ...base, status: 'unavailable', reason: 'No score was stored for this run.', windows: {} };
  if (!series || !series.length) return { ...base, status: 'unavailable', reason: 'No daily price history for this ticker from Alpaca.', windows: {} };
  if (!spy || !spy.length) return { ...base, status: 'unavailable', reason: 'No SPY daily price history, so excess return cannot be computed.', windows: {} };
  const i0 = baseIndex(series, row.created_at);
  if (i0 < 0) return { ...base, status: 'unavailable', reason: `No ${base.ticker} close on or before the run date.`, windows: {} };
  const baseDate = series[i0].date;
  const spyIdx = new Map(spy.map((b, i) => [b.date, i]));
  if (!spyIdx.has(baseDate)) return { ...base, status: 'unavailable', reason: `No SPY close on the base date ${baseDate}.`, windows: {} };
  const windows = {};
  for (const h of HORIZONS) {
    const i1 = i0 + h.days;
    if (i1 >= series.length) {
      const remaining = i1 - (series.length - 1);
      windows[h.id] = { status: 'pending', reason: `window ends ${remaining} trading day${remaining === 1 ? '' : 's'} after the latest close`, tradingDaysLeft: remaining };
      continue;
    }
    const endDate = series[i1].date;
    if (!spyIdx.has(endDate)) {
      windows[h.id] = { status: 'unavailable', reason: `No SPY close on ${endDate}.` };
      continue;
    }
    const c0 = series[i0].close;
    const c1 = series[i1].close;
    const s0 = spy[spyIdx.get(baseDate)].close;
    const s1 = spy[spyIdx.get(endDate)].close;
    const ret = c1 / c0 - 1;
    const spyRet = s1 / s0 - 1;
    windows[h.id] = { status: 'ok', baseDate, endDate, c0, c1, s0, s1, ret, spyRet, excess: ret - spyRet };
  }
  return { ...base, status: 'ok', baseDate, baseClose: series[i0].close, windows };
}

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/** Ranks with ties averaged (1-based). */
export function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 2) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function spearman(x, y) {
  if (x.length < 3) return null;
  return pearson(ranks(x), ranks(y));
}

/** Aggregate outcomes into per-label and per-horizon statistics. */
export function summarize(outcomes) {
  const byLabel = {};
  for (const label of LABEL_ORDER) {
    byLabel[label] = {};
    for (const h of HORIZONS) {
      const done = outcomes.filter((o) => o.label === label && o.windows[h.id] && o.windows[h.id].status === 'ok').map((o) => o.windows[h.id]);
      const pending = outcomes.filter((o) => o.label === label && o.windows[h.id] && o.windows[h.id].status === 'pending').length;
      byLabel[label][h.id] = {
        n: done.length,
        pending,
        avgReturn: mean(done.map((w) => w.ret)),
        avgExcess: mean(done.map((w) => w.excess)),
        hitRate: done.length ? done.filter((w) => w.excess > 0).length / done.length : null,
        small: done.length < MIN_SAMPLE,
      };
    }
  }
  const correlation = {};
  for (const h of HORIZONS) {
    const pts = outcomes.filter((o) => o.windows[h.id] && o.windows[h.id].status === 'ok').map((o) => [o.score, o.windows[h.id].excess]);
    const rho = spearman(pts.map((p) => p[0]), pts.map((p) => p[1]));
    correlation[h.id] = { n: pts.length, rho, small: pts.length < MIN_SAMPLE, reason: pts.length < 3 ? `needs at least 3 completed runs, have ${pts.length}` : rho === null ? 'all scores or all excess returns are identical, so ranks carry no information' : null };
  }
  const counts = {
    runs: outcomes.length,
    usable: outcomes.filter((o) => o.status === 'ok').length,
    unavailable: outcomes.filter((o) => o.status !== 'ok').length,
    completed: Object.fromEntries(HORIZONS.map((h) => [h.id, outcomes.filter((o) => o.windows[h.id] && o.windows[h.id].status === 'ok').length])),
    pending: Object.fromEntries(HORIZONS.map((h) => [h.id, outcomes.filter((o) => o.windows[h.id] && o.windows[h.id].status === 'pending').length])),
  };
  const nextToFinish = Object.fromEntries(HORIZONS.map((h) => {
    const p = outcomes.filter((o) => o.windows[h.id] && o.windows[h.id].status === 'pending').map((o) => o.windows[h.id].tradingDaysLeft);
    return [h.id, p.length ? Math.min(...p) : null];
  }));
  const anySmall = LABEL_ORDER.some((l) => HORIZONS.some((h) => byLabel[l][h.id].small)) || HORIZONS.some((h) => correlation[h.id].small);
  return { byLabel, correlation, counts, nextToFinish, anySmall };
}

/** Points for the score vs 3-month excess scatter. */
export function scatterPoints(outcomes, horizonId = 'm3') {
  return outcomes.filter((o) => o.windows[horizonId] && o.windows[horizonId].status === 'ok').map((o) => ({ score: o.score, excess: o.windows[horizonId].excess, ticker: o.ticker, label: o.label, date: o.createdAt.slice(0, 10) }));
}
