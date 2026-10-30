// Run with: npm test
// Stress test model: scenario replay, coverage rules, shocks; saved-portfolio backup validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, runScenario, runShocks, summarize, covers, betaVsSpy } from '../src/models/stressTest.js';
import { parseBackup, BACKUP_VERSION } from '../src/lib/savedPortfolios.js';

// Deterministic synthetic daily closes: a geometric path from `start` with the given per-day return.
function series(from, days, dailyRet, startClose = 100) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  let c = startClose;
  for (let i = 0; i < days; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push({ date: d.toISOString().slice(0, 10), close: c });
    c *= 1 + dailyRet(i);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const covid = SCENARIOS.find((s) => s.id === 'covid');
const dotcom = SCENARIOS.find((s) => s.id === 'dotcom');

test('a 60/40 SPY/AGG portfolio matches the 60/40 benchmark row exactly', () => {
  const spy = series('2019-06-03', 400, (i) => (i % 7 === 0 ? -0.03 : 0.004));
  const agg = series('2019-06-03', 400, (i) => (i % 11 === 0 ? -0.004 : 0.0007));
  const holdings = [{ ticker: 'SPY', weight: 0.6, series: spy, assetType: 'equity_etf' }, { ticker: 'AGG', weight: 0.4, series: agg, assetType: 'bond_etf' }];
  const r = runScenario(covid, holdings, spy, agg);
  assert.equal(r.status, 'ok');
  assert.equal(r.coverage, 1);
  assert.ok(Math.abs(r.totalReturn - r.benchmarks.sixtyForty.totalReturn) < 1e-12);
  assert.ok(Math.abs(r.maxDrawdown - r.benchmarks.sixtyForty.maxDrawdown) < 1e-12);
  assert.equal(r.recoveryDays, r.benchmarks.sixtyForty.recoveryDays);
  assert.equal(r.chart[0].portfolio, 100);
  assert.ok(r.chart.every((p) => Math.abs(p.portfolio - p.sixtyForty) < 1e-9));
});

test('holdings without data for a scenario are excluded, weights re-normalized and coverage shown', () => {
  const spy = series('2019-06-03', 400, () => 0.001);
  const late = series('2020-03-10', 100, () => 0.002); // starts after the COVID scenario start
  const holdings = [{ ticker: 'SPY', weight: 0.7, series: spy, assetType: 'equity_etf' }, { ticker: 'NEW', weight: 0.3, series: late, assetType: 'equity_etf' }];
  const r = runScenario(covid, holdings, spy, null);
  assert.equal(r.status, 'ok');
  assert.ok(Math.abs(r.coverage - 0.7) < 1e-12);
  assert.match(r.coverageText, /Coverage: 70% of portfolio — NEW excluded \(no data before 2020-03-10\)/);
  assert.equal(r.weightsUsed.length, 1);
  assert.ok(Math.abs(r.weightsUsed[0].weight - 1) < 1e-12);
  assert.equal(r.benchmarks.sixtyForty.status, 'unavailable');
});

test('below 50% coverage the scenario is unavailable, never estimated', () => {
  const spy = series('2019-06-03', 400, () => 0.001);
  const late = series('2020-03-10', 100, () => 0.002);
  const holdings = [{ ticker: 'SPY', weight: 0.4, series: spy, assetType: 'equity_etf' }, { ticker: 'NEW', weight: 0.6, series: late, assetType: 'equity_etf' }];
  const r = runScenario(covid, holdings, spy, null);
  assert.equal(r.status, 'unavailable');
  assert.match(r.reason, /insufficient history/);
  assert.equal(r.chart.length, 0);
});

test('a post-2016 series does not cover the dot-com scenario; coverage text names the first date', () => {
  const spy = series('2016-01-04', 300, () => 0.001);
  assert.equal(covers(spy, dotcom.start, dotcom.end), false);
  const r = runScenario(dotcom, [{ ticker: 'SPY', weight: 1, series: spy, assetType: 'equity_etf' }], spy, null);
  assert.equal(r.status, 'unavailable');
  assert.match(r.coverageText, /no data before 2016-01-04/);
  assert.equal(r.benchmarks.spy.status, 'unavailable');
});

test('recovery time counts trading days after the scenario end, or reports not yet recovered', () => {
  // Falls 1% a day during the scenario, then rises 2% a day afterwards
  const end = new Date(`${covid.end}T00:00:00Z`);
  const spy = series('2020-01-02', 120, (i) => {
    const d = new Date(`2020-01-02T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.round(i * 7 / 5));
    return d <= end ? -0.01 : 0.02;
  });
  const r = runScenario(covid, [{ ticker: 'SPY', weight: 1, series: spy, assetType: 'equity_etf' }], null, null);
  assert.equal(r.status, 'ok');
  assert.ok(r.totalReturn < 0);
  assert.equal(r.recovered, true);
  assert.ok(r.recoveryDays > 0);
  const flat = series('2020-01-02', 120, (i) => (i < 60 ? -0.01 : 0));
  const r2 = runScenario(covid, [{ ticker: 'SPY', weight: 1, series: flat, assetType: 'equity_etf' }], null, null);
  assert.equal(r2.recovered, false);
  assert.equal(r2.recoveryDays, null);
});

test('rate shock: 100% TLT (long duration) loses more than 100% SHY (short duration) at +2%', () => {
  const tlt = runShocks([{ ticker: 'TLT', weight: 1, assetType: 'bond_etf', duration: 16.5, beta: null }], 10000);
  const shy = runShocks([{ ticker: 'SHY', weight: 1, assetType: 'bond_etf', duration: 1.9, beta: null }], 10000);
  const t2 = tlt.rates.find((s) => s.id === 'rate2');
  const s2 = shy.rates.find((s) => s.id === 'rate2');
  assert.ok(t2.estReturn < s2.estReturn);
  assert.ok(Math.abs(t2.estReturn - -0.33) < 1e-9);
  assert.ok(Math.abs(t2.dollars - -3300) < 1e-6);
  assert.equal(tlt.market[0].status, 'unavailable'); // no equity holding → market shock cannot be estimated
  assert.equal(tlt.market[0].coverage, 0);
});

test('market shock excludes bonds, applies beta to equities and reports coverage', () => {
  const r = runShocks([
    { ticker: 'SPY', weight: 0.6, assetType: 'equity_etf', beta: 1.0 },
    { ticker: 'AGG', weight: 0.4, assetType: 'bond_etf', duration: 6 },
    { ticker: 'XYZ', weight: 0, assetType: 'stock', beta: null, betaReason: 'fewer than 60 common days with SPY' },
  ], 10000);
  const m10 = r.market.find((s) => s.id === 'mkt10');
  assert.ok(Math.abs(m10.coverage - 0.6) < 1e-12);
  assert.ok(Math.abs(m10.estReturn - -0.06) < 1e-12);
  assert.ok(Math.abs(m10.dollars - -600) < 1e-9);
  assert.match(m10.coverageText, /AGG \(bond ETF: market beta is not applied\)/);
  assert.match(m10.coverageText, /XYZ \(fewer than 60 common days with SPY\)/);
  const summary = summarize([], r);
  assert.equal(summary.worstShock.id, 'mkt20');
  assert.equal(summary.vulnerable.ticker, 'SPY');
});

test('beta vs SPY needs at least 60 common days', () => {
  const spy = Array.from({ length: 100 }, (_, i) => ({ date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`, ret: ((i * 7) % 5 - 2) / 100 }));
  const r = spy.map((p) => ({ date: p.date, ret: 2 * p.ret }));
  const b = betaVsSpy(r, spy);
  assert.ok(Math.abs(b.beta - 2) < 1e-9);
  assert.equal(betaVsSpy(r.slice(0, 30), spy), null);
});

test('backup import validates the file and rejects malformed content', () => {
  assert.equal(parseBackup('not json').ok, false);
  assert.match(parseBackup('{"kind":"other","portfolios":[]}').error, /not a Conviction 2.0 portfolio backup/);
  assert.match(parseBackup(JSON.stringify({ kind: 'saved-portfolios', version: BACKUP_VERSION, portfolios: [{ holdings: [] }] })).error, /malformed/);
  assert.match(parseBackup(JSON.stringify({ kind: 'saved-portfolios', version: BACKUP_VERSION, portfolios: [{ name: 'x', holdings: [{ amount: 1 }] }] })).error, /malformed holding/);
  assert.match(parseBackup(JSON.stringify({ kind: 'saved-portfolios', version: BACKUP_VERSION + 1, portfolios: [] })).error, /Unsupported backup version/);
  const ok = parseBackup(JSON.stringify({ kind: 'saved-portfolios', version: BACKUP_VERSION, portfolios: [{ id: 'a', name: 'Core', holdings: [{ ticker: 'spy', amount: 60 }, { ticker: 'agg', amount: 40 }], mode: 'percent', snapshots: [{ date: '2026-10-01', score: 70, label: 'High' }, { bad: true }] }] }));
  assert.equal(ok.ok, true);
  assert.equal(ok.portfolios[0].holdings[0].ticker, 'SPY');
  assert.equal(ok.portfolios[0].snapshots.length, 1);
});
