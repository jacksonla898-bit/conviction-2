// GET /api/fund?ticker=TLT
// Fund facts from SEC EDGAR (free; same User-Agent rule as api/fundamentals.js). Every value carries
// the filing type, filing date and accession it came from. Anything a filing does not contain is
// returned as unavailable with the reason "not in SEC filing"; nothing is estimated.
//
//   ticker → CIK / series / class      sec.gov/files/company_tickers_mf.json (fallback: company_tickers.json for the CIK)
//   expense ratio                       latest 485BPOS prospectus, XBRL risk/return facts
//                                       (oef:NetExpensesOverAssets if tagged for the share class, else oef:ExpensesOverAssets)
//   fund size, holdings                 latest NPORT-P (net assets, every holding with % of net assets)
//   duration (bond funds)               NPORT-P Item B.3 interest-rate risk:  D = Σ DV01 / net assets × 10,000
//   credit-quality split (bond funds)   NPORT-P Item B.3 credit-spread risk: investment-grade vs non-investment-grade DV01
//   SEC 30-day yield                    not in N-PORT or the prospectus XBRL → always unavailable here
import { cached, cleanTicker, sendJson, sendError } from './_lib/http.js';

const UA = () => {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) {
    const err = new Error('Server is missing SEC_USER_AGENT (SEC requires "AppName contact@email.com").');
    err.status = 500;
    throw err;
  }
  return { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate' };
};
const NOT_IN_FILING = 'unavailable (not in SEC filing)';
const ISSUER_LABELS = { UST: 'U.S. Treasury', USGA: 'U.S. government agency', USGSE: 'U.S. government-sponsored entity', MUN: 'Municipal', NUSS: 'Non-U.S. sovereign', CORP: 'Corporate', RF: 'Registered fund', PF: 'Private fund', OTHER: 'Other' };
const ASSET_LABELS = { DBT: 'Debt', EC: 'Equity (common)', EP: 'Equity (preferred)', STIV: 'Short-term investment vehicle', ABS: 'Asset-backed', 'ABS-MBS': 'Mortgage-backed', 'ABS-CBDO': 'CBO/CDO', 'ABS-O': 'Other asset-backed', DE: 'Derivative', DFE: 'Derivative (FX)', DIR: 'Derivative (rates)', DCR: 'Derivative (credit)', RA: 'Repurchase agreement', LON: 'Loan', OTHER: 'Other' };

async function secText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA(), signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`SEC EDGAR returned HTTP ${res.status} for ${url.replace('https://www.sec.gov', '')}`);
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function lookupIds(ticker) {
  const mf = await cached('sec:mf', 24 * 3600 * 1000, async () => JSON.parse(await secText('https://www.sec.gov/files/company_tickers_mf.json')));
  const row = (mf.data || []).find((r) => String(r[3]).toUpperCase() === ticker);
  if (row) return { cik: String(row[0]), seriesId: row[1] || null, classId: row[2] || null, source: 'SEC company_tickers_mf.json' };
  const co = await cached('sec:co', 24 * 3600 * 1000, async () => JSON.parse(await secText('https://www.sec.gov/files/company_tickers.json')));
  const hit = Object.values(co).find((r) => String(r.ticker).toUpperCase() === ticker);
  if (hit) return { cik: String(hit.cik_str), seriesId: null, classId: null, source: 'SEC company_tickers.json (no series/class id: unit investment trust or single-fund registrant)' };
  return null;
}

