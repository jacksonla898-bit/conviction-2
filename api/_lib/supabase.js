// Minimal Supabase REST (PostgREST) client for server-side code using the service role key.
// Files inside api/_lib are NOT deployed as functions. The key never leaves the server.

export const UNREACHABLE = 'Database paused or unreachable';

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url.replace(/\/+$/, '')}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

export async function supabaseFetch(url, init, timeoutMs = 8000) {
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
