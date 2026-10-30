// GET /api/asset?ticker=AGG
// Asset-type detection plus the fund facts the current providers can supply:
//   - Finnhub /search (free): symbol type (ETP / Common Stock) and name  → classification
//   - Alpaca /v2/assets (free): exchange and official name
//   - Alpaca corporate actions (free): trailing-12-month cash dividends → distribution yield input
//   - Finnhub /etf/profile: expense ratio, AUM, asset class — NOT in the free plan (HTTP 403), reported as unavailable
// Treasury tickers (US2Y/US5Y/US10Y/US30Y) are classified here without any provider call.
import { cached, fetchJson, cleanTicker, sendJson, sendError, requireEnv, isoDate } from './_lib/http.js';
import { classify, treasuryTicker, TREASURY_TICKERS } from './_lib/assetClass.js';

async function finnhubSearch(ticker, token) {
  const data = await fetchJson(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(ticker)}&token=${token}`);
  const rows = Array.isArray(data?.result) ? data.result : [];
  const exact = rows.find((r) => String(r.symbol).toUpperCase() === ticker) || rows.find((r) => String(r.displaySymbol).toUpperCase() === ticker);
  return exact ? { type: exact.type, name: exact.description } : null;
}

async function finnhubEtfProfile(ticker, token) {
  try {
    const data = await fetchJson(`https://finnhub.io/api/v1/etf/profile?symbol=${encodeURIComponent(ticker)}&token=${token}`);
    const p = data?.profile || {};
    if (!Object.keys(p).length) return { status: 'unavailable', reason: 'Finnhub /etf/profile returned no data for this symbol.' };
    return { status: 'ok', expenseRatio: p.expenseRatio ?? null, aum: p.aum ?? null, assetClass: p.assetClass ?? null, inceptionDate: p.inceptionDate ?? null, source: 'Finnhub /etf/profile' };
  } catch (err) {
    const why = err.status === 403 || err.status === 401 ? 'Finnhub /etf/profile is not included in the free plan (HTTP 403).' : `Finnhub /etf/profile failed: ${err.message}`;
    return { status: 'unavailable', reason: why };
  }
}

async function alpacaAsset(ticker, keyId, secret) {
  try {
    const a = await fetchJson(`https://paper-api.alpaca.markets/v2/assets/${encodeURIComponent(ticker)}`, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret } });
    return { name: a.name || null, exchange: a.exchange || null, tradable: Boolean(a.tradable), status: a.status || null };
  } catch (err) {
    return { error: err.status === 404 ? 'Alpaca has no asset with this symbol.' : err.message };
  }
}

async function alpacaDividends(ticker, keyId, secret) {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() - 1);
  try {
    const data = await fetchJson(
      `https://data.alpaca.markets/v1beta1/corporate-actions?symbols=${encodeURIComponent(ticker)}&types=cash_dividend&start=${isoDate(start)}&end=${isoDate(end)}&limit=1000`,
      { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret } }
    );
    const rows = (data?.corporate_actions?.cash_dividends || []).filter((d) => Number.isFinite(Number(d.rate)) && d.ex_date);
    const dividends = rows.map((d) => ({ exDate: d.ex_date, payable: d.payable_date || null, rate: Number(d.rate), special: Boolean(d.special) })).sort((a, b) => a.exDate.localeCompare(b.exDate));
    const regular = dividends.filter((d) => !d.special);
    return { status: 'ok', from: isoDate(start), to: isoDate(end), count: dividends.length, ttmTotal: regular.reduce((s, d) => s + d.rate, 0), ttmTotalIncludingSpecial: dividends.reduce((s, d) => s + d.rate, 0), dividends, source: 'Alpaca corporate actions (cash dividends)' };
  } catch (err) {
    return { status: 'unavailable', reason: `Alpaca corporate-actions endpoint failed: ${err.message}` };
  }
}

export default async function handler(req, res) {
  try {
    const raw = String(req.query.ticker || '').trim().toUpperCase();
    const tt = treasuryTicker(raw);
    if (tt) {
      const t = TREASURY_TICKERS[tt];
      return sendJson(res, 200, { ticker: tt, assetType: 'treasury', name: t.label, series: t.series, tenor: t.tenor, detection: { source: 'built-in', reason: `Synthetic Treasury ticker; yield history from FRED ${t.series}` } }, 3600);
    }
    const ticker = cleanTicker(raw);
    if (!ticker) return sendJson(res, 400, { error: 'Invalid ticker.' });

    const result = await cached(`asset:${ticker}`, 6 * 60 * 60 * 1000, async () => {
      const token = requireEnv('FINNHUB_API_KEY');
      const keyId = requireEnv('ALPACA_KEY_ID');
      const secret = requireEnv('ALPACA_SECRET_KEY');
      const [search, alp] = await Promise.all([
        finnhubSearch(ticker, token).catch((err) => ({ error: err.message })),
        alpacaAsset(ticker, keyId, secret),
      ]);
      const name = alp.name || search?.name || null;
      const cls = classify({ ticker, finnhubType: search?.type, name });
      if (!search && !alp.name) {
        return { ticker, assetType: 'unsupported', name: null, detection: { source: 'Finnhub /search + Alpaca /v2/assets', reason: `unsupported: no provider recognises "${ticker}"${search?.error ? ` (Finnhub: ${search.error})` : ''}${alp.error ? ` (Alpaca: ${alp.error})` : ''}.` } };
      }
      const out = {
        ticker,
        assetType: cls.assetType,
        name,
        exchange: alp.exchange || null,
        detection: { source: 'Finnhub /search type' + (alp.name ? ' + Alpaca asset name' : ''), finnhubType: search?.type || null, reason: cls.reason },
      };
      if (cls.assetType === 'equity_etf' || cls.assetType === 'bond_etf') {
        const [profile, dividends] = await Promise.all([finnhubEtfProfile(ticker, token), alpacaDividends(ticker, keyId, secret)]);
        out.etfProfile = profile;
        out.dividends = dividends;
      }
      return out;
    });
    sendJson(res, 200, result, 3600);
  } catch (err) {
    sendError(res, err);
  }
}
