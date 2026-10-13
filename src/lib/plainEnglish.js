// Plain-English explanations for an average reader. Every sentence is a fixed template with the
// real computed numbers dropped in. No AI is involved, so this works identically in both modes.
import { fmt, fmtPct, fmtMoney, fmtShares } from '../models/_math.js';
import { MODEL_LABELS } from '../models/conviction.js';

const FRIENDLY = {
  dcf: 'cash-flow valuation',
  monteCarlo: 'Monte Carlo simulation',
  risk: 'risk',
  momentum: 'momentum',
  health: 'financial health',
  earnings: 'earnings and insiders',
};

const pct = (x, d = 0) => fmtPct(x, d);
const usd = (x) => `$${fmt(x)}`;
const abovePct = (x, d = 0) => `${pct(Math.abs(x), d)} ${x >= 0 ? 'above' : 'below'}`;

/**
 * Per-chart explanations for one model result. Returns { [chartKey]: { what, reading, caveat } }.
 */
export function chartExplanations(r, ticker) {
  if (!r || !r.available) return {};
  const m = r.metrics;
  const t = ticker || 'the stock';
  switch (r.id) {
    case 'monteCarlo':
      return {
        fan: {
          what: 'This is a "what might happen next year" chart. We replayed 10,000 possible years for the stock, using how jumpy it has been and how fast it has drifted over the past year. The dark band is where half of the outcomes landed; the light band holds 90% of them. The dashed line is today\'s price.',
          reading: `For ${t}, the middle outcome a year from now is ${usd(m.medianEnd)} (${pct(m.medianReturn)} from today's ${usd(m.currentPrice)}). The price ended higher than today in ${pct(m.pAbove)} of the simulated years.`,
          caveat: 'The simulation assumes the next year looks like the last one. If the past year was unusually good or bad, the fan is tilted the same way.',
        },
        histogram: {
          what: 'This shows how the 10,000 simulated ending prices are spread out. Taller bars mean more simulations ended near that price. Green bars are above today\'s price, orange bars are below.',
          reading: `Nine out of ten simulated years ended somewhere between ${usd(m.p5End)} and ${usd(m.p95End)}. That spread comes from ${t}'s annual volatility of ${pct(m.annualVol)}: the wider the bars, the less certain the outcome.`,
          caveat: 'A wide spread is a measure of uncertainty, not of opportunity. It cuts both ways.',
        },
      };
    case 'dcf':
      return {
        projection: {
          what: 'A business is worth the cash it will generate. This chart shows last year\'s free cash flow (money left after running and investing in the business) and what we assume the next five years will look like if it grows at a steady rate.',
          reading: `${t} generated ${fmtMoney(m.fcf0)} of free cash flow in fiscal ${m.fcfYear}. We grew that at ${pct(m.growth, 1)} a year (${m.growthSource}), then discounted everything back to today at ${pct(m.discountRate, 1)} a year, the return an investor should demand given how risky the stock has been.`,
          caveat: `${pct(m.terminalShare)} of the value comes from the years after year five, which is the part we know least about.`,
        },
        tornado: {
          what: 'Each bar shows how far the fair value moves when one assumption is changed and everything else is left alone. The longest bar is the assumption the answer depends on most. The solid line is the Base fair value; the dashed line is today\'s price.',
          reading: (() => {
            const top = r.chart.tornado.rows.find((x) => x.min !== null);
            return top ? `For ${t}, the most sensitive input is ${top.label.toLowerCase()}: moving it between ${top.lowInput} and ${top.highInput} moves the fair value between ${usd(top.min)} and ${usd(top.max)}. Bear, Base and Bull come out at ${m.bearValue === null ? 'Unavailable' : usd(m.bearValue)}, ${usd(m.intrinsicValue)} and ${m.bullValue === null ? 'Unavailable' : usd(m.bullValue)}.` : 'No input variation produced a defined value.';
          })(),
          caveat: 'These ranges are fixed, equal-sized nudges chosen for comparison, not forecasts of how much each input might actually change.',
        },
        grid: {
          what: 'Because the valuation depends so heavily on two guesses, this table shows the answer under different guesses: how much return to demand (rows) and how fast free cash flow grows over the next five years (columns). Green cells are above today\'s price, red cells below.',
          reading: `Our base case (the centre cell) says ${t} is worth about ${usd(m.intrinsicValue)} a share against a price of ${usd(m.price)}, which is ${abovePct(m.upside)} the price. ${m.upside < 0 ? 'If most of the table is red, the stock looks expensive on cash flow under a wide range of assumptions.' : 'If most of the table is green, the stock looks cheap on cash flow under a wide range of assumptions.'}`,
          caveat: 'Fast-growing companies often look expensive on this test because it caps growth and demands a high return. Treat it as one opinion, not the verdict.',
        },
      };
    case 'risk':
      return {
        drawdown: {
          what: 'This chart shows how far the stock was below its previous high point at every moment in the last five years. Zero means it was at a record high; a deep dip means a painful fall from the peak.',
          reading: `The worst stretch for ${t} was a ${pct(Math.abs(m.maxDD))} fall from its peak, bottoming on ${m.troughDate}. Anyone who bought at the top before that had to sit through that loss.`,
          caveat: 'Past drawdowns are a guide to how bad things can get, not a prediction of when.',
        },
        rollingBeta: {
          what: 'Beta measures how much the stock moves when the overall market (the S&P 500) moves. A beta of 1 means it moves in step; 2 means it swings twice as hard; 0.5 means half. This line shows that figure measured over a sliding 60-day window.',
          reading: `Over the past year ${t} had a beta of ${fmt(m.beta)}, so when the market moved 1% the stock typically moved about ${fmt(m.beta)}%. Its overall volatility was ${pct(m.annualVol)} a year${m.sharpe !== null ? `, and its return per unit of risk (Sharpe ratio) was ${fmt(m.sharpe)}` : ''}.`,
          caveat: 'A low beta does not mean low risk if the stock has its own problems; it just means its swings are less tied to the market.',
        },
      };
    case 'momentum':
      return {
        priceSma: {
          what: 'The blue line is the price over the last two years. The orange and green lines are the average price over the last 50 and 200 trading days. When the price is above both averages the stock is in an uptrend; below both, a downtrend.',
          reading: `${t} is at ${usd(m.price)}, ${abovePct(m.pctFromSma50, 1)} its 50-day average and ${abovePct(m.pctFromSma200, 1)} its 200-day average. Over the past year (ignoring the last month) it moved ${pct(m.momentum12_1, 1)}. Its RSI reading of ${fmt(m.rsi14, 0)} ${m.rsi14 > 70 ? 'suggests the recent run has been fast enough that a pause is common' : m.rsi14 < 30 ? 'suggests the recent selling has been heavy enough that bounces are common' : 'is in the normal range, neither overbought nor oversold'}.`,
          caveat: 'Trends persist more often than not, but they always end eventually, and this chart cannot tell you when.',
        },
      };
    case 'health':
      return {
        margins: {
          what: 'Margins show how much of each dollar of sales the company keeps. Gross margin is what is left after making the product; operating margin after running the business; net margin after everything, including tax. Rising lines mean the business is getting more efficient.',
          reading: `In its latest fiscal year ${t} kept ${pct(m.grossMargin)} of sales after production costs, ${pct(m.opMargin)} after operating costs, and ${pct(m.netMargin)} as final profit.`,
          caveat: 'Margins differ a lot by industry. A grocer with a 3% net margin can be a great business; compare with similar companies, not with the whole market.',
        },
        revenueFcf: {
          what: 'Blue bars are total sales each year. Yellow bars are free cash flow: the actual cash left over after running and investing in the business. Growing bars of both colours is the healthy pattern.',
          reading: `Sales were ${fmtMoney(m.revenue)} in the latest year, ${m.revGrowth !== null ? `${m.revGrowth >= 0 ? 'up' : 'down'} ${pct(Math.abs(m.revGrowth), 1)} from the year before` : 'with no prior year to compare'}. Free cash flow was ${fmtMoney(m.fcfLatest)}${m.fcfGrew === true ? ', higher than at the start of the period' : m.fcfGrew === false ? ', lower than at the start of the period' : ''}. ${m.debtToEquity !== null ? `Debt is ${fmt(m.debtToEquity)} times shareholder equity` : 'Debt figures were not reported in a usable form'}${m.currentRatio !== null ? `, and the company has ${fmt(m.currentRatio)} dollars of short-term assets for every dollar of short-term bills` : ''}.`,
          caveat: 'These figures come from annual filings, so they can be up to a year old.',
        },
      };
    case 'earnings':
      return {
        surprise: {
          what: 'Every quarter, analysts predict the company\'s earnings per share. These bars show how far the actual result was from that prediction, in percent. Green is a beat, orange is a miss.',
          reading: m.quarters !== undefined ? `${t} beat the estimate in ${m.beats} of the last ${m.quarters} quarters, with an average surprise of ${pct(m.avgSurprise, 1)}.` : 'Earnings-surprise data was not available for this stock.',
          caveat: 'Companies often guide analysts to beatable numbers, so a long streak of small beats is normal rather than remarkable.',
        },
        insider: {
          what: 'Executives and directors must report when they buy or sell their own company\'s shares. This chart shows, month by month, net shares bought on the open market minus shares sold. Awards, option exercises and tax withholding are left out because they are not real buying decisions.',
          reading: m.sharesBought !== undefined ? `Over the last six months insiders at ${t} bought ${fmtShares(m.sharesBought)} shares and sold ${fmtShares(m.sharesSold)}${m.usdSold ? ` (about ${fmtMoney(m.usdSold, 1)} of sales)` : ''}. ${m.sharesBought === 0 && m.sharesSold > 0 ? 'Selling with no buying is common at large companies, where executives are paid largely in stock and sell to diversify.' : m.sharesBought > m.sharesSold ? 'Net buying is the more unusual and more informative signal.' : 'There were no open-market trades, which tells us nothing either way.'}` : 'Insider-transaction data was not available for this stock.',
          caveat: 'Insiders sell for many reasons (houses, taxes, diversification) but usually buy for only one.',
        },
      };
    default:
      return {};
  }
}

