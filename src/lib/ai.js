// The ONLY client module that talks to the AI endpoint (/api/reason → Anthropic).
//
// Hard rule: Wharton mode never calls the Anthropic API and never shows AI-written text.
// Enforcement:
//   1. This module is never imported statically. Standard-mode code loads it with a dynamic import()
//      at the moment a Standard explanation is requested, so in Wharton mode it is not even downloaded.
//   2. requestReasoning() and requestThesisCritique() refuse to run unless the caller passes mode === 'standard'.
//   3. The server function also rejects any request whose mode is not 'standard'.
//   tests/purity.test.js checks that no other file references this module statically or the endpoint at all.

export const AI_ENDPOINT = '/api/reason';

export async function requestReasoning(mode, subject, payload) {
  if (mode !== 'standard') {
    throw new Error('AI reasoning is disabled outside Standard mode.');
  }
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'standard', ticker: subject, payload }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || (body && body.error && !body.text)) return { ok: false, error: (body && body.error) || `HTTP ${res.status}` };
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

/**
 * Thesis critic: the same endpoint with action=thesis-critique. The payload holds the thesis and ONLY
 * already-computed numbers (src/lib/thesisMetrics.js). Returns {ok, data:{critique, model, cached}} or
 * {ok:false, error, status, rateLimited}.
 */
export async function requestThesisCritique(mode, payload) {
  if (mode !== 'standard') {
    throw new Error('The thesis critic is disabled outside Standard mode.');
  }
  try {
    const res = await fetch(`${AI_ENDPOINT}?action=thesis-critique`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'standard', action: 'thesis-critique', payload }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || !body || !body.critique) return { ok: false, error: (body && body.error) || `HTTP ${res.status}`, status: res.status, rateLimited: res.status === 429 || Boolean(body && body.rateLimited) };
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}`, status: 0, rateLimited: false };
  }
}
