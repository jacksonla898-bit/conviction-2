// Model 2: Discounted cash flow (5-year projection + Gordon growth terminal value).
//
//   Free cash flow            FCF = OperatingCashFlow − CapEx            (annual, from EDGAR)
//   Historical FCF growth     g_hist = (FCF_last / FCF_first)^(1/years) − 1   (needs both > 0)
//   Growth used               g = clamp(g_hist, g_min, g_max)   or the user's override
//   Discount rate (CAPM)      r = R_f + β · ERP      (cost of equity; used as the WACC proxy)
//   Valuation                 see dcfValue.js (projection, Gordon terminal value, equity value per share)
//   Upside                    U = IV / Price − 1
//
//   Subscore = clamp( 50 + 100·U, 0, 100 )   → fairly valued = 50, +50% upside = 100, −50% = 0
//
//   The subscore always uses the Base case. Bull / bear scenarios, the tornado chart and the
//   sensitivity grid (dcfScenarios.js) are views only and never change the score.

import { clamp, cagr, fmt, fmtPct, fmtMoney, fmtShares, unavailable } from './_math.js';
import { buildAnnualTable } from './health.js';
import { dcfValue, projectFcf } from './dcfValue.js';
import { buildScenarios, buildTornado, buildGrid, describeDeltas } from './dcfScenarios.js';
import { SRC, fetched, computed, secInput, settingInput } from '../lib/provenance.js';

export const ID = 'dcf';
export const NAME = 'DCF valuation';
export const NOTE = 'A DCF estimates what the business is worth today from the cash it is expected to generate; the output is extremely sensitive to the growth and discount-rate assumptions, which is why the sensitivity views matter more than the single number.';

export const DCF_DEFAULTS = {
  equityRiskPremium: 5.0, // percent
  terminalGrowth: 2.5, // percent
  growthCapMin: -10, // percent
  growthCapMax: 25, // percent
  growthOverride: '', // percent, blank = use historical CAGR
  projectionYears: 5,
};

