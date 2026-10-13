import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { MODEL_ORDER, MODEL_LABELS, scoreLabel } from '../models/conviction.js';
import { MODE_NAMES } from '../lib/reportData.js';
import { fmt, fmtPct } from '../models/_math.js';

const fmtWhen = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const usd = (v) => (num(v) === null ? 'Unavailable' : `$${fmt(num(v))}`);

function Detail({ row }) {
  const subs = row.model_subscores || {};
  const dcf = row.dcf || {};
  const inputs = row.inputs || {};
  return (
    <div className="grid gap-4 md:grid-cols-2 p-3 bg-surface-2 rounded-lg">
      <div>
        <div className="text-xs font-semibold mb-1">Stored subscores</div>
        <table className="w-full text-xs">
          <thead><tr className="text-muted"><th className="text-left font-medium p-1">Model</th><th className="text-right font-medium p-1">Subscore</th><th className="text-right font-medium p-1">Weight used</th><th className="text-left font-medium p-1">Status</th></tr></thead>
          <tbody>
            {MODEL_ORDER.map((id) => {
              const s = subs[id] || {};
              return (
                <tr key={id} className="border-t border-line align-top">
                  <td className="p-1 text-ink-2">{MODEL_LABELS[id]}</td>
                  <td className="p-1 text-right num">{s.subscore ?? '—'}</td>
                  <td className="p-1 text-right num">{typeof s.weight === 'number' ? `${(s.weight * 100).toFixed(1)}%` : '—'}</td>
                  <td className="p-1">{s.status === 'ok' ? 'ok' : <><span className="text-[#fab219]">Unavailable</span> <span className="text-muted">{s.reason}</span></>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <div className="text-xs font-semibold mb-1">Stored DCF values</div>
        {dcf.status === 'ok' ? (
          <table className="w-full text-xs">
            <thead><tr className="text-muted"><th className="text-left font-medium p-1">Scenario</th><th className="text-right font-medium p-1">Fair value</th><th className="text-right font-medium p-1">vs price</th><th className="text-right font-medium p-1">Growth</th><th className="text-right font-medium p-1">Discount</th><th className="text-right font-medium p-1">Terminal</th></tr></thead>
            <tbody>
              {['bear', 'base', 'bull'].map((k) => {
                const s = dcf[k] || {};
                return (
                  <tr key={k} className="border-t border-line">
                    <td className="p-1 text-ink-2 capitalize">{k}</td>
                    {s.status === 'ok' ? (
                      <>
                        <td className="p-1 text-right num">{usd(s.fair_value)}</td>
                        <td className="p-1 text-right num">{fmtPct(s.upside, 1)}</td>
                        <td className="p-1 text-right num">{fmtPct(s.fcf_growth, 1)}{s.growth_capped ? ' (cap)' : ''}</td>
                        <td className="p-1 text-right num">{fmtPct(s.discount_rate, 1)}</td>
                        <td className="p-1 text-right num">{fmtPct(s.terminal_growth, 1)}</td>
                      </>
                    ) : <td className="p-1 text-[#fab219]" colSpan={5}>Unavailable: {s.reason}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="text-xs"><span className="text-[#fab219] font-semibold">Unavailable</span> <span className="text-muted">{dcf.reason}</span></div>}
        <div className="text-[11px] text-muted mt-2">
          Settings used: risk-free {inputs.risk_free_rate_pct ?? 'n/a'}% ({inputs.risk_free_source || 'source not recorded'}); FCF growth override {inputs.dcf && inputs.dcf.growthOverride !== '' && inputs.dcf.growthOverride !== undefined && inputs.dcf.growthOverride !== null ? `${inputs.dcf.growthOverride}%` : 'not set'}; app version {row.app_version || 'n/a'}.
        </div>
      </div>
    </div>
  );
}

/** History: past runs read from the analysis log through /api/analyses. */
export default function HistoryPage({ onOpenStock }) {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });
  const [filter, setFilter] = useState('');
  const [order, setOrder] = useState('desc');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const res = await api.history({ limit: 500 });
    if (res.ok) setState({ status: 'ok', rows: res.data.rows || [], error: null });
    else setState({ status: 'error', rows: [], error: res.error });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const f = filter.trim().toUpperCase();
    const list = f ? state.rows.filter((r) => String(r.ticker).toUpperCase().includes(f)) : [...state.rows];
    list.sort((a, b) => (order === 'desc' ? String(b.created_at).localeCompare(String(a.created_at)) : String(a.created_at).localeCompare(String(b.created_at))));
    return list;
  }, [state.rows, filter, order]);

  return (
    <div className="space-y-5">
      <section className="card p-4 md:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="font-semibold">History</h2>
            <p className="text-xs text-muted mt-0.5">Every completed analysis is logged with the price at the time it ran. Click a row for the stored subscores and DCF values.</p>
          </div>
          <label className="block"><div className="text-xs text-ink-2 mb-1">Filter by ticker</div><input className="input uppercase w-36" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. NVDA" spellCheck={false} /></label>
          <button className="btn" onClick={load} disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Loading…' : 'Refresh'}</button>
        </div>

        {state.status === 'error' && (
          <div className="mt-4 rounded-lg border border-[#fab21955] bg-[#fab21914] p-3 text-sm"><span className="font-semibold text-[#fab219]">History unavailable.</span> <span className="text-ink-2">{state.error}</span></div>
        )}
        {state.status === 'ok' && rows.length === 0 && <div className="mt-4 text-sm text-muted">{state.rows.length === 0 ? 'No runs have been logged yet. Analyze a ticker on the Stock tab and it will appear here.' : 'No logged runs match that ticker.'}</div>}

        {rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-xs">
                  <th className="p-1 text-left font-medium"><button className="hover:text-ink" onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))} title="Sort by date">Date {order === 'desc' ? '↓' : '↑'}</button></th>
                  <th className="p-1 text-left font-medium">Ticker</th>
                  <th className="p-1 text-right font-medium">Price at run</th>
                  <th className="p-1 text-right font-medium">Score</th>
                  <th className="p-1 text-left font-medium">Mode</th>
                  {/* Future column: "price now vs price at run" (performance tracking is intentionally not built yet). */}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-line cursor-pointer hover:bg-surface-2" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      <td className="p-1 num text-ink-2 whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                      <td className="p-1"><span className="font-semibold">{r.ticker}</span> <span className="text-xs text-muted">{r.company_name || ''}</span></td>
                      <td className="p-1 text-right num" title={r.price_as_of ? `Alpaca daily close, bar dated ${String(r.price_as_of).slice(0, 10)}` : 'Alpaca price was unavailable when this run was logged'}>{usd(r.price_at_run)}</td>
                      <td className="p-1 text-right num">{num(r.score) === null ? '—' : `${num(r.score)} `}<span className="text-xs text-muted">{num(r.score) === null ? '' : scoreLabel(num(r.score))}</span></td>
                      <td className="p-1 text-ink-2">{MODE_NAMES[r.mode] || r.mode}</td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={5} className="p-1">
                          <Detail row={r} />
                          <button className="mt-2 text-xs text-s1 hover:underline" onClick={() => onOpenStock(r.ticker)}>Run {r.ticker} again now →</button>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
