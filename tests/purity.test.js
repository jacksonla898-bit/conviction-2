// Run with: npm test
// Wharton purity: the Wharton path must never import or call the AI module, and a Wharton report
// must contain no AI-written text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportData, reportFilename, WHARTON_FOOTER, AI_SECTION_TITLE, DISCLAIMER } from '../src/lib/reportData.js';
import { requestReasoning, AI_ENDPOINT } from '../src/lib/ai.js';
import { computeConviction, DEFAULT_WEIGHTS, MODEL_ORDER } from '../src/models/conviction.js';
import { computeAttribution } from '../src/models/attribution.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const srcFiles = walk(path.join(root, 'src')).filter((f) => /\.(js|jsx)$/.test(f));
const rel = (f) => path.relative(root, f).replace(/\\/g, '/');

test('only src/lib/ai.js knows the AI endpoint', () => {
  for (const f of srcFiles) {
    if (rel(f) === 'src/lib/ai.js') continue;
    assert.ok(!fs.readFileSync(f, 'utf8').includes(AI_ENDPOINT), `${rel(f)} must not reference ${AI_ENDPOINT}`);
  }
});

test('the AI module is never imported statically', () => {
  const staticImport = /import\s+[^;]*?from\s+['"][^'"]*\/ai\.js['"]/;
  for (const f of srcFiles) assert.ok(!staticImport.test(fs.readFileSync(f, 'utf8')), `${rel(f)} statically imports the AI module`);
});

test('only the Standard-mode call sites load the AI module (dynamically)', () => {
  const users = srcFiles.filter((f) => rel(f) !== 'src/lib/ai.js' && /ai\.js/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(users, ['src/App.jsx', 'src/components/AssetAnalysis.jsx', 'src/components/GraderPage.jsx', 'src/components/OptimizerPage.jsx', 'src/components/PortfolioPage.jsx']);
  for (const u of users) {
    const text = fs.readFileSync(path.join(root, u), 'utf8');
    // Every load must sit behind a Standard-mode check, and the call must pass the literal mode.
    assert.match(text, /import\(['"][^'"]*\/ai\.js['"]\)/);
    assert.match(text, /requestReasoning\('standard'/);
  }
});

test('Wharton-path modules do not mention the AI module at all', () => {
  const whartonPath = ['src/lib/reportData.js', 'src/lib/tearSheet.js', 'src/components/report/TearSheet.jsx', 'src/components/Reasoning.jsx', 'src/components/Attribution.jsx', 'src/components/DcfScenarios.jsx', 'src/components/Prov.jsx', 'src/components/HistoryPage.jsx', 'src/lib/logPayload.js', 'src/lib/provenance.js', 'src/lib/api.js',
    'src/components/Methodology.jsx', 'src/components/AssetModelCard.jsx', 'src/components/chartsPortfolio.jsx', 'src/lib/assetPipeline.js', 'src/lib/portfolioData.js', 'src/models/assets.js', 'src/models/bondMath.js', 'src/models/portfolioGrade.js', 'src/models/optimizer.js'];
  for (const p of whartonPath) {
    const text = fs.readFileSync(path.join(root, p), 'utf8');
    assert.ok(!/['"][^'"]*\/ai\.js['"]/.test(text), `${p} references the AI module`);
  }
});

test('requestReasoning refuses to run outside Standard mode and makes no network call', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('fetch must not be called');
  };
  try {
    await assert.rejects(() => requestReasoning('wharton', 'AAPL', {}), /disabled outside Standard mode/);
    await assert.rejects(() => requestReasoning(undefined, 'AAPL', {}), /disabled outside Standard mode/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the server function rejects non-Standard requests before any Anthropic call', async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-used';
  const { default: handler } = await import('../api/reason.js');
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: 'POST', body: { mode: 'wharton', ticker: 'AAPL', payload: { a: 1 } } }, res);
  assert.equal(out.status, 403);
  await handler({ method: 'POST', body: { ticker: 'AAPL', payload: { a: 1 } } }, res);
  assert.equal(out.status, 403, 'a request with no mode is rejected too');
});

