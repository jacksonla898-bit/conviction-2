// Print layout for the tear sheet (US Letter at 96 dpi: 816 × 1056 px per page).
// Black-and-white friendly: no meaning is carried by colour alone (signs, labels and line styles are used).
// Inline hex colours only, so the page rasterizes reliably.
//
// This component only renders the data it is given. In Wharton mode that data contains no AI text
// (see src/lib/reportData.js); there is no code path here that fetches or generates text.
import React from 'react';
import { BarChart, Bar, Cell, LineChart, Line, ComposedChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, LabelList } from 'recharts';
import { waterfallData } from '../Attribution.jsx';
import { signed } from '../../models/attribution.js';

const PAGE_W = 816;
const PAGE_H = 1056;
const INK = '#000000';
const GREY = '#555555';
const LIGHT = '#999999';
const RULE = '#bbbbbb';
const FONT = 'Arial, Helvetica, sans-serif';
const MONO = '"Courier New", Courier, monospace';

const money = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? 'Unavailable' : `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? 'Unavailable' : `${(v * 100).toFixed(d)}%`);

const page = { width: PAGE_W, height: PAGE_H, boxSizing: 'border-box', padding: '30px 38px 24px', background: '#ffffff', color: INK, fontFamily: FONT, fontSize: 10, lineHeight: 1.3, position: 'relative', overflow: 'hidden' };
const h2 = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, margin: '0 0 4px', borderBottom: `1px solid ${INK}`, paddingBottom: 2 };
const th = { textAlign: 'left', fontSize: 8, fontWeight: 700, color: GREY, textTransform: 'uppercase', letterSpacing: 0.4, padding: '2px 4px', borderBottom: `1px solid ${RULE}` };
const td = { fontSize: 9, padding: '2.5px 4px', borderBottom: `1px solid #e3e3e3`, verticalAlign: 'top' };
const tick = { fontSize: 7.5, fill: GREY, fontFamily: FONT };

function Unavailable({ what, reason, height }) {
  return (
    <div style={{ height, border: `1px dashed ${LIGHT}`, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 8, boxSizing: 'border-box', fontSize: 8.5, color: GREY }}>
      <span><strong style={{ color: INK }}>{what}: Unavailable.</strong> {reason}</span>
    </div>
  );
}

// ---------- charts ----------
function WfLabel({ x, y, width, value }) {
  if (x === undefined || y === undefined) return null;
  return <text x={x + width / 2} y={y - 3} textAnchor="middle" fontSize={8.5} fill={INK} fontFamily={FONT} fontWeight={700}>{value}</text>;
}

function PrintWaterfall({ attribution, width, height }) {
  const { data, lo, hi, ticks } = waterfallData(attribution);
  const fill = (k) => (k === 'anchor' ? '#8c8c8c' : k === 'pos' ? '#1a1a1a' : k === 'round' ? '#cfcfcf' : '#ffffff');
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 14, right: 4, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="#dddddd" vertical={false} />
      <XAxis dataKey="name" stroke={INK} tick={tick} tickLine={false} interval={0} />
      <YAxis domain={[lo, hi]} ticks={ticks} stroke={INK} tick={tick} tickLine={false} width={24} allowDataOverflow />
      <ReferenceLine y={50} stroke={GREY} strokeDasharray="3 3" />
      <Bar dataKey="range" isAnimationActive={false} minPointSize={1}>
        {data.map((d) => <Cell key={d.key} fill={fill(d.kind)} stroke={INK} strokeWidth={d.kind === 'excluded' ? 0.6 : 1} strokeDasharray={d.kind === 'excluded' ? '2 2' : undefined} />)}
        <LabelList dataKey="text" content={<WfLabel />} />
      </Bar>
    </BarChart>
  );
}

