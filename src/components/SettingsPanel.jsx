import React from 'react';
import { MODEL_ORDER, MODEL_LABELS, DEFAULT_WEIGHTS } from '../models/conviction.js';
import { DCF_DEFAULTS } from '../models/dcf.js';

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-xs text-ink-2 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </label>
  );
}

export default function SettingsPanel({ settings, onChange, onClose, rfInfo }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const setDcf = (patch) => onChange({ ...settings, dcf: { ...settings.dcf, ...patch } });
  const setWeight = (id, v) => onChange({ ...settings, weights: { ...settings.weights, [id]: v === '' ? 0 : Math.max(0, Number(v)) } });
  const total = MODEL_ORDER.reduce((s, id) => s + (Number(settings.weights[id]) || 0), 0);

  return (
    <section className="card p-4 md:p-5 space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">Settings</h2>
        <button className="btn" onClick={onClose}>Close</button>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="block">
          <div className="text-xs text-ink-2 mb-1">Risk-free rate (3-month Treasury yield, %)</div>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={settings.riskFreeAuto !== false} onChange={(e) => set({ riskFreeAuto: e.target.checked })} />
            <span>Look it up automatically from the U.S. Treasury</span>
          </label>
          {settings.riskFreeAuto !== false ? (
            <div className="text-xs text-muted">
              {rfInfo?.value != null ? <>Using <span className="num text-ink">{Number(rfInfo.value).toFixed(2)}%</span> as of {rfInfo.asOf} (Treasury daily par yield curve, 3-month).</> : rfInfo?.error ? <span className="text-[#fab219]">Lookup failed: {rfInfo.error}. Untick to enter it manually.</span> : 'Looking up…'}
            </div>
          ) : (
            <>
              <input className="input" type="number" step="0.01" placeholder="e.g. 4.25" value={settings.riskFreeRate} onChange={(e) => set({ riskFreeRate: e.target.value })} />
              <div className="text-[11px] text-muted mt-1">Used by the DCF and the Sharpe ratio. Current 3-month T-bill yield: treasury.gov daily yield curve, or FRED series DTB3.</div>
            </>
          )}
        </div>
        <Field label="Equity risk premium (%)" hint="CAPM: discount rate = risk-free + beta × ERP.">
          <input className="input" type="number" step="0.1" value={settings.dcf.equityRiskPremium} onChange={(e) => setDcf({ equityRiskPremium: e.target.value })} />
        </Field>
        <Field label="Terminal growth (%)" hint="Perpetual growth after year 5. Must be below the discount rate.">
          <input className="input" type="number" step="0.1" value={settings.dcf.terminalGrowth} onChange={(e) => setDcf({ terminalGrowth: e.target.value })} />
        </Field>
        <Field label="FCF growth override (%)" hint="Blank = use the historical FCF CAGR (capped below). Set a number to force the 5-year growth rate.">
          <input className="input" type="number" step="0.1" placeholder="blank = historical CAGR" value={settings.dcf.growthOverride} onChange={(e) => setDcf({ growthOverride: e.target.value })} />
        </Field>
        <Field label="Growth cap minimum (%)">
          <input className="input" type="number" step="1" value={settings.dcf.growthCapMin} onChange={(e) => setDcf({ growthCapMin: e.target.value })} />
        </Field>
        <Field label="Growth cap maximum (%)">
          <input className="input" type="number" step="1" value={settings.dcf.growthCapMax} onChange={(e) => setDcf({ growthCapMax: e.target.value })} />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Conviction weights</h3>
          <div className="text-xs text-muted">Total {total} — weights are re-normalized, so only the ratios matter.</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {MODEL_ORDER.map((id) => (
            <Field key={id} label={MODEL_LABELS[id]}>
              <input className="input" type="number" min="0" step="1" value={settings.weights[id]} onChange={(e) => setWeight(id, e.target.value)} />
            </Field>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Portfolio score blend</h3>
          <div className="text-xs text-muted">How the portfolio conviction combines its three parts (re-normalized).</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[['conviction', 'Stock conviction'], ['target', 'Target feasibility'], ['risk', 'Portfolio risk']].map(([id, label]) => (
            <Field key={id} label={label}>
              <input className="input" type="number" min="0" step="1" value={settings.portfolioBlend?.[id] ?? 0} onChange={(e) => onChange({ ...settings, portfolioBlend: { ...settings.portfolioBlend, [id]: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) } })} />
            </Field>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => onChange({ ...settings, weights: { ...DEFAULT_WEIGHTS } })}>Reset weights</button>
        <button className="btn" onClick={() => onChange({ ...settings, portfolioBlend: { conviction: 50, target: 30, risk: 20 } })}>Reset portfolio blend</button>
        <button className="btn" onClick={() => onChange({ ...settings, dcf: { ...DCF_DEFAULTS } })}>Reset DCF assumptions</button>
      </div>
    </section>
  );
}
