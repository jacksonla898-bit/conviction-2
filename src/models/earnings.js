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
//     insiderScore = 50 + 50·ρ
//     If there were no open-market trades, ρ is undefined: the insider component is Unavailable and
//     excluded. No neutral placeholder is substituted.
//
//   Subscore = average of the available components (earningsScore, insiderScore).

import { clamp, fmt, fmtPct, fmtMoney, fmtShares, unavailable, topDrivers } from './_math.js';
import { SRC, computed, missing } from '../lib/provenance.js';

export const ID = 'earnings';
export const NAME = 'Earnings & insiders';
export const NOTE = 'Earnings-surprise history shows whether management tends to clear the bar analysts set; open-market insider buying and selling shows what the people with the most information are doing with their own money.';

const trim = (s) => String(s || 'no data').replace(/\.+$/, '');

export function runEarnings({ earnings, insiders }) {
  const earnOk = earnings && !earnings.unavailable && !earnings.error && Array.isArray(earnings.earnings);
  const insOk = insiders && !insiders.unavailable && !insiders.error && Array.isArray(insiders.transactions);

  const components = [];
  const driverRows = [];
  const steps = [];
  const inputs = [];
  const metrics = {};
  const warnings = [];
  const provenance = {};

  // ---- Earnings ----
  let surpriseBars = [];
  let earningsReason = null;
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
      const latest = rows[rows.length - 1].period;
      components.push({ name: 'earningsScore', value: earningsScore });
      driverRows.push({ label: 'Earnings beat rate', value: `${fmtPct(beatRate, 0)} (${beats}/${rows.length})`, score: earningsScore });
      Object.assign(metrics, { quarters: rows.length, beats, misses, beatRate, avgSurprise, earningsScore, latestPeriod: latest });
      const src = { source: SRC.FINNHUB, asOf: latest, detail: `/stock/earnings, ${rows.length} quarters of EPS actual vs estimate (${rows[0].period} to ${latest})` };
      provenance.beatRate = computed(beatRate, [src]);
      provenance.avgSurprise = computed(avgSurprise, [src]);
      inputs.push({ label: 'Earnings quarters', value: `${rows.length} (${rows[0].period} → ${latest})`, source: 'Finnhub /stock/earnings' });
      steps.push({ label: 'Surprise per quarter', formula: 'surprise% = (actual − estimate) / |estimate|', calc: surpriseBars.slice(-4).map((b) => `${b.period}: ${fmtPct(b.surprisePct)}`).join('; '), result: `avg ${fmtPct(avgSurprise)}` });
      steps.push({ label: 'Beat rate', formula: 'B = beats / quarters', calc: `${beats} / ${rows.length}`, result: `B = ${fmtPct(beatRate, 0)}` });
      steps.push({ label: 'Earnings score', formula: '100 · B', calc: `100 × ${beatRate.toFixed(3)}`, result: fmt(earningsScore, 1) });
    } else {
      earningsReason = earnings.note || 'Finnhub earnings endpoint returned no quarters with both actual and estimated EPS.';
    }
  } else {
    earningsReason = `Finnhub earnings endpoint failed: ${trim(earnings?.error)}.`;
  }
  if (earningsReason) {
    warnings.push(`Earnings surprise: Unavailable. ${earningsReason}`);
    provenance.beatRate = missing(earningsReason, SRC.FINNHUB);
    provenance.avgSurprise = missing(earningsReason, SRC.FINNHUB);
  }

  // ---- Insiders ----
  let monthly = [];
  let insiderReason = null; // reason the whole insider data set is unavailable
  if (insOk && insiders.transactions.length > 0) {
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
    // Fill the 6-month window so months with no trades still show (a true zero, not an estimate)
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
    const src = { source: SRC.FINNHUB, asOf: insiders.to, detail: `/stock/insider-transactions, ${insiders.transactions.length} Form 4 rows (${tx.length} open-market) from ${insiders.from} to ${insiders.to}` };
    Object.assign(metrics, { insiderTrades: tx.length, allFilings: insiders.transactions.length, sharesBought: bought, sharesSold: sold, netShares: bought - sold, usdBought: boughtUsd, usdSold: soldUsd, netUsd: boughtUsd - soldUsd, window: `${insiders.from} → ${insiders.to}` });
    provenance.sharesBought = computed(bought, [src]);
    provenance.sharesSold = computed(sold, [src]);
    provenance.netShares = computed(bought - sold, [src]);
    inputs.push({ label: 'Insider filings (6 months)', value: `${insiders.transactions.length} rows, ${tx.length} open-market (P/S)`, source: `Finnhub /stock/insider-transactions ${insiders.from} → ${insiders.to}` });
    steps.push({ label: 'Open-market totals', formula: 'bought = Σ shares (code P); sold = Σ shares (code S)', calc: `bought ${fmtShares(bought)} (${fmtMoney(boughtUsd)}), sold ${fmtShares(sold)} (${fmtMoney(soldUsd)})`, result: `net ${bought - sold >= 0 ? '+' : ''}${fmtShares(bought - sold)} shares` });
    if (total > 0) {
      const rho = (bought - sold) / total;
      const insiderScore = clamp(50 + 50 * rho, 0, 100);
      components.push({ name: 'insiderScore', value: insiderScore });
      driverRows.push({ label: 'Insider net buy ratio', value: fmt(rho, 2), score: insiderScore });
      Object.assign(metrics, { netRatio: rho, insiderScore });
      provenance.netRatio = computed(rho, [src]);
      steps.push({ label: 'Net ratio', formula: 'ρ = (bought − sold) / (bought + sold)', calc: `(${fmtShares(bought)} − ${fmtShares(sold)}) / ${fmtShares(total)}`, result: `ρ = ${fmt(rho, 3)}` });
      steps.push({ label: 'Insider score', formula: '50 + 50·ρ', calc: `50 + 50 × ${rho.toFixed(3)}`, result: fmt(insiderScore, 1) });
    } else {
      const why = `No open-market insider purchases or sales (Form 4 codes P/S) between ${insiders.from} and ${insiders.to}; the net ratio is undefined.`;
      Object.assign(metrics, { netRatio: null, insiderScore: null });
      provenance.netRatio = missing(why, SRC.FINNHUB);
      warnings.push(`Insider score: Unavailable and excluded. ${why}`);
      steps.push({ label: 'Net ratio', formula: 'ρ = (bought − sold) / (bought + sold)', calc: '0 / 0', result: 'Unavailable (excluded)' });
    }
  } else if (insOk) {
    insiderReason = 'Finnhub insider endpoint returned no data.';
  } else {
    insiderReason = `Finnhub insider endpoint failed: ${trim(insiders?.error)}.`;
  }
  if (insiderReason) {
    warnings.push(`Insider activity: Unavailable. ${insiderReason}`);
    for (const k of ['sharesBought', 'sharesSold', 'netShares', 'netRatio']) provenance[k] = missing(insiderReason, SRC.FINNHUB);
  }

  if (components.length === 0) return unavailable(ID, NAME, warnings.join(' '));
  const subscore = Math.round(components.reduce((s, c) => s + c.value, 0) / components.length);
  steps.push({ label: 'Subscore', formula: 'average of available components', calc: `(${components.map((c) => c.value.toFixed(1)).join(' + ')}) / ${components.length}`, result: `${subscore} / 100` });

  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Average of the available components: earnings score (100 × beat rate) and insider score (50 + 50 × net open-market buy ratio). A component whose data is unavailable is excluded, never assumed.',
    note: NOTE,
    warning: warnings.length ? warnings.join(' ') : null,
    keyOutput: [metrics.beatRate !== undefined ? `Beat rate ${fmtPct(metrics.beatRate, 0)}` : 'Beat rate Unavailable', metrics.sharesBought !== undefined ? `net insider ${metrics.netShares >= 0 ? '+' : ''}${fmtShares(metrics.netShares)} sh` : 'insiders Unavailable'].join('; '),
    drivers: topDrivers(driverRows),
    metrics,
    provenance,
    inputs,
    steps,
    chart: { surpriseBars, monthly },
  };
}
