// GET /api/prices?ticker=AAPL[&asof=YYYY-MM-DD]
// Returns 5 years of daily bars for the ticker and for SPY from Alpaca Market Data v2 (IEX feed).
// With `asof`, the 5-year window ends on that date and the bars after it are returned separately as
// `forward` / `spyForward`, so an as-of analysis can also show what happened next.
import { cached, fetchJson, cleanTicker, sendJson, sendError, requireEnv, isoDate } from './_lib/http.js';

const ALPACA = 'https://data.alpaca.markets/v2/stocks';

async function fetchBars(symbol, keyId, secret, startDate, endDate) {
  const headers = { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret };
  const bars = [];
  let pageToken = null;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      timeframe: '1Day',
      start: isoDate(startDate),
      end: isoDate(endDate),
      limit: '10000',
      adjustment: 'split',
      feed: 'iex',
      sort: 'asc',
    });
    if (pageToken) params.set('page_token', pageToken);
    const data = await fetchJson(`${ALPACA}/${encodeURIComponent(symbol)}/bars?${params}`, { headers });
    for (const b of data.bars || []) {
      bars.push({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
    }
    pageToken = data.next_page_token || null;
    pages += 1;
  } while (pageToken && pages < 5);

  if (bars.length === 0) {
    const err = new Error(`Alpaca returned no daily bars for ${symbol}. Check the ticker symbol.`);
    err.status = 404;
    throw err;
  }
  return bars;
}

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
    start.setDate(start.getDate() - 7);
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
