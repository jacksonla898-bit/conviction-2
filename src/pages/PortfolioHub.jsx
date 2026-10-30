import React from 'react';
import { Tabs } from '../components/ui.jsx';

export const PORTFOLIO_TABS = [
  { id: 'grade', label: 'Grade' },
  { id: 'optimize', label: 'Optimize' },
  { id: 'stress', label: 'Stress Test' },
  { id: 'saved', label: 'My Portfolios' },
];

/** Portfolio: Grade, Optimize, Stress Test and My Portfolios share one set of holdings. */
export default function PortfolioHub({ tab, onTab, holdingsSummary, children }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0"><Tabs items={PORTFOLIO_TABS} value={tab} onChange={onTab} ariaLabel="Portfolio sections" /></div>
        {holdingsSummary && <div className="hidden md:block text-xs text-muted truncate max-w-[40%]" title={holdingsSummary}>Holdings carry over: {holdingsSummary}</div>}
      </div>
      {children}
    </div>
  );
}
