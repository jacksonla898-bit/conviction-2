// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradePortfolio, normalizeHoldings, alignReturns } from '../src/models/portfolioGrade.js';
import { optimize, projectSimplexBox, portVol, RISK_LEVELS } from '../src/models/optimizer.js';
import { parBondDuration, treasuryReturnsFromYields, historicalVar95 } from '../src/models/bondMath.js';
import { makeRng, makeNormal } from '../src/models/_math.js';

// Synthetic daily returns with a one-factor structure so correlations are controllable.
function synth(seed, n, { vol, beta = 1, drift = 0.0003 }, factor) {
  const rng = makeRng(seed);
  const z = makeNormal(rng);
  const out = [];
  const d = new Date('2023-10-01');
  for (let i = 0; i < n; i++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) {
      i--;
      continue;
    }
    const f = factor ? factor[i].ret : 0;
    out.push({ date: d.toISOString().slice(0, 10), ret: drift + beta * f + (vol / Math.sqrt(252)) * z() });
  }
  return out;
}
const N = 760;
const market = synth(1, N, { vol: 0.15 });
const spy = market.map((r) => ({ date: r.date, ret: r.ret }));
const agg = synth(2, N, { vol: 0.05, beta: 0.05, drift: 0.00012 }, market);
const tech = [3, 4, 5, 6, 7].map((s) => synth(s, N, { vol: 0.18, beta: 1.3, drift: 0.0005 }, market));
const tlt = synth(8, N, { vol: 0.13, beta: -0.2, drift: 0.0001 }, market);

const H = (ticker, assetType, weight, score, returns) => ({ ticker, assetType, weight, score, returns });

test('diversification: SPY/AGG beats a single stock and five correlated tech stocks', () => {
  const a = gradePortfolio({ holdings: [H('SPY', 'equity_etf', 0.6, 70, spy), H('AGG', 'bond_etf', 0.4, 60, agg)], spy, agg, rf: 0.04 });
  const b = gradePortfolio({ holdings: [H('AAPL', 'stock', 1, 58, tech[0])], spy, agg, rf: 0.04 });
  const c = gradePortfolio({ holdings: tech.map((r, i) => H(`T${i}`, 'stock', 0.2, 60, r)), spy, agg, rf: 0.04 });
  const div = (g) => g.pillars.find((p) => p.id === 'diversification').score;
  assert.ok(div(b) < div(a), `single stock ${div(b)} should be below SPY/AGG ${div(a)}`);
  assert.ok(div(c) < div(a), `5 tech ${div(c)} should be below SPY/AGG ${div(a)}`);
  assert.equal(div(b), 0, 'one holding: HHI 0, mix 0, correlation excluded');
  assert.ok(b.notes.some((n) => /Correlation unavailable with a single holding/.test(n)));
  assert.ok(a.score !== null && b.score !== null && c.score !== null);
});

test('pillar weights are 40/30/30 and re-normalize when a pillar is unavailable', () => {
  const g = gradePortfolio({ holdings: [H('SPY', 'equity_etf', 0.6, 70, spy), H('AGG', 'bond_etf', 0.4, 60, agg)], spy, agg, rf: 0.04 });
  const q = g.pillars.find((p) => p.id === 'quality');
  assert.ok(Math.abs(q.score - 66) < 1e-9, 'quality = 0.6×70 + 0.4×60');
  assert.deepEqual(g.pillars.map((p) => p.weight), [40, 30, 30]);
  const expected = Math.round(0.4 * q.score + 0.3 * g.pillars[1].score + 0.3 * g.pillars[2].score);
  assert.equal(g.score, expected);
  // No SPY history → risk pillar unavailable → weights renormalize over 70
  const g2 = gradePortfolio({ holdings: [H('SPY', 'equity_etf', 0.6, 70, spy), H('AGG', 'bond_etf', 0.4, 60, agg)], spy: null, agg, rf: 0.04 });
  assert.equal(g2.pillars.find((p) => p.id === 'risk').score, null);
  assert.ok(Math.abs(g2.pillars.find((p) => p.id === 'quality').normWeight - 40 / 70) < 1e-12);
  assert.ok(g2.notes.some((n) => /re-normalized/.test(n)));
});

test('unscored holding is excluded from quality but still counts for concentration', () => {
  const g = gradePortfolio({ holdings: [H('SPY', 'equity_etf', 0.5, 70, spy), H('XYZ', 'stock', 0.5, null, tech[1])], spy, agg, rf: 0.04 });
  assert.equal(g.pillars.find((p) => p.id === 'quality').score, 70);
  assert.ok(g.notes.some((n) => /XYZ had no score/.test(n)));
  assert.ok(Math.abs(g.hhi - 0.5) < 1e-12);
});

test('risk metrics are computed and sensible; drivers sum to score − 50', () => {
  const g = gradePortfolio({ holdings: [H('SPY', 'equity_etf', 0.6, 70, spy), H('AGG', 'bond_etf', 0.4, 60, agg)], spy, agg, rf: 0.04 });
  const m = g.riskMetrics;
  assert.ok(m.vol > 0.03 && m.vol < 0.2);
  assert.ok(m.beta > 0.4 && m.beta < 0.8, `beta ${m.beta}`);
  assert.ok(m.var95 > 0 && m.var95 < 0.05);
  assert.ok(g.charts.cumulative.length > 500 && g.charts.cumulative[0].sixtyForty !== null);
  const sum = g.drivers.reduce((s, d) => s + d.points, 0);
  assert.ok(Math.abs(sum - (0.4 * g.pillars[0].score + 0.3 * g.pillars[1].score + 0.3 * g.pillars[2].score - 50)) < 1e-9);
});

