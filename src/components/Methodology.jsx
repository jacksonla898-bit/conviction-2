import React from 'react';
import { MathModeBadge } from './Reasoning.jsx';

/** Generic Wharton-mode methodology: fixed template rows (formula, calculation, result). No AI anywhere. */
export function StepsTable({ steps }) {
  return (
    <div className="overflow-x-auto">
      <table className="steps-table">
        <thead><tr><th>Step</th><th>Formula</th><th>Calculation</th><th>Result</th></tr></thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={i}>
              <td className="text-ink-2 whitespace-nowrap">{s.label}</td>
              <td className="num text-ink-2">{s.formula}</td>
              <td className="num text-ink-2">{s.calc}</td>
              <td className="num text-ink font-semibold whitespace-nowrap">{s.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * sections: [{ title, subtitle?, steps: [...], note?, unavailable? }]
 */
export default function Methodology({ title = 'Methodology', intro, sections }) {
  return (
    <section className="card p-4 md:p-5" id="methodology">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted">{intro || 'Every number is computed in the browser from the listed inputs. Fixed templates; nothing is generated.'}</p>
        </div>
        <MathModeBadge />
      </header>
      <div className="mt-5 space-y-6">
        {sections.map((s, i) => (
          <div key={i}>
            <div className="flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold">{s.title}</h3>{s.subtitle && <span className="num text-sm text-ink-2">{s.subtitle}</span>}</div>
            {s.note && <p className="text-xs text-muted mt-1">{s.note}</p>}
            {s.unavailable ? <p className="text-sm text-[#e66767] mt-1">{s.unavailable}</p> : <div className="mt-2"><StepsTable steps={s.steps} /></div>}
          </div>
        ))}
      </div>
    </section>
  );
}
