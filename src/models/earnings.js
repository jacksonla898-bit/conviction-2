// Model 6: Earnings surprises and insider activity.
//
//   Earnings (Finnhub /stock/earnings, quarterly EPS):
//     surprise% = (actual − estimate) / |estimate|
//     beat rate  B = (# quarters with actual > estimate) / (# quarters)
//     earningsScore = 100 · B
//
//   Insiders (Finnhub /stock/insider-transactions, last 6 months, Form 4 codes P = open-market buy, S = open-market sale):
//     bought = Σ |shares| for code P,  sold = Σ |shares| for code S
//     net ratio  ρ = (bought − sold) / (bought + sold)      ∈ [−1, 1]
//     insiderScore = 50 + 50·ρ        (no P/S trades → 50, neutral)
//
//   Subscore = average of the available components (earningsScore, insiderScore).

import { clamp, fmt, fmtPct, fmtMoney, fmtShares, unavailable } from './_math.js';

export const ID = 'earnings';
export const NAME = 'Earnings & insiders';
export const NOTE = 'Earnings-surprise history shows whether management tends to clear the bar analysts set; open-market insider buying and selling shows what the people with the most information are doing with their own money.';

export function runEarnings({ earnings, insiders }) {
  const earnOk = earnings && !earnings.unavailable && !earnings.error && Array.isArray(earnings.earnings);
  const insOk = insiders && !insiders.unavailable && !insiders.error && Array.isArray(insiders.transactions);

  const trim = (s) => String(s || 'unavailable').replace(/\.+$/, '');
  if (!earnOk && !insOk) {
    return unavailable(ID, NAME, `Earnings: ${trim(earnings?.error)}. Insiders: ${trim(insiders?.error)}.`);
  }

  const components = [];
  const steps = [];
  const inputs = [];
  const metrics = {};
  const warnings = [];

  // ---- Earnings ----
  let surpriseBars = [];
  if (earnOk) {
    const rows = earnings.earnings.filter((e) => e.estimate !== 0 && Number.isFinite(e.actual) && Number.isFinite(e.estimate));
    if (rows.length > 0) {
      let beats = 0;
      let misses = 0;
      let sumSurprise = 0;
      surpriseBars = rows.map((e) => {
        const sp = (e.actual - e.estimate) / Math.abs(e.estimate);
        if (e.actual > e.estimate) beats++;
        else if (e.actual < e.estimate) misses++;
        sumSurprise += sp;
        return { period: e.period, actual: e.actual, estimate: e.estimate, surprisePct: sp };
      });
      const beatRate = beats / rows.length;
      const avgSurprise = sumSurprise / rows.length;
      const earningsScore = 100 * beatRate;
      components.push({ name: 'earningsScore', value: earningsScore });
      Object.assign(metrics, { quarters: rows.length, beats, misses, beatRate, avgSurprise, earningsScore, latestPeriod: rows[rows.length - 1].period });
      inputs.push({ label: 'Earnings quarters', value: `${rows.length} (${rows[0].period} → ${rows[rows.length - 1].period})`, source: 'Finnhub /stock/earnings' });
      steps.push({ label: 'Surprise per quarter', formula: 'surprise% = (actual − estimate) / |estimate|', calc: surpriseBars.slice(-4).map((b) => `${b.period}: ${fmtPct(b.surprisePct)}`).join('; '), result: `avg ${fmtPct(avgSurprise)}` });
      steps.push({ label: 'Beat rate', formula: 'B = beats / quarters', calc: `${beats} / ${rows.length}`, result: `B = ${fmtPct(beatRate, 0)}` });
      steps.push({ label: 'Earnings score', formula: '100 · B', calc: `100 × ${beatRate.toFixed(3)}`, result: fmt(earningsScore, 1) });
    } else {
      warnings.push(earnings.note || 'Finnhub returned no quarters with both actual and estimated EPS.');
    }
  } else {
    warnings.push(`Earnings unavailable: ${earnings?.error || 'no data'}.`);
  }

  // ---- Insiders ----
  let monthly = [];
  if (insOk) {
    const tx = insiders.transactions.filter((t) => t.code === 'P' || t.code === 'S');
    let bought = 0;
    let sold = 0;
    let boughtUsd = 0;
    let soldUsd = 0;
    const byMonth = new Map();
    for (const t of tx) {
      const shares = Math.abs(t.change);
      const usd = t.price ? shares * t.price : 0;
      const month = t.date.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, { month, bought: 0, sold: 0, net: 0 });
      const m = byMonth.get(month);
      if (t.code === 'P') {
        bought += shares;
        boughtUsd += usd;
        m.bought += shares;
        m.net += shares;
      } else {
        sold += shares;
        soldUsd += usd;
        m.sold += shares;
        m.net -= shares;
      }
    }
    // Fill the 6-month window so empty months still show
    const months = [];
    const from = new Date(insiders.from);
    for (let i = 0; i < 7; i++) {
      const dte = new Date(from.getFullYear(), from.getMonth() + i, 1);
      const key = `${dte.getFullYear()}-${String(dte.getMonth() + 1).padStart(2, '0')}`;
      if (key > insiders.to.slice(0, 7)) break;
      months.push(key);
    }
    monthly = months.map((k) => byMonth.get(k) || { month: k, bought: 0, sold: 0, net: 0 });

    const total = bought + sold;
    const rho = total > 0 ? (bought - sold) / total : 0;
    const insiderScore = clamp(50 + 50 * rho, 0, 100);
    components.push({ name: 'insiderScore', value: insiderScore });
    Object.assign(metrics, { insiderTrades: tx.length, allFilings: insiders.transactions.length, sharesBought: bought, sharesSold: sold, netShares: bought - sold, usdBought: boughtUsd, usdSold: soldUsd, netUsd: boughtUsd - soldUsd, netRatio: rho, insiderScore, window: `${insiders.from} → ${insiders.to}` });
    inputs.push({ label: 'Insider filings (6 months)', value: `${insiders.transactions.length} rows, ${tx.length} open-market (P/S)`, source: `Finnhub /stock/insider-transactions ${insiders.from} → ${insiders.to}` });
    steps.push({ label: 'Open-market totals', formula: 'bought = Σ shares (code P); sold = Σ shares (code S)', calc: `bought ${fmtShares(bought)} (${fmtMoney(boughtUsd)}), sold ${fmtShares(sold)} (${fmtMoney(soldUsd)})`, result: `net ${bought - sold >= 0 ? '+' : ''}${fmtShares(bought - sold)} shares` });
    steps.push({ label: 'Net ratio', formula: 'ρ = (bought − sold) / (bought + sold)', calc: total > 0 ? `(${fmtShares(bought)} − ${fmtShares(sold)}) / ${fmtShares(total)}` : 'no open-market trades → ρ = 0', result: `ρ = ${fmt(rho, 3)}` });
    steps.push({ label: 'Insider score', formula: '50 + 50·ρ', calc: `50 + 50 × ${rho.toFixed(3)}`, result: fmt(insiderScore, 1) });
    if (tx.length === 0) warnings.push('No open-market insider purchases or sales in the last 6 months (awards and option exercises are excluded); insider score is neutral at 50.');
  } else {
    warnings.push(`Insider data unavailable: ${insiders?.error || 'no data'}.`);
  }

  if (components.length === 0) return unavailable(ID, NAME, warnings.join(' '));
  const subscore = Math.round(components.reduce((s, c) => s + c.value, 0) / components.length);
  steps.push({ label: 'Subscore', formula: 'average of available components', calc: `(${components.map((c) => c.value.toFixed(1)).join(' + ')}) / ${components.length}`, result: `${subscore} / 100` });

  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Average of: earnings score (100 × beat rate) and insider score (50 + 50 × net open-market buy ratio). A missing source is excluded.',
    note: NOTE,
    warning: warnings.length ? warnings.join(' ') : null,
    metrics,
    inputs,
    steps,
    chart: { surpriseBars, monthly },
  };
}
