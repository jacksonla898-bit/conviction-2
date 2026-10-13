// GET /api/prices?ticker=AAPL[&asof=YYYY-MM-DD]
// Returns 5 years of daily bars for the ticker and for SPY from Alpaca Market Data v2 (IEX feed).
// With `asof`, the 5-year window ends on that date and the bars after it are returned separately as
// `forward` / `spyForward`, so an as-of analysis can also show what happened next.
import { cached, cleanTicker, sendJson, sendError, requireEnv } from './_lib/http.js';
import { fetchBars } from './_lib/alpaca.js';

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(req.query.ticker);
    if (!ticker) return sendJson(res, 400, { error: 'Invalid ticker.' });
    const asof = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asof || '') ? req.query.asof : null;
    const keyId = requireEnv('ALPACA_KEY_ID');
    const secret = requireEnv('ALPACA_SECRET_KEY');

    const today = new Date();
    const anchor = asof ? new Date(`${asof}T00:00:00Z`) : today;
    if (asof && anchor > today) return sendJson(res, 400, { error: 'The as-of date is in the future.' });
    const start = new Date(anchor);
    start.setFullYear(start.getFullYear() - 5);
    start.setDate(start.getDate() - 7); // small buffer so we have >= 5y of trading days
    const key = (sym) => `bars:${sym}:${asof || 'now'}`;

    const [stockAll, spyAll] = await Promise.all([
      cached(key(ticker), 15 * 60 * 1000, () => fetchBars(ticker, keyId, secret, start, today)),
      cached(key('SPY'), 15 * 60 * 1000, () => fetchBars('SPY', keyId, secret, start, today)),
    ]);

    const split = (bars) => (asof ? { past: bars.filter((b) => b.date <= asof), forward: bars.filter((b) => b.date > asof) } : { past: bars, forward: [] });
    const s = split(stockAll);
    const p = split(spyAll);
    if (s.past.length === 0) return sendJson(res, 404, { error: `No price history for ${ticker} on or before ${asof}.` });

    sendJson(
      res,
      200,
      { ticker, asOf: asof, source: 'Alpaca Market Data v2 (IEX feed, split-adjusted)', stock: s.past, spy: p.past, forward: s.forward, spyForward: p.forward },
      600
    );
  } catch (err) {
    sendError(res, err);
  }
}
