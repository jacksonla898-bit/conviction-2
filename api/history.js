// GET /api/history?ticker=SPY
// Full daily close history for the stress test: Alpaca Market Data v2, SIP feed (the free plan serves
// SIP history that is older than 15 minutes, so the request carries no `end`), split-adjusted, from the earliest date Alpaca holds
// (2016-01-04 for US equities) to today. Nothing is back-filled or substituted: a scenario that starts
// before the first bar is reported as uncovered by the client.
import { cached, cleanTicker, sendJson, sendError, requireEnv } from './_lib/http.js';
import { fetchBars } from './_lib/alpaca.js';

export const HISTORY_START = '2015-01-01'; // request from here; Alpaca returns its first available bar

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(req.query.ticker);
    if (!ticker) return sendJson(res, 400, { error: 'Invalid ticker.' });
    const keyId = requireEnv('ALPACA_KEY_ID');
    const secret = requireEnv('ALPACA_SECRET_KEY');
    const bars = await cached(`history:${ticker}`, 6 * 60 * 60 * 1000, async () => {
      const all = await fetchBars(ticker, keyId, secret, new Date(`${HISTORY_START}T00:00:00Z`), null, { feed: 'sip', maxPages: 10 });
      return all.map((b) => ({ date: b.date, close: b.close }));
    });
    sendJson(res, 200, { ticker, source: 'Alpaca Market Data v2 (SIP feed, split-adjusted daily closes)', first: bars[0].date, last: bars[bars.length - 1].date, count: bars.length, bars }, 3600);
  } catch (err) {
    sendError(res, err);
  }
}
