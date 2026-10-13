// Run with: npm test
// Checks that the score-attribution bars add up EXACTLY to the displayed conviction score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeConviction, DEFAULT_WEIGHTS, MODEL_ORDER } from '../src/models/conviction.js';
import { computeAttribution, roundToSum, NEUTRAL } from '../src/models/attribution.js';

const mk = (subscores) => Object.fromEntries(MODEL_ORDER.map((id) => [id, subscores[id] === null || subscores[id] === undefined ? { available: false, subscore: null, error: 'simulated: data source failed' } : { available: true, subscore: subscores[id], drivers: [] }]));

function check(subscores, weights = DEFAULT_WEIGHTS) {
  const results = mk(subscores);
  const conviction = computeConviction(results, weights);
  const a = computeAttribution(conviction, results, weights);
  if (conviction.score === null) {
    assert.equal(a, null);
    return { conviction, a };
  }
  // 1. Model bars + the rounding step sum, in integer tenths, to exactly (score − 50).
  const units = a.rows.reduce((s, r) => s + r.units, 0);
  assert.equal(units, a.modelUnits);
  assert.equal(units + a.rounding.units, (conviction.score - NEUTRAL) * 10, 'bars + rounding must sum to score − 50');
  assert.equal(a.totalUnits, (conviction.score - NEUTRAL) * 10);
  // 2. The waterfall starts at 50 and ends exactly on the displayed score.
  assert.equal(a.rows[0].start, NEUTRAL);
  assert.equal(a.rounding.start, a.rows[a.rows.length - 1].end);
  assert.equal(a.rounding.end, conviction.score);
  assert.equal(a.endsAt, conviction.score);
  assert.equal(a.exact, true);
  // 3. Each bar starts where the previous one ended.
  for (let i = 1; i < a.rows.length; i++) assert.equal(a.rows[i].start, a.rows[i - 1].end);
  // 4. The one-decimal labels, as displayed, add up to the displayed total.
  const shown = a.rows.reduce((s, r) => s + Math.round(Number(r.contribution.toFixed(1)) * 10), 0) + Math.round(Number(a.rounding.value.toFixed(1)) * 10);
  assert.equal(shown, (conviction.score - NEUTRAL) * 10);
  // 5. Every model bar is true to its formula: within 0.1 of weight × (subscore − 50), and a model
  //    that scores exactly 50 always shows exactly 0.
  for (const r of a.rows) {
    if (!r.included) continue;
    assert.ok(Math.abs(r.contribution - r.rawContribution) < 0.1, `${r.id} bar is not true to its formula`);
    if (r.subscore === NEUTRAL) assert.equal(r.units, 0, `${r.id} scores 50 and must contribute exactly 0`);
    if (r.rawContribution > 0) assert.ok(r.units >= 0);
    if (r.rawContribution < 0) assert.ok(r.units <= 0);
  }
  // 6. The rounding step is only the whole-number rounding of the average: never more than half a point.
  assert.ok(Math.abs(a.rounding.units) <= 5, 'rounding step exceeds 0.5');
  assert.ok(Math.abs(a.unrounded + a.rounding.value - conviction.score) < 1e-9);
  // 7. Weights used are re-normalized to 100%.
  const wsum = a.rows.reduce((s, r) => s + r.normWeight, 0);
  assert.ok(Math.abs(wsum - 1) < 1e-9);
  return { conviction, a };
}

test('all six models available (AAPL-like run)', () => {
  const { conviction } = check({ dcf: 0, monteCarlo: 86, risk: 75, momentum: 91, health: 70, earnings: 38 });
  assert.equal(conviction.score, 58);
});

test('NVDA-like and PRLB-like runs', () => {
  check({ dcf: 0, monteCarlo: 70, risk: 39, momentum: 87, health: 99, earnings: 50 });
  check({ dcf: 7, monteCarlo: 91, risk: 37, momentum: 98, health: 71, earnings: 50 });
});

