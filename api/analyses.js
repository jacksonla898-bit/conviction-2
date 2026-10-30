// Analysis log, stored in Supabase (table public.analyses, see supabase/schema.sql and supabase/migrations).
//
//   POST /api/analyses                    insert one row for a completed analysis (public)
//   GET  /api/analyses[?ticker=&order=&limit=]   read the log (owner only: session cookie required)
//   POST /api/analyses?action=login       { passcode } → sets the owner session cookie
//   POST /api/analyses?action=logout      clears it
//   GET  /api/analyses?action=session     { owner: true|false, configured }
//   GET  /api/analyses  with "Authorization: Bearer $CRON_SECRET"   daily keep-alive (Vercel Cron)
//
// One function handles everything so the log costs a single serverless function. The Supabase
// service-role key, LOG_PASSCODE and CRON_SECRET are read from the server environment only.
// Rows never contain AI-generated text.
//
// price_at_run is fetched here, server-side, from Alpaca at the moment of the write: the latest
// completed daily close. If Alpaca fails, or the asset has no traded price (Treasury yields), the row
// stores null; no other number is ever substituted.
import { cleanTicker, sendJson } from './_lib/http.js';
import { latestClose } from './_lib/alpaca.js';
import { isOwner, isCron, checkPasscode, passcodeConfigured, setSessionCookie, clearSessionCookie } from './_lib/session.js';

const TABLE = 'analyses';
const COLUMNS = 'id,created_at,ticker,company_name,asset_type,label,price_at_run,price_as_of,price_source,score,mode,model_subscores,dcf,inputs,app_version';
const MAX_JSON = 20000; // characters per jsonb field
const ASSET_TYPES = ['stock', 'equity_etf', 'bond_etf', 'treasury'];
export const UNREACHABLE = 'Log database paused or unreachable';

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
      // 5xx (including Supabase's 540 "project paused") means the database itself is not serving.
      const err = new Error(res.status >= 500 ? `${UNREACHABLE} (HTTP ${res.status}: ${detail})` : `Supabase returned HTTP ${res.status}: ${detail}`);
      err.status = 502;
      throw err;
    }
    return body;
  } catch (err) {
    if (err.status) throw err;
    const e = new Error(`${UNREACHABLE} (${err.name === 'AbortError' ? 'request timed out' : err.message})`);
    e.status = 502;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Small in-memory limiters per warm instance (they blunt accidents and brute force; they are not a firewall).
const recentWrites = [];
function tooMany(list, max, windowMs = 60000) {
  const now = Date.now();
  while (list.length && now - list[0] > windowMs) list.shift();
  if (list.length >= max) return true;
  list.push(now);
  return false;
}
const loginAttempts = [];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Score bands, identical to src/models/conviction.js scoreLabel(). */
export function labelFor(score) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
  const s = Number(score);
  return s < 40 ? 'Low' : s < 60 ? 'Neutral' : s < 80 ? 'High' : 'Very High';
}

export function validate(body) {
  const ticker = cleanTicker(body.ticker);
  if (!ticker) return { error: 'Invalid ticker.' };
  if (body.mode !== 'standard' && body.mode !== 'wharton') return { error: "mode must be 'standard' or 'wharton'." };
  const score = Number(body.score);
  if (body.score === null || body.score === undefined || !Number.isFinite(score) || score < 0 || score > 100) return { error: 'score must be a number from 0 to 100.' };
  const assetType = body.assetType === undefined ? 'stock' : body.assetType;
  if (!ASSET_TYPES.includes(assetType)) return { error: `assetType must be one of ${ASSET_TYPES.join(', ')}.` };
  for (const k of ['modelSubscores', 'dcf', 'inputs']) {
    if (!isPlainObject(body[k])) return { error: `${k} must be an object.` };
    if (JSON.stringify(body[k]).length > MAX_JSON) return { error: `${k} is too large.` };
  }
  const companyName = typeof body.companyName === 'string' ? body.companyName.slice(0, 200) : null;
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 40) : null;
  return { row: { ticker, company_name: companyName, asset_type: assetType, label: labelFor(score), score, mode: body.mode, model_subscores: body.modelSubscores, dcf: body.dcf, inputs: body.inputs, app_version: appVersion } };
}

