// Conviction score: weighted average of the available model subscores.
//
//   score = Σ wᵢ · sᵢ / Σ wᵢ      over models i that are available (subscore not null)
//   Weights are re-normalized automatically when a model is unavailable.
//   Label: 0–39 Low, 40–59 Neutral, 60–79 High, 80–100 Very High.

export const DEFAULT_WEIGHTS = {
  dcf: 20,
  monteCarlo: 15,
  risk: 15,
  momentum: 15,
  health: 20,
  earnings: 15,
};

export const MODEL_ORDER = ['dcf', 'monteCarlo', 'risk', 'momentum', 'health', 'earnings'];

export const MODEL_LABELS = {
  dcf: 'Valuation (DCF)',
  monteCarlo: 'Monte Carlo',
  risk: 'Risk',
  momentum: 'Momentum',
  health: 'Financial health',
  earnings: 'Earnings & insiders',
};

export function scoreLabel(score) {
  if (score === null || score === undefined) return 'n/a';
  if (score < 40) return 'Low';
  if (score < 60) return 'Neutral';
  if (score < 80) return 'High';
  return 'Very High';
}

/**
 * @param {Record<string, {available:boolean, subscore:number|null}>} results keyed by model id
 * @param {Record<string, number>} weights
 */
export function computeConviction(results, weights = DEFAULT_WEIGHTS) {
  const included = [];
  const excluded = [];
  let sumW = 0;
  for (const id of MODEL_ORDER) {
    const w = Number(weights[id]) || 0;
    const r = results[id];
    if (r && r.available && typeof r.subscore === 'number' && w > 0) {
      included.push({ id, weight: w, subscore: r.subscore });
      sumW += w;
    } else {
      excluded.push({ id, reason: !r ? 'not run' : !r.available ? r.error || 'unavailable' : w <= 0 ? 'weight is 0' : 'no subscore' });
    }
  }
  if (sumW === 0) return { score: null, label: 'n/a', included: [], excluded, breakdown: [] };

  let total = 0;
  const breakdown = included.map((m) => {
    const normWeight = m.weight / sumW; // re-normalized weight
    const contribution = normWeight * m.subscore; // points contributed to the final score
    total += contribution;
    return { ...m, normWeight, contribution };
  });
  const score = Math.round(total);
  return { score, label: scoreLabel(score), included: breakdown, excluded, breakdown, sumWeights: sumW };
}
