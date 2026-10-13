// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { dcfValue } from '../src/models/dcfValue.js';
import { buildScenarios, buildTornado, buildGrid, shiftGrowth, DCF_SCENARIO_CONFIG } from '../src/models/dcfScenarios.js';

const baseOf = (over = {}) => {
  const b = { fcf0: 96.68e9, g: 0.25, gT: 0.025, years: 5, netDebtAdj: 2.14e9, shares: 24.1e9, rf: 0.0425, erp: 0.05, beta: 1.89, gMin: -0.1, gMax: 0.25, overrideSet: false, baseYear: 2026, ...over };
  return { ...b, r: over.r ?? b.rf + b.beta * b.erp };
};

test('bull ≥ base ≥ bear', () => {
  for (const base of [baseOf(), baseOf({ g: 0.015, beta: 0.69 }), baseOf({ g: -0.1, beta: 1.2 }), baseOf({ g: 0.12, overrideSet: true })]) {
    const s = buildScenarios(base, 200);
    assert.ok(s.bull.value >= s.base.value, 'bull must be at least base');
    assert.ok(s.base.value >= s.bear.value, 'base must be at least bear');
    assert.equal(s.base.value, dcfValue(base).perShare, 'base scenario equals the scored valuation');
  }
});

test('NVDA-like case: growth already at the 25% cap', () => {
  const base = baseOf(); // g = 25% = cap
  const s = buildScenarios(base, 229.35);
  assert.equal(s.bull.g, 0.25, 'bull growth stays at the cap');
  assert.equal(s.bull.growthCapped, true);
  assert.ok(Math.abs(s.bear.g - 0.2) < 1e-12, 'bear growth is base − 5 pts');
  assert.ok(s.bull.value > s.base.value, 'bull still exceeds base through the discount rate and terminal growth');
  assert.ok(Math.abs(s.bull.r - (base.r - 0.01)) < 1e-12);
  assert.ok(Math.abs(s.bear.gT - 0.02) < 1e-12);
});

test('FCF growth override flows through all three scenarios, uncapped', () => {
  const base = baseOf({ g: 0.3, overrideSet: true }); // override above the 25% cap
  const s = buildScenarios(base, 200);
  assert.ok(Math.abs(s.base.g - 0.3) < 1e-12);
  assert.ok(Math.abs(s.bull.g - 0.35) < 1e-12, 'bull = override + 5 pts, not capped');
  assert.ok(Math.abs(s.bear.g - 0.25) < 1e-12, 'bear = override − 5 pts');
  assert.equal(s.bull.growthCapped, false);
  assert.equal(shiftGrowth(base, 0.05).capped, false);
});

test('the growth floor also binds', () => {
  const s = buildScenarios(baseOf({ g: -0.1, beta: 1 }), 50);
  assert.equal(s.bear.g, -0.1);
  assert.equal(s.bear.growthCapped, true);
});

test('a scenario whose discount rate is not above terminal growth is unavailable, never a number', () => {
  const base = baseOf({ g: 0.02, beta: 0.1, rf: 0.03, erp: 0.05, r: 0.035 }); // r 3.5%, gT 2.5%
  const s = buildScenarios(base, 100);
  assert.equal(s.base.available, true);
  assert.equal(s.bull.available, false); // bull r 2.5% vs gT 3.0%
  assert.equal(s.bull.value, null);
  assert.match(s.bull.reason, /must exceed terminal growth/);
});

test('tornado: one input at a time, sorted by impact, contains the base value', () => {
  const base = baseOf({ g: 0.08, beta: 1.1 });
  const t = buildTornado(base, 150);
  assert.equal(t.baseValue, dcfValue(base).perShare);
  assert.deepEqual(t.rows.map((r) => r.key).sort(), ['beta', 'discount', 'erp', 'fcf', 'growth', 'terminal']);
  for (let i = 1; i < t.rows.length; i++) assert.ok(t.rows[i - 1].span >= t.rows[i].span, 'rows sorted by span');
  for (const r of t.rows) assert.ok(r.min <= t.baseValue + 1e-9 && r.max >= t.baseValue - 1e-9, `${r.key} range must contain base`);
  const fcf = t.rows.find((r) => r.key === 'fcf');
  assert.ok(fcf.valueAtHigh > fcf.valueAtLow);
  const disc = t.rows.find((r) => r.key === 'discount');
  assert.ok(disc.valueAtLow > disc.valueAtHigh, 'a lower discount rate gives a higher value');
});

test('grid: 5 × 5, base cell equals the base valuation', () => {
  const base = baseOf({ g: 0.08, beta: 1.1 });
  const grid = buildGrid(base, 150);
  assert.equal(grid.cells.length, 5);
  assert.equal(grid.cells[0].length, 5);
  assert.ok(Math.abs(grid.cells[grid.baseRow][grid.baseCol] - dcfValue(base).perShare) < 1e-9);
  assert.ok(grid.cells[0][4] > grid.cells[4][0], 'low discount + high growth beats high discount + low growth');
  assert.equal(grid.growths.length, DCF_SCENARIO_CONFIG.grid.growth.length);
});

test('dcfValue is undefined when r ≤ g_T', () => {
  assert.equal(dcfValue({ fcf0: 1, g: 0.05, r: 0.02, gT: 0.025, years: 5, netDebtAdj: 0, shares: 1 }), null);
});