function PrintPrice({ series, width, height }) {
  const step = Math.max(1, Math.floor(series.length / 5));
  const ticks = series.filter((_, i) => i % step === 0).map((s) => s.date);
  return (
    <LineChart width={width} height={height} data={series} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="#e3e3e3" vertical={false} />
      <XAxis dataKey="date" stroke={INK} tick={tick} tickLine={false} ticks={ticks} tickFormatter={(d) => String(d).slice(0, 7)} />
      <YAxis stroke={INK} tick={tick} tickLine={false} width={34} domain={['auto', 'auto']} tickFormatter={(v) => `$${Math.round(v)}`} />
      <Line type="monotone" dataKey="close" stroke={INK} strokeWidth={1} dot={false} isAnimationActive={false} />
      <Line type="monotone" dataKey="sma50" stroke="#444444" strokeWidth={1.1} strokeDasharray="5 2" dot={false} connectNulls isAnimationActive={false} />
      <Line type="monotone" dataKey="sma200" stroke="#777777" strokeWidth={1.3} strokeDasharray="1.5 2" dot={false} connectNulls isAnimationActive={false} />
    </LineChart>
  );
}

function PrintFan({ fan, S0, width, height }) {
  const data = fan.map((d) => ({ ...d, band95: [d.p5, d.p95], band50: [d.p25, d.p75] }));
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="#e3e3e3" vertical={false} />
      <XAxis dataKey="day" stroke={INK} tick={tick} tickLine={false} ticks={[0, 63, 126, 189, 252]} tickFormatter={(d) => `${d}d`} />
      <YAxis stroke={INK} tick={tick} tickLine={false} width={34} domain={['auto', 'auto']} tickFormatter={(v) => `$${Math.round(v)}`} />
      <Area type="monotone" dataKey="band95" stroke="none" fill="#dcdcdc" fillOpacity={1} isAnimationActive={false} />
      <Area type="monotone" dataKey="band50" stroke="none" fill="#a8a8a8" fillOpacity={1} isAnimationActive={false} />
      <Line type="monotone" dataKey="p50" stroke={INK} strokeWidth={1.4} dot={false} isAnimationActive={false} />
      <ReferenceLine y={S0} stroke={INK} strokeDasharray="3 3" />
    </ComposedChart>
  );
}

function PrintTornado({ tornado, width, height }) {
  const rows = tornado.rows.filter((r) => r.min !== null).map((r) => ({ ...r, range: [r.min, r.max] }));
  const lo = Math.min(...rows.map((r) => r.min), tornado.price);
  const hi = Math.max(...rows.map((r) => r.max), tornado.price);
  const pad = (hi - lo) * 0.06 || 1;
  return (
    <BarChart width={width} height={height} data={rows} layout="vertical" margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="#e3e3e3" horizontal={false} />
      <XAxis type="number" domain={[Math.max(0, lo - pad), hi + pad]} stroke={INK} tick={tick} tickLine={false} tickFormatter={(v) => `$${Math.round(v)}`} tickCount={5} />
      <YAxis type="category" dataKey="label" width={92} stroke={INK} tick={{ ...tick, fontSize: 7 }} tickLine={false} interval={0} />
      <Bar dataKey="range" fill="#8c8c8c" stroke={INK} strokeWidth={0.6} isAnimationActive={false} minPointSize={1} />
      <ReferenceLine x={tornado.baseValue} stroke={INK} strokeWidth={1.2} label={{ value: 'base', fontSize: 7, fill: INK, position: 'top' }} />
      <ReferenceLine x={tornado.price} stroke={INK} strokeDasharray="3 2" label={{ value: 'price', fontSize: 7, fill: INK, position: 'top' }} />
    </BarChart>
  );
}

function ChartBox({ title, caption, children }) {
  return (
    <div style={{ width: 240 }}>
      <div style={{ fontSize: 8.5, fontWeight: 700 }}>{title}</div>
      {children}
      <div style={{ fontSize: 7.5, color: GREY, lineHeight: 1.25 }}>{caption}</div>
    </div>
  );
}

// ---------- shared ----------
function Footer({ data, pageNo, pages }) {
  return (
    <div data-ts-footer style={{ position: 'absolute', left: 38, right: 38, bottom: 18, borderTop: `1px solid ${INK}`, paddingTop: 4, fontSize: 8, color: INK }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontWeight: 700 }}>{data.disclaimer}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{data.ticker} · {data.runDate} · {data.modeName} · page {pageNo} of {pages}</span>
      </div>
      {data.footerLine && <div style={{ marginTop: 1 }}>{data.footerLine}</div>}
      <div style={{ marginTop: 1, color: GREY }}>Conviction 2.0{data.appVersion ? ` v${data.appVersion}` : ''} · tradeconviction.com · Scores are model outputs, not forecasts.</div>
    </div>
  );
}

