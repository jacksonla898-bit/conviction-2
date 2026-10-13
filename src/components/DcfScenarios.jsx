import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { fmt, fmtPct } from '../models/_math.js';
import { chartExplanations } from '../lib/plainEnglish.js';
import { C, FcfProjectionChart } from './charts.jsx';
import ChartBlock from './ChartBlock.jsx';
import Prov from './Prov.jsx';

const ORDER = ['bear', 'base', 'bull'];
const usd = (v) => (v === null || v === undefined ? 'Unavailable' : `$${fmt(v)}`);

function TornadoTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const r = payload[0].payload;
  return (
    <div className="chart-tip max-w-[260px]">
      <div className="text-ink font-semibold">{r.label}</div>
      <div className="text-ink-2">At {r.lowInput}: <span className="num text-ink">{usd(r.valueAtLow)}</span></div>
      <div className="text-ink-2">At {r.highInput}: <span className="num text-ink">{usd(r.valueAtHigh)}</span></div>
      {r.note && <div className="text-[#fab219]">Unavailable end: {r.note}</div>}
      <div className="text-muted">All other inputs held at Base.</div>
    </div>
  );
}

export function TornadoChart({ tornado }) {
  const rows = tornado.rows.filter((r) => r.min !== null).map((r) => ({ ...r, range: [r.min, r.max] }));
  if (!rows.length) return <div className="text-sm text-muted">Unavailable: no input variation produced a defined value.</div>;
  const lo = Math.min(...rows.map((r) => r.min), tornado.price);
  const hi = Math.max(...rows.map((r) => r.max), tornado.price);
  const pad = (hi - lo) * 0.06 || 1;
  return (
    <ResponsiveContainer width="100%" height={40 + rows.length * 30}>
      <BarChart data={rows} layout="vertical" margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" domain={[Math.max(0, lo - pad), hi + pad]} stroke={C.axis} tick={{ fill: C.muted, fontSize: 11, fontFamily: 'ui-monospace, monospace' }} tickLine={false} tickFormatter={(v) => `$${fmt(v, 0)}`} />
        <YAxis type="category" dataKey="label" width={118} stroke={C.axis} tick={{ fill: C.ink2, fontSize: 11 }} tickLine={false} />
        <Tooltip content={<TornadoTip />} cursor={{ fill: '#ffffff10' }} />
        <Bar dataKey="range" fill={C.blue} isAnimationActive={false} radius={[3, 3, 3, 3]} minPointSize={2} />
        <ReferenceLine x={tornado.baseValue} stroke="#ffffff" label={{ value: 'base', fill: '#ffffff', fontSize: 10, position: 'top' }} />
        <ReferenceLine x={tornado.price} stroke={C.yellow} strokeDasharray="4 4" label={{ value: 'price', fill: C.yellow, fontSize: 10, position: 'top' }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DcfGrid({ grid }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs num">
        <thead>
          <tr>
            <th className="p-1 text-left font-medium text-muted">discount ↓ / growth →</th>
            {grid.growths.map((g, j) => <th key={j} className={`p-1 text-right font-medium ${j === grid.baseCol ? 'text-ink' : 'text-muted'}`}>{fmtPct(g, 1)}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.cells.map((row, i) => (
            <tr key={i}>
              <td className={`p-1 ${i === grid.baseRow ? 'text-ink' : 'text-ink-2'}`}>{fmtPct(grid.discounts[i], 1)}</td>
              {row.map((v, j) => {
                const isBase = i === grid.baseRow && j === grid.baseCol;
                const up = v === null ? null : v / grid.price - 1;
                const bg = v === null ? 'transparent' : up >= 0 ? `rgba(12,163,12,${Math.min(0.5, 0.12 + Math.abs(up) * 0.4)})` : `rgba(208,59,59,${Math.min(0.5, 0.12 + Math.abs(up) * 0.4)})`;
                return (
                  <td key={j} className="p-1 text-right text-ink" style={{ background: bg, fontWeight: isBase ? 700 : 400, outline: isBase ? '2px solid #ffffff' : 'none', outlineOffset: -2 }} title={v === null ? 'Unavailable: discount rate is not above terminal growth' : `${fmtPct(up, 1)} vs price $${fmt(grid.price)}`}>
                    {v === null ? 'n/a' : `$${fmt(v, 0)}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-muted mt-1">Fair value per share. Green cells are at or above the current price ${fmt(grid.price)}; red cells are below. The outlined cell is the Base case. Growth rates in this grid are not capped.</div>
    </div>
  );
}

/** Bull / base / bear toggle, tornado chart and sensitivity grid for an available DCF result. */
export default function DcfScenarios({ result, ticker }) {
  const [sel, setSel] = useState('base');
  const { scenarios, tornado, grid, deltasText, price } = result.chart;
  const ex = chartExplanations(result, ticker);
  const s = scenarios[sel];
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-axis overflow-hidden text-xs font-semibold" role="tablist" aria-label="DCF scenario">
            {ORDER.map((k) => (
              <button key={k} role="tab" aria-selected={sel === k} className={`px-3 py-1.5 ${sel === k ? 'bg-s1 text-white' : 'text-ink-2 hover:bg-surface-2'}`} onClick={() => setSel(k)}>{scenarios[k].label}</button>
            ))}
          </div>
          <span className="text-[11px] text-[#fab219]">Scenarios never change the conviction score. The score always uses Base.</span>
        </div>
        <p className="mt-2 text-[11px] text-muted">{deltasText}</p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted">
                <th className="p-1 text-left font-medium">Scenario</th>
                <th className="p-1 text-right font-medium">Fair value / share</th>
                <th className="p-1 text-right font-medium">vs price ${fmt(price)}</th>
                <th className="p-1 text-right font-medium">FCF growth</th>
                <th className="p-1 text-right font-medium">Discount rate</th>
                <th className="p-1 text-right font-medium">Terminal growth</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.map((k) => {
                const x = scenarios[k];
                return (
                  <tr key={k} className={`border-t border-line ${sel === k ? 'bg-surface-2' : ''}`}>
                    <td className="p-1 text-ink-2">{x.label}{k === 'base' ? ' (scored)' : ''}</td>
                    <td className="p-1 text-right num text-ink">{x.available ? usd(x.value) : 'Unavailable'}<Prov p={result.provenance[k]} /></td>
                    <td className="p-1 text-right num" style={{ color: !x.available ? C.muted : x.upside >= 0 ? '#3ecf3e' : '#e66767' }}>{x.available ? fmtPct(x.upside, 1) : '—'}</td>
                    <td className="p-1 text-right num">{fmtPct(x.g, 1)}{x.growthCapped ? ' (cap)' : ''}</td>
                    <td className="p-1 text-right num">{fmtPct(x.r, 1)}</td>
                    <td className="p-1 text-right num">{fmtPct(x.gT, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!s.available && <p className="mt-2 text-xs text-[#fab219]">{s.label} scenario: Unavailable. {s.reason}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartBlock title={`Free cash flow: last actual + 5 projected years (${s.label} growth ${fmtPct(s.g, 1)})`} explanation={ex.projection}>
          <FcfProjectionChart projection={s.projection} />
        </ChartBlock>
        <ChartBlock title="Tornado: fair value when one input moves and the rest stay at Base" explanation={ex.tornado}>
          <TornadoChart tornado={tornado} />
        </ChartBlock>
      </div>
      <ChartBlock title="Sensitivity grid: fair value per share by discount rate and FCF growth" explanation={ex.grid}>
        <DcfGrid grid={grid} />
      </ChartBlock>
    </div>
  );
}

/** Shown when the DCF could not be computed: all three views are Unavailable, with the reason. */
export function DcfUnavailableViews({ reason }) {
  return (
    <ul className="text-xs space-y-1">
      {['Bull / base / bear scenarios', 'Tornado chart', 'Sensitivity grid'].map((v) => (
        <li key={v} className="flex flex-wrap gap-x-2"><span className="text-ink-2">{v}:</span><span className="text-[#e66767] font-semibold">Unavailable</span><span className="text-muted">{reason}</span></li>
      ))}
    </ul>
  );
}
