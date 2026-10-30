// Shared Alpaca Market Data helper (files in api/_lib are not deployed as functions).
import { fetchJson, isoDate } from './http.js';

const ALPACA = 'https://data.alpaca.markets/v2/stocks';

/** Daily bars (IEX feed by default, split-adjusted) between two dates. Pass endDate = null to omit `end`
 * (the free plan rejects SIP requests whose end touches the last 15 minutes). Throws with status 404 if there are none. */
export async function fetchBars(symbol, keyId, secret, startDate, endDate, { keepTimestamp = false, feed = 'iex', maxPages = 5 } = {}) {
  const headers = { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret };
  const bars = [];
  let pageToken = null;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      timeframe: '1Day',
      start: isoDate(startDate),
      limit: '10000',
      adjustment: 'split',
      feed,
      sort: 'asc',
    });
    if (endDate) params.set('end', isoDate(endDate));
    if (pageToken) params.set('page_token', pageToken);
    const data = await fetchJson(`${ALPACA}/${encodeURIComponent(symbol)}/bars?${params}`, { headers });
    for (const b of data.bars || []) {
      const bar = { date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v };
      if (keepTimestamp) bar.t = b.t;
      bars.push(bar);
    }
    pageToken = data.next_page_token || null;
    pages += 1;
  } while (pageToken && pages < maxPages);

  if (bars.length === 0) {
    const err = new Error(`Alpaca returned no daily bars for ${symbol}. Check the ticker symbol.`);
    err.status = 404;
    throw err;
  }
  return bars;
}

/** Latest daily close for a symbol: { price, asOf (ISO timestamp of the bar) }. Throws on any failure. */
export async function latestClose(symbol, keyId, secret) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 10);
  const bars = await fetchBars(symbol, keyId, secret, start, end, { keepTimestamp: true });
  const last = bars[bars.length - 1];
  return { price: last.close, asOf: last.t, date: last.date };
}
