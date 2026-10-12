// Model 5: Financial health from SEC EDGAR annual (10-K) data, last 4–5 fiscal years.
//
//   Revenue growth (latest YoY)   g = Rev_t / Rev_{t−1} − 1
//   Revenue CAGR                  (Rev_last / Rev_first)^(1/years) − 1
//   Gross margin                  GM = GrossProfit / Revenue   (or (Revenue − CostOfRevenue) / Revenue)
//   Operating margin              OM = OperatingIncome / Revenue
//   Net margin                    NM = NetIncome / Revenue
//   Debt-to-equity                D/E = TotalDebt / StockholdersEquity
//   Current ratio                 CR = CurrentAssets / CurrentLiabilities
//   Free cash flow                FCF = OperatingCashFlow − CapEx ; trend = FCF CAGR (or sign change)
//
//   Subscore = average of the available component scores:
//     growthScore  = clamp( 50 + 250·g, 0, 100 )          → +20% YoY scores 100, −20% scores 0
//     marginScore  = clamp( 100 · NM / 25%, 0, 100 )       → 25% net margin scores 100, ≤0% scores 0
//     debtScore    = clamp( 100 − 50·(D/E), 0, 100 )      → no debt scores 100, D/E = 2 scores 0 (negative equity scores 0)
//     liquidScore  = clamp( 50 · CR, 0, 100 )              → CR = 2 scores 100
//     fcfScore     = 100 if latest FCF > 0 and FCF grew; 50 if FCF > 0 but shrank; 0 if latest FCF ≤ 0

import { clamp, cagr, fmt, fmtPct, fmtMoney, unavailable } from './_math.js';

export const ID = 'health';
export const NAME = 'Financial health';
export const NOTE = 'Margins, growth, leverage and liquidity describe the quality and resilience of the business itself, independent of what the market is paying for it.';

/** Join per-year series on fiscal-year-end year. Returns rows sorted ascending, last `maxYears` only. */
export function buildAnnualTable(series, maxYears = 5) {
  const years = new Set();
  for (const key of ['revenue', 'netIncome', 'operatingCashFlow']) for (const row of series[key] || []) years.add(row.year);
  const rows = [...years].sort().map((year) => {
    const get = (k) => {
      const hit = (series[k] || []).find((r) => r.year === year);
      return hit ? hit.value : null;
    };
    const revenue = get('revenue');
    const costOfRevenue = get('costOfRevenue');
    let grossProfit = get('grossProfit');
    if (grossProfit === null && revenue !== null && costOfRevenue !== null) grossProfit = revenue - costOfRevenue;
    const ocf = get('operatingCashFlow');
    const capex = get('capex');
    let totalDebt = get('totalDebt');
    if (totalDebt === null) {
      const lt = get('longTermDebtNoncurrent');
      const cur = get('debtCurrent');
      if (lt !== null || cur !== null) totalDebt = (lt || 0) + (cur || 0);
    }
    return {
      year,
      end: ((series.revenue || []).find((r) => r.year === year) || {}).end || null,
      revenue,
      grossProfit,
      operatingIncome: get('operatingIncome'),
      netIncome: get('netIncome'),
      operatingCashFlow: ocf,
      capex,
      fcf: ocf !== null && capex !== null ? ocf - capex : ocf !== null && capex === null ? null : null,
      totalDebt,
      equity: get('equity'),
      currentAssets: get('currentAssets'),
      currentLiabilities: get('currentLiabilities'),
      cash: get('cash'),
    };
  });
  // Drop years with no revenue at all (partial filings)
  const filtered = rows.filter((r) => r.revenue !== null);
  return filtered.slice(-maxYears);
}

