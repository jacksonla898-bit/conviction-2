// Thin client for the /api serverless functions. Never throws: returns {ok, data} or {ok:false, error, unavailable}.

async function getJson(url, init) {
  try {
    const res = await fetch(url, init);
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || (body && body.error)) {
      return {
        ok: false,
        error: (body && body.error) || `HTTP ${res.status}`,
        unavailable: Boolean(body && body.unavailable),
        status: res.status,
      };
    }
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}`, unavailable: false };
  }
}

const q = (ticker, asOf) => `ticker=${encodeURIComponent(ticker)}${asOf ? `&asof=${encodeURIComponent(asOf)}` : ''}`;

export const api = {
  prices: (ticker, asOf) => getJson(`/api/prices?${q(ticker, asOf)}`),
  fundamentals: (ticker, asOf) => getJson(`/api/fundamentals?${q(ticker, asOf)}`),
  earnings: (ticker, asOf) => getJson(`/api/earnings?${q(ticker, asOf)}`),
  insiders: (ticker, asOf) => getJson(`/api/insiders?${q(ticker, asOf)}`),
  riskfree: (asOf) => getJson(`/api/riskfree${asOf ? `?asof=${encodeURIComponent(asOf)}` : ''}`),
  reason: (ticker, payload) =>
    getJson('/api/reason', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, payload }),
    }),
};
