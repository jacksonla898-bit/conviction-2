// Analysis log, stored in Supabase (table public.analyses, see supabase/schema.sql).
//
//   POST /api/analyses           insert one row for a completed analysis
//   GET  /api/analyses[?ticker=AAPL&order=desc&limit=300]   read the history
//
// One function handles both the write and the read so the log costs a single serverless function.
// The Supabase service-role key is read from the server environment only and never reaches the browser.
// The row never contains AI-generated text.
//
// price_at_run is fetched here, server-side, from Alpaca at the moment of the write. If Alpaca fails
// the row stores null for the price; no other number is ever substituted.
import { cleanTicker, sendJson } from './_lib/http.js';
import { latestClose } from './_lib/alpaca.js';

const TABLE = 'analyses';
const COLUMNS = 'id,created_at,ticker,company_name,price_at_run,price_as_of,score,mode,model_subscores,dcf,inputs,app_version';
const MAX_JSON = 20000; // characters per jsonb field

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error('Analysis log is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the server.');
    err.status = 503;
    err.notConfigured = true;
    throw err;
  }
  return {
    endpoint: `${url.replace(/\/+$/, '')}/rest/v1/${TABLE}`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

async function supabaseFetch(url, init, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const detail = (body && (body.message || body.error || body.hint)) || text.slice(0, 200) || 'no details';
      const err = new Error(`Supabase returned HTTP ${res.status}: ${detail}`);
      err.status = 502;
      throw err;
    }
    return body;
  } catch (err) {
    if (err.status) throw err;
    const e = new Error(`Could not reach Supabase: ${err.name === 'AbortError' ? 'request timed out' : err.message}`);
    e.status = 502;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Small in-memory write limiter per warm instance (the endpoint is public; this only blunts accidents).
const recentWrites = [];
function tooManyWrites() {
  const now = Date.now();
  while (recentWrites.length && now - recentWrites[0] > 60000) recentWrites.shift();
  if (recentWrites.length >= 60) return true;
  recentWrites.push(now);
  return false;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validate(body) {
  const ticker = cleanTicker(body.ticker);
  if (!ticker) return { error: 'Invalid ticker.' };
  if (body.mode !== 'standard' && body.mode !== 'wharton') return { error: "mode must be 'standard' or 'wharton'." };
  const score = Number(body.score);
  if (body.score === null || body.score === undefined || !Number.isFinite(score) || score < 0 || score > 100) return { error: 'score must be a number from 0 to 100.' };
  for (const k of ['modelSubscores', 'dcf', 'inputs']) {
    if (!isPlainObject(body[k])) return { error: `${k} must be an object.` };
    if (JSON.stringify(body[k]).length > MAX_JSON) return { error: `${k} is too large.` };
  }
  const companyName = typeof body.companyName === 'string' ? body.companyName.slice(0, 200) : null;
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 40) : null;
  return { row: { ticker, company_name: companyName, score, mode: body.mode, model_subscores: body.modelSubscores, dcf: body.dcf, inputs: body.inputs, app_version: appVersion } };
}

async function handlePost(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const v = validate(body);
  if (v.error) return sendJson(res, 400, { saved: false, error: v.error });
  const cfg = supabaseConfig();
  if (tooManyWrites()) return sendJson(res, 429, { saved: false, error: 'Too many log writes in the last minute. Try again shortly.' });

  // Price at run: Alpaca, right now. Any failure stores null (never a substitute).
  let priceAtRun = null;
  let priceAsOf = null;
  let priceNote = null;
  try {
    const keyId = process.env.ALPACA_KEY_ID;
    const secret = process.env.ALPACA_SECRET_KEY;
    if (!keyId || !secret) throw new Error('Alpaca keys are not set on the server');
    const last = await latestClose(v.row.ticker, keyId, secret);
    priceAtRun = last.price;
    priceAsOf = last.asOf;
  } catch (err) {
    priceNote = `Alpaca price unavailable at run time (${err.message}); price_at_run stored as null.`;
  }

  const row = { ...v.row, price_at_run: priceAtRun, price_as_of: priceAsOf };
  const inserted = await supabaseFetch(`${cfg.endpoint}?select=id,created_at`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const saved = Array.isArray(inserted) ? inserted[0] : inserted;
  sendJson(res, 200, { saved: true, id: saved?.id || null, created_at: saved?.created_at || null, price_at_run: priceAtRun, price_as_of: priceAsOf, price_note: priceNote });
}

async function handleGet(req, res) {
  const cfg = supabaseConfig();
  const params = new URLSearchParams({ select: COLUMNS });
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  params.set('order', `created_at.${order}`);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 300));
  params.set('limit', String(limit));
  if (req.query.ticker) {
    const t = cleanTicker(req.query.ticker);
    if (!t) return sendJson(res, 400, { error: 'Invalid ticker filter.' });
    params.set('ticker', `eq.${t}`);
  }
  const rows = await supabaseFetch(`${cfg.endpoint}?${params}`, { method: 'GET', headers: cfg.headers });
  sendJson(res, 200, { rows: Array.isArray(rows) ? rows : [], order, limit });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET') return await handleGet(req, res);
    return sendJson(res, 405, { error: 'Use GET or POST.' });
  } catch (err) {
    sendJson(res, err.status || 500, { saved: false, error: err.message || String(err), configured: err.notConfigured ? false : undefined });
  }
}
