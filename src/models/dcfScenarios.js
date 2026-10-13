// DCF scenarios (bull / base / bear), tornado sensitivity and the growth × discount-rate grid.
// None of these change the conviction score: the score always uses the Base case.
//
//   Scenario inputs      g_s = g_base + Δg (capped to [g_min, g_max] unless a growth override is set)
//                        r_s = r_base + Δr,   g_T,s = g_T + Δg_T
//   Tornado              one input moved at a time, all others held at Base; bar = [min value, max value]
//   Grid                 IV(r_i, g_j) for 5 discount rates × 5 FCF growth rates around Base

import { clamp } from './_math.js';
import { dcfValue, projectFcf } from './dcfValue.js';

/** All scenario and sensitivity deltas live here. Fractions: 0.05 = 5 percentage points. */
export const DCF_SCENARIO_CONFIG = {
  scenarios: {
    bear: { label: 'Bear', growth: -0.05, discount: +0.01, terminal: -0.005 },
    base: { label: 'Base', growth: 0, discount: 0, terminal: 0 },
    bull: { label: 'Bull', growth: +0.05, discount: -0.01, terminal: +0.005 },
  },
  // One-at-a-time ranges for the tornado chart.
  tornado: {
    growth: 0.05, // ± percentage points of FCF growth
    discount: 0.01, // ± percentage points of discount rate
    terminal: 0.005, // ± percentage points of terminal growth
    erp: 0.01, // ± percentage points of equity risk premium (moves r through beta)
    beta: 0.2, // ± beta
    fcf: 0.1, // ± 10% of starting free cash flow
  },
  // Offsets from Base for the sensitivity grid.
  grid: {
    growth: [-0.05, -0.025, 0, 0.025, 0.05],
    discount: [-0.02, -0.01, 0, 0.01, 0.02],
  },
};

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

/** Shift FCF growth by delta. The cap applies unless the user set an explicit growth override. */
export function shiftGrowth(base, delta) {
  const raw = base.g + delta;
  if (base.overrideSet) return { g: raw, capped: false };
  const g = clamp(raw, base.gMin, base.gMax);
  return { g, capped: g !== raw };
}

function evaluate(base, over, price) {
  const inputs = { ...base, ...over };
  if (!(inputs.r > inputs.gT)) {
    return { available: false, reason: `Discount rate ${pct(inputs.r)} must exceed terminal growth ${pct(inputs.gT)} for the terminal value to be defined.`, value: null, upside: null, g: inputs.g, r: inputs.r, gT: inputs.gT };
  }
  const v = dcfValue(inputs);
  return { available: true, value: v.perShare, upside: v.perShare / price - 1, terminalShare: v.pvTv / v.ev, g: inputs.g, r: inputs.r, gT: inputs.gT, fcf0: inputs.fcf0 };
}

/** Bull / base / bear fair values. */
export function buildScenarios(base, price) {
  const out = {};
  for (const [key, cfg] of Object.entries(DCF_SCENARIO_CONFIG.scenarios)) {
    const growth = shiftGrowth(base, cfg.growth);
    const res = evaluate(base, { g: growth.g, r: base.r + cfg.discount, gT: base.gT + cfg.terminal }, price);
    out[key] = {
      key,
      label: cfg.label,
      ...res,
      growthCapped: key !== 'base' && growth.capped,
      deltas: { growth: cfg.growth, discount: cfg.discount, terminal: cfg.terminal },
      projection: projectFcf(base.fcf0, growth.g, base.years, base.baseYear),
    };
  }
  return out;
}

