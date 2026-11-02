// Run with: npm test
// Thesis critic: payload building and validation, evidence filtering, stray-number detection, the retry
// rule, and the Standard-only / server-only rules. No network: the Anthropic client is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildThesisCritiquePayload, describeMetric, formatMetric } from '../src/lib/thesisMetrics.js';
import { validatePayload, validateCritique, strayNumbers, critiqueThesis, payloadHash, ipHash, CRITIQUE_SCHEMA } from '../api/_lib/thesisCritic.js';
import { critiqueIfStandard, WHARTON_SKIP } from '../src/lib/aiGate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THESIS = 'This is a low-risk, defensive basket that should beat the market comfortably over the horizon.';

const grade = {
  score: 62, label: 'High', avgCorr: 0.4123, hhi: 0.34,
  pillars: [{ id: 'quality', score: 58.44 }, { id: 'diversification', score: 61.2 }, { id: 'risk', score: null }],
  holdings: [{ ticker: 'NVDA' }, { ticker: 'TLT' }],
  riskMetrics: { vol: 0.4632, beta: 1.4567, mdd: -0.3211, var95: 0.03456, sharpe: 0.876, cumReturn: 0.5, spyCumReturn: 0.3, window: { from: '2024-01-02', to: '2026-10-30' } },
};
const holdings = [{ ticker: 'NVDA', assetType: 'stock', weight: 0.6, score: 55 }, { ticker: 'TLT', assetType: 'bond_etf', weight: 0.4, score: null, error: 'fund facts unavailable' }];
const analyses = { NVDA: { assetType: 'stock', conviction: { label: 'Neutral' }, results: { dcf: { available: true, subscore: 22 }, monteCarlo: { available: true, subscore: 61 }, risk: { available: false, error: 'beta failed' }, momentum: { available: true, subscore: 80 }, health: { available: true, subscore: 90 }, earnings: { available: true, subscore: 70 } } } };

function payload() {
  return buildThesisCritiquePayload({ def: { thesis: `  ${THESIS}  `, horizon: { value: 6, unit: 'months' }, targetGrowth: 12 }, grade, holdings, analyses });
}

test('payload flattens only computed numbers, rounded like the UI, and marks unavailable values as facts', () => {
  const p = payload();
  assert.equal(p.thesis, THESIS);
  assert.equal(p.metrics['portfolio.vol'], 46.3);
  assert.equal(p.metrics['portfolio.beta'], 1.46);
  assert.equal(p.metrics['portfolio.var95'], 3.46);
  assert.equal(p.metrics['portfolio.pillar.quality'], 58);
  assert.equal(p.metrics['NVDA.weight'], 60);
  assert.equal(p.metrics['NVDA.subscore.dcf'], 22);
  assert.ok(!('NVDA.subscore.risk' in p.metrics), 'an Unavailable subscore is never sent as a number');
  assert.match(p.facts['NVDA.subscore.risk'], /unavailable/);
  assert.ok(!('portfolio.pillar.risk' in p.metrics));
  assert.ok(!('TLT.score' in p.metrics));
  assert.equal(p.facts['stress.status'], 'not run');
  for (const k of Object.keys(p.metrics)) assert.ok(describeMetric(k), `${k} is a known metric key`);
  assert.equal(formatMetric('portfolio.vol', 46.3), '46.3%');
});

test('server re-validates: short thesis, missing grade, bad ticker and unknown keys', () => {
  assert.equal(validatePayload({ ...payload(), thesis: 'too short' }).ok, false);
  const noGrade = payload();
  delete noGrade.metrics['portfolio.grade'];
  assert.equal(validatePayload(noGrade).ok, false);
  assert.equal(validatePayload({ ...payload(), holdings: [{ ticker: 'not a ticker!' }] }).ok, false);
  const p = payload();
  p.metrics['made.up'] = 99;
  p.metrics['portfolio.vol'] = 46.3049;
  const v = validatePayload(p);
  assert.equal(v.ok, true);
  assert.ok(!('made.up' in v.payload.metrics));
  assert.equal(v.payload.metrics['portfolio.vol'], 46.3);
  assert.equal(payloadHash(v.payload), payloadHash(validatePayload(payload()).payload), 'hash is stable for equivalent input');
});

test('evidence with an unknown key or a mismatched value is dropped; stray numbers are found', () => {
  const p = validatePayload(payload()).payload;
  const raw = {
    thesis_claims: [{ claim: 'Low risk', verdict: 'contradicted', explanation: 'Volatility is 46.3%, beta 1.46, and a price target of 250 is not measured.', evidence: [{ metric_key: 'portfolio.vol', value: 46.3 }, { metric_key: 'portfolio.vol', value: 40 }, { metric_key: 'NVDA.price', value: 900 }] }],
    bear_case: [{ point: 'The DCF subscore is 22.', evidence: [{ metric_key: 'NVDA.subscore.dcf', value: 22 }] }],
    would_change_my_mind: ['Volatility well below 46%.'],
    blind_spots: ['Management quality in the 2020 COVID crash is not measured.'],
  };
  const r = validateCritique(raw, p);
  assert.equal(r.dropped, 2);
  assert.deepEqual(r.critique.thesis_claims[0].evidence, [{ metric_key: 'portfolio.vol', value: 46.3 }]);
  assert.deepEqual(r.stray.sort(), ['2020', '250'].sort(), 'scenario years are allowed only when that scenario is in the payload');
  assert.deepEqual(strayNumbers('Volatility of 0.463 and 46%', p), [], 'decimal and rounded forms of a metric are allowed');
});

