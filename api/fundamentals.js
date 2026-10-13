// GET /api/fundamentals?ticker=AAPL
// Maps ticker -> CIK via sec.gov/files/company_tickers.json, then pulls XBRL company facts
// from data.sec.gov. SEC requires a descriptive User-Agent with a contact email.
import { cached, fetchJson, cleanTicker, sendJson, sendError } from './_lib/http.js';

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const FACTS_URL = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

// XBRL concepts we care about. First tag with usable annual data wins (companies use different tags).
const CONCEPTS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
  totalDebt: ['LongTermDebt', 'DebtInstrumentCarryingAmount', 'LongTermDebtAndCapitalLeaseObligations'],
  longTermDebtNoncurrent: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent', 'LongTermDebtAndFinanceLeaseLiabilitiesNoncurrent'],
  debtCurrent: ['LongTermDebtCurrent', 'DebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'ShortTermBorrowings', 'CommercialPaper'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndCashEquivalentsFairValueDisclosure'],
  sharesDiluted: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'],
};
// Balance-sheet items are "instant" facts (a point in time); everything else is a duration (a fiscal year).
const INSTANT = new Set(['totalDebt', 'longTermDebtNoncurrent', 'debtCurrent', 'equity', 'currentAssets', 'currentLiabilities', 'cash']);

function secHeaders() {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) {
    const err = new Error('Server is missing SEC_USER_AGENT (SEC requires "AppName contact@email.com").');
    err.status = 500;
    throw err;
  }
  return { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate', Accept: 'application/json' };
}

async function tickerMap() {
  return cached('sec:tickers', 24 * 60 * 60 * 1000, async () => {
    const data = await fetchJson(TICKERS_URL, { headers: secHeaders() });
    const map = {};
    for (const row of Object.values(data)) {
      map[String(row.ticker).toUpperCase()] = { cik: String(row.cik_str).padStart(10, '0'), name: row.title };
    }
    return map;
  });
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

/**
 * Reduce a concept's fact list to one value per fiscal year.
 * Duration facts: keep only ~1-year periods (annual figures from 10-K / 20-F filings).
 * Instant facts: keep fiscal-year-end balance-sheet dates.
 * Dedupe by period end year, preferring the most recently filed value (restatements win).
 */
function annualSeries(units, instant) {
  const byYear = new Map();
  for (const f of units) {
    if (!['10-K', '10-K/A', '20-F', '40-F'].includes(f.form)) continue;
    if (!instant) {
      if (!f.start) continue;
      const d = daysBetween(f.start, f.end);
      if (d < 350 || d > 380) continue;
    } else if (f.fp !== 'FY') {
      continue;
    }
    const year = Number(f.end.slice(0, 4));
    const prev = byYear.get(year);
    if (!prev || f.filed > prev.filed || (f.filed === prev.filed && f.end > prev.end)) {
      byYear.set(year, { year, end: f.end, value: f.val, filed: f.filed, fy: f.fy, form: f.form });
    }
  }
  return [...byYear.values()].sort((a, b) => a.end.localeCompare(b.end));
}

function pickConcept(facts, names, instant, asof) {
  const gaap = facts['us-gaap'] || {};
  const ifrs = facts['ifrs-full'] || {};
  let best = null;
  for (const name of names) {
    const concept = gaap[name] || ifrs[name];
    if (!concept) continue;
    let units = concept.units?.USD || concept.units?.shares || concept.units?.pure;
    if (!units || units.length === 0) continue;
    // Point-in-time: only facts that had been FILED by the as-of date existed back then.
    if (asof) units = units.filter((f) => f.filed <= asof);
    if (units.length === 0) continue;
    const series = annualSeries(units, instant);
    if (series.length === 0) continue;
    // Prefer the tag with the most recent data; break ties by series length.
    const last = series[series.length - 1].end;
    if (!best || last > best.last || (last === best.last && series.length > best.series.length)) {
      best = { tag: name, series, last };
    }
  }
  return best ? { tag: best.tag, series: best.series } : null;
}

/** Latest shares outstanding from the cover page (dei), falling back to us-gaap. */
function sharesOutstanding(facts, asof) {
  const filt = (arr) => (asof && arr ? arr.filter((f) => f.filed <= asof) : arr);
  const dei = filt(facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares);
  const gaap = filt(facts['us-gaap']?.CommonStockSharesOutstanding?.units?.shares);
  const list = (dei && dei.length ? dei : gaap) || [];
  if (list.length === 0) return null;
  // Sum multiple share classes reported in the same (latest) filing on the same date (e.g. GOOGL class A/B/C).
  const latestFiled = list.reduce((m, f) => (f.filed > m ? f.filed : m), '');
  const latestRows = list.filter((f) => f.filed === latestFiled);
  const latestEnd = latestRows.reduce((m, f) => (f.end > m ? f.end : m), '');
  const rows = latestRows.filter((f) => f.end === latestEnd);
  const total = rows.reduce((s, f) => s + f.val, 0);
  return {
    value: total,
    asOf: latestEnd,
    tag: dei && dei.length ? 'dei:EntityCommonStockSharesOutstanding' : 'us-gaap:CommonStockSharesOutstanding',
    classes: rows.length,
  };
}

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(req.query.ticker);
    if (!ticker) return sendJson(res, 400, { error: 'Invalid ticker.' });
    const asof = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asof || '') ? req.query.asof : null;

    const map = await tickerMap();
    const entry = map[ticker] || map[ticker.replace('.', '-')] || map[ticker.replace('-', '.')];
    if (!entry) {
      return sendJson(res, 404, { error: `SEC EDGAR has no CIK for ticker ${ticker}. Fundamentals unavailable.`, unavailable: true });
    }

    const facts = await cached(`sec:facts:${entry.cik}`, 6 * 60 * 60 * 1000, () =>
      fetchJson(FACTS_URL(entry.cik), { headers: secHeaders() }, 30000)
    );

    const out = {};
    const tagsUsed = {};
    for (const [key, names] of Object.entries(CONCEPTS)) {
      const picked = pickConcept(facts.facts || {}, names, INSTANT.has(key), asof);
      out[key] = picked ? picked.series : [];
      if (picked) tagsUsed[key] = picked.tag;
    }
    const shares = sharesOutstanding(facts.facts || {}, asof);

    sendJson(
      res,
      200,
      {
        ticker,
        asOf: asof,
        cik: entry.cik,
        companyName: facts.entityName || entry.name,
        source: asof ? `SEC EDGAR XBRL companyfacts (annual 10-K values filed on or before ${asof})` : 'SEC EDGAR XBRL companyfacts (annual values from 10-K filings)',
        tagsUsed,
        sharesOutstanding: shares,
        series: out,
      },
      3600
    );
  } catch (err) {
    sendError(res, err);
  }
}
