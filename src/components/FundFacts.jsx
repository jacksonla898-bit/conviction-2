import React from 'react';
import { fmt, fmtPct, fmtMoney } from '../models/_math.js';
import { Unavailable, InfoButton, MetricTile } from './ui.jsx';

const filingText = (f) => `${f.formType} filed ${f.filingDate}${f.reportDate ? ` (period ${f.reportDate})` : ''}, accession ${f.accession}`;

/** Fund facts read from SEC EDGAR filings: what was found, in which filing, and what the filings lack. */
export default function FundFacts({ fund, assetType }) {
  if (!fund) return <section className="card p-5 text-sm text-muted">Fund facts were not looked up for this run.</section>;
  const ex = fund.expense || {};
  const np = fund.nport && fund.nport.status === 'ok' ? fund.nport : null;
  const npReason = fund.nport ? fund.nport.reason : 'not looked up';
  const bond = assetType === 'bond_etf';
  const tiles = [
    { label: 'Expense ratio', value: ex.status === 'ok' ? fmtPct(ex.value, 2) : null, reason: ex.reason, drawer: ex.status === 'ok' ? { title: 'Expense ratio', prov: [`Source: SEC EDGAR, ${filingText(ex)}`, `Element: ${ex.element}`], steps: [{ label: 'Expense ratio', formula: 'as tagged in the prospectus risk/return XBRL', calc: ex.element, result: fmtPct(ex.value, 2) }] } : null },
    { label: 'Fund size (net assets)', value: np ? fmtMoney(np.netAssets, 2) : null, reason: npReason, drawer: np ? { title: 'Net assets', prov: [`Source: SEC EDGAR, ${filingText(np)}`, 'Item B.1.c net assets'], steps: [{ label: 'Net assets', formula: 'total assets − total liabilities', calc: `${fmtMoney(np.totAssets, 2)} − ${fmtMoney(np.totAssets - np.netAssets, 2)}`, result: fmtMoney(np.netAssets, 2) }] } : null },
    { label: 'Holdings count', value: np ? `${np.holdingsCount}` : null, reason: npReason, drawer: np ? { title: 'Holdings', prov: [`Source: SEC EDGAR, ${filingText(np)}`, 'Part C schedule of investments'] } : null },
    { label: 'SEC 30-day yield', value: null, reason: fund.secYield ? fund.secYield.reason : 'unavailable (not in SEC filing)' },
  ];
  if (bond) {
    const d = np && np.duration;
    const c = np && np.credit;
    tiles.push({ label: 'Rate sensitivity (duration)', value: d && d.status === 'ok' ? `${fmt(d.value, 2)}y` : null, reason: (d && d.reason) || npReason, drawer: d && d.status === 'ok' ? { title: 'Duration from N-PORT', prov: [`Source: SEC EDGAR, ${filingText(np)}`, 'Item B.3.a interest-rate risk (DV01)'], steps: [{ label: 'Duration', formula: d.formula, calc: `${fmt(d.dv01, 0)} / ${fmt(np.netAssets, 0)} × 10,000`, result: `${fmt(d.value, 2)} years` }] } : null });
    tiles.push({ label: 'Investment-grade share of credit risk', value: c && c.status === 'ok' ? fmtPct(c.igShare, 1) : null, reason: (c && c.reason) || npReason, drawer: c && c.status === 'ok' ? { title: 'Credit quality split', prov: [`Source: SEC EDGAR, ${filingText(np)}`, 'Item B.3.b credit-spread risk'], steps: [{ label: 'IG share', formula: c.formula, calc: `${fmt(c.igDv01, 0)} / (${fmt(c.igDv01, 0)} + ${fmt(c.nonIgDv01, 0)})`, result: fmtPct(c.igShare, 2) }], note: 'N-PORT does not report letter ratings, so a rating-by-rating breakdown is unavailable (not in SEC filing).' } : null });
  }
  return (
    <div className="space-y-5">
      <section className="card p-4 md:p-5">
        <header className="mb-3"><h3 className="font-semibold">Fund facts from SEC filings</h3><p className="text-xs text-muted">Each value names the filing it came from. A field a filing does not contain is shown as unavailable; nothing is estimated.</p></header>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          {tiles.map((t) => <MetricTile key={t.label} label={t.label} value={t.value} reason={t.reason} drawer={t.drawer} />)}
        </div>
        <ul className="mt-4 text-xs text-ink-2 space-y-1">
          <li>• Expense ratio: {ex.status === 'ok' ? `SEC ${filingText(ex)} (${ex.element})` : ex.reason || 'not looked up'}</li>
          <li>• Holdings, fund size{bond ? ', duration and credit split' : ''}: {np ? `SEC ${filingText(np)}` : npReason}</li>
          <li>• SEC 30-day yield: {fund.secYield ? fund.secYield.reason : 'unavailable (not in SEC filing)'}</li>
        </ul>
      </section>
      {np && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card p-4 md:p-5 overflow-x-auto">
            <h3 className="font-semibold mb-2 inline-flex items-center">Top 10 holdings<InfoButton content={{ title: 'Top holdings', prov: [`Source: SEC EDGAR, ${filingText(np)}`], note: '% of net assets as reported in the filing (Part C, pctVal). Holdings change after the report date.' }} /></h3>
            <table className="data-table"><thead><tr><th>Holding</th><th>Type</th><th className="r">% of net assets</th></tr></thead>
              <tbody>{np.topHoldings.map((h, i) => <tr key={i}><td className="text-ink">{h.name || h.title}{h.maturity ? <span className="text-muted"> · {h.coupon !== null ? `${fmt(h.coupon, 2)}% ` : ''}{h.maturity}</span> : ''}</td><td className="text-xs text-ink-2">{h.assetCat}{h.issuerCat ? ` / ${h.issuerCat}` : ''}</td><td className="r num">{fmtPct(h.pct, 2)}</td></tr>)}</tbody></table>
          </section>
          <section className="card p-4 md:p-5 overflow-x-auto">
            <h3 className="font-semibold mb-2">{bond ? 'Debt by issuer type' : 'Assets by category'}</h3>
            {(bond ? np.issuerBreakdown : np.assetBreakdown).length ? <table className="data-table"><thead><tr><th>Category</th><th className="r">% of net assets</th></tr></thead>
              <tbody>{(bond ? np.issuerBreakdown : np.assetBreakdown).map((b) => <tr key={b.code}><td>{b.label}</td><td className="r num">{fmtPct(b.pct, 1)}</td></tr>)}</tbody></table> : <Unavailable reason="no categorised holdings in the filing" />}
            <p className="text-xs text-muted mt-2">From the filing's issuer and asset category codes. Report period {np.reportDate}.</p>
          </section>
        </div>
      )}
    </div>
  );
}
