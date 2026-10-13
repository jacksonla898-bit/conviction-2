import React from 'react';

/** Where every data type in this analysis came from, and as of when. Same rows as the PDF footer. */
export default function DataSources({ sources }) {
  if (!sources || !sources.length) return null;
  return (
    <section className="card p-4 md:p-5" id="data-sources">
      <h2 className="font-semibold mb-2">Data sources</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="p-1 text-left font-medium">Data</th>
              <th className="p-1 text-left font-medium">Source</th>
              <th className="p-1 text-left font-medium">As of</th>
              <th className="p-1 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.type} className="border-t border-line align-top">
                <td className="p-1 text-ink-2">{s.type}</td>
                <td className="p-1 text-ink">{s.source}</td>
                <td className="p-1 num">{s.asOf || '—'}</td>
                <td className="p-1">{s.status === 'ok' ? <span className="text-ink-2">{s.detail}</span> : <><span className="text-[#fab219] font-semibold">Unavailable</span> <span className="text-muted">{s.reason}</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">Every number on this page has an "i" marker showing its own source and as-of date. Values marked Computed list the sources they were calculated from.</p>
    </section>
  );
}
