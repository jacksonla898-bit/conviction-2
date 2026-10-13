import React, { useState } from 'react';

/** A titled chart with an optional collapsible plain-English explanation (fixed template text). */
export default function ChartBlock({ title, explanation, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="text-xs text-ink-2 mb-1">{title}</div>
      {children}
      {explanation && (
        <div className="mt-1">
          <button className="text-xs text-s1 hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide explanation' : 'Explain this chart'}
          </button>
          {open && (
            <div className="mt-2 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed space-y-2">
              <p className="text-ink-2">{explanation.what}</p>
              <p className="text-ink">{explanation.reading}</p>
              <p className="text-muted">{explanation.caveat}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
