// The only door to the AI module. Every Standard-mode explanation goes through explainIfStandard().
// In Wharton mode it returns immediately: src/lib/ai.js is never imported (so its code is never
// downloaded), fetch is never called, and the AI endpoint is never contacted. tests/wharton-network.test.js
// proves this by recording every fetch while calling the gate in Wharton mode.

export const WHARTON_SKIP = 'Wharton mode: AI explanations are turned off; only template text is shown.';

/**
 * @param {string} mode       'standard' | 'wharton' (anything other than 'standard' is treated as Wharton)
 * @param {string} subject    ticker or page name shown to the model
 * @param {object} payload    computed numbers only
 * @returns {Promise<{ok: boolean, data?: object, error?: string, skipped?: boolean}>}
 */
export async function explainIfStandard(mode, subject, payload) {
  if (mode !== 'standard') return { ok: false, skipped: true, error: WHARTON_SKIP };
  const { requestReasoning } = await import('./ai.js');
  return requestReasoning('standard', subject, payload);
}