/** One-at-a-time sensitivity, sorted by impact (largest fair-value range first). */
export function buildTornado(base, price) {
  const t = DCF_SCENARIO_CONFIG.tornado;
  const gLo = shiftGrowth(base, -t.growth);
  const gHi = shiftGrowth(base, +t.growth);
  const defs = [
    { key: 'growth', label: 'FCF growth', lo: { g: gLo.g }, hi: { g: gHi.g }, loText: `${pct(gLo.g)}${gLo.capped ? ' (cap)' : ''}`, hiText: `${pct(gHi.g)}${gHi.capped ? ' (cap)' : ''}` },
    { key: 'discount', label: 'Discount rate', lo: { r: base.r - t.discount }, hi: { r: base.r + t.discount }, loText: pct(base.r - t.discount), hiText: pct(base.r + t.discount) },
    { key: 'terminal', label: 'Terminal growth', lo: { gT: base.gT - t.terminal }, hi: { gT: base.gT + t.terminal }, loText: pct(base.gT - t.terminal), hiText: pct(base.gT + t.terminal) },
    { key: 'erp', label: 'Equity risk premium', lo: { r: base.rf + base.beta * (base.erp - t.erp) }, hi: { r: base.rf + base.beta * (base.erp + t.erp) }, loText: pct(base.erp - t.erp), hiText: pct(base.erp + t.erp) },
    { key: 'beta', label: 'Beta', lo: { r: base.rf + (base.beta - t.beta) * base.erp }, hi: { r: base.rf + (base.beta + t.beta) * base.erp }, loText: (base.beta - t.beta).toFixed(2), hiText: (base.beta + t.beta).toFixed(2) },
    { key: 'fcf', label: 'Starting FCF', lo: { fcf0: base.fcf0 * (1 - t.fcf) }, hi: { fcf0: base.fcf0 * (1 + t.fcf) }, loText: `−${(t.fcf * 100).toFixed(0)}%`, hiText: `+${(t.fcf * 100).toFixed(0)}%` },
  ];
  const baseValue = evaluate(base, {}, price).value;
  const rows = defs.map((d) => {
    const lo = evaluate(base, d.lo, price);
    const hi = evaluate(base, d.hi, price);
    const vals = [lo.value, hi.value].filter((v) => v !== null);
    const min = vals.length ? Math.min(...vals, baseValue) : null;
    const max = vals.length ? Math.max(...vals, baseValue) : null;
    return {
      key: d.key,
      label: d.label,
      lowInput: d.loText,
      highInput: d.hiText,
      valueAtLow: lo.value,
      valueAtHigh: hi.value,
      min,
      max,
      span: min === null ? null : max - min,
      note: !lo.available ? lo.reason : !hi.available ? hi.reason : null,
    };
  });
  rows.sort((a, b) => (b.span ?? -1) - (a.span ?? -1));
  return { baseValue, price, rows };
}

/** Fair value per share across discount rates (rows) × FCF growth rates (columns). Grid growth is not capped. */
export function buildGrid(base, price) {
  const cfg = DCF_SCENARIO_CONFIG.grid;
  const growths = cfg.growth.map((d) => base.g + d);
  const discounts = cfg.discount.map((d) => base.r + d);
  const cells = discounts.map((r) => growths.map((g) => {
    const v = dcfValue({ ...base, g, r });
    return v ? v.perShare : null;
  }));
  return { growths, discounts, cells, price, baseRow: cfg.discount.indexOf(0), baseCol: cfg.growth.indexOf(0) };
}

/** Plain description of the configured deltas (template text for the UI and the PDF). */
export function describeDeltas(base) {
  const s = DCF_SCENARIO_CONFIG.scenarios;
  const pp = (x) => `${Math.abs(x * 100).toFixed(1)} pts`;
  const cap = base && !base.overrideSet ? `growth stays within the ${pct(base.gMin, 0)} to ${pct(base.gMax, 0)} cap` : 'no cap applies because a growth override is set';
  return `Bull: FCF growth +${pp(s.bull.growth)}, discount rate −${pp(s.bull.discount)}, terminal growth +${pp(s.bull.terminal)}. Bear: FCF growth −${pp(s.bear.growth)}, discount rate +${pp(s.bear.discount)}, terminal growth −${pp(s.bear.terminal)}. In both, ${cap}.`;
}
