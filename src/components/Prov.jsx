import React, { useRef, useState } from 'react';
import { provLines } from '../lib/provenance.js';

/**
 * Small "i" marker next to a number. Hover or tap shows where the number came from and its as-of date.
 * All text is fixed template text built from the provenance record.
 */
export default function Prov({ p }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);
  if (!p) return null;
  const lines = provLines(p);
  const show = () => {
    if (ref.current) setAlignRight(ref.current.getBoundingClientRect().left > window.innerWidth / 2);
    setOpen(true);
  };
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`Data source. ${lines.join('. ')}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        className={`ml-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold leading-none normal-case ${p.status === 'unavailable' ? 'border-[#fab21988] text-[#fab219]' : 'border-axis text-muted hover:border-ink-2 hover:text-ink'}`}
      >
        i
      </button>
      {open && (
        <span role="tooltip" className={`absolute top-5 z-30 w-64 max-w-[72vw] rounded-lg border border-axis bg-[#0d0d0d] p-2 text-left font-sans text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-2 shadow-lg ${alignRight ? 'right-0' : 'left-0'}`}>
          {lines.map((l, i) => (
            <span key={i} className={`block ${i === 0 ? 'text-ink' : ''}`} style={{ whiteSpace: 'normal' }}>{l}</span>
          ))}
        </span>
      )}
    </span>
  );
}