function Header({ data, small }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${INK}`, paddingBottom: 6, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase', color: GREY }}>Conviction 2.0 · Equity tear sheet{small ? ' (continued)' : ''}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: small ? 18 : 28, fontWeight: 700, lineHeight: 1.1 }}>{data.ticker}</span>
          <span style={{ fontSize: small ? 10 : 13, color: INK }}>{data.companyName || 'Company name unavailable'}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 9, lineHeight: 1.4 }}>
        <div><strong>Analysis run:</strong> {data.runAtText}{data.asOf ? ` (point-in-time as of ${data.asOf})` : ''}</div>
        <div><strong>Price at run:</strong> {data.price === null ? 'Unavailable' : `${money(data.price)} (Alpaca close, ${data.priceAsOf || 'date unavailable'})`}</div>
        <div><strong>Mode:</strong> {data.modeName}{data.mode === 'wharton' ? ' (template text only, no AI)' : ' (AI-written reasoning on page 2)'}</div>
      </div>
    </div>
  );
}

// ---------- page 1 ----------
function PageOne({ data, pages }) {
  const { attribution, models, dcf, charts, sources } = data;
  return (
    <div data-ts-page="1" style={page}>
      <Header data={data} />

      {/* Everything between the header and the footer. If unusually long "Unavailable" reasons make it
          taller than the page, tearSheet.js scales this block down so nothing is ever clipped. */}
      <div data-ts-main style={{ transformOrigin: 'top left' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
        <div style={{ width: 168, border: `1.5px solid ${INK}`, padding: '8px 10px', boxSizing: 'border-box' }}>
          <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.8, color: GREY }}>Conviction score</div>
          <div style={{ fontSize: 58, fontWeight: 700, lineHeight: '64px', height: 64, fontFamily: FONT }}>{data.score}</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{data.label} conviction</div>
          <div style={{ fontSize: 7.5, color: GREY, marginTop: 6, lineHeight: 1.35 }}>Scale 0–100. 0–39 Low, 40–59 Neutral, 60–79 High, 80–100 Very High. Weighted average of the available model subscores.</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8.5, fontWeight: 700 }}>Score attribution: from neutral 50 to {data.score}</div>
          {attribution ? <PrintWaterfall attribution={attribution} width={555} height={178} /> : <Unavailable what="Attribution" reason="No model produced a subscore." height={178} />}
          <div style={{ fontSize: 7.5, color: GREY }}>Model bar = weight used × (subscore − 50). Black = adds to the score, white = subtracts, grey = start and end.{attribution && attribution.rounding.units !== 0 ? ` Light grey "Rounding" = the weighted average ${attribution.unrounded.toFixed(1)} rounded to the whole number ${attribution.score}.` : ''} The steps sum exactly to the score.{attribution && attribution.renormalized ? ' Excluded models contribute 0 and the remaining weights were renormalized.' : ''}</div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={h2}>Models</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 118 }}>Model</th>
              <th style={{ ...th, width: 50, textAlign: 'right' }}>Subscore</th>
              <th style={{ ...th, width: 62, textAlign: 'right' }}>Weight used</th>
              <th style={{ ...th, width: 66, textAlign: 'right' }}>Contribution</th>
              <th style={th}>Key output</th>
              <th style={{ ...th, width: 190 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td style={{ ...td, fontWeight: 700 }}>{m.label}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{m.subscore === null ? '—' : m.subscore}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{m.included ? `${(m.weightUsed * 100).toFixed(1)}%` : 'excluded'}</td>
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{m.contribution === null ? '—' : signed(m.contribution)}</td>
                <td style={td}>{m.keyOutput}</td>
                <td style={{ ...td, fontSize: 8 }}>{m.status === 'ok' ? (m.included ? 'OK' : 'OK (weight 0, excluded)') : <span><strong>Unavailable.</strong> {m.reason}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={h2}>DCF fair value per share: bear / base / bull</div>
        {dcf.available ? (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Scenario</th>
                  <th style={{ ...th, textAlign: 'right' }}>Fair value</th>
                  <th style={{ ...th, textAlign: 'right' }}>vs price {money(dcf.price)}</th>
                  <th style={{ ...th, textAlign: 'right' }}>FCF growth</th>
                  <th style={{ ...th, textAlign: 'right' }}>Discount rate</th>
                  <th style={{ ...th, textAlign: 'right' }}>Terminal growth</th>
                </tr>
              </thead>
              <tbody>
                {dcf.scenarios.map((s) => (
                  <tr key={s.key}>
                    <td style={{ ...td, fontWeight: s.key === 'base' ? 700 : 400 }}>{s.label}{s.key === 'base' ? ' (used for the score)' : ''}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontWeight: s.key === 'base' ? 700 : 400 }}>{s.available ? money(s.value) : 'Unavailable'}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{s.available ? `${s.upside >= 0 ? '+' : '−'}${Math.abs(s.upside * 100).toFixed(1)}%` : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{pct(s.g)}{s.growthCapped ? ' (cap)' : ''}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{pct(s.r)}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: MONO }}>{pct(s.gT)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 7.5, color: GREY, marginTop: 2 }}>The conviction score always uses the Base case; scenarios do not change it. {dcf.deltasText}{dcf.warning ? ` Note: ${dcf.warning}` : ''}</div>
          </>
        ) : <Unavailable what="DCF fair value (bear / base / bull)" reason={dcf.reason} height={46} />}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={h2}>Key charts</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <ChartBox title="Price, 2 years, with moving averages" caption="Solid = daily close. Dashed = 50-day average. Dotted = 200-day average.">
            {charts.price.series ? <PrintPrice series={charts.price.series} width={240} height={170} /> : <Unavailable what="Price chart" reason={charts.price.unavailable} height={170} />}
          </ChartBox>
          <ChartBox title="Monte Carlo: 1-year simulated price range" caption="Line = median path. Dark band = middle 50% of 10,000 paths, light band = middle 90%. Dashed = price at run.">
            {charts.fan.fan ? <PrintFan fan={charts.fan.fan} S0={charts.fan.S0} width={240} height={170} /> : <Unavailable what="Monte Carlo chart" reason={charts.fan.unavailable} height={170} />}
          </ChartBox>
          <ChartBox title="DCF tornado: fair value, one input at a time" caption="Bar = fair-value range when that input moves and the rest stay at Base. Solid line = Base, dashed = price.">
            {dcf.available && dcf.tornado.rows.some((r) => r.min !== null) ? <PrintTornado tornado={dcf.tornado} width={240} height={170} /> : <Unavailable what="DCF tornado" reason={dcf.available ? 'No input variation produced a defined value.' : dcf.reason} height={170} />}
          </ChartBox>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={h2}>Data sources</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 120 }}>Data</th>
              <th style={{ ...th, width: 86 }}>Source</th>
              <th style={{ ...th, width: 66 }}>As of</th>
              <th style={th}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.type}>
                <td style={{ ...td, fontSize: 8 }}>{s.type}</td>
                <td style={{ ...td, fontSize: 8, fontWeight: 700 }}>{s.source}</td>
                <td style={{ ...td, fontSize: 8, fontFamily: MONO }}>{s.asOf || '—'}</td>
                <td style={{ ...td, fontSize: 8 }}>{s.status === 'ok' ? s.detail : <span><strong>Unavailable.</strong> {s.reason}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      <Footer data={data} pageNo={1} pages={pages} />
    </div>
  );
}

// ---------- page 2 ----------
function inlineBold(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <React.Fragment key={i}>{p}</React.Fragment>));
}

function AiNarrative({ n }) {
  const lines = n.text ? n.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  return (
    <div data-ts-fit style={{ fontSize: 10.5, height: 880, overflow: 'hidden' }}>
      <div style={{ ...h2, fontSize: '1em' }}>{n.title}</div>
      <div style={{ fontSize: '0.82em', color: GREY, marginBottom: 6 }}>
        This section was written by an AI language model{n.model ? ` (${n.model})` : ''} from the computed metrics and subscores shown on page 1. It was instructed to use no figure outside that data. Everything else in this report is computed or template text.
      </div>
      {n.text ? lines.map((l, i) => {
        const h = l.match(/^#{1,6}\s+(.*)$/);
        if (h) return <div key={i} style={{ fontWeight: 700, fontSize: '1.05em', margin: '0.7em 0 0.2em' }}>{inlineBold(h[1])}</div>;
        const b = l.match(/^[-*•]\s+(.*)$/) || l.match(/^\d+[.)]\s+(.*)$/);
        if (b) return <div key={i} style={{ display: 'flex', gap: 6, margin: '0.15em 0' }}><span>•</span><span>{inlineBold(b[1])}</span></div>;
        return <div key={i} style={{ margin: '0.3em 0' }}>{inlineBold(l)}</div>;
      }) : <div style={{ border: `1px dashed ${LIGHT}`, padding: 8 }}><strong>{n.title}: Unavailable.</strong> {n.unavailableReason}</div>}

      <div style={{ ...h2, fontSize: '1em', marginTop: '1.4em' }}>Scoring rules (template text)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {n.scoringRules.map((r) => (
            <tr key={r.label}>
              <td style={{ ...td, fontSize: '0.85em', fontWeight: 700, width: 130 }}>{r.label}</td>
              <td style={{ ...td, fontSize: '0.85em' }}>{r.rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodModel({ m }) {
  return (
    <div style={{ marginBottom: '0.9em' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${INK}`, fontWeight: 700, fontSize: '1.12em' }}>
        <span>{m.label}</span>
        <span>{m.available ? `subscore ${m.subscore}` : 'Unavailable'}</span>
      </div>
      {!m.available ? (
        <div style={{ marginTop: '0.2em' }}><strong>Unavailable and excluded from the score.</strong> {m.reason}</div>
      ) : (
        <>
          <div style={{ color: GREY, margin: '0.2em 0 0.3em' }}><strong style={{ color: INK }}>Inputs.</strong> {m.inputs.join('; ')}</div>
          {m.steps.map((s, i) => (
            <div key={i} style={{ borderBottom: '1px solid #e3e3e3', padding: '0.12em 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{s.label}</span>
                <span style={{ fontFamily: MONO, fontWeight: 700, textAlign: 'right' }}>{s.result}</span>
              </div>
              <div style={{ fontFamily: MONO, color: GREY, fontSize: '0.94em' }}>{s.formula}</div>
            </div>
          ))}
          <div style={{ color: GREY, marginTop: '0.2em' }}><strong style={{ color: INK }}>Scoring rule.</strong> {m.scoringRule}</div>
        </>
      )}
    </div>
  );
}

