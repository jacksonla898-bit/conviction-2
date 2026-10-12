// Shared helpers for the Vercel serverless functions.
// Files inside api/_lib are NOT deployed as functions (underscore prefix).

/** In-memory cache shared by warm invocations of the same function. */
const cache = new Map();

/**
 * Get a cached value or compute it. TTL in milliseconds.
 * Vercel keeps a function instance warm for a while, so repeat requests for the
 * same ticker within the TTL avoid hitting the upstream API again.
 */
export async function cached(key, ttlMs, compute) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await compute();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** Fetch JSON with a timeout and a readable error on non-2xx responses. */
export async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(upstreamMessage(res.status, text));
      err.status = res.status;
      err.body = text.slice(0, 500);
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Upstream returned non-JSON (${url.split('?')[0]})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function upstreamMessage(status, text) {
  if (status === 429) return 'Rate limit reached (HTTP 429). Wait a minute and try again.';
  if (status === 401 || status === 403) return `Upstream rejected the request (HTTP ${status}). Check the API key or plan limits.`;
  if (status === 404) return 'Upstream returned 404 (not found).';
  return `Upstream error HTTP ${status}: ${text.slice(0, 200)}`;
}

/** Validate a ticker: 1-10 upper-case letters, digits, dot or hyphen. */
export function cleanTicker(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(t)) return null;
  return t;
}

/** Send a JSON response with cache headers. */
export function sendJson(res, status, body, maxAgeSeconds = 0) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (maxAgeSeconds > 0) {
    res.setHeader('Cache-Control', `s-maxage=${maxAgeSeconds}, stale-while-revalidate=60`);
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.status(status).json(body);
}

/** Uniform error response. `unavailable: true` tells the UI to mark the model unavailable rather than failed. */
export function sendError(res, err, { unavailable = false } = {}) {
  const status = err.status === 429 ? 429 : err.status === 401 || err.status === 403 ? 502 : 500;
  sendJson(res, status, {
    error: err.message || String(err),
    unavailable,
  });
}

/** Read a required environment variable or throw a readable error. */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`Server is missing the ${name} environment variable.`);
    err.status = 500;
    throw err;
  }
  return v;
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
