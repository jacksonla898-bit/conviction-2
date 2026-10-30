// Charts for the Stress Test and My Portfolios pages.
import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend, ScatterChart, Scatter, Cell } from 'recharts';
import { fmt } from '../models/_math.js';
import { C } from './charts.jsx';

const axisPropsFn = () => ({ stroke: C.axis, tick: { fill: C.muted, fontSize: 11 }, tickLine: false, axisLine: { stroke: C.axis } });
const gridPropsFn = () => ({ stroke: C.grid, strokeDasharray: '0', vertical: false });
const shortDate = (d) => (typeof d === 'string' ? d.slice(0, 7) : d);

function Tip({ active, payload, label, fmtValue }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tip">
      <div className="text-muted mb-1">{label}</div>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p, i) => (
        <div key={i} className="flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} /><span className="text-ink-2">{p.name}</span><span className="num ml-auto text-ink">{fmtValue(p.value)}</span></div>
      ))}
    </div>
  );
}

/** Portfolio vs SPY vs 60/40, indexed to 100 at the scenario start. */
export function IndexedChart({ data, height = 230 }) {
  const hasSpy = data.some((d) => d.spy !== null && d.spy !== undefined);
  const hasBench = data.some((d) => d.sixtyForty !== null && d.sixtyForty !== undefined);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridPropsFn()} />
        <XAxis dataKey="date" {...axisPropsFn()} tickFormatter={shortDate} minTickGap={50} />
        <YAxis {...axisPropsFn()} width={44} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 0)} />
        <Tooltip content={<Tip fmtValue={(v) => fmt(v, 1)} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.ink2 }} iconType="plainline" />
        <ReferenceLine y={100} stroke={C.axis} strokeDasharray="4 4" />
        <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke={C.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
        {hasSpy && <Line type="monotone" dataKey="spy" name="SPY" stroke={C.yellow} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
        {hasBench && <Line type="monotone" dataKey="sixtyForty" name="60/40 (SPY/AGG)" stroke={C.violet} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Score history of a saved portfolio: total plus the three pillars. */
export function ScoreHistoryChart({ snapshots, height = 200 }) {
  const data = snapshots.map((s) => ({ date: s.date.slice(0, 10), total: s.score, quality: s.quality, diversification: s.diversification, risk: s.risk }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridPropsFn()} />
        <XAxis dataKey="date" {...axisPropsFn()} minTickGap={40} />
        <YAxis {...axisPropsFn()} width={36} domain={[0, 100]} />
        <Tooltip content={<Tip fmtValue={(v) => fmt(v, 0)} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.ink2 }} iconType="plainline" />
        <Line type="monotone" dataKey="total" name="Total" stroke={C.blue} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="quality" name="Holding quality" stroke={C.aqua} strokeWidth={1.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="diversification" name="Diversification" stroke={C.violet} strokeWidth={1.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="risk" name="Risk" stroke={C.magenta} strokeWidth={1.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Track Record: score (x) vs forward excess return vs SPY (y), one dot per completed run. */
export function ScoreExcessScatter({ points, height = 280 }) {
  const color = (s) => (s < 40 ? 'var(--score-bad)' : s < 60 ? 'var(--score-warn)' : 'var(--score-good)');
  const data = points.map((p) => ({ ...p, x: p.score, y: p.excess * 100 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid {...gridPropsFn()} vertical />
        <XAxis type="number" dataKey="x" name="Score" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} {...axisPropsFn()} label={{ value: 'Score at run', fill: C.muted, fontSize: 11, position: 'insideBottom', offset: -4 }} />
        <YAxis type="number" dataKey="y" name="Excess return" {...axisPropsFn()} width={52} tickFormatter={(v) => `${fmt(v, 0)}%`} />
        <ReferenceLine y={0} stroke={C.axis} />
        <ReferenceLine x={40} stroke={C.grid} strokeDasharray="4 4" />
        <ReferenceLine x={60} stroke={C.grid} strokeDasharray="4 4" />
        <ReferenceLine x={80} stroke={C.grid} strokeDasharray="4 4" />
        <Tooltip cursor={{ stroke: C.axis }} content={({ active, payload }) => {
          if (!active || !payload || !payload.length) return null;
          const p = payload[0].payload;
          return <div className="chart-tip"><div className="text-ink font-semibold">{p.ticker} · {p.date}</div><div className="text-ink-2">score {p.score} · excess vs SPY {fmt(p.y, 1)}%</div></div>;
        }} />
        <Scatter data={data} isAnimationActive={false}>{data.map((p, i) => <Cell key={i} fill={color(p.score)} />)}</Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