/** Latest filings of a form type for a series (preferred) or CIK, newest first. */
async function latestFilings(id, type, count = 3) {
  const t = await secText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}&dateb=&owner=include&count=${count + 3}&output=atom`);
  const seen = new Set();
  const out = [];
  for (const m of t.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const get = (tag) => (m[1].match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || null;
    const form = get('filing-type');
    const acc = get('accession-number');
    const href = get('filing-href');
    if (form !== type || !acc || seen.has(acc)) continue;
    seen.add(acc);
    const cik = (href || '').match(/edgar\/data\/(\d+)\//)?.[1] || null;
    out.push({ form, filingDate: get('filing-date'), accession: acc, folder: cik ? `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}` : null, indexUrl: href });
    if (out.length >= count) break;
  }
  return out;
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : null;
};
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const sumAttrs = (el) => (el ? [...el.matchAll(/period\w+="([-\d.]+)"/g)].reduce((s, m) => s + Number(m[1]), 0) : null);

/** Parse an NPORT-P primary_doc.xml (exported for tests). */
export function parseNport(xml) {
  const fundInfo = (xml.match(/<fundInfo>[\s\S]*?<\/fundInfo>/) || [''])[0];
  const netAssets = num(tag(fundInfo, 'netAssets'));
  const totAssets = num(tag(fundInfo, 'totAssets'));
  const seriesName = tag(xml, 'seriesName');
  const repPdDate = tag(xml, 'repPdDate');
  const holdings = [];
  const byIssuer = {};
  const byAsset = {};
  let debtPct = 0;
  for (const m of xml.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/g)) {
    const h = m[1];
    const pct = num(tag(h, 'pctVal'));
    const assetCat = tag(h, 'assetCat') || (h.match(/<assetConditional[^>]*assetCat="([^"]+)"/) || [])[1] || 'OTHER';
    const issuerCat = tag(h, 'issuerCat') || (h.match(/<issuerConditional[^>]*issuerCat="([^"]+)"/) || [])[1] || 'OTHER';
    const isDebt = /<debtSec>/.test(h);
    if (pct !== null) {
      byAsset[assetCat] = (byAsset[assetCat] || 0) + pct;
      if (isDebt) {
        byIssuer[issuerCat] = (byIssuer[issuerCat] || 0) + pct;
        debtPct += pct;
      }
    }
    holdings.push({ name: tag(h, 'name'), title: tag(h, 'title'), pct, assetCat, issuerCat, maturity: isDebt ? tag(h, 'maturityDt') : null, coupon: isDebt ? num(tag(h, 'annualizedRt')) : null });
  }
  const top = holdings.filter((x) => x.pct !== null).sort((a, b) => b.pct - a.pct).slice(0, 10).map((x) => ({ ...x, pct: x.pct / 100 }));
  const breakdown = (o, labels) => Object.entries(o).map(([k, v]) => ({ code: k, label: labels[k] || k, pct: v / 100 })).sort((a, b) => b.pct - a.pct);

  // Interest-rate risk (Item B.3.a): DV01 per currency, summed over maturity buckets and currencies.
  const curMetrics = [...fundInfo.matchAll(/<curMetric>([\s\S]*?)<\/curMetric>/g)].map((m) => ({ currency: tag(m[1], 'curCd'), dv01: sumAttrs((m[1].match(/<intrstRtRiskdv01[^>]*\/?>/) || [])[0]) }));
  const dv01 = curMetrics.length ? curMetrics.reduce((s, c) => s + (c.dv01 || 0), 0) : null;
  const duration = dv01 !== null && netAssets > 0
    ? { status: 'ok', value: (dv01 / netAssets) * 10000, dv01, currencies: curMetrics.map((c) => c.currency), formula: 'D = Σ DV01 / net assets × 10,000' }
    : { status: 'unavailable', reason: `${NOT_IN_FILING}: no interest-rate risk (DV01) reported. Item B.3 is only required when debt is 25% or more of net assets.` };
  const ig = sumAttrs((fundInfo.match(/<creditSprdRiskInvstGrade[^>]*\/?>/) || [])[0]);
  const nonIg = sumAttrs((fundInfo.match(/<creditSprdRiskNonInvstGrade[^>]*\/?>/) || [])[0]);
  const credit = ig === null && nonIg === null
    ? { status: 'unavailable', reason: `${NOT_IN_FILING}: no credit-spread risk reported (N-PORT does not contain credit ratings).` }
    : (ig || 0) + (nonIg || 0) <= 0
      ? { status: 'unavailable', reason: `${NOT_IN_FILING}: the filing reports zero credit-spread risk, so no investment-grade share can be computed.` }
      : { status: 'ok', igDv01: ig || 0, nonIgDv01: nonIg || 0, igShare: (ig || 0) / ((ig || 0) + (nonIg || 0)), formula: 'IG share = investment-grade spread DV01 / (investment-grade + non-investment-grade spread DV01)' };
  return {
    seriesName, reportDate: repPdDate, netAssets, totAssets, holdingsCount: holdings.length, topHoldings: top,
    assetBreakdown: breakdown(byAsset, ASSET_LABELS), issuerBreakdown: breakdown(byIssuer, ISSUER_LABELS), debtPct: debtPct / 100,
    duration, credit,
  };
}

/** Find the expense ratio for a share class in a 485BPOS XBRL instance (exported for tests). */
export function parseExpense(instanceXml, classId, seriesId) {
  const pick = (name) => {
    const facts = [...instanceXml.matchAll(new RegExp(`<(?:oef|rr):${name}\\b([^>]*)>([^<]*)<`, 'g'))]
      .filter((m) => {
        const ctx = (m[1].match(/contextRef="([^"]*)"/) || [])[1] || '';
        return classId ? ctx.endsWith(`${classId}Member`) : seriesId ? ctx.endsWith(`${seriesId}Member`) : false;
      })
      .map((m) => Number(m[2]))
      .filter(Number.isFinite);
    return facts.length ? facts[0] : null;
  };
  const net = pick('NetExpensesOverAssets');
  if (net !== null) return { value: net, element: 'oef:NetExpensesOverAssets (net of fee waivers)' };
  const gross = pick('ExpensesOverAssets');
  if (gross !== null) return { value: gross, element: 'oef:ExpensesOverAssets (total annual fund operating expenses)' };
  return null;
}

async function nportFacts(ids) {
  const filings = await latestFilings(ids.seriesId || ids.cik, 'NPORT-P', 1);
  if (!filings.length) return { status: 'unavailable', reason: `${NOT_IN_FILING}: no NPORT-P filing found for ${ids.seriesId || `CIK ${ids.cik}`}.` };
  const f = filings[0];
  const xml = await secText(`${f.folder}/primary_doc.xml`, 25000);
  const p = parseNport(xml);
  return { status: 'ok', formType: f.form, filingDate: f.filingDate, accession: f.accession, url: f.indexUrl, ...p };
}

async function expenseFacts(ids) {
  if (!ids.classId && !ids.seriesId) return { status: 'unavailable', reason: `${NOT_IN_FILING}: this registrant has no fund series/class id, so its prospectus carries no class-level risk/return XBRL.` };
  const filings = await latestFilings(ids.seriesId || ids.cik, '485BPOS', 3);
  if (!filings.length) return { status: 'unavailable', reason: `${NOT_IN_FILING}: no 485BPOS prospectus filing found.` };
  for (const f of filings) {
    const idx = JSON.parse(await secText(`${f.folder}/index.json`));
    const inst = (idx.directory?.item || []).find((i) => /_htm\.xml$/i.test(i.name)) || (idx.directory?.item || []).find((i) => /\.xml$/i.test(i.name) && !/FilingSummary|primary_doc/i.test(i.name));
    if (!inst) continue;
    const xml = await secText(`${f.folder}/${inst.name}`, 25000);
    const e = parseExpense(xml, ids.classId, ids.seriesId);
    if (e) return { status: 'ok', value: e.value, element: e.element, formType: f.form, filingDate: f.filingDate, accession: f.accession, url: f.indexUrl };
  }
  return { status: 'unavailable', reason: `${NOT_IN_FILING}: the latest ${filings.length} prospectus filing(s) have no tagged expense ratio for ${ids.classId || ids.seriesId}.` };
}

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(req.query.ticker);
    if (!ticker) return sendJson(res, 400, { error: 'Invalid ticker.' });
    const body = await cached(`fund:${ticker}`, 12 * 3600 * 1000, async () => {
      const ids = await lookupIds(ticker);
      if (!ids) {
        const reason = `${NOT_IN_FILING}: ${ticker} is not in the SEC fund ticker lists.`;
        return { ticker, found: false, ids: null, nport: { status: 'unavailable', reason }, expense: { status: 'unavailable', reason }, secYield: { status: 'unavailable', reason } };
      }
      const [nport, expense] = await Promise.all([
        nportFacts(ids).catch((err) => ({ status: 'unavailable', reason: `SEC EDGAR N-PORT lookup failed: ${err.message}` })),
        expenseFacts(ids).catch((err) => ({ status: 'unavailable', reason: `SEC EDGAR prospectus lookup failed: ${err.message}` })),
      ]);
      return { ticker, found: true, ids, nport, expense, secYield: { status: 'unavailable', reason: `${NOT_IN_FILING}: the SEC 30-day yield is not a field in N-PORT or in the prospectus XBRL.` }, source: 'SEC EDGAR' };
    });
    sendJson(res, 200, body, 12 * 3600);
  } catch (err) {
    sendError(res, err);
  }
}