/** One short sentence per model, used in the overall conclusion. */
export function modelHeadline(r) {
  if (!r || !r.available) return null;
  const m = r.metrics;
  switch (r.id) {
    case 'dcf':
      return `our cash-flow valuation puts the shares at about ${usd(m.intrinsicValue)} against a price of ${usd(m.price)}, ${abovePct(m.upside)} the market`;
    case 'monteCarlo':
      return `the simulation ended higher than today in ${pct(m.pAbove)} of 10,000 runs, with a middle outcome of ${pct(m.medianReturn)}`;
    case 'risk':
      return `the stock swings about ${pct(m.annualVol)} a year, moves ${fmt(m.beta, 1)} times as much as the market, and fell ${pct(Math.abs(m.maxDD))} from its peak at its worst in the last five years`;
    case 'momentum':
      return `the price is ${m.aboveSma50 && m.aboveSma200 ? 'above both' : !m.aboveSma50 && !m.aboveSma200 ? 'below both' : 'above one of'} its 50- and 200-day averages and moved ${pct(m.momentum12_1)} over the past year`;
    case 'health':
      return `sales ${m.revGrowth === null ? 'were ' + fmtMoney(m.revenue) : (m.revGrowth >= 0 ? 'grew ' : 'fell ') + pct(Math.abs(m.revGrowth))} last year with a ${pct(m.netMargin)} net margin${m.debtToEquity !== null ? ` and debt at ${fmt(m.debtToEquity, 1)} times equity` : ''}`;
    case 'earnings': {
      const parts = [];
      if (m.quarters !== undefined) parts.push(`it beat analyst estimates in ${m.beats} of ${m.quarters} quarters`);
      if (m.sharesBought !== undefined) parts.push(m.sharesBought === 0 && m.sharesSold === 0 ? 'insiders made no open-market trades' : `insiders ${m.sharesBought > m.sharesSold ? 'bought' : 'sold'} a net ${fmtShares(Math.abs(m.netShares))} shares`);
      return parts.join(' and ');
    }
    default:
      return null;
  }
}

