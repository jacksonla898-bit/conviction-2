// GET /api/insiders?ticker=AAPL
// Finnhub /stock/insider-transactions for the last 6 months (SEC Form 4 filings).
import { cached, fetchJson, cleanTicker, sendJson, sendError, requireEnv, isoDate } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(req.query.ticker);
    if (!ticker) return sendJson(res, 400, { error: 'Invalid ticker.' });
    const token = requireEnv('FINNHUB_API_KEY');

    const asof = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asof || '') ? req.query.asof : null;
    const to = asof ? new Date(`${asof}T00:00:00Z`) : new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - 6);

    const data = await cached(`fh:insiders:${ticker}:${asof || 'now'}`, 60 * 60 * 1000, () =>
      fetchJson(
        `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(ticker)}&from=${isoDate(from)}&to=${isoDate(to)}&token=${token}`
      )
    );
    const rows = Array.isArray(data?.data) ? data.data : null;
    if (!rows) {
      return sendJson(res, 502, { error: 'Finnhub returned an unexpected payload for insider transactions.', unavailable: true });
    }
    const transactions = rows
      .filter((r) => r.transactionDate && typeof r.change === 'number')
      .map((r) => ({
        name: r.name,
        date: r.transactionDate,
        filingDate: r.filingDate,
        // Form 4 codes: P = open-market purchase, S = sale, A = award, M = option exercise, F = tax withholding, G = gift
        code: r.transactionCode,
        change: r.change, // signed share change (positive = acquired)
        price: r.transactionPrice,
        sharesAfter: r.share,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    sendJson(
      res,
      200,
      { ticker, asOf: asof, source: 'Finnhub /stock/insider-transactions', from: isoDate(from), to: isoDate(to), transactions },
      1800
    );
  } catch (err) {
    sendError(res, err, { unavailable: err.status === 403 || err.status === 401 });
  }
}
