// Score attribution: how the conviction score gets from a neutral 50 to its final value.
//
//   The score is a weighted average of the available subscores:   raw = Σ wᵢ · sᵢ   (wᵢ normalized, Σ wᵢ = 1)
//   Rewrite around neutral 50:                                    raw − 50 = Σ wᵢ · (sᵢ − 50)
//   Contribution of model i:                                      cᵢ = wᵢ · (sᵢ − 50)
//   Displayed score:                                              score = round(raw)
//
//   So the waterfall is:   50  +  Σ cᵢ  +  rounding  =  score
//
//   Every model's bar is its own cᵢ to one decimal (never adjusted by more than 0.05, and a model that
//   scores exactly 50 always shows 0.0). The bars add up to the unrounded average to one decimal; the
//   final, separately labelled "rounding" step (at most ±0.5) is the rounding of that average to the
//   whole-number score. All sums are done in integer tenths, so the steps add up EXACTLY to the score.
//
//   A model that is unavailable (or has weight 0) contributes 0 and is shown as excluded; the weights
//   of the remaining models are re-normalized to sum to 100%.

import { MODEL_ORDER, MODEL_LABELS as STOCK_LABELS } from './conviction.js';
const MODEL_LABELS = STOCK_LABELS;

export const NEUTRAL = 50;

/**
 * Round `values` to `decimals` places so that the rounded values sum exactly to round(Σ values).
 * Largest-remainder: only entries that actually have a rounding remainder can move, each by one unit.
 * Returns { values, units } where units are integers (value × 10^decimals).
 */
export function roundToSum(values, decimals = 1) {
  const k = 10 ** decimals;
  const scaled = values.map((v) => v * k);
  const units = scaled.map((v) => Math.round(v));
  if (units.length === 0) return { values: [], units: [] };
  const target = Math.round(scaled.reduce((s, v) => s + v, 0));
  let diff = target - units.reduce((s, u) => s + u, 0);
  let guard = 0;
  while (diff !== 0 && guard < 1000) {
    const dir = diff > 0 ? 1 : -1;
    let best = -1;
    let bestErr = 1e-9; // only entries with a real remainder in the needed direction are eligible
    for (let i = 0; i < units.length; i++) {
      const err = dir * (scaled[i] - units[i]);
      if (err > bestErr) {
        bestErr = err;
        best = i;
      }
    }
    if (best === -1) break; // nothing left to adjust (floating-point dust); the rounding step absorbs it
    units[best] += dir;
    diff -= dir;
    guard += 1;
  }
  return { values: units.map((u) => u / k), units };
}

/**
 * @param conviction result of computeConviction()
 * @param results model results keyed by id
 * @param weights nominal weights from Settings
 */
export function computeAttribution(conviction, results, weights, order = MODEL_ORDER, labels = MODEL_LABELS) {
  if (!conviction || conviction.score === null || conviction.score === undefined) return null;
  const included = conviction.breakdown;
  const raw = included.map((b) => b.normWeight * (b.subscore - NEUTRAL));
  const { values, units } = roundToSum(raw, 1);
  const MODEL_LABELS = labels; // shadows the import for the rows below

  let cum = NEUTRAL * 10; // running total in tenths
  const rows = order.map((id) => {
    const idx = included.findIndex((b) => b.id === id);
    const r = results ? results[id] : null;
    if (idx === -1) {
      const ex = (conviction.excluded || []).find((e) => e.id === id);
      const zeroWeight = Boolean(r && r.available && !(Number(weights?.[id]) > 0));
      return {
        id,
        label: MODEL_LABELS[id],
        included: false,
        excluded: true,
        excludedKind: zeroWeight ? 'weight' : 'unavailable',
        reason: ex?.reason || 'unavailable',
        subscore: r && r.available ? r.subscore : null,
        nominalWeight: Number(weights?.[id]) || 0,
        normWeight: 0,
        rawContribution: 0,
        contribution: 0,
        units: 0,
        start: cum / 10,
        end: cum / 10,
        drivers: [],
      };
    }
    const b = included[idx];
    const start = cum;
    cum += units[idx];
    return {
      id,
      label: MODEL_LABELS[id],
      included: true,
      excluded: false,
      subscore: b.subscore,
      nominalWeight: b.weight,
      normWeight: b.normWeight,
      rawContribution: raw[idx],
      contribution: values[idx],
      units: units[idx],
      start: start / 10,
      end: cum / 10,
      drivers: (r && r.drivers) || [],
    };
  });

  // Final step: the weighted average (one decimal) rounded to the whole-number score.
  const subtotalUnits = cum; // 50 + Σ contributions, in tenths
  const roundingUnits = conviction.score * 10 - subtotalUnits;
  const modelUnits = subtotalUnits - NEUTRAL * 10;

  return {
    neutral: NEUTRAL,
    score: conviction.score,
    rows,
    modelUnits, // Σ model contributions, tenths
    unrounded: subtotalUnits / 10, // 50 + Σ contributions = weighted average to one decimal
    rounding: { units: roundingUnits, value: roundingUnits / 10, start: subtotalUnits / 10, end: conviction.score },
    totalUnits: modelUnits + roundingUnits, // = (score − 50) × 10 exactly
    endsAt: (subtotalUnits + roundingUnits) / 10,
    exact: subtotalUnits + roundingUnits === conviction.score * 10,
    renormalized: rows.some((x) => x.excluded),
    sumWeights: conviction.sumWeights,
  };
}

/** Signed one-decimal text, e.g. "+7.2" or "−3.0". */
export function signed(x) {
  const v = Math.abs(x).toFixed(1);
  return x > 0 ? `+${v}` : x < 0 ? `−${v}` : '0.0';
}
