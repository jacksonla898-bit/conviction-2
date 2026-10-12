// GET /api/riskfree[?asof=YYYY-MM-DD]
// Current (or as-of) 3-month Treasury par yield from the U.S. Treasury's daily yield-curve XML feed.
// No API key required. Used as the default risk-free rate; the user can still override it in Settings.
import { cached, cleanTicker, sendJson, sendError } from './_lib/http.js';

const FEED = (yyyymm) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}`;

async function fetchMonth(yyyymm) {
  const res = await fetch(FEED(yyyymm), { headers: { 'User-Agent': 'Conviction2 (risk-free rate lookup)' } });
  if (!res.ok) {
    const err = new Error(`Treasury feed returned HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const xml = await res.text();
  // Each <entry> holds <d:NEW_DATE>2026-10-09T00:00:00</d:NEW_DATE> ... <d:BC_3MONTH>4.02</d:BC_3MONTH>
  const rows = [];
  const re = /<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>[\s\S]*?<d:BC_3MONTH[^>]*>([^<]*)<\/d:BC_3MONTH>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const date = m[1].slice(0, 10);
    const rate = parseFloat(m[2]);
    if (Number.isFinite(rate)) rows.push({ date, rate });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function monthKey(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  try {
    const asof = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asof || '') ? req.query.asof : null;
    const anchor = asof ? new Date(`${asof}T00:00:00Z`) : new Date();
    const result = await cached(`rf:${asof || 'now'}:${monthKey(anchor)}`, 6 * 60 * 60 * 1000, async () => {
      // Try the anchor month, then the previous month (first days of a month have no data yet).
      for (let back = 0; back < 3; back++) {
        const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - back, 1));
        const rows = (await fetchMonth(monthKey(d))).filter((r) => !asof || r.date <= asof);
        if (rows.length) {
          const last = rows[rows.length - 1];
          return { rate: last.rate, asOf: last.date, source: 'U.S. Treasury daily par yield curve, 3-month' };
        }
      }
      const err = new Error('Treasury feed had no 3-month yield for the requested period.');
      err.status = 404;
      throw err;
    });
    sendJson(res, 200, result, asof ? 86400 : 3600);
  } catch (err) {
    sendError(res, err);
  }
}

// cleanTicker is imported to keep the helper module's export surface identical across functions.
void cleanTicker;
