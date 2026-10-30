import React from 'react';
import ComparePage from '../components/ComparePage.jsx';
import BacktestPage from '../components/BacktestPage.jsx';
import HistoryPage from '../components/HistoryPage.jsx';
import TrackRecordPage from '../components/TrackRecordPage.jsx';
import { Tabs, EmptyState } from '../components/ui.jsx';

export const ANALYZE_TABS = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'compare', label: 'Compare' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'history', label: 'History' },
  { id: 'track', label: 'Track Record' },
];

/** Analyze: single-asset results, with Compare, Backtest, History and Track Record as labelled tabs. */
export default function AnalyzePage({ tab, onTab, input, setInput, asOfInput, setAsOfInput, onSubmit, fetching, hasResult, settings, onOpenStock, children }) {
  return (
    <div className="space-y-5">
      <Tabs items={ANALYZE_TABS} value={tab} onChange={onTab} ariaLabel="Analyze sections" />
      {tab === 'analysis' && (
        <>
          <form className="card p-4 flex flex-col sm:flex-row gap-3 sm:items-end" onSubmit={(e) => { e.preventDefault(); onSubmit(input, asOfInput || null); }}>
            <label className="flex-1">
              <span className="text-xs text-ink-2 block mb-1">Ticker (stock, ETF, bond ETF, or Treasury such as US10Y)</span>
              <input className="input text-lg uppercase" placeholder="e.g. AAPL, SPY, TLT, US10Y" value={input} onChange={(e) => setInput(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </label>
            <label className="sm:w-48">
              <span className="text-xs text-ink-2 block mb-1">As of (optional)</span>
              <input className="input" type="date" value={asOfInput} max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} onChange={(e) => setAsOfInput(e.target.value)} title="Score with only the data that existed on this date, then see what happened next" />
            </label>
            <button type="submit" className="btn btn-primary justify-center" disabled={fetching || !input.trim()}>{fetching ? 'Analyzing…' : 'Analyze'}</button>
          </form>
          {children}
          {!hasResult && !fetching && <EmptyState title="No analysis yet" text="Enter a ticker above. Stocks run six models; ETFs and Treasuries run their own components. Add an as-of date to score with only the data that existed then." />}
        </>
      )}
      {tab === 'compare' && <ComparePage settings={settings} onOpenStock={onOpenStock} />}
      {tab === 'backtest' && <BacktestPage settings={settings} onOpenStock={onOpenStock} />}
      {tab === 'history' && <HistoryPage onOpenStock={onOpenStock} />}
      {tab === 'track' && <TrackRecordPage settings={settings} onOpenStock={onOpenStock} />}
    </div>
  );
}