/**
 * Overall conclusion: an array of paragraphs built from the conviction breakdown.
 */
export function overallConclusion(ticker, companyName, conviction, results, pending) {
  if (!conviction || conviction.score === null) return null;
  const name = companyName || ticker;
  const score = conviction.score;
  const label = conviction.label;
  const rows = conviction.breakdown.map((b) => ({ ...b, r: results[b.id] }));
  const supporters = rows.filter((b) => b.subscore >= 60).sort((a, b) => b.contribution - a.contribution);
  const drags = rows.filter((b) => b.subscore < 40).sort((a, b) => a.subscore - b.subscore);
  const middle = rows.filter((b) => b.subscore >= 40 && b.subscore < 60);

  const paras = [];
  const meaning =
    score < 40 ? 'more of the evidence points against the stock than for it'
    : score < 60 ? 'the evidence is mixed, with real strengths offset by real weaknesses'
    : score < 80 ? 'most of the evidence points in the stock\'s favour'
    : 'nearly every measure we look at points in the stock\'s favour';
  paras.push(`${name} scores ${score} out of 100, which we call ${label} conviction: ${meaning}. The score is a weighted average of ${rows.length} independent tests${conviction.excluded.length ? `, with ${conviction.excluded.length} skipped because the data was missing` : ''}.`);

  const list = (items) => items.map((b) => `${FRIENDLY[b.id] || MODEL_LABELS[b.id]} (${b.subscore}): ${modelHeadline(b.r)}`);
  if (supporters.length) paras.push(`What helps: ${list(supporters).join('; ')}.`);
  if (drags.length) paras.push(`What hurts: ${list(drags).join('; ')}.`);
  if (middle.length) paras.push(`In the middle: ${list(middle).join('; ')}.`);

  if (drags.some((b) => b.id === 'dcf') && supporters.some((b) => b.id === 'momentum' || b.id === 'monteCarlo')) {
    paras.push('Note the tension: the price trend is strong, but the cash-flow valuation says the price already assumes a lot. That combination is typical of popular growth stocks, and it means the outcome depends on whether the growth actually shows up.');
  } else if (supporters.some((b) => b.id === 'dcf') && drags.some((b) => b.id === 'momentum')) {
    paras.push('Note the tension: the shares look cheap on cash flow but the price trend is weak. Cheap stocks can stay cheap for a long time, so patience is part of the bet.');
  }
  if (conviction.excluded.length) {
    paras.push(`Skipped: ${conviction.excluded.map((e) => `${FRIENDLY[e.id] || MODEL_LABELS[e.id]} (${e.reason})`).join('; ')}. The remaining weights were rescaled so the score still runs 0 to 100.`);
  }
  paras.push(pending ? 'Some models are still loading; this summary will update.' : 'This is a summary of the numbers above, not a recommendation. Nothing here is investment advice.');
  return paras;
}
