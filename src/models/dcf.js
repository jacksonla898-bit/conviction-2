// Model 2: Discounted cash flow (5-year projection + Gordon growth terminal value).
//
//   Free cash flow            FCF = OperatingCashFlow − CapEx            (annual, from EDGAR)
//   Historical FCF growth     g_hist = (FCF_last / FCF_first)^(1/years) − 1   (needs both > 0)
//   Growth used               g = clamp(g_hist, g_min, g_max)   or the user's override
//   Discount rate (CAPM)      r = R_f + β · ERP      (cost of equity; used as the WACC proxy — see note)
//   Projected FCF             FCF_t = FCF_0 · (1 + g)^t,   t = 1..5
//   PV of projections         PV = Σ FCF_t / (1 + r)^t
//   Terminal value (Gordon)   TV = FCF_5 · (1 + g_T) / (r − g_T),   requires r > g_T
//   PV of terminal value      PV_TV = TV / (1 + r)^5
//   Enterprise value          EV = PV + PV_TV
//   Equity value              Equity = EV − TotalDebt + Cash      (when EDGAR provides both; else EV)
//   Intrinsic value / share   IV = Equity / SharesOutstanding
//   Upside                    U = IV / Price − 1
//
//   Subscore = clamp( 50 + 100·U, 0, 100 )   → fairly valued = 50, +50% upside = 100, −50% = 0

import { clamp, cagr, fmt, fmtPct, fmtMoney, fmtShares, unavailable } from './_math.js';
import { buildAnnualTable } from './health.js';

export const ID = 'dcf';
export const NAME = 'DCF valuation';
export const NOTE = 'A DCF estimates what the business is worth today from the cash it is expected to generate; the output is extremely sensitive to the growth and discount-rate assumptions, which is why the sensitivity table matters more than the single number.';

export const DCF_DEFAULTS = {
  equityRiskPremium: 5.0, // percent
  terminalGrowth: 2.5, // percent
  growthCapMin: -10, // percent
  growthCapMax: 25, // percent
  growthOverride: '', // percent, blank = use historical CAGR
  projectionYears: 5,
};

function intrinsicPerShare({ fcf0, g, r, gT, years, netDebtAdj, shares }) {
  if (r <= gT) return null;
  let pv = 0;
  let fcfT = fcf0;
  for (let t = 1; t <= years; t++) {
    fcfT = fcf0 * Math.pow(1 + g, t);
    pv += fcfT / Math.pow(1 + r, t);
  }
  const tv = (fcfT * (1 + gT)) / (r - gT);
  const pvTv = tv / Math.pow(1 + r, years);
  const ev = pv + pvTv;
  const equity = ev + netDebtAdj;
  return { pv, tv, pvTv, ev, equity, perShare: equity / shares, fcfFinal: fcfT };
}