function MethodNarrative({ n }) {
  const left = n.models.filter((m) => ['dcf', 'monteCarlo', 'risk'].includes(m.id));
  const right = n.models.filter((m) => ['momentum', 'health', 'earnings'].includes(m.id));
  return (
    <div data-ts-fit style={{ fontSize: 8.4, height: 880, overflow: 'hidden', lineHeight: 1.25 }}>
      <div style={{ ...h2, fontSize: '1.2em' }}>{n.title}</div>
      <div style={{ marginBottom: '0.6em' }}>
        <strong>Conviction score.</strong> <span style={{ fontFamily: MONO }}>{n.conviction.formula}</span> = <span style={{ fontFamily: MONO }}>{n.conviction.calc}</span> = <strong>{n.conviction.result}</strong>. Each model below lists its formula, the inputs used and the result. All text is fixed template wording filled with computed values.
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div data-ts-col style={{ flex: 1, minWidth: 0 }}>{left.map((m) => <MethodModel key={m.id} m={m} />)}</div>
        <div data-ts-col style={{ flex: 1, minWidth: 0 }}>{right.map((m) => <MethodModel key={m.id} m={m} />)}</div>
      </div>
    </div>
  );
}

function PageTwo({ data, pages }) {
  return (
    <div data-ts-page="2" style={page}>
      <Header data={data} small />
      {data.narrative.kind === 'methodology' ? <MethodNarrative n={data.narrative} /> : <AiNarrative n={data.narrative} />}
      <Footer data={data} pageNo={2} pages={pages} />
    </div>
  );
}

export default function TearSheet({ data }) {
  const pages = 2;
  return (
    <div style={{ width: PAGE_W, background: '#ffffff' }}>
      <PageOne data={data} pages={pages} />
      <PageTwo data={data} pages={pages} />
    </div>
  );
}
