import React from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList } from 'recharts';
import { signed } from '../models/attribution.js';
import { C } from './charts.jsx';

export const SHORT_LABELS = { dcf: 'DCF', monteCarlo: 'Monte Carlo', risk: 'Risk', momentum: 'Momentum', health: 'Health', earnings: 'Earnings' };

/** Waterfall rows shared by the on-screen chart and the PDF. */
export function waterfallData(attribution) {
  const { rows, score, neutral, rounding } = attribution;
  const pts = [neutral, score, ...rows.flatMap((r) => [r.start, r.end])];
  const lo = Math.max(0, Math.floor((Math.min(...pts) - 6) / 5) * 5);
  const hi = Math.min(100, Math.ceil((Math.max(...pts) + 6) / 5) * 5);
  const step = hi - lo > 40 ? 10 : 5;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const data = [
    { key: 'neutral', name: 'Neutral', range: [lo, neutral], kind: 'anchor', text: String(neutral) },
    ...rows.map((r) => ({
      key: r.id,
      name: SHORT_LABELS[r.id] || r.label,
      range: [Math.min(r.start, r.end), Math.max(r.start, r.end)],
      kind: r.excluded ? 'excluded' : r.units >= 0 ? 'pos' : 'neg',
      text: r.excluded ? 'excluded' : signed(r.contribution),
      row: r,
    })),
    // Whole-number rounding of the weighted average, shown as its own step only when it is not zero.
    ...(rounding.units !== 0 ? [{ key: 'rounding', name: 'Rounding', range: [Math.min(rounding.start, rounding.end), Math.max(rounding.start, rounding.end)], kind: 'round', text: signed(rounding.value), rounding }] : []),
    { key: 'score', name: 'Score', range: [lo, score], kind: 'anchor', text: String(score) },
  ];
  return { data, lo, hi, ticks };
}

function BarLabel({ x, y, width, value }) {
  if (x === undefined || y === undefined) return null;
  return <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={11} fill="#c3c2b7" fontFamily="ui-monospace, monospace">{value}</text>;
}

function Tip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  if (d.kind === 'anchor') {
    return <div className="chart-tip"><div className="text-ink font-semibold">{d.key === 'neutral' ? 'Neutral starting point: 50' : `Conviction score: ${d.text}`}</div><div className="text-ink-2">{d.key === 'neutral' ? 'A model that scores exactly 50 adds nothing.' : 'Neutral 50 plus every bar to the left.'}</div></div>;
  }
  if (d.kind === 'round') {
    return (
      <div className="chart-tip max-w-[260px]">
        <div className="text-ink font-semibold">Rounding: {d.text}</div>
        <div className="text-ink-2">The weighted average is {d.rounding.start.toFixed(1)}. The score is shown as a whole number, so it rounds to {d.rounding.end}.</div>
        <div className="text-muted">This step is never more than half a point and is not a model.</div>
      </div>
    );
  }
  const r = d.row;
  if (r.excluded) {
    return (
      <div className="chart-tip max-w-[260px]">
        <div className="text-ink font-semibold">{r.label}</div>
        <div className="text-warn">{r.excludedKind === 'weight' ? 'Weight 0 — excluded' : 'Unavailable — excluded'}</div>
        <div className="text-ink-2">{r.excludedKind === 'weight' ? `Subscore ${r.subscore}, but its weight is set to 0 in Settings.` : `Reason: ${r.reason}`}</div>
        <div className="text-muted">Contribution 0.0. The other weights were renormalized.</div>
      </div>
    );
  }
  return (
    <div className="chart-tip max-w-[280px]">
      <div className="text-ink font-semibold">{r.label}: {signed(r.contribution)} points</div>
      <div className="text-ink-2">Subscore {r.subscore} of 100 ({r.subscore >= 50 ? `${r.subscore - 50} above` : `${50 - r.subscore} below`} neutral)</div>
      <div className="text-ink-2">Weight used {(r.normWeight * 100).toFixed(1)}% (set to {r.nominalWeight})</div>
      <div className="text-muted">{(r.normWeight * 100).toFixed(1)}% × ({r.subscore} − 50) = {r.rawContribution.toFixed(2).replace('-', '−')}</div>
      {r.drivers.map((dr, i) => <div key={i} className="text-ink-2">{dr.label}: <span className="num text-ink">{dr.value}</span></div>)}
    </div>
  );
}

const FILL = { anchor: 'var(--axis)', pos: C.aqua, neg: C.orange, excluded: 'transparent', round: 'var(--muted)' };

