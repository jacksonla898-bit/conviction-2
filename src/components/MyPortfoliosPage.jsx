import React, { useEffect, useRef, useState } from 'react';
import { loadSaved, renamePortfolio, deletePortfolio, duplicatePortfolio, exportBackup, parseBackup, importBackup } from '../lib/savedPortfolios.js';
import { ScoreHistoryChart } from './chartsExtra.jsx';
import { EmptyState, Notice, Unavailable } from './ui.jsx';
import { labelText, scoreClass } from '../lib/labels.js';

const UNIT = { percent: '%', dollars: '$', shares: ' sh' };
const when = (iso) => (iso ? iso.slice(0, 10) : '—');

/** My Portfolios: local list with open, rename, delete, duplicate, score history, export and import. */
export default function MyPortfoliosPage({ version, activeId, onOpen, onChanged, onCleared }) {
  const [list, setList] = useState(loadSaved);
  const [open, setOpen] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => { setList(loadSaved()); }, [version]);

  const refresh = (next) => { setList(next); onChanged(); };
  const doExport = () => {
    try {
      const blob = new Blob([exportBackup()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conviction2_portfolios_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg({ tone: 'ok', text: `Exported ${list.length} portfolio${list.length === 1 ? '' : 's'}.` });
    } catch (e) {
      setMsg({ tone: 'bad', text: `Export failed: ${e.message}` });
    }
  };
  const doImport = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseBackup(text);
      if (!parsed.ok) { setMsg({ tone: 'bad', text: `Import rejected: ${parsed.error}` }); return; }
      refresh(importBackup(parsed.portfolios));
      setMsg({ tone: 'ok', text: `Imported ${parsed.portfolios.length} portfolio${parsed.portfolios.length === 1 ? '' : 's'}.` });
    } catch (e) {
      setMsg({ tone: 'bad', text: `Import failed: ${e.message}` });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <section className="card p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">My Portfolios</h2>
            <p className="text-xs text-muted mt-1">Open a portfolio to load its holdings into Grade, Optimize and Stress Test. Every time a saved portfolio is graded, a snapshot of its score is added.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={doExport} disabled={!list.length}>Export backup</button>
            <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}>Import backup</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => doImport(e.target.files && e.target.files[0])} aria-label="Import backup file" />
          </div>
        </div>
        <Notice tone="warn">Saved in this browser only. Export a backup to avoid losing data.</Notice>
        {msg && <div className={`text-xs ${msg.tone === 'bad' ? 'text-bad' : 'text-ink-2'}`} role="status">{msg.text}</div>}
      </section>

      {list.length === 0 && <EmptyState title="No saved portfolios" text="Grade, optimize or stress-test a portfolio and press Save portfolio. Or import a backup file." />}

      {list.map((p) => {
        const last = p.snapshots.length ? p.snapshots[p.snapshots.length - 1] : null;
        const isOpen = open === p.id;
        return (
          <section key={p.id} className={`card p-4 md:p-5 ${activeId === p.id ? 'border-accent/60' : ''}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                {renaming === p.id ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); refresh(renamePortfolio(p.id, name)); setRenaming(null); }}>
                    <input className="input w-64" value={name} autoFocus maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="New name" />
                    <button className="btn btn-sm btn-primary" type="submit">Save</button>
                    <button className="btn btn-sm" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : (
                  <h3 className="font-semibold truncate">{p.name}{activeId === p.id && <span className="ml-2 pill bg-accent/15 text-accent">open</span>}</h3>
                )}
                <div className="text-xs text-ink-2 mt-1 truncate">{p.holdings.map((h) => `${h.ticker} ${h.amount}${UNIT[p.mode] || ''}`).join(' · ')}</div>
                <div className="text-[11px] text-muted mt-1">{p.holdings.length} holdings · updated {when(p.updatedAt)} · {p.snapshots.length} snapshot{p.snapshots.length === 1 ? '' : 's'}{p.thesis && p.thesis.thesis ? ' · has thesis' : ''}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-muted">Last score</div>
                {last ? <div className="flex items-center gap-2 justify-end"><span className={`pill num text-base ${scoreClass(last.score)}`}>{last.score}</span><span className="text-xs text-muted">{labelText(last.label)} · {when(last.date)}</span></div> : <Unavailable reason="Not graded yet" />}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-sm btn-primary" onClick={() => onOpen(p)}>Open</button>
              <button className="btn btn-sm" onClick={() => { setRenaming(p.id); setName(p.name); }}>Rename</button>
              <button className="btn btn-sm" onClick={() => refresh(duplicatePortfolio(p.id))}>Duplicate</button>
              {confirm === p.id ? (
                <span className="inline-flex items-center gap-2 text-xs"><span className="text-ink-2">Delete "{p.name}"?</span><button className="btn btn-sm" style={{ color: 'var(--score-bad)' }} onClick={() => { refresh(deletePortfolio(p.id)); onCleared(p.id); setConfirm(null); }}>Delete</button><button className="btn btn-sm" onClick={() => setConfirm(null)}>Cancel</button></span>
              ) : <button className="btn btn-sm" onClick={() => setConfirm(p.id)}>Delete</button>}
              <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>{isOpen ? 'Hide history' : 'Score history'}</button>
            </div>
            {isOpen && (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-xs text-ink-2 mb-1">Score over time</div>
                  {p.snapshots.length >= 1 ? <ScoreHistoryChart snapshots={p.snapshots} /> : <Unavailable reason="Grade this portfolio to record a snapshot" />}
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th className="r">Total</th><th className="r">Quality</th><th className="r">Diversification</th><th className="r">Risk</th></tr></thead>
                    <tbody>
                      {p.snapshots.length === 0 && <tr><td colSpan={5} className="text-muted">No snapshots yet.</td></tr>}
                      {[...p.snapshots].reverse().map((s, i) => <tr key={i}><td className="num">{s.date.replace('T', ' ').slice(0, 16)}</td><td className="r num font-semibold">{s.score}</td><td className="r num">{s.quality === null ? '—' : Math.round(s.quality)}</td><td className="r num">{s.diversification === null ? '—' : Math.round(s.diversification)}</td><td className="r num">{s.risk === null ? '—' : Math.round(s.risk)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
