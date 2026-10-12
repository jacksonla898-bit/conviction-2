import React from 'react';
import { overallConclusion } from '../lib/plainEnglish.js';

/** "What this means" card: deterministic plain-English summary of the conviction score. */
export default function Conclusion({ ticker, companyName, conviction, results, pending }) {
  const paras = overallConclusion(ticker, companyName, conviction, results, pending);
  if (!paras) return null;
  return (
    <section className="card p-5 md:p-6" id="conclusion">
      <h2 className="font-semibold mb-2">What this means</h2>
      <div className="space-y-2 text-sm text-ink-2 leading-relaxed">
        {paras.map((p, i) => (
          <p key={i} className={i === 0 ? 'text-ink' : ''}>{p}</p>
        ))}
      </div>
    </section>
  );
}
