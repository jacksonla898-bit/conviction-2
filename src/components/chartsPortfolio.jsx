// Charts for ETFs, Treasuries, the Portfolio Grader and the Optimizer. Same dark tokens as charts.jsx.
import React from 'react';
import { ResponsiveContainer, LineChart, BarChart, Line, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, Legend, ScatterChart, Scatter, PieChart, Pie } from 'recharts';
import { fmt, fmtMoney } from '../models/_math.js';
import { C } from './charts.jsx';

const axisPropsFn = () => ({ stroke: C.axis, tick: { fill: C.muted, fontSize: 11 }, tickLine: false, axisLine: { stroke: C.axis } });
const gridPropsFn = () => ({ stroke: C.grid, strokeDasharray: '0', vertical: false });
const H = 230;
const shortDate = (d) => (typeof d === 'string' ? d.slice(0, 7) : d);

function Tip({ active, payload, label, fmtLabel, fmtValue }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tip">
      <div className="text-muted mb-1">{fmtLabel ? fmtLabel(label, payload) : label}</div>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="num ml-auto text-ink">{fmtValue ? fmtValue(p.value, p.name, p.payload) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function YieldCurveChart({ points }) {
  const sel = points.find((p) => p.selected);
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={points} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridPropsFn()} />
        <XAxis dataKey="label" {...axisPropsFn()} interval={0} />
        <YAxis {...axisPropsFn()} width={44} domain={['auto', 'auto']} tickFormatter={(v) => `${fmt(v, 1)}%`} />
        <Tooltip content={<Tip fmtLabel={(l, p) => `${l} (${p[0].payload.id})`} fmtValue={(v) => `${fmt(v, 2)}%`} />} />
        <Line type="monotone" dataKey="yield" name="Yield" stroke={C.blue} strokeWidth={2} dot={{ r: 3, fill: C.blue }} isAnimationActive={false} />
        {sel && <ReferenceDot x={sel.label} y={sel.yield} r={7} fill={C.yellow} stroke={C.surface} label={{ value: 'this', fill: C.yellow, fontSize: 10, position: 'top' }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function YieldHistoryChart({ series }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridPropsFn()} />
        <XAxis dataKey="date" {...axisPropsFn()} tickFormatter={shortDate} minTickGap={60} />
        <YAxis {...axisPropsFn()} width={44} domain={['auto', 'auto']} tickFormatter={(v) => `${fmt(v, 1)}%`} />
        <Tooltip content={<Tip fmtValue={(v) => `${fmt(v, 2)}%`} />} />
        <Line type="monotone" dataKey="yield" name="Yield" stroke={C.blue} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DollarVolumeChart({ series }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={0}>
        <CartesianGrid {...gridPropsFn()} />
        <XAxis dataKey="date" {...axisPropsFn()} tickFormatter={shortDate} minTickGap={60} />
        <YAxis {...axisPropsFn()} width={56} tickFormatter={(v) => fmtMoney(v, 0)} />
        <Tooltip content={<Tip fmtValue={(v) => fmtMoney(v, 1)} />} cursor={{ fill: 'color-mix(in srgb, var(--ink) 6%, transparent)' }} />
        <Bar dataKey="dollarVolume" name="Dollar volume (IEX)" fill={C.blue} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DividendsChart({ series }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridPropsFn()} />
        <XAxis dataKey="date" {...axisPropsFn()} tickFormatter={shortDate} />
        <YAxis {...axisPropsFn()} width={56} tickFormatter={(v) => `$${fmt(v, 2)}`} />
        <Tooltip content={<Tip fmtValue={(v) => `$${fmt(v, 4)} per share`} />} cursor={{ fill: 'color-mix(in srgb, var(--ink) 6%, transparent)' }} />
        <Bar dataKey="rate" name="Cash dividend" fill={C.aqua} isAnimationActive={false} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CumulativeChart({ data }) {
  const hasBench = data.some((d) => d.sixtyForty !== null && d.sixtyForty !== undefined);
  return (
    <ResponsiveContainer width="100%" height={H + 30}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridPropsFn()} />
        <XAxis dataKey="date" {...axisPropsFn()} tickFormatter={shortDate} minTickGap={60} />
        <YAxis {...axisPropsFn()} width={52} tickFormatter={(v) => `${fmt(v, 0)}%`} domain={['auto', 'auto']} />
        <Tooltip content={<Tip fmtValue={(v) => `${fmt(v, 1)}%`} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.ink2 }} iconType="plainline" />
        <ReferenceLine y={0} stroke={C.axis} />
        <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke={C.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="spy" name="SPY" stroke={C.ink2} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        {hasBench && <Line type="monotone" dataKey="sixtyForty" name="60/40 (SPY/AGG)" stroke={C.yellow} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export const CLASS_COLORS = { stock: C.blue, equity_etf: C.aqua, bond_etf: C.yellow, treasury: C.violet };

export function AllocationPie({ classWeights, labels }) {
  const data = Object.entries(classWeights).map(([k, w]) => ({ name: labels[k] || k, key: k, value: +(w * 100).toFixed(2) }));
  return (
    <ResponsiveContainer width="100%" height={H}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2} isAnimationActive={false} label={({ name, value }) => `${name} ${value.toFixed(0)}%`} labelLine={{ stroke: C.axis }}>
          {data.map((d) => <Cell key={d.key} fill={CLASS_COLORS[d.key] || C.muted} stroke={C.surface} />)}
        </Pie>
        <Tooltip content={<Tip fmtValue={(v) => `${fmt(v, 1)}%`} />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CorrelationHeatmap({ corr, tickers }) {
  const color = (v) => (v >= 0 ? `color-mix(in srgb, var(--chart-5) ${Math.round(8 + 70 * Math.min(1, v))}%, transparent)` : `color-mix(in srgb, var(--chart-1) ${Math.round(8 + 70 * Math.min(1, -v))}%, transparent)`);
  return (
    <div className="overflow-x-auto">
      <table className="text-xs num">
        <thead><tr><th className="p-1" />{tickers.map((t) => <th key={t} className="p-1 text-muted font-medium text-right">{t}</th>)}</tr></thead>
        <tbody>
          {corr.map((row, i) => (
            <tr key={i}>
              <td className="p-1 text-ink-2 font-semibold">{tickers[i]}</td>
              {row.map((v, j) => <td key={j} className="p-1 text-right text-ink" style={{ background: i === j ? 'var(--surface-2)' : v === null ? 'transparent' : color(v), minWidth: 52 }}>{v === null ? 'n/a' : v.toFixed(2)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-muted mt-1">1-year daily returns. Orange = move together, blue = move opposite, darker = stronger.</div>
    </div>
  );
}

export function FrontierChart({ frontier, chosen, equal, assets, volCap }) {
  const pts = frontier.map((p) => ({ x: p.vol * 100, y: p.ret * 100, kind: 'frontier' }));
  const assetPts = assets.map((a) => ({ x: a.vol * 100, y: a.expectedReturn * 100, kind: 'asset', ticker: a.ticker }));
  return (
    <ResponsiveContainer width="100%" height={H + 40}>
      <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid {...gridPropsFn()} vertical />
        <XAxis type="number" dataKey="x" name="Volatility" {...axisPropsFn()} tickFormatter={(v) => `${fmt(v, 0)}%`} label={{ value: 'Annualized volatility', fill: C.muted, fontSize: 11, position: 'insideBottom', offset: -4 }} />
        <YAxis type="number" dataKey="y" name="Return" {...axisPropsFn()} width={52} tickFormatter={(v) => `${fmt(v, 0)}%`} />
        <Tooltip cursor={{ stroke: C.axis }} content={({ active, payload }) => {
          if (!active || !payload || !payload.length) return null;
          const p = payload[0].payload;
          return <div className="chart-tip"><div className="text-ink font-semibold">{p.ticker || (p.kind === 'chosen' ? 'Chosen portfolio' : p.kind === 'equal' ? 'Equal weight' : 'Frontier')}</div><div className="text-ink-2">vol {fmt(p.x, 1)}% · hist. return {fmt(p.y, 1)}%</div></div>;
        }} />
        {Number.isFinite(volCap) && <ReferenceLine x={volCap * 100} stroke={C.yellow} strokeDasharray="4 4" label={{ value: 'vol cap', fill: C.yellow, fontSize: 10, position: 'insideTopRight' }} />}
        <Scatter data={pts} line={{ stroke: C.blue, strokeWidth: 1.5 }} fill={C.blue} isAnimationActive={false} />
        <Scatter data={assetPts} fill={C.muted} isAnimationActive={false} shape="diamond" />
        <Scatter data={[{ x: equal.vol * 100, y: equal.ret * 100, kind: 'equal' }]} fill={C.orange} isAnimationActive={false} shape="square" />
        <Scatter data={[{ x: chosen.vol * 100, y: chosen.ret * 100, kind: 'chosen' }]} fill={C.aqua} isAnimationActive={false} shape="star" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