export default function Attribution({ attribution }) {
  if (!attribution) return null;
  const { data, lo, hi, ticks } = waterfallData(attribution);
  const excluded = attribution.rows.filter((r) => r.excluded);
  return (
    <section className="card p-4 md:p-5" id="attribution">
      <header>
        <h2 className="font-semibold">Score attribution</h2>
        <p className="text-xs text-muted mt-0.5">How the score gets from a neutral 50 to {attribution.score}. Each model's bar = weight used × (subscore − 50).{attribution.rounding.units !== 0 ? ' The last small step is the rounding of the weighted average to a whole number.' : ''} The steps add up exactly to the score.</p>
      </header>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="name" stroke={C.axis} tick={{ fill: C.muted, fontSize: 11 }} tickLine={false} interval={0} />
            <YAxis domain={[lo, hi]} ticks={ticks} stroke={C.axis} tick={{ fill: C.muted, fontSize: 11, fontFamily: 'ui-monospace, monospace' }} tickLine={false} width={36} allowDataOverflow />
            <Tooltip content={<Tip />} cursor={{ fill: 'color-mix(in srgb, var(--ink) 6%, transparent)' }} />
            <ReferenceLine y={50} stroke={C.ink2} strokeDasharray="4 4" />
            <Bar dataKey="range" isAnimationActive={false} radius={[3, 3, 3, 3]} minPointSize={2}>
              {data.map((d) => <Cell key={d.key} fill={FILL[d.kind]} stroke={d.kind === 'excluded' ? 'var(--score-warn)' : 'none'} strokeDasharray={d.kind === 'excluded' ? '3 3' : undefined} />)}
              <LabelList dataKey="text" content={<BarLabel />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {excluded.length > 0 && (
        <p className="mt-2 text-xs text-warn">
          {excluded.map((r) => `${r.label}: ${r.excludedKind === 'weight' ? 'weight 0, excluded' : 'Unavailable — excluded'}`).join('; ')}. The remaining weights were renormalized to total 100%; the weights actually used are shown below.
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="p-1 text-left font-medium">Model</th>
              <th className="p-1 text-right font-medium">Subscore</th>
              <th className="p-1 text-right font-medium">Weight set</th>
              <th className="p-1 text-right font-medium">Weight used</th>
              <th className="p-1 text-right font-medium">Contribution</th>
              <th className="p-1 text-left font-medium">Main drivers</th>
            </tr>
          </thead>
          <tbody>
            {attribution.rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="p-1 text-ink-2">{r.label}</td>
                <td className="p-1 text-right num">{r.subscore ?? 'Unavailable'}</td>
                <td className="p-1 text-right num text-muted">{r.nominalWeight}</td>
                <td className="p-1 text-right num">{r.excluded ? 'excluded' : `${(r.normWeight * 100).toFixed(1)}%`}</td>
                <td className="p-1 text-right num" style={{ color: r.excluded ? C.muted : r.units >= 0 ? 'var(--score-good)' : 'var(--score-bad)' }}>{signed(r.contribution)}</td>
                <td className="p-1 text-ink-2">{r.excluded ? (r.excludedKind === 'weight' ? 'Weight set to 0 in Settings.' : `Unavailable: ${r.reason}`) : r.drivers.map((d) => `${d.label}: ${d.value}`).join('; ')}</td>
              </tr>
            ))}
            <tr className="border-t border-axis">
              <td className="p-1 text-ink-2">Weighted average (neutral 50 + models)</td>
              <td className="p-1" />
              <td className="p-1" />
              <td className="p-1 text-right num">100.0%</td>
              <td className="p-1 text-right num">{signed(attribution.modelUnits / 10)}</td>
              <td className="p-1 num">50 {attribution.modelUnits >= 0 ? '+' : '−'} {Math.abs(attribution.modelUnits / 10).toFixed(1)} = {attribution.unrounded.toFixed(1)}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="p-1 text-ink-2">Rounding to a whole number</td>
              <td className="p-1" />
              <td className="p-1" />
              <td className="p-1" />
              <td className="p-1 text-right num">{signed(attribution.rounding.value)}</td>
              <td className="p-1 num">{attribution.unrounded.toFixed(1)} → {attribution.score}</td>
            </tr>
            <tr className="border-t border-axis font-semibold">
              <td className="p-1">Conviction score</td>
              <td className="p-1" />
              <td className="p-1" />
              <td className="p-1" />
              <td className="p-1 text-right num">{signed(attribution.totalUnits / 10)}</td>
              <td className="p-1 num">50 {attribution.totalUnits >= 0 ? '+' : '−'} {Math.abs(attribution.totalUnits / 10).toFixed(1)} = {attribution.score}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">Each model's contribution is shown to one decimal and is exactly its weight times its distance from 50. The only other step is rounding the average to a whole number, which is never more than half a point.</p>
    </section>
  );
}
