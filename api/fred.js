// GET /api/fred?series=DGS2,DGS10[&start=YYYY-MM-DD][&end=YYYY-MM-DD][&latest=1]
// Server-side proxy for FRED (Federal Reserve Economic Data) Treasury yield series.
// The FRED key lives only in the server environment. Only the Treasury series below can be requested,
// so this endpoint cannot be used as a general proxy.
import { cached, fetchJson, sendJson, sendError, requireEnv } from './_lib/http.js';

/** Constant-maturity Treasury yields (percent). Key = FRED series id, value = tenor in years. */
export const TREASURY_SERIES = {
  DGS1MO: 1 / 12,
  DGS3MO: 0.25,
  DGS6MO: 0.5,
  DGS1: 1,
  DGS2: 2,
  DGS3: 3,
  DGS5: 5,
  DGS7: 7,
  DGS10: 10,
  DGS20: 20,
  DGS30: 30,
};
const ALLOWED = new Set(Object.keys(TREASURY_SERIES));
const BASE = 'https://api.stlouisfed.org/fred/series/observations';

async function fetchSeries(id, key, { start, end, latest }) {
  const params = new URLSearchParams({ series_id: id, api_key: key, file_type: 'json' });
  if (start) params.set('observation_start', start);
  if (end) params.set('observation_end', end);
  if (latest) {
    params.set('sort_order', 'desc');
    params.set('limit', '15'); // enough to skip holidays ('.' values)
  }
  const data = await fetchJson(`${BASE}?${params}`);
  const rows = (data.observations || [])
    .filter((o) => o.value !== '.' && o.value !== '' && Number.isFinite(Number(o.value)))
    .map((o) => ({ date: o.date, value: Number(o.value) }));
  if (latest) {
    const last = rows[0]; // sorted desc
    return last ? [last] : [];
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export default async function handler(req, res) {
  try {
    const key = requireEnv('FRED_API_KEY');
    const ids = String(req.query.series || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!ids.length || ids.length > 12) return sendJson(res, 400, { error: 'Pass 1 to 12 series ids in ?series=' });
    const bad = ids.filter((id) => !ALLOWED.has(id));
    if (bad.length) return sendJson(res, 400, { error: `Unsupported series: ${bad.join(', ')}. Allowed: ${[...ALLOWED].join(', ')}` });
    const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    const start = dateOk(req.query.start) ? req.query.start : null;
    const end = dateOk(req.query.end) ? req.query.end : null;
    const latest = req.query.latest === '1';

    const out = {};
    const errors = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          out[id] = await cached(`fred:${id}:${start || ''}:${end || ''}:${latest ? 'L' : 'H'}`, 60 * 60 * 1000, () => fetchSeries(id, key, { start, end, latest }));
        } catch (err) {
          errors[id] = err.message;
        }
      })
    );
    if (!Object.keys(out).length) {
      const err = new Error(`FRED request failed: ${Object.values(errors)[0] || 'no data'}`);
      err.status = 502;
      throw err;
    }
    sendJson(res, 200, { source: 'FRED (Federal Reserve Bank of St. Louis), constant-maturity Treasury yields, percent', series: out, tenors: TREASURY_SERIES, errors: Object.keys(errors).length ? errors : undefined }, latest ? 1800 : 3600);
  } catch (err) {
    sendError(res, err);
  }
}