async function handlePost(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const v = validate(body);
  if (v.error) return sendJson(res, 400, { saved: false, error: v.error });
  const cfg = supabaseConfig();
  if (tooMany(recentWrites, 60)) return sendJson(res, 429, { saved: false, error: 'Too many log writes in the last minute. Try again shortly.' });

  // Price at run: Alpaca, right now. Any failure stores null (never a substitute).
  let priceAtRun = null;
  let priceAsOf = null;
  let priceNote = null;
  let priceSource = null;
  if (v.row.asset_type === 'treasury') {
    priceNote = 'Treasury yields have no traded price; price_at_run stored as null.';
  } else {
    try {
      const keyId = process.env.ALPACA_KEY_ID;
      const secret = process.env.ALPACA_SECRET_KEY;
      if (!keyId || !secret) throw new Error('Alpaca keys are not set on the server');
      const last = await latestClose(v.row.ticker, keyId, secret);
      priceAtRun = last.price;
      priceAsOf = last.asOf;
      priceSource = 'Alpaca IEX latest daily close at run time';
    } catch (err) {
      priceNote = `Alpaca price unavailable at run time (${err.message}); price_at_run stored as null.`;
    }
  }

  const row = { ...v.row, price_at_run: priceAtRun, price_as_of: priceAsOf, price_source: priceSource };
  const inserted = await supabaseFetch(`${cfg.endpoint}?select=id,created_at`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const saved = Array.isArray(inserted) ? inserted[0] : inserted;
  sendJson(res, 200, { saved: true, id: saved?.id || null, created_at: saved?.created_at || null, price_at_run: priceAtRun, price_as_of: priceAsOf, price_note: priceNote });
}

async function handleGet(req, res) {
  if (!isOwner(req)) return sendJson(res, 401, { error: 'The analysis log is private. Enter the owner passcode to view it.', locked: true, configured: passcodeConfigured() });
  const cfg = supabaseConfig();
  const params = new URLSearchParams({ select: COLUMNS });
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  params.set('order', `created_at.${order}`);
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 300));
  params.set('limit', String(limit));
  if (req.query.ticker) {
    const t = cleanTicker(req.query.ticker);
    if (!t) return sendJson(res, 400, { error: 'Invalid ticker filter.' });
    params.set('ticker', `eq.${t}`);
  }
  const rows = await supabaseFetch(`${cfg.endpoint}?${params}`, { method: 'GET', headers: cfg.headers });
  res.setHeader('Cache-Control', 'private, no-store');
  sendJson(res, 200, { rows: Array.isArray(rows) ? rows : [], order, limit });
}

/** Keep-alive: the cheapest possible query (one id) so the free Supabase project never idles into a pause. */
async function handlePing(res) {
  const cfg = supabaseConfig();
  const t0 = Date.now();
  await supabaseFetch(`${cfg.endpoint}?select=id&limit=1`, { method: 'GET', headers: cfg.headers });
  sendJson(res, 200, { ok: true, ms: Date.now() - t0, at: new Date().toISOString() });
}

async function handleLogin(req, res) {
  if (!passcodeConfigured()) return sendJson(res, 503, { owner: false, error: 'LOG_PASSCODE is not set on the server.' });
  if (tooMany(loginAttempts, 10)) return sendJson(res, 429, { owner: false, error: 'Too many attempts. Wait a minute.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!checkPasscode(body.passcode)) return sendJson(res, 401, { owner: false, error: 'Wrong passcode.' });
  setSessionCookie(req, res);
  sendJson(res, 200, { owner: true });
}

export default async function handler(req, res) {
  try {
    const action = req.query?.action || '';
    if (req.method === 'GET' && isCron(req)) return await handlePing(res);
    if (req.method === 'GET' && action === 'session') return sendJson(res, 200, { owner: isOwner(req), configured: passcodeConfigured() });
    if (req.method === 'POST' && action === 'login') return await handleLogin(req, res);
    if (req.method === 'POST' && action === 'logout') { clearSessionCookie(req, res); return sendJson(res, 200, { owner: false }); }
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET') return await handleGet(req, res);
    return sendJson(res, 405, { error: 'Use GET or POST.' });
  } catch (err) {
    sendJson(res, err.status || 500, { saved: false, error: err.message || String(err), configured: err.notConfigured ? false : undefined });
  }
}