test('one model unavailable: excluded at zero, remaining weights renormalized', () => {
  const { a } = check({ dcf: 12, monteCarlo: 64, risk: 55, momentum: 73, health: 81, earnings: null });
  const ex = a.rows.find((r) => r.id === 'earnings');
  assert.equal(ex.excluded, true);
  assert.equal(ex.excludedKind, 'unavailable');
  assert.equal(ex.contribution, 0);
  assert.equal(ex.start, ex.end);
  assert.equal(a.renormalized, true);
  const dcf = a.rows.find((r) => r.id === 'dcf');
  assert.ok(Math.abs(dcf.normWeight - 20 / 85) < 1e-12, 'dcf weight should be 20/85 after renormalizing');
});

test('several models unavailable, including the DCF', () => {
  check({ dcf: null, monteCarlo: 33, risk: 71, momentum: 48, health: null, earnings: 67 });
  check({ dcf: null, monteCarlo: null, risk: null, momentum: null, health: 70, earnings: null });
});

test('a rounding tie (.5) still sums exactly', () => {
  // Weighted average is exactly 50.5 → displayed 51.
  check({ dcf: 50, monteCarlo: 50, risk: 50, momentum: 50, health: 50, earnings: 53 }, { dcf: 1, monteCarlo: 1, risk: 1, momentum: 1, health: 1, earnings: 1 });
  check({ dcf: 51, monteCarlo: 50, risk: 50, momentum: 50, health: 50, earnings: 50 }, { dcf: 50, monteCarlo: 10, risk: 10, momentum: 10, health: 10, earnings: 10 });
});

test('a zero-weight model is excluded and labelled as weight 0', () => {
  const { a } = check({ dcf: 10, monteCarlo: 80, risk: 60, momentum: 70, health: 90, earnings: 40 }, { ...DEFAULT_WEIGHTS, dcf: 0 });
  const dcf = a.rows.find((r) => r.id === 'dcf');
  assert.equal(dcf.excluded, true);
  assert.equal(dcf.excludedKind, 'weight');
});

test('no model available → no attribution', () => {
  check({ dcf: null, monteCarlo: null, risk: null, momentum: null, health: null, earnings: null });
});

test('extremes: all 0 and all 100', () => {
  assert.equal(check({ dcf: 0, monteCarlo: 0, risk: 0, momentum: 0, health: 0, earnings: 0 }).conviction.score, 0);
  assert.equal(check({ dcf: 100, monteCarlo: 100, risk: 100, momentum: 100, health: 100, earnings: 100 }).conviction.score, 100);
});

test('2,000 random cases with random weights and random outages', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2000; i++) {
    const subs = {};
    const w = {};
    for (const id of MODEL_ORDER) {
      subs[id] = rnd() < 0.15 ? null : Math.round(rnd() * 100);
      w[id] = rnd() < 0.05 ? 0 : Math.round(rnd() * 40) + 1;
    }
    check(subs, w);
  }
});

test('roundToSum: rounded parts sum to the rounded total, and exact parts never move', () => {
  const a = roundToSum([1.26, 1.26, 1.26], 1); // exact sum 3.78 → 38 tenths
  assert.equal(a.units.reduce((s, u) => s + u, 0), 38);
  const b = roundToSum([-10, 2.4, -1.65, 4.95, 9.8, 0], 1); // NVDA-like: sum 5.5
  assert.equal(b.units.reduce((s, u) => s + u, 0), 55);
  assert.equal(b.units[0], -100, 'an exact value is not adjusted');
  assert.equal(b.units[5], 0, 'a zero contribution stays zero');
});

test('NVDA-like run: neutral subscore shows 0.0 and the half-point rounding is its own step', () => {
  const { a, conviction } = check({ dcf: 0, monteCarlo: 66, risk: 39, momentum: 83, health: 99, earnings: 50 });
  assert.equal(conviction.score, 56);
  assert.equal(a.rows.find((r) => r.id === 'earnings').contribution, 0);
  assert.equal(a.rows.find((r) => r.id === 'dcf').contribution, -10);
  assert.equal(a.unrounded, 55.5);
  assert.equal(a.rounding.value, 0.5);
});
