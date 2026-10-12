// All Recharts chart components. Dark theme tokens match src/index.css.
import React from 'react';
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart, AreaChart, Line, Area, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend, ScatterChart, Scatter,
} from 'recharts';
import { fmt, fmtPct, fmtMoney, fmtShares } from '../models/_math.js';

export const C = {
  blue: '#3987e5', orange: '#d95926', aqua: '#199e70', yellow: '#c98500', magenta: '#d55181', violet: '#9085e9',
  good: '#0ca30c', bad: '#e66767', grid: '#2c2c2a', axis: '#383835', muted: '#898781', ink2: '#c3c2b7',
};

const axisProps = { stroke: C.axis, tick: { fill: C.muted, fontSize: 11, fontFamily: 'ui-monospace, monospace' }, tickLine: false, axisLine: { stroke: C.axis } };
const gridProps = { stroke: C.grid, strokeDasharray: '0', vertical: false };
const H = 230;

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

const shortDate = (d) => (typeof d === 'string' ? d.slice(0, 7) : d);
const money = (v) => `$${fmt(v, 0)}`;

// ---------- Monte Carlo ----------
export function FanChart({ fan, S0 }) {
  const data = fan.map((d) => ({ ...d, band95: [d.p5, d.p95], band50: [d.p25, d.p75] }));
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="day" {...axisProps} tickFormatter={(d) => `${d}d`} minTickGap={40} />
        <YAxis {...axisProps} tickFormatter={money} width={62} domain={['auto', 'auto']} />
        <Tooltip content={<Tip fmtLabel={(l) => `Day ${l}`} fmtValue={(v) => (Array.isArray(v) ? `${money(v[0])} – ${money(v[1])}` : money(v))} />} />
        <Area type="monotone" dataKey="band95" name="5th–95th pct" stroke="none" fill={C.blue} fillOpacity={0.15} isAnimationActive={false} />
        <Area type="monotone" dataKey="band50" name="25th–75th pct" stroke="none" fill={C.blue} fillOpacity={0.3} isAnimationActive={false} />
        <Line type="monotone" dataKey="p50" name="Median" stroke={C.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
        <ReferenceLine y={S0} stroke={C.ink2} strokeDasharray="4 4" label={{ value: 'today', fill: C.muted, fontSize: 10, position: 'insideTopLeft' }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function EndingHistogram({ histogram, S0 }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={histogram} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="price" {...axisProps} tickFormatter={money} minTickGap={30} />
        <YAxis {...axisProps} width={48} />
        <Tooltip content={<Tip fmtLabel={(l, p) => `${money(p[0].payload.from)} – ${money(p[0].payload.to)}`} fmtValue={(v) => `${v} paths`} />} cursor={{ fill: '#ffffff10' }} />
        <Bar dataKey="count" name="Paths" isAnimationActive={false} radius={[3, 3, 0, 0]}>
          {histogram.map((b, i) => <Cell key={i} fill={b.price >= S0 ? C.aqua : C.orange} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------- DCF ----------
export function FcfProjectionChart({ projection }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={projection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="year" {...axisProps} tickFormatter={(y) => y.replace(' (actual)', '')} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtMoney(v, 0)} width={62} />
        <Tooltip content={<Tip fmtValue={(v) => fmtMoney(v)} />} cursor={{ fill: '#ffffff10' }} />
        <Bar dataKey="fcf" name="Free cash flow" isAnimationActive={false} radius={[4, 4, 0, 0]}>
          {projection.map((p, i) => <Cell key={i} fill={p.projected ? C.blue : C.ink2} fillOpacity={p.projected ? 0.9 : 1} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SensitivityTable({ sensitivity, price }) {
  const gs = sensitivity[0].cells.map((c) => c.gT);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs num">
        <thead>
          <tr>
            <th className="text-left text-muted font-medium p-1">r \ g_T</th>
            {gs.map((g) => <th key={g} className="text-right text-muted font-medium p-1">{fmtPct(g, 1)}</th>)}
          </tr>
        </thead>
        <tbody>
          {sensitivity.map((row, i) => (
            <tr key={i} className={i === 2 ? 'bg-surface-2' : ''}>
              <td className="p-1 text-ink-2">{fmtPct(row.r, 1)}</td>
              {row.cells.map((c, j) => {
                const v = c.value;
                const up = v !== null ? v / price - 1 : null;
                const color = v === null ? C.muted : up >= 0 ? C.good : C.bad;
                return (
                  <td key={j} className="p-1 text-right" style={{ color, fontWeight: i === 2 && j === 2 ? 700 : 400 }} title={up !== null ? `${fmtPct(up)} vs price` : 'n/a'}>
                    {v === null ? 'n/a' : `$${fmt(v, 0)}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-muted mt-1">Intrinsic value per share by discount rate (rows) and terminal growth (columns). Green ≥ price ${fmt(price)}, red below. Centre cell = base case.</div>
    </div>
  );
}

// ---------- Risk ----------
export function DrawdownChart({ drawdown }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <AreaChart data={drawdown} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={60} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtPct(v, 0)} width={52} domain={['auto', 0]} />
        <Tooltip content={<Tip fmtValue={(v) => fmtPct(v)} />} />
        <Area type="monotone" dataKey="drawdown" name="Drawdown" stroke={C.bad} strokeWidth={1.5} fill={C.bad} fillOpacity={0.25} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RollingBetaChart({ rollingBeta }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={rollingBeta} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={60} />
        <YAxis {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 1)} />
        <Tooltip content={<Tip fmtValue={(v) => fmt(v)} />} />
        <ReferenceLine y={1} stroke={C.ink2} strokeDasharray="4 4" label={{ value: 'β = 1', fill: C.muted, fontSize: 10, position: 'insideTopLeft' }} />
        <Line type="monotone" dataKey="beta" name="60-day beta" stroke={C.violet} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------- Momentum ----------
export function PriceSmaChart({ series }) {
  return (
    <ResponsiveContainer width="100%" height={H + 30}>
      <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={60} />
        <YAxis {...axisProps} tickFormatter={money} width={62} domain={['auto', 'auto']} />
        <Tooltip content={<Tip fmtValue={(v) => `$${fmt(v)}`} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.ink2 }} iconType="plainline" />
        <Line type="monotone" dataKey="close" name="Close" stroke={C.blue} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="sma50" name="SMA 50" stroke={C.orange} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="sma200" name="SMA 200" stroke={C.aqua} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------- Financial health ----------
export function MarginsChart({ rows }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="year" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtPct(v, 0)} width={52} />
        <Tooltip content={<Tip fmtLabel={(l) => `FY${l}`} fmtValue={(v) => fmtPct(v)} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.ink2 }} iconType="plainline" />
        <Line type="monotone" dataKey="grossMargin" name="Gross margin" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="operatingMargin" name="Operating margin" stroke={C.orange} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="netMargin" name="Net margin" stroke={C.aqua} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RevenueFcfChart({ rows }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="year" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtMoney(v, 0)} width={62} />
        <Tooltip content={<Tip fmtLabel={(l) => `FY${l}`} fmtValue={(v) => fmtMoney(v)} />} cursor={{ fill: '#ffffff10' }} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.ink2 }} />
        <Bar dataKey="revenue" name="Revenue" fill={C.blue} isAnimationActive={false} radius={[4, 4, 0, 0]} />
        <Bar dataKey="fcf" name="Free cash flow" fill={C.yellow} isAnimationActive={false} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------- Earnings & insiders ----------
export function SurpriseChart({ surpriseBars }) {
  if (!surpriseBars.length) return <Empty text="No earnings-surprise data." />;
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={surpriseBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="period" {...axisProps} tickFormatter={shortDate} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtPct(v, 0)} width={52} />
        <Tooltip content={<Tip fmtValue={(v, n, p) => `${fmtPct(v)} (actual ${fmt(p.actual)} vs est ${fmt(p.estimate)})`} />} cursor={{ fill: '#ffffff10' }} />
        <ReferenceLine y={0} stroke={C.axis} />
        <Bar dataKey="surprisePct" name="EPS surprise" isAnimationActive={false} radius={[4, 4, 0, 0]}>
          {surpriseBars.map((b, i) => <Cell key={i} fill={b.surprisePct >= 0 ? C.aqua : C.orange} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function InsiderFlowChart({ monthly }) {
  if (!monthly.length) return <Empty text="No insider-transaction data." />;
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtShares(v)} width={56} />
        <Tooltip content={<Tip fmtValue={(v, n, p) => `${v >= 0 ? '+' : ''}${fmtShares(v)} (bought ${fmtShares(p.bought)}, sold ${fmtShares(p.sold)})`} />} cursor={{ fill: '#ffffff10' }} />
        <ReferenceLine y={0} stroke={C.axis} />
        <Bar dataKey="net" name="Net insider shares (P − S)" isAnimationActive={false} radius={[4, 4, 0, 0]}>
          {monthly.map((m, i) => <Cell key={i} fill={m.net >= 0 ? C.aqua : C.orange} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Empty({ text }) {
  return <div className="h-[120px] flex items-center justify-center text-sm text-muted border border-dashed border-line rounded-lg">{text}</div>;
}

// ---------- Portfolio ----------
export function PortfolioFanChart({ fan, target }) {
  const data = fan.map((d) => ({ ...d, band95: [d.p5, d.p95], band50: [d.p25, d.p75] }));
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="day" {...axisProps} tickFormatter={(d) => `${d}d`} minTickGap={40} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtPct(v, 0)} width={52} domain={['auto', 'auto']} />
        <Tooltip content={<Tip fmtLabel={(l) => `Day ${l}`} fmtValue={(v) => (Array.isArray(v) ? `${fmtPct(v[0], 1)} – ${fmtPct(v[1], 1)}` : fmtPct(v, 1))} />} />
        <Area type="monotone" dataKey="band95" name="5th–95th pct" stroke="none" fill={C.violet} fillOpacity={0.15} isAnimationActive={false} />
        <Area type="monotone" dataKey="band50" name="25th–75th pct" stroke="none" fill={C.violet} fillOpacity={0.3} isAnimationActive={false} />
        <Line type="monotone" dataKey="p50" name="Median" stroke={C.violet} strokeWidth={2} dot={false} isAnimationActive={false} />
        <ReferenceLine y={0} stroke={C.axis} />
        <ReferenceLine y={target} stroke={C.yellow} strokeDasharray="4 4" label={{ value: `target ${fmtPct(target, 0)}`, fill: C.yellow, fontSize: 10, position: 'insideTopLeft' }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function PortfolioHistogram({ histogram, target }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={histogram} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="ret" {...axisProps} tickFormatter={(v) => fmtPct(v, 0)} minTickGap={30} />
        <YAxis {...axisProps} width={48} />
        <Tooltip content={<Tip fmtLabel={(l, p) => `${fmtPct(p[0].payload.from, 1)} to ${fmtPct(p[0].payload.to, 1)}`} fmtValue={(v) => `${v} paths`} />} cursor={{ fill: '#ffffff10' }} />
        <Bar dataKey="count" name="Paths" isAnimationActive={false} radius={[3, 3, 0, 0]}>
          {histogram.map((b, i) => <Cell key={i} fill={b.from >= target ? C.aqua : b.to < 0 ? C.orange : C.muted} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CorrelationTable({ corr, tickers }) {
  const color = (v) => {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(217, 89, 38, ${0.1 + 0.55 * a})` : `rgba(57, 135, 229, ${0.1 + 0.55 * a})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-xs num">
        <thead>
          <tr><th className="p-1" />{tickers.map((t) => <th key={t} className="p-1 text-muted font-medium text-right">{t}</th>)}</tr>
        </thead>
        <tbody>
          {corr.map((row, i) => (
            <tr key={i}>
              <td className="p-1 text-ink-2 font-semibold">{tickers[i]}</td>
              {row.map((v, j) => (
                <td key={j} className="p-1 text-right text-ink" style={{ background: i === j ? 'transparent' : color(v), minWidth: 48 }}>{v.toFixed(2)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-muted mt-1">1.00 = move together perfectly; 0 = unrelated; negative = move opposite. Darker orange = more alike.</div>
    </div>
  );
}

export function PerModelBars({ perModel, labels }) {
  const data = Object.entries(perModel).filter(([, v]) => v).map(([id, v]) => ({ model: labels[id], score: Math.round(v.score) }));
  if (!data.length) return <Empty text="No model subscores available." />;
  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="model" {...axisProps} tick={{ ...axisProps.tick, fontSize: 10 }} interval={0} />
        <YAxis {...axisProps} domain={[0, 100]} width={36} />
        <Tooltip content={<Tip fmtValue={(v) => `${v} / 100`} />} cursor={{ fill: '#ffffff10' }} />
        <Bar dataKey="score" name="Weighted subscore" isAnimationActive={false} radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.score >= 60 ? C.aqua : d.score >= 40 ? C.yellow : C.orange} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------- As-of / backtest ----------
export function ForwardPathChart({ path }) {
  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={path} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={60} />
        <YAxis {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 0)} />
        <Tooltip content={<Tip fmtValue={(v) => fmt(v, 1)} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.ink2 }} iconType="plainline" />
        <ReferenceLine y={100} stroke={C.axis} />
        <Line type="monotone" dataKey="stock" name="Stock (=100 at as-of)" stroke={C.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="spy" name="SPY (=100 at as-of)" stroke={C.ink2} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ScoreReturnScatter({ rows, spyReturn }) {
  const data = rows.filter((r) => Number.isFinite(r.score) && Number.isFinite(r.forwardReturn));
  return (
    <ResponsiveContainer width="100%" height={H + 40}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid {...gridProps} vertical />
        <XAxis type="number" dataKey="score" name="Score" domain={[0, 100]} {...axisProps} label={{ value: 'Conviction score (as of date)', fill: C.muted, fontSize: 11, position: 'insideBottom', offset: -4 }} />
        <YAxis type="number" dataKey="forwardReturn" name="Return" {...axisProps} width={56} tickFormatter={(v) => fmtPct(v, 0)} />
        <Tooltip cursor={{ stroke: C.axis }} content={({ active, payload }) => {
          if (!active || !payload || !payload.length) return null;
          const p = payload[0].payload;
          return <div className="chart-tip"><div className="text-ink font-semibold">{p.ticker}</div><div className="text-ink-2">score {p.score} · return {fmtPct(p.forwardReturn, 1)}{Number.isFinite(p.spyReturn) ? ` · SPY ${fmtPct(p.spyReturn, 1)}` : ''}</div></div>;
        }} />
        {Number.isFinite(spyReturn) && <ReferenceLine y={spyReturn} stroke={C.yellow} strokeDasharray="4 4" label={{ value: 'SPY', fill: C.yellow, fontSize: 10, position: 'insideTopRight' }} />}
        <ReferenceLine x={40} stroke={C.axis} strokeDasharray="2 4" />
        <ReferenceLine x={60} stroke={C.axis} strokeDasharray="2 4" />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.score >= 60 ? C.aqua : d.score < 40 ? C.orange : C.yellow} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