export function runDCF({ fundamentals, beta, price, priceAsOf }, settings) {
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

  const latest = table[table.length - 1];
  const debt = latest.totalDebt;
  const cash = latest.cash;
  const hasNetDebt = debt !== null && cash !== null;
  const netDebtAdj = hasNetDebt ? cash - debt : 0;

  // Everything the valuation needs, in one object (also the Base case for the scenario views).
  const baseInputs = { fcf0, g, r, gT, years, netDebtAdj, shares, rf, erp, beta, gMin, gMax, overrideSet, baseYear: lastRow.year };
  const base = dcfValue(baseInputs);
  const upside = base.perShare / price - 1;
  const subscore = Math.round(clamp(50 + 100 * upside, 0, 100));

  const scenarios = buildScenarios(baseInputs, price);
  const tornado = buildTornado(baseInputs, price);
  const grid = buildGrid(baseInputs, price);
  const deltasText = describeDeltas(baseInputs);

  // ---- provenance ----
  const secFcf = secInput(lastRow, 'operating cash flow and capex');
  const secFirst = secInput(firstRow, 'operating cash flow and capex');
  const secBal = secInput(latest, 'debt and cash');
  const sharesP = fetched(shares, SRC.SEC, fundamentals.sharesOutstanding.asOf, `cover page (${fundamentals.sharesOutstanding.tag})`);
  const priceP = fetched(price, SRC.ALPACA, priceAsOf || null, 'latest daily close, IEX feed');
  const betaP = { source: SRC.ALPACA, asOf: priceAsOf || null, detail: 'beta from 1 year of daily returns vs SPY' };
  const rfP = settings?.riskFreeProv || settingInput('risk-free rate');
  const growthP = overrideSet ? fetched(g, SRC.SETTING, null, 'FCF growth override') : computed(g, [secFcf, secFirst, settingInput('growth cap')]);
  const rateP = computed(r, [rfP, betaP, settingInput('equity risk premium')]);
  const ivInputs = [secFcf, growthP, rateP, settingInput('terminal growth'), sharesP, ...(hasNetDebt ? [secBal] : [])];
  const scenarioP = (s) => (s.available ? computed(s.value, [...ivInputs, settingInput('scenario deltas')]) : { value: null, source: SRC.COMPUTED, asOf: null, status: 'unavailable', reason: s.reason });

  return {
    id: ID,
    name: NAME,
    available: true,
    subscore,
    scoringRule: 'Subscore = clamp(50 + 100 × upside, 0, 100), where upside = Base-case intrinsic value per share / price − 1.',
    note: NOTE,
    warning: hasNetDebt ? null : 'EDGAR did not report both debt and cash, so equity value = enterprise value (no net-debt adjustment).',
    keyOutput: `Fair value $${fmt(base.perShare)} vs price $${fmt(price)} (${fmtPct(upside)})`,
    drivers: [
      { label: 'Base fair value vs price', value: `$${fmt(base.perShare)} vs $${fmt(price)} (${fmtPct(upside)})` },
      { label: 'FCF growth / discount rate', value: `${fmtPct(g)} / ${fmtPct(r)}` },
    ],
    metrics: {
      price, intrinsicValue: base.perShare, upside, fcf0, fcfYear: lastRow.year, gHist: Number.isFinite(gHist) ? gHist : null, growth: g, growthSource,
      growthOverrideSet: overrideSet, growthCapMin: gMin, growthCapMax: gMax, riskFreeRate: rf, beta, erp, discountRate: r, terminalGrowth: gT,
      pvProjections: base.pv, terminalValue: base.tv, pvTerminal: base.pvTv, enterpriseValue: base.ev, debt, cash, equityValue: base.equity, shares, terminalShare: base.pvTv / base.ev,
      bearValue: scenarios.bear.value, bullValue: scenarios.bull.value, bearUpside: scenarios.bear.upside, bullUpside: scenarios.bull.upside,
    },
    provenance: {
      price: priceP,
      intrinsicValue: computed(base.perShare, ivInputs),
      upside: computed(upside, [...ivInputs, priceP]),
      growth: growthP,
      discountRate: rateP,
      terminalShare: computed(base.pvTv / base.ev, ivInputs),
      fcf0: computed(fcf0, [secFcf]),
      shares: sharesP,
      bear: scenarioP(scenarios.bear),
      base: scenarioP(scenarios.base),
      bull: scenarioP(scenarios.bull),
    },
    inputs: [
      { label: 'Latest FCF (FY' + lastRow.year + ')', value: `${fmtMoney(lastRow.operatingCashFlow)} OCF − ${fmtMoney(lastRow.capex)} CapEx = ${fmtMoney(fcf0)}`, source: `SEC EDGAR ${lastRow.form || '10-K'}, FY${lastRow.year}` },
      { label: 'FCF growth g', value: fmtPct(g), source: growthSource },
      { label: 'Risk-free rate R_f', value: fmtPct(rf, 2), source: settings?.riskFreeSource || 'Settings (3-month T-bill yield)' },
      { label: 'Beta β', value: fmt(beta), source: 'Risk model (1-year daily vs SPY, Alpaca)' },
      { label: 'Equity risk premium', value: fmtPct(erp), source: 'Settings' },
      { label: 'Terminal growth g_T', value: fmtPct(gT), source: 'Settings' },
      { label: 'Total debt / cash', value: hasNetDebt ? `${fmtMoney(debt)} / ${fmtMoney(cash)}` : 'not both available', source: `SEC EDGAR, FY${latest.year} year-end` },
      { label: 'Shares outstanding', value: `${fmtShares(shares)} (as of ${fundamentals.sharesOutstanding.asOf})`, source: `SEC EDGAR ${fundamentals.sharesOutstanding.tag}` },
      { label: 'Price', value: `$${fmt(price)}`, source: `Alpaca close${priceAsOf ? ` ${priceAsOf}` : ''}` },
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
      { label: 'Subscore (Base case)', formula: 'clamp(50 + 100·U, 0, 100)', calc: `50 + 100 × ${upside.toFixed(4)}`, result: `${subscore} / 100` },
      { label: 'Bear / Bull (not scored)', formula: 'same formula with g, r, g_T shifted by the fixed scenario deltas', calc: `bear g ${fmtPct(scenarios.bear.g)}, r ${fmtPct(scenarios.bear.r)}, g_T ${fmtPct(scenarios.bear.gT)}; bull g ${fmtPct(scenarios.bull.g)}, r ${fmtPct(scenarios.bull.r)}, g_T ${fmtPct(scenarios.bull.gT)}`, result: `${scenarios.bear.available ? `$${fmt(scenarios.bear.value)}` : 'Unavailable'} / ${scenarios.bull.available ? `$${fmt(scenarios.bull.value)}` : 'Unavailable'}` },
    ],
    baseInputs,
    chart: { projection: projectFcf(fcf0, g, years, lastRow.year), scenarios, tornado, grid, deltasText, price },
  };
}
