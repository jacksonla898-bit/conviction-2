// GET /api/riskfree[?asof=YYYY-MM-DD]
// Current (or as-of) 3-month Treasury yield, used as the risk-free rate.
// Primary source: FRED series DGS3MO (3-month constant-maturity Treasury), via the server-side FRED key.
// Fallback if FRED is unavailable: the U.S. Treasury's own daily yield-curve XML feed (no key).
// The response names which source answered. The user can still override the rate in Settings.
import { cached, fetchJson, sendJson, sendError } from './_lib/http.js';

const FRED = 'https://api.stlouisfed.org/fred/series/observations';
const FEED = (yyyymm) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}`;

async function fromFred(asof) {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY is not set');
  const params = new URLSearchParams({ series_id: 'DGS3MO', api_key: key, file_type: 'json', sort_order: 'desc', limit: '15' });
  if (asof) params.set('observation_end', asof);
  const data = await fetchJson(`${FRED}?${params}`);
  const row = (data.observations || []).find((o) => o.value !== '.' && Number.isFinite(Number(o.value)));
  if (!row) throw new Error('FRED returned no 3-month yield');
  return { rate: Number(row.value), asOf: row.date, source: 'FRED series DGS3MO (3-month constant-maturity Treasury)' };
}

async function fetchMonth(yyyymm) {
  const res = await fetch(FEED(yyyymm), { headers: { 'User-Agent': 'Conviction2 (risk-free rate lookup)' } });
  if (!res.ok) {
    const err = new Error(`Treasury feed returned HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const xml = await res.text();
  const rows = [];
  const re = /<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>[\s\S]*?<d:BC_3MONTH[^>]*>([^<]*)<\/d:BC_3MONTH>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const rate = parseFloat(m[2]);
    if (Number.isFinite(rate)) rows.push({ date: m[1].slice(0, 10), rate });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function monthKey(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function fromTreasuryXml(asof) {
  const anchor = asof ? new Date(`${asof}T00:00:00Z`) : new Date();
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - back, 1));
    const rows = (await fetchMonth(monthKey(d))).filter((r) => !asof || r.date <= asof);
    if (rows.length) {
      const last = rows[rows.length - 1];
      return { rate: last.rate, asOf: last.date, source: 'U.S. Treasury daily par yield curve, 3-month (FRED unavailable)' };
    }
  }
  throw new Error('Treasury feed had no 3-month yield for the requested period.');
}

export default async function handler(req, res) {
  try {
    const asof = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asof || '') ? req.query.asof : null;
    const result = await cached(`rf:${asof || 'now'}`, asof ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000, async () => {
      try {
        return await fromFred(asof);
      } catch (fredErr) {
        try {
          const fb = await fromTreasuryXml(asof);
          return { ...fb, fredError: fredErr.message };
        } catch (xmlErr) {
          const err = new Error(`Risk-free rate unavailable. FRED: ${fredErr.message}. Treasury feed: ${xmlErr.message}.`);
          err.status = 502;
          throw err;
        }
      }
    });
    sendJson(res, 200, result, asof ? 86400 : 1800);
  } catch (err) {
    sendError(res, err);
  }
}
