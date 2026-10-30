import React from 'react';
import { SkeletonCard } from '../ui.jsx';

const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;

/**
 * "What drove this score": the top 3 positive and top 3 negative contributors with their numbers.
 * drivers: [{ label, detail, points }] where points is the contribution to the score (above/below neutral 50).
 */
export default function DriversCard({ drivers, pending, note, unit = 'pts' }) {
  if (pending && (!drivers || !drivers.length)) return <SkeletonCard lines={4} />;
  if (!drivers || !drivers.length) return null;
  const pos = drivers.filter((d) => d.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
  const neg = drivers.filter((d) => d.points < 0).sort((a, b) => a.points - b.points).slice(0, 3);
  const List = ({ title, items, color, empty }) => (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted mb-2">{title}</div>
      {items.length === 0 ? <div className="text-sm text-muted">{empty}</div> : (
        <ul className="space-y-1.5">
          {items.map((d, i) => (
            <li key={i} className="flex items-baseline gap-2 text-sm">
              <span className="num w-12 shrink-0 text-right font-semibold" style={{ color }}>{signed(d.points)}</span>
              <span className="min-w-0"><span className="text-ink">{d.label}</span>{d.detail && <span className="text-muted"> · {d.detail}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <section className="card p-5" id="drivers">
      <header className="mb-3"><h2 className="font-semibold">What drove this score</h2><p className="text-xs text-muted">Points added to or taken from a neutral 50 ({unit}).{note ? ` ${note}` : ''}</p></header>
      <div className="grid gap-5 sm:grid-cols-2">
        <List title="Pushing the score up" items={pos} color="var(--score-good)" empty="Nothing above neutral." />
        <List title="Pulling the score down" items={neg} color="var(--score-bad)" empty="Nothing below neutral." />
      </div>
    </section>
  );
}

/** Build drivers from a conviction attribution (stock and asset pages). */
export function driversFromAttribution(attribution, results) {
  if (!attribution || !attribution.rows) return [];
  return attribution.rows.filter((r) => !r.excluded && r.contribution !== undefined && r.contribution !== null && r.id !== 'rounding').map((r) => ({ label: r.label, detail: results?.[r.id]?.keyOutput || `subscore ${r.subscore}`, points: r.contribution }));
}
