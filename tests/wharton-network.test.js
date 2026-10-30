// Run with: npm test
// Proves that Wharton mode makes zero AI network calls: every fetch is recorded while the AI gate is
// called in Wharton mode for every kind of explanation the app can request. The gate must return
// without touching the network, and the AI module must never be loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explainIfStandard, WHARTON_SKIP } from '../src/lib/aiGate.js';
import { AI_ENDPOINT } from '../src/lib/ai.js';

const KINDS = [
  ['AAPL', { kind: 'stock', score: 57 }],
  ['TLT', { kind: 'asset', score: 40 }],
  ['Portfolio', { kind: 'grade', score: 70 }],
  ['Optimizer', { kind: 'optimize', scoreAfter: 72 }],
  ['Stress test', { kind: 'stress', scenarios: [] }],
  ['My thesis', { kind: 'portfolio', thesis: 'x' }],
];

function recordFetch() {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ text: 'AI TEXT SHOULD NEVER APPEAR', model: 'test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test('Wharton mode: the AI gate makes no network call for any explanation kind', async () => {
  const rec = recordFetch();
  try {
    for (const mode of ['wharton', undefined, null, 'Wharton', '']) {
      for (const [subject, payload] of KINDS) {
        const res = await explainIfStandard(mode, subject, payload);
        assert.equal(res.ok, false);
        assert.equal(res.skipped, true);
        assert.equal(res.error, WHARTON_SKIP);
        assert.equal(res.data, undefined, 'no AI text is returned');
      }
    }
    assert.equal(rec.calls.length, 0, `expected no fetch, saw: ${rec.calls.join(', ')}`);
    assert.ok(!rec.calls.some((u) => u.includes(AI_ENDPOINT)));
  } finally {
    rec.restore();
  }
});

test('Standard mode: the same gate does call the AI endpoint (the test above is not vacuous)', async () => {
  const rec = recordFetch();
  try {
    const res = await explainIfStandard('standard', 'AAPL', { kind: 'stock', score: 57 });
    assert.equal(rec.calls.length, 1);
    assert.ok(rec.calls[0].includes(AI_ENDPOINT));
    assert.equal(res.ok, true);
  } finally {
    rec.restore();
  }
});
