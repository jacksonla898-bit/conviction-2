// Run with: npm test
// Track Record: base-date rule, pending windows (never partial numbers), excess vs SPY, Spearman, small-sample flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { easternParts, baseIndex, runOutcome, summarize, spearman, ranks, HORIZONS, MIN_SAMPLE, scatterPoints } from '../src/models/trackRecord.js';

function bars(from, n, f) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  let i = 0;
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), close: f(i++) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test('base date: before 16:00 ET uses the previous close, after uses the same day', () => {
  assert.deepEqual(easternParts('2026-03-10T14:00:00Z'), { date: '2026-03-10', afterClose: false }); // 10:00 EDT
  assert.deepEqual(easternParts('2026-03-10T21:30:00Z'), { date: '2026-03-10', afterClose: true }); // 17:30 EDT
  const s = bars('2026-03-02', 10, (i) => 100 + i);
  assert.equal(s[baseIndex(s, '2026-03-10T14:00:00Z')].date, '2026-03-09');
  assert.equal(s[baseIndex(s, '2026-03-10T21:30:00Z')].date, '2026-03-10');
});

test('windows that have not finished are pending, never partial', () => {
  const s = bars('2026-01-05', 40, (i) => 100 + i);
  const spy = bars('2026-01-05', 40, () => 100);
  const o = runOutcome({ id: 1, ticker: 'X', score: 70, created_at: '2026-01-06T22:00:00Z', asset_type: 'stock' }, s, spy);
  assert.equal(o.windows.m1.status, 'ok');
  assert.equal(o.windows.m3.status, 'pending');
  assert.equal(o.windows.m6.status, 'pending');
  assert.equal(o.windows.m3.ret, undefined);
  assert.ok(o.windows.m3.tradingDaysLeft > 0);
});

test('forward and excess returns use the same two dates for the asset and SPY', () => {
  const s = bars('2025-01-02', 200, (i) => 100 * (1.001 ** i));
  const spy = bars('2025-01-02', 200, (i) => 50 * (1.0005 ** i));
  const o = runOutcome({ id: 1, ticker: 'X', score: 80, created_at: '2025-01-03T21:00:00Z' }, s, spy);
  const w = o.windows.m3;
  assert.equal(w.status, 'ok');
  assert.ok(Math.abs(w.ret - (1.001 ** 63 - 1)) < 1e-12);
  assert.ok(Math.abs(w.spyRet - (1.0005 ** 63 - 1)) < 1e-12);
  assert.ok(Math.abs(w.excess - (w.ret - w.spyRet)) < 1e-15);
  assert.equal(o.label, 'Very High');
});

test('Treasury runs and missing history are unavailable with a reason', () => {
  const spy = bars('2025-01-02', 10, () => 1);
  assert.equal(runOutcome({ id: 1, ticker: 'US10Y', score: 80, created_at: '2025-01-03T21:00:00Z', asset_type: 'treasury' }, null, spy).status, 'unavailable');
  assert.match(runOutcome({ id: 2, ticker: 'ZZZ', score: 50, created_at: '2025-01-03T21:00:00Z' }, [], spy).reason, /No daily price history/);
});

test('Spearman with ties, and correlation needs at least 3 points', () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-12);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-12);
  assert.equal(spearman([1, 2], [1, 2]), null);
});

test('every bucket below 30 runs is flagged as a small sample', () => {
  const s = bars('2024-01-02', 400, (i) => 100 + i);
  const spy = bars('2024-01-02', 400, () => 100);
  const rows = Array.from({ length: 12 }, (_, k) => ({ id: k, ticker: 'X', score: 30 + k * 5, created_at: '2024-01-03T21:00:00Z' }));
  const outs = rows.map((r) => runOutcome(r, s, spy));
  const sum = summarize(outs);
  assert.equal(sum.counts.completed.m6, 12);
  assert.ok(sum.anySmall);
  for (const label of Object.keys(sum.byLabel)) for (const h of HORIZONS) assert.equal(sum.byLabel[label][h.id].small, sum.byLabel[label][h.id].n < MIN_SAMPLE);
  assert.equal(sum.correlation.m3.n, 12);
  assert.equal(sum.correlation.m3.small, true);
  assert.equal(scatterPoints(outs).length, 12);
});
