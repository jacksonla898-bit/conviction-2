// Plain-English text for the portfolio view. Fixed templates, real numbers, no AI.
import { fmt, fmtPct } from '../models/_math.js';
import { horizonLabel } from '../models/portfolio.js';

const pct = (x, d = 0) => fmtPct(x, d);
const NAMES = { dcf: 'valuation', monteCarlo: 'the Monte Carlo odds', risk: 'risk', momentum: 'momentum', health: 'financial health', earnings: 'earnings and insiders' };

function describePerModel(perModel) {
  const entries = Object.entries(perModel).filter(([, v]) => v);
  if (!entries.length) return '';
  const sorted = [...entries].sort((a, b) => b[1].score - a[1].score);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return `The strongest area is ${NAMES[best[0]]} (${Math.round(best[1].score)}) and the weakest is ${NAMES[worst[0]]} (${Math.round(worst[1].score)}).`;
}

export function portfolioChartExplanations(part) {
  if (!part || !part.available) return {};
  const m = part.metrics;
  switch (part.id) {
    case 'conviction':
      return {
        perModel: {
          what: 'Each holding was run through the six single-stock models. This chart combines each model\'s scores across the holdings, weighted by position size, so you can see which kinds of evidence favour the basket as a whole.',
          reading: `Across ${m.holdingsScored} scored holding${m.holdingsScored === 1 ? '' : 's'}, the weighted conviction is ${Math.round(m.score)}. ${describePerModel(m.perModel)}`,
          caveat: 'A model that is missing for some holdings is averaged over the holdings where it ran, so check the holdings table for gaps.',
        },
      };
    case 'target':
      return {
        fan: {
          what: `This shows the range of outcomes for the whole basket over your ${m.horizon} horizon. We replayed ${m.paths.toLocaleString()} random sequences of real past trading days for all holdings together, so when the stocks tend to move as a group, the simulation does too. The dashed line is your growth target.`,
          reading: `The middle outcome after ${m.horizon} is ${pct(m.median, 1)}, with half of the paths inside the dark band. Your target of ${pct(m.target, 1)} was reached in ${pct(m.pTarget, 1)} of paths; the basket lost money in ${pct(m.pLoss, 1)} of them.`,
          caveat: `The paths are built from the last ${m.windowDays} trading days, so they assume the coming period resembles the recent past.`,
        },
        histogram: {
          what: 'How the simulated end results are spread. Green bars are paths that met your target, orange bars lost money, grey bars gained but fell short of the target.',
          reading: `To hit ${pct(m.target, 1)} in ${m.horizon} the basket needs to grow at ${pct(m.requiredAnnual, 1)} a year; over the past year this blend actually grew at ${pct(m.histAnnual, 1)} a year. ${m.requiredAnnual > m.histAnnual ? 'The target asks for a faster pace than the recent past delivered.' : 'The recent pace would have been enough.'}`,
          caveat: 'A high probability built from a short window of strong returns is less reliable than it looks; the fan chart\'s width is the honest part.',
        },
      };
    case 'risk':
      return {
        corr: {
          what: 'Correlation tells you whether two holdings tend to move together. Owning several stocks only lowers risk if they do not all rise and fall on the same days.',
          reading: `${m.tickers.length} holdings with an average pairwise correlation of ${m.avgCorr === null ? 'n/a' : fmt(m.avgCorr)}. The weighted average of the individual volatilities is ${pct(m.weightedAvgVol)}, but the basket's volatility is ${pct(m.vol)}: a diversification ratio of ${fmt(m.divRatio)}. ${m.divRatio >= 1.3 ? 'That is a real diversification benefit.' : m.divRatio >= 1.1 ? 'That is a modest benefit; the holdings share a lot of their movement.' : 'That is almost no benefit; these holdings behave like one bet.'}`,
          caveat: 'Correlations rise in sell-offs, so the benefit shown here tends to be smaller exactly when it is needed.',
        },
        drawdown: {
          what: 'If you had held this exact mix for the last five years, this is how far it would have been below its previous high at each point.',
          reading: `The blended portfolio's worst fall from a peak was ${pct(Math.abs(m.maxDD))}, bottoming on ${m.troughDate}. It moves ${fmt(m.beta, 1)} times as much as the market (beta) with annual volatility of ${pct(m.vol)}.`,
          caveat: 'This assumes constant weights, which quietly rebalances every day; a real buy-and-hold basket drifts toward whichever holding grew most.',
        },
      };
    default:
      return {};
  }
}

