// Owner session for reading the analysis log (History and Track Record).
// The passcode lives only in the server env var LOG_PASSCODE. A correct passcode sets an HttpOnly,
// SameSite=Strict cookie holding `expiry.signature`, where signature = HMAC-SHA256(LOG_PASSCODE, expiry).
// Changing LOG_PASSCODE invalidates every existing session.
import crypto from 'node:crypto';

export const COOKIE = 'cv_log_session';
export const SESSION_DAYS = 7;

function secret() {
  const s = process.env.LOG_PASSCODE;
  return s && s.length >= 8 ? s : null;
}

export function passcodeConfigured() {
  return secret() !== null;
}

export function sign(expiry, key = secret()) {
  return crypto.createHmac('sha256', key).update(`conviction-log:${expiry}`).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkPasscode(candidate) {
  const s = secret();
  if (!s || typeof candidate !== 'string') return false;
  // Compare digests so the comparison is constant-time regardless of length.
  const h = (v) => crypto.createHash('sha256').update(v).digest('hex');
  return safeEqual(h(candidate), h(s));
}

export function makeToken(now = Date.now()) {
  const expiry = String(now + SESSION_DAYS * 86400000);
  return `${expiry}.${sign(expiry)}`;
}

export function verifyToken(token, now = Date.now()) {
  const s = secret();
  if (!s || typeof token !== 'string' || !token.includes('.')) return false;
  const [expiry, sig] = token.split('.');
  if (!/^\d{10,16}$/.test(expiry) || Number(expiry) < now) return false;
  return safeEqual(sig, sign(expiry, s));
}

export function readCookie(req, name = COOKIE) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function isOwner(req) {
  return verifyToken(readCookie(req));
}

function secureFlag(req) {
  const host = String(req.headers?.host || '');
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? '' : '; Secure';
}

export function setSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secureFlag(req)}`);
}

export function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag(req)}`);
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function isCron(req) {
  const s = process.env.CRON_SECRET;
  const h = req.headers?.authorization || '';
  return Boolean(s && s.length >= 16 && safeEqual(h, `Bearer ${s}`));
}