export function runHealth({ fundamentals }) {
  if (!fundamentals || !fundamentals.series) return unavailable(ID, NAME, 'SEC EDGAR fundamentals unavailable.');
  const table = buildAnnualTable(fundamentals.series, 5);
  if (table.length < 2) return unavailable(ID, NAME, `EDGAR returned ${table.length} usable fiscal year(s) of revenue; need at least 2.`);

  const last = table[table.length - 1];
  const prev = table[table.length - 2];
  const first = table[0];
  const yearsSpan = last.year - first.year;

  const revGrowth = prev.revenue ? last.revenue / prev.revenue - 1 : null;
  const revCagr = yearsSpan > 0 ? cagr(first.revenue, last.revenue, yearsSpan) : null;
  const grossMargin = last.grossProfit !== null ? last.grossProfit / last.revenue : null;
  const opMargin = last.operatingIncome !== null ? last.operatingIncome / last.revenue : null;
  const netMargin = last.netIncome !== null ? last.netIncome / last.revenue : null;
  const debtToEquity = last.totalDebt !== null && last.equity !== null && last.equity !== 0 ? last.totalDebt / last.equity : null;
  const currentRatio = last.currentAssets !== null && last.currentLiabilities ? last.currentAssets / last.currentLiabilities : null;

  const fcfRows = table.filter((r) => r.fcf !== null);
  const fcfLast = fcfRows.length ? fcfRows[fcfRows.length - 1].fcf : null;
  const fcfFirst = fcfRows.length ? fcfRows[0].fcf : null;
  const fcfYears = fcfRows.length ? fcfRows[fcfRows.length - 1].year - fcfRows[0].year : 0;
  const fcfCagr = fcfYears > 0 ? cagr(fcfFirst, fcfLast, fcfYears) : NaN;
  const fcfGrew = fcfRows.length >= 2 ? fcfLast > fcfFirst : null;

  const components = [];
  const steps = [];

  if (revGrowth !== null) {
    const s = clamp(50 + 250 * revGrowth, 0, 100);
    components.push({ name: 'growthScore', value: s });
    steps.push({ label: 'Revenue growth (YoY)', formula: 'g = Rev_t / Rev_{t−1} − 1', calc: `${fmtMoney(last.revenue)} / ${fmtMoney(prev.revenue)} − 1`, result: `g = ${fmtPct(revGrowth)}` });
    steps.push({ label: 'Growth score', formula: 'clamp(50 + 250·g, 0, 100)', calc: `50 + 250 × ${revGrowth.toFixed(4)}`, result: fmt(s, 1) });
  }
  if (grossMargin !== null) steps.push({ label: 'Gross margin', formula: 'GM = GrossProfit / Revenue', calc: `${fmtMoney(last.grossProfit)} / ${fmtMoney(last.revenue)}`, result: fmtPct(grossMargin) });
  if (opMargin !== null) steps.push({ label: 'Operating margin', formula: 'OM = OperatingIncome / Revenue', calc: `${fmtMoney(last.operatingIncome)} / ${fmtMoney(last.revenue)}`, result: fmtPct(opMargin) });
  if (netMargin !== null) {
    const s = clamp((100 * netMargin) / 0.25, 0, 100);
    components.push({ name: 'marginScore', value: s });
    steps.push({ label: 'Net margin', formula: 'NM = NetIncome / Revenue', calc: `${fmtMoney(last.netIncome)} / ${fmtMoney(last.revenue)}`, result: fmtPct(netMargin) });
    steps.push({ label: 'Margin score', formula: 'clamp(100 · NM / 25%, 0, 100)', calc: `100 × ${netMargin.toFixed(4)} / 0.25`, result: fmt(s, 1) });
  }
  if (debtToEquity !== null) {
    const s = last.equity < 0 ? 0 : clamp(100 - 50 * debtToEquity, 0, 100);
    components.push({ name: 'debtScore', value: s });
    steps.push({ label: 'Debt-to-equity', formula: 'D/E = TotalDebt / Equity', calc: `${fmtMoney(last.totalDebt)} / ${fmtMoney(last.equity)}`, result: `D/E = ${fmt(debtToEquity)}${last.equity < 0 ? ' (negative equity)' : ''}` });
    steps.push({ label: 'Debt score', formula: 'clamp(100 − 50·(D/E), 0, 100); 0 if equity < 0', calc: last.equity < 0 ? 'equity is negative' : `100 − 50 × ${fmt(debtToEquity)}`, result: fmt(s, 1) });
  }
  if (currentRatio !== null) {
    const s = clamp(50 * currentRatio, 0, 100);
    components.push({ name: 'liquidityScore', value: s });
    steps.push({ label: 'Current ratio', formula: 'CR = CurrentAssets / CurrentLiabilities', calc: `${fmtMoney(last.currentAssets)} / ${fmtMoney(last.currentLiabilities)}`, result: `CR = ${fmt(currentRatio)}` });
    steps.push({ label: 'Liquidity score', formula: 'clamp(50·CR, 0, 100)', calc: `50 × ${fmt(currentRatio)}`, result: fmt(s, 1) });
  }
  if (fcfLast !== null && fcfRows.length >= 2) {
    const s = fcfLast <= 0 ? 0 : fcfGrew ? 100 : 50;
    components.push({ name: 'fcfScore', value: s });
    steps.push({ label: 'Free cash flow trend', formula: 'FCF = OCF − CapEx; trend over the window', calc: `FCF ${fcfRows[0].year}: ${fmtMoney(fcfFirst)} → ${fcfRows[fcfRows.length - 1].year}: ${fmtMoney(fcfLast)}${Number.isFinite(fcfCagr) ? ` (CAGR ${fmtPct(fcfCagr)})` : ''}`, result: fcfLast <= 0 ? 'negative' : fcfGrew ? 'positive and growing' : 'positive but shrinking' });
    steps.push({ label: 'FCF score', formula: '100 if FCF > 0 and grew; 50 if FCF > 0 but shrank; 0 if FCF ≤ 0', calc: `latest FCF ${fmtMoney(fcfLast)}, grew = ${fcfGrew}`, result: fmt(s, 1) });
  }

  if (components.length === 0) return unavailable(ID, NAME, 'EDGAR data lacked the fields needed for any health component.');
  const subscore = Math.round(components.reduce((s, c) => s + c.value, 0) / components.length);
  steps.push({ label: 'Subscore', formula: 'average of available component scores', calc: `(${components.map((c) => c.value.toFixed(1)).join(' + ')}) / ${components.length}`, result: `${subscore} / 100` });

  const chartRows = table.map((r) => ({
    year: String(r.year),
    grossMargin: r.grossProfit !== null && r.revenue ? r.grossProfit / r.revenue : null,
    operatingMargin: r.operatingIncome !== null && r.revenue ? r.operatingIncome / r.revenue : null,
    netMargin: r.netIncome !== null && r.revenue ? r.netIncome / r.revenue : null,
    revenue: r.revenue,
    fcf: r.fcf,
  }));

  const tags = fundamentals.tagsUsed || {};
  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Average of available: growth score (50 + 250 × YoY revenue growth), margin score (net margin / 25%), debt score (100 − 50 × D/E), liquidity score (50 × current ratio), FCF trend score (100 / 50 / 0).',
    note: NOTE,
    metrics: { fiscalYears: table.map((r) => r.year), latestFiscalYearEnd: last.end, revenue: last.revenue, revGrowth, revCagr, grossMargin, opMargin, netMargin, debtToEquity, currentRatio, fcfLatest: fcfLast, fcfCagr: Number.isFinite(fcfCagr) ? fcfCagr : null, fcfGrew, components: Object.fromEntries(components.map((c) => [c.name, c.value])) },
    inputs: [
      { label: 'Company', value: `${fundamentals.companyName} (CIK ${fundamentals.cik})`, source: 'SEC company_tickers.json' },
      { label: 'Fiscal years', value: table.map((r) => r.year).join(', '), source: 'EDGAR companyfacts, 10-K annual values' },
      { label: 'Revenue tag', value: tags.revenue || 'n/a', source: 'us-gaap' },
      { label: 'Net income tag', value: tags.netIncome || 'n/a', source: 'us-gaap' },
      { label: 'Cash-flow tags', value: `${tags.operatingCashFlow || 'n/a'} − ${tags.capex || 'n/a'}`, source: 'us-gaap' },
      { label: 'Debt tag', value: tags.totalDebt || [tags.longTermDebtNoncurrent, tags.debtCurrent].filter(Boolean).join(' + ') || 'n/a', source: 'us-gaap' },
    ],
    steps,
    chart: { rows: chartRows },
    table,
  };
}
