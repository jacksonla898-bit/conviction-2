// GET /api/earnings?ticker=AAPL
// Finnhub /stock/earnings (quarterly EPS actual vs. estimate).
import { cached, fetchJson, cleanTicker, sendJson, sendError, requireEnv } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(req.query.ticker);
    if (!ticker) return sendJson(res, 400, { error: 'Invalid ticker.' });
    const token = requireEnv('FINNHUB_API_KEY');

    const rows = await cached(`fh:earnings:${ticker}`, 60 * 60 * 1000, () =>
      fetchJson(`https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(ticker)}&limit=20&token=${token}`)
    );
    if (!Array.isArray(rows)) {
      return sendJson(res, 502, { error: 'Finnhub returned an unexpected payload for earnings.', unavailable: true });
    }
    const asof = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asof || '') ? req.query.asof : null;
    // Point-in-time: a quarter is reported roughly 3-5 weeks after it ends, so only keep quarters
    // that ended at least 35 days before the as-of date.
    let cutoff = null;
    if (asof) {
      const d = new Date(`${asof}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 35);
      cutoff = d.toISOString().slice(0, 10);
    }
    const earnings = rows
      .filter((r) => r.actual != null && r.estimate != null && r.period)
      .filter((r) => !cutoff || r.period <= cutoff)
      .map((r) => ({
        period: r.period,
        year: r.year,
        quarter: r.quarter,
        actual: r.actual,
        estimate: r.estimate,
        surprise: r.surprise,
        surprisePercent: r.surprisePercent,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
    if (asof && earnings.length === 0 && rows.length > 0) {
      return sendJson(res, 200, {
        ticker,
        asOf: asof,
        source: 'Finnhub /stock/earnings',
        earnings,
        note: `Finnhub's free tier only returns the most recent ${rows.length} quarters, none of which had been reported by ${asof}.`,
      }, 1800);
    }
    sendJson(res, 200, { ticker, asOf: asof, source: 'Finnhub /stock/earnings', earnings }, 1800);
  } catch (err) {
    // 401/403 on the free tier means the endpoint is restricted -> mark unavailable, not failed.
    sendError(res, err, { unavailable: err.status === 403 || err.status === 401 });
  }
}