// ---- report data ----
const SECRET = 'ZZ_AI_TEXT_SENTINEL_ZZ this sentence was written by a language model.';
const fakeResults = () => Object.fromEntries(MODEL_ORDER.map((id, i) => [id, {
  id, name: id, available: id !== 'earnings', error: id === 'earnings' ? 'Finnhub earnings endpoint failed: HTTP 401.' : undefined,
  subscore: id === 'earnings' ? null : 40 + i * 9, keyOutput: `key output ${id}`, scoringRule: `rule ${id}`, note: `note ${id}`,
  inputs: [{ label: 'input', value: '1', source: 'Alpaca' }], steps: [{ label: 'step', formula: 'a = b', calc: '1 = 1', result: '1' }], drivers: [],
  metrics: { price: 100 },
  chart: id === 'dcf' ? { scenarios: { bear: { key: 'bear', label: 'Bear', available: true, value: 80, upside: -0.2, g: 0.03, r: 0.09, gT: 0.02 }, base: { key: 'base', label: 'Base', available: true, value: 100, upside: 0, g: 0.08, r: 0.08, gT: 0.025 }, bull: { key: 'bull', label: 'Bull', available: true, value: 130, upside: 0.3, g: 0.13, r: 0.07, gT: 0.03 } }, deltasText: 'deltas', tornado: { baseValue: 100, price: 100, rows: [] } } : id === 'momentum' ? { series: [] } : id === 'monteCarlo' ? { fan: [], S0: 100 } : {},
}]));

function reportFor(mode, reasoning) {
  const results = fakeResults();
  const conviction = computeConviction(results, DEFAULT_WEIGHTS);
  const attribution = computeAttribution(conviction, results, DEFAULT_WEIGHTS);
  return buildReportData({ mode, ticker: 'TEST', companyName: 'Test Co', runAt: new Date(2026, 9, 12, 14, 5), price: 100, priceAsOf: '2026-10-09', conviction, attribution, results, sources: [], reasoning, appVersion: '2.1.0' });
}

test('Wharton report: no AI text even if AI text is passed in', () => {
  const data = reportFor('wharton', { status: 'done', text: SECRET, model: 'claude-sonnet-5-5' });
  const dump = JSON.stringify(data);
  assert.ok(!dump.includes('ZZ_AI_TEXT_SENTINEL_ZZ'), 'AI text leaked into the Wharton report');
  assert.ok(!dump.includes(AI_SECTION_TITLE), 'Wharton report must not have an AI section');
  assert.equal(data.containsAiText, false);
  assert.equal(data.footerLine, WHARTON_FOOTER);
  assert.equal(data.narrative.kind, 'methodology');
  assert.equal(data.narrative.models.length, 6);
  assert.equal(data.narrative.models.find((m) => m.id === 'earnings').available, false);
  assert.equal(data.disclaimer, DISCLAIMER);
  assert.equal(data.filename, 'Conviction_TEST_2026-10-12_Wharton.pdf');
});

test('Standard report: AI text is included and labelled', () => {
  const data = reportFor('standard', { status: 'done', text: SECRET, model: 'claude-sonnet-5-5' });
  assert.equal(data.narrative.kind, 'ai');
  assert.equal(data.narrative.title, AI_SECTION_TITLE);
  assert.ok(data.narrative.text.includes('ZZ_AI_TEXT_SENTINEL_ZZ'));
  assert.equal(data.footerLine, null);
  assert.equal(data.filename, 'Conviction_TEST_2026-10-12_Standard.pdf');
});

test('Standard report with no AI text says Unavailable with a reason, never a substitute', () => {
  const data = reportFor('standard', { status: 'error', text: null, error: 'Anthropic rate limit' });
  assert.equal(data.narrative.text, null);
  assert.equal(data.narrative.unavailableReason, 'Anthropic rate limit');
  assert.equal(data.containsAiText, false);
});

test('report filename format', () => {
  assert.equal(reportFilename('NVDA', '2026-10-25', 'standard'), 'Conviction_NVDA_2026-10-25_Standard.pdf');
  assert.equal(reportFilename('PRLB', '2026-10-25', 'wharton'), 'Conviction_PRLB_2026-10-25_Wharton.pdf');
});

test('an unavailable model is reported as Unavailable with its reason and excluded from the weights', () => {
  const data = reportFor('wharton', null);
  const e = data.models.find((m) => m.id === 'earnings');
  assert.equal(e.status, 'unavailable');
  assert.match(e.reason, /Finnhub earnings endpoint failed/);
  assert.equal(e.subscore, null);
  assert.equal(e.weightUsed, null);
  assert.equal(e.contribution, 0);
  const used = data.models.filter((m) => m.included).reduce((s, m) => s + m.weightUsed, 0);
  assert.ok(Math.abs(used - 1) < 1e-9);
});