export function runDCF({ fundamentals, beta, price }, settings) {
  if (!fundamentals || !fundamentals.series) return unavailable(ID, NAME, 'SEC EDGAR fundamentals unavailable.');
  if (!(price > 0)) return unavailable(ID, NAME, 'Current price unavailable.');
  if (beta === null || beta === undefined || Number.isNaN(beta)) return unavailable(ID, NAME, 'Beta unavailable (needs price history vs SPY).');

  const rfRaw = settings?.riskFreeRate;
  if (rfRaw === '' || rfRaw === null || rfRaw === undefined || Number.isNaN(Number(rfRaw))) {
    return unavailable(ID, NAME, 'No risk-free rate available: turn on automatic Treasury lookup or enter the 3-month T-bill yield in Settings to run the DCF.');
  }
  const rf = Number(rfRaw) / 100;
  const d = { ...DCF_DEFAULTS, ...(settings?.dcf || {}) };
  const erp = Number(d.equityRiskPremium) / 100;
  const gT = Number(d.terminalGrowth) / 100;
  const gMin = Number(d.growthCapMin) / 100;
  const gMax = Number(d.growthCapMax) / 100;
  const years = Number(d.projectionYears) || 5;

  const table = buildAnnualTable(fundamentals.series, 5);
  const fcfRows = table.filter((r) => r.fcf !== null);
  if (fcfRows.length === 0) return unavailable(ID, NAME, 'EDGAR did not provide operating cash flow and capex for any fiscal year.');
  const lastRow = fcfRows[fcfRows.length - 1];
  const firstRow = fcfRows[0];
  const fcf0 = lastRow.fcf;
  if (!(fcf0 > 0)) return unavailable(ID, NAME, `Latest free cash flow is ${fmtMoney(fcf0)} (FY${lastRow.year}); a Gordon-growth DCF needs positive FCF.`);

  const spanYears = lastRow.year - firstRow.year;
  const gHist = spanYears > 0 ? cagr(firstRow.fcf, fcf0, spanYears) : NaN;
  const overrideSet = d.growthOverride !== '' && d.growthOverride !== null && d.growthOverride !== undefined && !Number.isNaN(Number(d.growthOverride));
  let g;
  let growthSource;
  if (overrideSet) {
    g = Number(d.growthOverride) / 100;
    growthSource = 'user override (Settings)';
  } else if (Number.isFinite(gHist)) {
    g = clamp(gHist, gMin, gMax);
    growthSource = g === gHist ? `historical FCF CAGR FY${firstRow.year}–FY${lastRow.year}` : `historical FCF CAGR ${fmtPct(gHist)} capped to [${fmtPct(gMin, 0)}, ${fmtPct(gMax, 0)}]`;
  } else {
    return unavailable(ID, NAME, `Historical FCF CAGR undefined (FCF FY${firstRow.year} = ${fmtMoney(firstRow.fcf)}). Enter a growth override in Settings to run the DCF.`);
  }

  const r = rf + beta * erp;
  if (r <= gT) return unavailable(ID, NAME, `Discount rate ${fmtPct(r)} must exceed terminal growth ${fmtPct(gT)}. Lower the terminal growth or raise the ERP in Settings.`);

  const shares = fundamentals.sharesOutstanding?.value;
  if (!(shares > 0)) return unavailable(ID, NAME, 'Shares outstanding not found in EDGAR cover-page data.');

  const debt = table[table.length - 1].totalDebt;
  const cash = table[table.length - 1].cash;
  const hasNetDebt = debt !== null && cash !== null;
  const netDebtAdj = hasNetDebt ? cash - debt : 0;

  const base = intrinsicPerShare({ fcf0, g, r, gT, years, netDebtAdj, shares });
  const upside = base.perShare / price - 1;
  const subscore = Math.round(clamp(50 + 100 * upside, 0, 100));

  // Projected FCF bars
  const projection = [];
  for (let t = 0; t <= years; t++) projection.push({ year: `FY${lastRow.year + t}${t === 0 ? ' (actual)' : ''}`, fcf: fcf0 * Math.pow(1 + g, t), projected: t > 0 });

  // Sensitivity table: discount rate rows × terminal growth columns
  const rSteps = [-0.02, -0.01, 0, 0.01, 0.02].map((x) => r + x);
  const gSteps = [-0.01, -0.005, 0, 0.005, 0.01].map((x) => gT + x);
  const sensitivity = rSteps.map((rr) => ({
    r: rr,
    cells: gSteps.map((gg) => {
      const v = intrinsicPerShare({ fcf0, g, r: rr, gT: gg, years, netDebtAdj, shares });
      return { gT: gg, value: v ? v.perShare : null };
    }),
  }));

  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Subscore = clamp(50 + 100 × upside, 0, 100), where upside = intrinsic value per share / price − 1.',
    note: NOTE,
    warning: hasNetDebt ? null : 'EDGAR did not report both debt and cash, so equity value = enterprise value (no net-debt adjustment).',
    metrics: { price, intrinsicValue: base.perShare, upside, fcf0, fcfYear: lastRow.year, gHist: Number.isFinite(gHist) ? gHist : null, growth: g, growthSource, riskFreeRate: rf, beta, erp, discountRate: r, terminalGrowth: gT, pvProjections: base.pv, terminalValue: base.tv, pvTerminal: base.pvTv, enterpriseValue: base.ev, debt, cash, equityValue: base.equity, shares, terminalShare: base.pvTv / base.ev },
    inputs: [
      { label: 'Latest FCF (FY' + lastRow.year + ')', value: `${fmtMoney(lastRow.operatingCashFlow)} OCF − ${fmtMoney(lastRow.capex)} CapEx = ${fmtMoney(fcf0)}`, source: 'EDGAR 10-K' },
      { label: 'FCF growth g', value: fmtPct(g), source: growthSource },
      { label: 'Risk-free rate R_f', value: fmtPct(rf, 2), source: settings?.riskFreeSource || 'Settings (3-month T-bill yield)' },
      { label: 'Beta β', value: fmt(beta), source: 'Risk model (1-year daily vs SPY)' },
      { label: 'Equity risk premium', value: fmtPct(erp), source: 'Settings' },
      { label: 'Terminal growth g_T', value: fmtPct(gT), source: 'Settings' },
      { label: 'Total debt / cash', value: hasNetDebt ? `${fmtMoney(debt)} / ${fmtMoney(cash)}` : 'not both available', source: 'EDGAR latest fiscal year-end' },
      { label: 'Shares outstanding', value: `${fmtShares(shares)} (as of ${fundamentals.sharesOutstanding.asOf})`, source: fundamentals.sharesOutstanding.tag },
      { label: 'Price', value: `$${fmt(price)}`, source: 'Alpaca latest close' },
    ],
    steps: [
      { label: 'Free cash flow', formula: 'FCF = OCF − CapEx', calc: `${fmtMoney(lastRow.operatingCashFlow)} − ${fmtMoney(lastRow.capex)}`, result: `FCF₀ = ${fmtMoney(fcf0)}` },
      { label: 'Historical growth', formula: 'g_hist = (FCF_last / FCF_first)^(1/years) − 1', calc: Number.isFinite(gHist) ? `(${fmtMoney(fcf0)} / ${fmtMoney(firstRow.fcf)})^(1/${spanYears}) − 1` : 'undefined (non-positive FCF)', result: Number.isFinite(gHist) ? `g_hist = ${fmtPct(gHist)}` : 'n/a' },
      { label: 'Growth used', formula: overrideSet ? 'g = user override' : 'g = clamp(g_hist, g_min, g_max)', calc: overrideSet ? 'from Settings' : `clamp(${fmtPct(gHist)}, ${fmtPct(gMin, 0)}, ${fmtPct(gMax, 0)})`, result: `g = ${fmtPct(g)}` },
      { label: 'Discount rate (CAPM)', formula: 'r = R_f + β · ERP', calc: `${fmtPct(rf, 2)} + ${fmt(beta)} × ${fmtPct(erp)}`, result: `r = ${fmtPct(r)}` },
      { label: 'PV of 5 projected FCFs', formula: 'PV = Σ FCF₀(1+g)^t / (1+r)^t, t = 1..5', calc: `FCF₁ = ${fmtMoney(fcf0 * (1 + g))} … FCF₅ = ${fmtMoney(base.fcfFinal)}`, result: `PV = ${fmtMoney(base.pv)}` },
      { label: 'Terminal value (Gordon)', formula: 'TV = FCF₅ (1 + g_T) / (r − g_T)', calc: `${fmtMoney(base.fcfFinal)} × ${fmt(1 + gT, 3)} / (${fmtPct(r)} − ${fmtPct(gT)})`, result: `TV = ${fmtMoney(base.tv)}` },
      { label: 'PV of terminal value', formula: 'PV_TV = TV / (1 + r)^5', calc: `${fmtMoney(base.tv)} / ${fmt(Math.pow(1 + r, years), 3)}`, result: `PV_TV = ${fmtMoney(base.pvTv)} (${fmtPct(base.pvTv / base.ev, 0)} of EV)` },
      { label: 'Enterprise value', formula: 'EV = PV + PV_TV', calc: `${fmtMoney(base.pv)} + ${fmtMoney(base.pvTv)}`, result: `EV = ${fmtMoney(base.ev)}` },
      { label: 'Equity value', formula: hasNetDebt ? 'Equity = EV − Debt + Cash' : 'Equity = EV (no net-debt data)', calc: hasNetDebt ? `${fmtMoney(base.ev)} − ${fmtMoney(debt)} + ${fmtMoney(cash)}` : fmtMoney(base.ev), result: `Equity = ${fmtMoney(base.equity)}` },
      { label: 'Intrinsic value per share', formula: 'IV = Equity / Shares', calc: `${fmtMoney(base.equity)} / ${fmtShares(shares)}`, result: `IV = $${fmt(base.perShare)}` },
      { label: 'Upside vs price', formula: 'U = IV / Price − 1', calc: `${fmt(base.perShare)} / ${fmt(price)} − 1`, result: `U = ${fmtPct(upside)}` },
      { label: 'Subscore', formula: 'clamp(50 + 100·U, 0, 100)', calc: `50 + 100 × ${upside.toFixed(4)}`, result: `${subscore} / 100` },
    ],
    chart: { projection, sensitivity, price },
  };
}