test('a stray number triggers exactly one retry; a second failure returns a clean error, never the critique', async () => {
  const p = validatePayload(payload()).payload;
  const bad = { thesis_claims: [{ claim: 'x', verdict: 'supported', explanation: 'Up 37% next year.', evidence: [] }], bear_case: [], would_change_my_mind: [], blind_spots: [] };
  const good = { ...bad, thesis_claims: [{ claim: 'x', verdict: 'contradicted', explanation: 'Volatility is 46.3%.', evidence: [{ metric_key: 'portfolio.vol', value: 46.3 }] }] };
  const fake = (answers) => {
    const calls = [];
    return { calls, messages: { create: async (req) => { calls.push(req); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answers[calls.length - 1]) }], usage: {} }; } } };
  };
  const c1 = fake([bad, good]);
  const ok = await critiqueThesis({ payload: p, client: c1, model: 'test-model' });
  assert.equal(ok.ok, true);
  assert.equal(c1.calls.length, 2);
  assert.match(c1.calls[1].messages[0].content, /IMPORTANT CORRECTION: .*37%/);
  assert.equal(c1.calls[0].max_tokens, 1500);
  assert.deepEqual(c1.calls[0].output_config.format, { type: 'json_schema', schema: CRITIQUE_SCHEMA });
  assert.match(c1.calls[0].messages[0].content, /<thesis>\n[\s\S]*\n<\/thesis>/);
  const c2 = fake([bad, bad]);
  const fail = await critiqueThesis({ payload: p, client: c2, model: 'test-model' });
  assert.equal(fail.ok, false);
  assert.equal(c2.calls.length, 2);
  assert.equal(fail.critique, undefined);
  assert.match(fail.error, /not among the computed values/);
});

test('the server refuses thesis-critique in Wharton mode before any Anthropic or database call', async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-used';
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('no network'); };
  try {
    const { default: handler } = await import('../api/reason.js');
    for (const mode of ['wharton', undefined, 'Wharton']) {
      const out = {};
      const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
      await handler({ method: 'POST', query: { action: 'thesis-critique' }, headers: {}, body: { mode, action: 'thesis-critique', payload: payload() } }, res);
      assert.equal(out.status, 403);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Wharton mode: the critic gate makes no network call', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}'); };
  try {
    for (const mode of ['wharton', undefined, null, '']) {
      const r = await critiqueIfStandard(mode, payload());
      assert.equal(r.skipped, true);
      assert.equal(r.error, WHARTON_SKIP);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('IP is stored only as a salted hash; no VITE_ variables; the log payload has no critique text', () => {
  const h = ipHash('203.0.113.7', 'a-long-salt-value-123');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, ipHash('203.0.113.7', 'another-salt-value-456'));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const f of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'api'))].filter((x) => /\.(js|jsx)$/.test(x))) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/import\.meta\.env\.VITE_|process\.env\.VITE_/.test(text), `${f} reads a VITE_ variable`);
  }
  const logPayload = fs.readFileSync(path.join(root, 'src/lib/logPayload.js'), 'utf8');
  const analysesApi = fs.readFileSync(path.join(root, 'api/analyses.js'), 'utf8');
  assert.ok(!/critique|thesisMetrics/i.test(logPayload) && !/critique/i.test(analysesApi), 'the analysis log must not carry critique text');
});

test('Wharton rendering: the critic is shown only when mode is standard', () => {
  const page = fs.readFileSync(path.join(root, 'src/components/PortfolioPage.jsx'), 'utf8');
  assert.match(page, /const showCritic = settings\.mode === 'standard' && Boolean\(critic\);/);
  assert.match(page, /showCritic \? <ThesisCriticButton/);
  assert.match(page, /\{showCritic && <ThesisCriticCard/);
  const grader = fs.readFileSync(path.join(root, 'src/components/GraderPage.jsx'), 'utf8');
  assert.match(grader, /settings\.mode === 'standard' && result \? \{ grade/);
});

test('Vercel Hobby: still at most 12 serverless functions (no new function file)', () => {
  const fns = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.ok(fns.length <= 12, `${fns.length} functions`);
  assert.ok(!fns.some((f) => /thesis|critic/i.test(f)), 'the critic must be an action on api/reason.js, not its own function');
});
