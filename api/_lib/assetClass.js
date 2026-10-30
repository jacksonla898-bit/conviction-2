// Asset-type classification shared by the server endpoint. Pure functions, no network.
//
// Types: 'stock' | 'equity_etf' | 'bond_etf' | 'treasury' | 'unsupported'
// Treasuries are synthetic tickers (US2Y, US5Y, US10Y, US30Y) priced from FRED yields, so they never
// reach a market-data provider. Individual bonds / CUSIPs are unsupported: no provider here has them.

export const TREASURY_TICKERS = {
  US2Y: { series: 'DGS2', tenor: 2, label: '2-year U.S. Treasury' },
  US5Y: { series: 'DGS5', tenor: 5, label: '5-year U.S. Treasury' },
  US10Y: { series: 'DGS10', tenor: 10, label: '10-year U.S. Treasury' },
  US30Y: { series: 'DGS30', tenor: 30, label: '30-year U.S. Treasury' },
};

/** Normalize user input such as "10Y", "US10Y", "10-year" to a Treasury ticker, or null. */
export function treasuryTicker(raw) {
  const t = String(raw || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const m = t.match(/^(?:US|UST|T)?(2|5|10|30)(?:Y|YR|YEAR)$/);
  return m ? `US${m[1]}Y` : null;
}

/** A 9-character CUSIP (8 alphanumerics + check digit) or ISIN-like input: individual bonds are unsupported. */
export function looksLikeCusip(raw) {
  const t = String(raw || '').trim().toUpperCase();
  return /^[0-9A-Z]{8}[0-9]$/.test(t) && /\d/.test(t) && !/^[A-Z]+$/.test(t);
}

// Known bond ETFs (symbol → reason). Names are also checked below, so this list only needs the common ones.
export const KNOWN_BOND_ETFS = new Set(['AGG', 'BND', 'TLT', 'IEF', 'SHY', 'SHV', 'BIL', 'SGOV', 'TBIL', 'GOVT', 'LQD', 'HYG', 'JNK', 'TIP', 'VTIP', 'SCHP', 'VCIT', 'VCSH', 'VCLT', 'BNDX', 'BNDW', 'MUB', 'VTEB', 'EMB', 'IEI', 'TLH', 'VGIT', 'VGSH', 'VGLT', 'SCHZ', 'SCHO', 'SCHR', 'SPTL', 'SPTS', 'SPTI', 'BSV', 'BIV', 'BLV', 'USHY', 'FLOT', 'IGSB', 'IGIB', 'USIG', 'SPAB', 'SPIB', 'SPLB', 'JPST', 'MINT', 'NEAR', 'ICSH', 'BKLN', 'SRLN', 'PFF', 'EDV', 'ZROZ', 'STIP', 'TDTT', 'TDTF', 'VMBS', 'MBB', 'TOTL', 'BOND', 'FBND', 'JAGG', 'IUSB', 'EAGG', 'DFCF', 'GVI', 'IBTF', 'IBTG', 'IBTH', 'IBTI', 'IBTJ', 'IBTK', 'IBTL', 'BSCO', 'BSCP', 'BSCQ', 'BSCR', 'BSCS']);

const BOND_WORDS = /\b(bond|bonds|treasury|treasuries|t-bill|bill|bills|aggregate|fixed income|fixed-income|credit|corporate|municipal|muni|high yield|high-yield|govt|government|tips|inflation[- ]protected|duration|maturity|floating rate|mortgage|mbs|bank loan|senior loan|income fund)\b/i;
const EQUITY_INCOME_WORDS = /\b(dividend|equity|stock|s&p|russell|nasdaq|index fund|sector|reit|growth|value|small[- ]cap|mid[- ]cap|large[- ]cap|total market|world|international|emerging|covered call|preferred)\b/i;

/**
 * @param {{ticker, finnhubType?: string, name?: string}} info  finnhubType is the /search "type" field (e.g. "ETP", "Common Stock")
 */
export function classify(info) {
  const ticker = String(info.ticker || '').toUpperCase();
  const name = String(info.name || '');
  if (TREASURY_TICKERS[ticker]) return { assetType: 'treasury', reason: `Synthetic Treasury ticker ${ticker} (yield from FRED ${TREASURY_TICKERS[ticker].series})` };
  if (looksLikeCusip(ticker)) return { assetType: 'unsupported', reason: 'unsupported: individual bond data unavailable (looks like a CUSIP).' };
  const type = String(info.finnhubType || '').toUpperCase();
  const isEtf = type === 'ETP' || type === 'ETF' || /\bETF\b|\bFUND\b|\bTRUST\b/i.test(name) && type === '';
  if (!isEtf) {
    if (type === 'COMMON STOCK' || type === 'ADR' || type === 'REIT' || type === 'GDR' || type === '') return { assetType: 'stock', reason: type ? `Finnhub symbol type "${info.finnhubType}"` : 'No ETF classification found; treated as a stock' };
    return { assetType: 'unsupported', reason: `unsupported: Finnhub symbol type "${info.finnhubType}" is not a stock or ETF.` };
  }
  if (KNOWN_BOND_ETFS.has(ticker)) return { assetType: 'bond_etf', reason: `Finnhub type "${info.finnhubType}"; ${ticker} is a known bond ETF` };
  const bondHit = name.match(BOND_WORDS);
  const equityHit = name.match(EQUITY_INCOME_WORDS);
  if (bondHit && !equityHit) return { assetType: 'bond_etf', reason: `Finnhub type "${info.finnhubType}"; fund name contains "${bondHit[0]}"` };
  if (bondHit && equityHit) return { assetType: 'equity_etf', reason: `Finnhub type "${info.finnhubType}"; fund name contains both "${bondHit[0]}" and "${equityHit[0]}", treated as equity` };
  return { assetType: 'equity_etf', reason: `Finnhub type "${info.finnhubType}"; fund name has no bond keywords` };
}