/** Paragraphs for the "What this means" card on the portfolio view. */
export function portfolioConclusion(def, analysis) {
  if (!analysis || !analysis.score || analysis.score.score === null) return null;
  const { score, parts, holdings } = analysis;
  const name = def.name || 'This portfolio';
  const paras = [];
  const meaning =
    score.score < 40 ? 'the evidence mostly argues against this basket meeting its goal'
    : score.score < 60 ? 'the evidence is mixed'
    : score.score < 80 ? 'the evidence mostly supports this basket'
    : 'nearly everything we measure supports this basket';
  paras.push(`${name} scores ${score.score} out of 100, ${score.label} conviction: ${meaning}. The score blends three things: how the ${holdings.length} holdings score individually, how likely the basket is to deliver your ${pct(Number(def.targetGrowth) / 100, 1)} target in ${horizonLabel(def.horizon)}, and how risky the combination is.`);

  if (parts.conviction?.available) {
    const m = parts.conviction.metrics;
    const ranked = holdings.filter((h) => h.conviction && h.conviction.score !== null).sort((a, b) => b.conviction.score - a.conviction.score);
    const hi = ranked[0]?.conviction.score;
    const lo = ranked[ranked.length - 1]?.conviction.score;
    let spread;
    if (ranked.length <= 1) spread = `${ranked[0]?.ticker} scores ${hi}`;
    else if (hi - lo <= 3) spread = `the holdings score similarly (${ranked.map((h) => `${h.ticker} ${h.conviction.score}`).join(', ')})`;
    else spread = `the strongest holding is ${ranked[0].ticker} (${hi}) and the weakest is ${ranked[ranked.length - 1].ticker} (${lo})`;
    paras.push(`Stock by stock, the weighted conviction is ${Math.round(m.score)}; ${spread}. ${describePerModel(m.perModel)}`);
  }
  if (parts.target?.available) {
    const m = parts.target.metrics;
    paras.push(`On the target: in ${pct(m.pTarget, 1)} of ${m.paths.toLocaleString()} simulated ${m.horizon.replace(' ', '-').replace(/s$/, '')} periods the basket gained at least ${pct(m.target, 1)}. The middle outcome was ${pct(m.median, 1)}, and the basket lost money ${pct(m.pLoss, 1)} of the time. Hitting the target means growing at ${pct(m.requiredAnnual, 1)} a year, versus ${pct(m.histAnnual, 1)} a year over the past year for this blend.`);
  } else if (parts.target) {
    paras.push(`The target test could not run: ${parts.target.error}`);
  }
  if (parts.risk?.available) {
    const m = parts.risk.metrics;
    paras.push(`On risk: the basket's volatility is ${pct(m.vol)} a year with a beta of ${fmt(m.beta, 1)}, and the worst five-year drawdown of this mix was ${pct(Math.abs(m.maxDD))}. Diversification ratio ${fmt(m.divRatio)}: ${m.divRatio >= 1.3 ? 'the holdings genuinely offset each other' : m.divRatio >= 1.1 ? 'the holdings offset each other a little' : 'the holdings move almost as one'}.`);
  }
  if (def.thesis && def.thesis.trim()) {
    const t = parts.target?.available ? parts.target.metrics : null;
    paras.push(`Your thesis: "${def.thesis.trim().replace(/[.\s]+$/, '')}." ${t ? (t.pTarget >= 0.6 ? 'The numbers lean in its favour.' : t.pTarget >= 0.4 ? 'The numbers call it a coin flip.' : 'The numbers lean against it, mainly because the target is ambitious for this basket\'s historical behaviour.') : 'The target test was unavailable, so the numbers cannot speak to it directly.'}`);
  }
  const failed = holdings.filter((h) => h.status === 'failed');
  if (failed.length) paras.push(`Could not analyze: ${failed.map((h) => `${h.ticker} (${h.error})`).join('; ')}.`);
  paras.push('This is a summary of the numbers, not a recommendation. Nothing here is investment advice.');
  return paras;
}