test('normalizeHoldings validates percent sums and converts dollars and shares', () => {
  assert.match(normalizeHoldings([{ ticker: 'SPY', amount: 60 }, { ticker: 'AGG', amount: 30 }], 'percent').error, /add up to 100%/);
  const p = normalizeHoldings([{ ticker: 'spy', amount: 60 }, { ticker: 'AGG', amount: 40 }], 'percent').holdings;
  assert.deepEqual(p.map((h) => [h.ticker, +h.weight.toFixed(2)]), [['SPY', 0.6], ['AGG', 0.4]]);
  const d = normalizeHoldings([{ ticker: 'SPY', amount: 7500 }, { ticker: 'AGG', amount: 2500 }], 'dollars').holdings;
  assert.ok(Math.abs(d[0].weight - 0.75) < 1e-12);
  const s = normalizeHoldings([{ ticker: 'SPY', amount: 10 }, { ticker: 'AGG', amount: 10 }], 'shares', { SPY: 300, AGG: 100 }).holdings;
  assert.ok(Math.abs(s[0].weight - 0.75) < 1e-12);
  assert.match(normalizeHoldings([{ ticker: 'SPY', amount: 10 }], 'shares', {}).error, /No price for SPY/);
});

test('bond math: duration and Treasury return approximation', () => {
  const d = parBondDuration(0.04, 10);
  assert.ok(d.modified > 7.5 && d.modified < 8.5, `10y at 4%: ${d.modified}`);
  assert.ok(parBondDuration(0.04, 2).modified < parBondDuration(0.04, 30).modified);
  const r = treasuryReturnsFromYields([{ date: '2026-01-02', value: 4.0 }, { date: '2026-01-05', value: 4.1 }], 10);
  assert.equal(r.length, 1);
  assert.ok(r[0].ret < 0, 'yield up → price down');
  assert.ok(Math.abs(r[0].ret - (-d.modified * 0.001 + 0.04 / 252)) < 1e-12);
  assert.ok(historicalVar95(tech[0].map((x) => x.ret)) > 0);
});

test('projection onto the box-constrained simplex', () => {
  const w = projectSimplexBox([0.9, 0.05, 0.03, 0.02], 0.02, 0.3);
  assert.ok(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  for (const x of w) assert.ok(x >= 0.02 - 1e-9 && x <= 0.3 + 1e-9);
  assert.throws(() => projectSimplexBox([1, 1], 0.02, 0.3), /empty/);
});

test('optimizer: constraints hold, conservative is less volatile than aggressive, after ≥ before Sharpe', () => {
  const assets = [...tech.slice(0, 3), tlt, agg].map((r, i) => ({ ticker: `A${i}`, returns: r, price: 100 + i * 50 }));
  const results = {};
  for (const lvl of ['conservative', 'moderate', 'aggressive']) {
    const o = optimize({ assets, rf: 0.04, riskLevel: lvl, amount: 10000 });
    assert.equal(o.ok, true);
    results[lvl] = o;
    assert.ok(Math.abs(o.chosen.w.reduce((s, x) => s + x, 0) - 1) < 1e-6, 'weights sum to 1');
    for (const x of o.chosen.w) assert.ok(x >= 0.02 - 1e-6 && x <= 0.3 + 1e-6, `weight ${x} within bounds`);
    if (!o.infeasible) assert.ok(o.chosen.vol <= RISK_LEVELS[lvl].volCap + 1e-6, `${lvl} vol ${o.chosen.vol}`);
    assert.ok(Math.abs(portVol(o.chosen.w, o.sigma) - o.chosen.vol) < 1e-9);
    assert.ok(o.leftover >= 0 && o.leftover < 500, `leftover ${o.leftover}`);
    assert.ok(o.alloc.every((a) => Number.isInteger(a.shares)));
    assert.ok(o.chosen.sharpe >= o.equal.sharpe - 1e-9 || o.infeasible, 'optimized Sharpe should not be below equal weight');
  }
  assert.ok(results.conservative.chosen.vol <= results.aggressive.chosen.vol + 1e-9);
  assert.ok(results.conservative.chosen.vol <= results.moderate.chosen.vol + 1e-9);
});

test('optimizer: infeasible cap reports the closest portfolio; <4 assets relaxes the ceiling', () => {
  const hot = [...tech.slice(0, 4)].map((r, i) => ({ ticker: `H${i}`, returns: r.map((x) => ({ date: x.date, ret: x.ret * 2 })), price: 50 }));
  const o = optimize({ assets: hot, rf: 0.04, riskLevel: 'conservative', amount: 5000 });
  assert.equal(o.ok, true);
  assert.equal(o.infeasible, true);
  assert.ok(o.chosen.vol > 0.08);
  assert.ok(o.notes.some((n) => /closest feasible/.test(n)));
  const two = optimize({ assets: [{ ticker: 'X', returns: tech[0], price: 10 }, { ticker: 'Y', returns: agg, price: 20 }], rf: 0.04, riskLevel: 'moderate', amount: 1000 });
  assert.equal(two.ok, true);
  assert.ok(two.notes.some((n) => /ceiling was relaxed/.test(n)));
  assert.ok(two.chosen.w.every((x) => Math.abs(x - 0.5) < 1e-6));
});

test('alignReturns intersects on dates', () => {
  const a = [{ date: '2026-01-02', ret: 0.1 }, { date: '2026-01-03', ret: 0.2 }];
  const b = [{ date: '2026-01-03', ret: 0.3 }, { date: '2026-01-04', ret: 0.4 }];
  assert.deepEqual(alignReturns([a, b]), { dates: ['2026-01-03'], matrix: [[0.2], [0.3]] });
});
