// Data provenance. Every fetched or computed metric carries:
//   { value, source, asOf, status: 'ok' | 'unavailable', reason?, inputs?, detail? }
// `source` is where the number came from. For computed values, `inputs` lists the underlying sources.
// Nothing here ever supplies a substitute number: a metric that cannot be produced is `unavailable` with a reason.

export const SRC = {
  SEC: 'SEC EDGAR',
  FINNHUB: 'Finnhub',
  ALPACA: 'Alpaca',
  COMPUTED: 'Computed',
  TREASURY: 'U.S. Treasury', // risk-free rate (daily par yield curve)
  SETTING: 'User setting', // assumptions typed into Settings
};

function dedupe(list) {
  const seen = new Set();
  return list.filter((i) => {
    const k = `${i.source}|${i.asOf}|${i.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Flatten a provenance record to its leaf (non-computed) sources. */
function leaves(p) {
  if (!p) return [];
  if (p.source === SRC.COMPUTED && Array.isArray(p.inputs)) return p.inputs.flatMap(leaves);
  return [{ source: p.source, asOf: p.asOf ?? null, detail: p.detail ?? null }];
}

/** A value taken directly from a data source. */
export function fetched(value, source, asOf, detail) {
  return { value, source, asOf: asOf || null, status: 'ok', ...(detail ? { detail } : {}) };
}

/** A value computed from other values. `inputs` are provenance records or {source, asOf, detail} descriptors. */
export function computed(value, inputs, detail) {
  const list = dedupe((inputs || []).flatMap(leaves));
  const dates = list.map((i) => i.asOf).filter(Boolean).sort();
  return { value, source: SRC.COMPUTED, asOf: dates.length ? dates[dates.length - 1] : null, status: 'ok', inputs: list, ...(detail ? { detail } : {}) };
}

/** A value that could not be produced. Never carries a number. */
export function missing(reason, source = SRC.COMPUTED) {
  return { value: null, source, asOf: null, status: 'unavailable', reason };
}

/** Descriptor for Alpaca daily bars. */
export function alpacaInput(bars, what = 'daily closes') {
  const last = bars[bars.length - 1];
  return { source: SRC.ALPACA, asOf: last.date, detail: `${what}, IEX feed, split-adjusted, ${bars.length} bars through ${last.date}` };
}

/** Descriptor for one SEC annual filing row: {form, year, end, filed}. */
export function secInput(row, what) {
  const form = row.form || '10-K';
  return { source: SRC.SEC, asOf: row.end || null, detail: `${form}, FY${row.year}${what ? ` ${what}` : ''}${row.end ? `, period ended ${row.end}` : ''}${row.filed ? `, filed ${row.filed}` : ''}` };
}

export function settingInput(what) {
  return { source: SRC.SETTING, asOf: null, detail: what };
}

/** Human-readable lines for the info marker. Fixed template text only. */
export function provLines(p) {
  if (!p) return [];
  if (p.status === 'unavailable') return ['Unavailable', `Reason: ${p.reason}`, `Source: ${p.source}`];
  if (p.source === SRC.COMPUTED) {
    const lines = ['Source: Computed'];
    if (p.detail) lines.push(p.detail);
    for (const i of p.inputs || []) lines.push(`From ${i.source}${i.detail ? `: ${i.detail}` : ''}${i.asOf && !(i.detail || '').includes(i.asOf) ? ` (as of ${i.asOf})` : ''}`);
    if (p.asOf) lines.push(`As of ${p.asOf}`);
    return lines;
  }
  const lines = [`Source: ${p.source}${p.detail ? `: ${p.detail}` : ''}`];
  if (p.asOf) lines.push(`As of ${p.asOf}`);
  return lines;
}

/** One-line summary, e.g. for tables and the PDF. */
export function provSummary(p) {
  if (!p) return '';
  if (p.status === 'unavailable') return `Unavailable: ${p.reason}`;
  if (p.source === SRC.COMPUTED) {
    const srcs = [...new Set((p.inputs || []).map((i) => i.source))];
    return `Computed${srcs.length ? ` from ${srcs.join(', ')}` : ''}${p.asOf ? `, as of ${p.asOf}` : ''}`;
  }
  return `${p.source}${p.asOf ? `, as of ${p.asOf}` : ''}`;
}
