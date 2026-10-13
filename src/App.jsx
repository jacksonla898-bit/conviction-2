import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import ScoreCard from './components/ScoreCard.jsx';
import ModelCard from './components/ModelCard.jsx';
import Conclusion from './components/Conclusion.jsx';
import Attribution from './components/Attribution.jsx';
import DataSources from './components/DataSources.jsx';
import SinceThen from './components/SinceThen.jsx';
import PortfolioPage from './components/PortfolioPage.jsx';
import ComparePage from './components/ComparePage.jsx';
import BacktestPage from './components/BacktestPage.jsx';
import HistoryPage from './components/HistoryPage.jsx';
import AboutPage from './components/AboutPage.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { StandardReasoning, WhartonReasoning } from './components/Reasoning.jsx';
import { fetchAll, runModels, emptyRaw, MODEL_SOURCES, SOURCES, buildReasoningPayload, sinceThen, dataSources } from './lib/pipeline.js';
import { computeConviction, MODEL_ORDER, scoreLabel } from './models/conviction.js';
import { computeAttribution } from './models/attribution.js';
import { loadSettings, saveSettings, loadHistory, pushHistory, clearHistory } from './lib/settings.js';
import { overallConclusion } from './lib/plainEnglish.js';
import { buildLogPayload } from './lib/logPayload.js';
import { buildReportData } from './lib/reportData.js';
import { SRC, fetched, computed } from './lib/provenance.js';
import { api } from './lib/api.js';
import { EXAMPLE_TICKERS, MATH_MODE_LABEL, REPO_URL, APP_VERSION } from './config.js';

const EMPTY_CONVICTION = { score: null, label: 'n/a', breakdown: [], excluded: [], included: [] };
const IDLE_REASONING = { status: 'idle', text: null, error: null, model: null };
const VIEWS = [
  ['stock', 'Stock'],
  ['portfolio', 'Portfolio'],
  ['compare', 'Compare'],
  ['backtest', 'Backtest'],
  ['history', 'History'],
  ['about', 'How it works'],
];

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const t = (p.get('t') || '').toUpperCase();
  const asof = p.get('asof') || '';
  const view = p.get('view') || '';
  return {
    ticker: /^[A-Z0-9.\-]{1,10}$/.test(t) ? t : null,
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(asof) ? asof : null,
    view: VIEWS.some(([v]) => v === view) ? view : null,
  };
}

function writeUrl({ view, ticker, asOf }) {
  const p = new URLSearchParams();
  if (view && view !== 'stock') p.set('view', view);
  if (ticker) p.set('t', ticker);
  if (asOf) p.set('asof', asOf);
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

export default function App() {
  const initialUrl = useRef(readUrl());
  const [settings, setSettings] = useState(() => {
    const s = loadSettings();
    if (initialUrl.current.view) return { ...s, view: initialUrl.current.view };
    if (initialUrl.current.ticker) return { ...s, view: 'stock' }; // a deep link to a ticker always opens the stock view
    return s;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState('');
  const [asOfInput, setAsOfInput] = useState(initialUrl.current.asOf || '');
  const [ticker, setTicker] = useState(null);
  const [asOf, setAsOf] = useState(null);
  const [runAt, setRunAt] = useState(null);
  const [raw, setRaw] = useState(emptyRaw);
  const [results, setResults] = useState({});
  const [computedFor, setComputedFor] = useState(null); // {raw, es}: the inputs the current results were computed from
  const [fetching, setFetching] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [reasoning, setReasoning] = useState(IDLE_REASONING);
  const [rfNow, setRfNow] = useState({ status: 'loading', value: null, asOf: null, error: null });
  const [rfRun, setRfRun] = useState(null); // risk-free rate as of the current run's date (as-of analyses)
  const [copied, setCopied] = useState(false);
  const [logState, setLogState] = useState({ status: 'idle', reason: null });
  const [reportState, setReportState] = useState({ status: 'idle', error: null, filename: null });
  const mcCache = useRef({});
  const runId = useRef(0);
  const savedFor = useRef(null);
  const loggedFor = useRef(null);
  const autoFor = useRef(null);
  const modeRef = useRef(settings.mode);
  modeRef.current = settings.mode;

  useEffect(() => saveSettings(settings), [settings]);

  // Current risk-free rate from the Treasury feed (once per page load).
  useEffect(() => {
    api.riskfree().then((res) => {
      if (res.ok) setRfNow({ status: 'ok', value: res.data.rate, asOf: res.data.asOf, error: null });
      else setRfNow({ status: 'error', value: null, asOf: null, error: res.error });
    });
  }, []);

  // Settings with the risk-free rate resolved (auto from Treasury, or manual), used by every model run.
  const effectiveSettings = useMemo(() => {
    const auto = settings.riskFreeAuto !== false;
    const rf = asOf ? rfRun : rfNow;
    if (!auto) {
      const set = settings.riskFreeRate !== '' && settings.riskFreeRate !== null && settings.riskFreeRate !== undefined;
      return { ...settings, riskFreeSource: 'Settings (manual entry)', riskFreeProv: set ? { source: SRC.SETTING, asOf: null, detail: '3-month T-bill yield entered in Settings' } : null, asOf };
    }
    if (rf && rf.value != null) {
      return { ...settings, riskFreeRate: String(rf.value), riskFreeSource: `Treasury 3-month yield as of ${rf.asOf} (auto)`, riskFreeProv: { source: SRC.TREASURY, asOf: rf.asOf, detail: 'daily par yield curve, 3-month' }, asOf };
    }
    return { ...settings, riskFreeRate: '', riskFreeSource: 'unavailable', riskFreeProv: null, asOf };
  }, [settings, rfNow, rfRun, asOf]);

  // Re-run the math whenever raw data or settings change (no refetch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { results: r } = await runModels(raw, effectiveSettings, mcCache.current);
      if (cancelled) return;
      if (r.monteCarlo?.available) mcCache.current = { monteCarlo: r.monteCarlo, monteCarloBars: raw.prices.data?.stock };
      setResults(r);
      setComputedFor({ raw, es: effectiveSettings });
    })();
    return () => {
      cancelled = true;
    };
  }, [raw, effectiveSettings]);

  const conviction = useMemo(() => (Object.keys(results).length ? computeConviction(results, settings.weights) : EMPTY_CONVICTION), [results, settings.weights]);
  const attribution = useMemo(() => computeAttribution(conviction, results, settings.weights), [conviction, results, settings.weights]);
  const forward = useMemo(() => sinceThen(raw), [raw]);
  const sources = useMemo(() => dataSources(raw, effectiveSettings), [raw, effectiveSettings]);

  // "Complete" = every source has settled, the risk-free lookup has settled, and the results on screen
  // were computed from exactly the current data and settings. Logging, the report and the AI wait for this.
  const rfReady = settings.riskFreeAuto === false || (asOf ? rfRun !== null : rfNow.status !== 'loading');
  const complete = Boolean(
    ticker && !fetching && rfReady && computedFor && computedFor.raw === raw && computedFor.es === effectiveSettings &&
    SOURCES.every((s) => raw[s].status === 'ok' || raw[s].status === 'error') && MODEL_ORDER.every((id) => results[id])
  );

  const price = raw.prices.data?.stock?.at(-1)?.close ?? null;
  const priceDate = raw.prices.data?.stock?.at(-1)?.date ?? null;
  const companyName = raw.fundamentals.data?.companyName ?? null;

  // Local "past analyses" chips (this browser only; current-date runs).
  useEffect(() => {
    if (!complete || asOf || conviction.score === null || savedFor.current === runId.current) return;
    savedFor.current = runId.current;
    setHistory(pushHistory({
      ticker,
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString(),
      score: conviction.score,
      label: conviction.label,
      subscores: Object.fromEntries(MODEL_ORDER.map((id) => [id, results[id]?.available ? results[id].subscore : null])),
      price,
    }));
  }, [complete, asOf, conviction, ticker, results, price]);

  // Analysis log (Supabase, via /api/analyses): one row per completed current-date analysis.
  // A failed write never blocks the analysis; it only shows a small notice.
  useEffect(() => {
    if (!complete || asOf || conviction.score === null || loggedFor.current === runId.current) return;
    const key = runId.current;
    loggedFor.current = key;
    setLogState({ status: 'saving', reason: null });
    const payload = buildLogPayload({ ticker, companyName, mode: modeRef.current, conviction, results, settings: effectiveSettings, appVersion: APP_VERSION });
    api.logAnalysis(payload).then((res) => {
      if (runId.current !== key) return;
      if (res.ok && res.data && res.data.saved) setLogState({ status: 'saved', reason: res.data.price_note || null });
      else setLogState({ status: 'failed', reason: res.error || 'The log did not confirm the write.' });
    });
  }, [complete, asOf, conviction, ticker, companyName, results, effectiveSettings]);

  const analyze = useCallback(async (sym, asOfDate = null) => {
    const t = String(sym || '').trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,10}$/.test(t)) return;
    const a = asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ? asOfDate : null;
    runId.current += 1;
    const myRun = runId.current;
    mcCache.current = {};
    setTicker(t);
    setInput(t);
    setAsOf(a);
    setAsOfInput(a || '');
    setRunAt(new Date());
    setResults({});
    setComputedFor(null);
    setReasoning(IDLE_REASONING);
    setLogState({ status: 'idle', reason: null });
    setReportState({ status: 'idle', error: null, filename: null });
    setFetching(true);
    setCopied(false);
    writeUrl({ view: 'stock', ticker: t, asOf: a });
    if (a) {
      setRfRun(null);
      api.riskfree(a).then((res) => {
        if (runId.current === myRun) setRfRun(res.ok ? { value: res.data.rate, asOf: res.data.asOf } : { value: null, asOf: null, error: res.error });
      });
    }
    await fetchAll(t, (snap) => {
      if (runId.current === myRun) setRaw(snap);
    }, a);
    if (runId.current === myRun) setFetching(false);
  }, []);

  // Deep link: /?t=NVDA[&asof=YYYY-MM-DD]
  useEffect(() => {
    if (initialUrl.current.ticker) analyze(initialUrl.current.ticker, initialUrl.current.asOf);
  }, [analyze]);

  // ---- AI reasoning: Standard mode only ----
  // The AI module is loaded with a dynamic import inside this function, behind the mode check, so in
  // Wharton mode it is never imported, never called, and its text is never held or shown.
  const generateReasoning = useCallback(async () => {
    if (modeRef.current !== 'standard' || !ticker || conviction.score === null) return;
    const myRun = runId.current;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const payload = buildReasoningPayload(ticker, results, conviction, effectiveSettings);
    const { requestReasoning } = await import('./lib/ai.js');
    const res = await requestReasoning('standard', ticker, payload);
    if (runId.current !== myRun || modeRef.current !== 'standard') return; // never surface AI text outside Standard mode
    if (!res.ok) setReasoning({ status: 'error', text: null, error: res.error, model: null });
    else if (!res.data.text) setReasoning({ status: 'error', text: null, error: res.data.error || 'Empty response.', model: res.data.model });
    else setReasoning({ status: 'done', text: res.data.text, error: null, model: res.data.model });
  }, [ticker, results, conviction, effectiveSettings]);

  // Entering Wharton mode discards any AI text already in memory.
  useEffect(() => {
    if (settings.mode !== 'standard') {
      setReasoning(IDLE_REASONING);
      autoFor.current = null;
    }
  }, [settings.mode]);

  // Auto-generate once per run in Standard mode when the analysis is complete.
  useEffect(() => {
    if (settings.mode !== 'standard' || !complete || conviction.score === null) return;
    if (autoFor.current === runId.current) return;
    autoFor.current = runId.current;
    generateReasoning();
  }, [settings.mode, complete, conviction.score, generateReasoning]);

  // ---- tear sheet ----
  const downloadReport = useCallback(async () => {
    if (!complete || conviction.score === null) return;
    setReportState({ status: 'working', error: null, filename: null });
    try {
      const mode = modeRef.current;
      const data = buildReportData({
        mode, ticker, companyName, runAt: runAt || new Date(), asOf, price, priceAsOf: priceDate, conviction, attribution, results, sources, appVersion: APP_VERSION,
        reasoning: mode === 'standard' ? reasoning : null, // AI text is only ever passed in Standard mode
      });
      const { generateTearSheet } = await import('./lib/tearSheet.js');
      const out = await generateTearSheet(data);
      setReportState({ status: 'done', error: null, filename: out.filename });
    } catch (err) {
      setReportState({ status: 'error', error: err.message, filename: null });
    }
  }, [complete, conviction, ticker, companyName, runAt, asOf, price, priceDate, attribution, results, sources, reasoning]);

  // Development aid only (never in production builds): lets automated checks read the exact numbers on screen.
  useEffect(() => {
    if (import.meta.env.DEV) window.__run = { ticker, mode: settings.mode, complete, conviction, attribution, results, sources, logState, reasoningStatus: reasoning.status };
  });

  const rfMissing = effectiveSettings.riskFreeRate === '' || effectiveSettings.riskFreeRate === null;
  const view = VIEWS.some(([v]) => v === settings.view) ? settings.view : 'stock';
  const setView = useCallback((v) => {
    setSettings((s) => ({ ...s, view: v }));
    writeUrl({ view: v, ticker: v === 'stock' ? ticker : null, asOf: v === 'stock' ? asOf : null });
  }, [ticker, asOf]);
  const openStock = useCallback((sym, asOfDate = null) => {
    setSettings((s) => ({ ...s, view: 'stock' }));
    analyze(sym, asOfDate);
    window.scrollTo({ top: 0 });
  }, [analyze]);
  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/?t=${encodeURIComponent(ticker)}${asOf ? `&asof=${asOf}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }, [ticker, asOf]);
  const fallbackParas = useMemo(() => overallConclusion(ticker, companyName, conviction, results, fetching), [ticker, companyName, conviction, results, fetching]);

  const priceProv = price !== null && priceDate ? fetched(price, SRC.ALPACA, priceDate, 'latest daily close, IEX feed, split-adjusted') : null;
  const scoreProv = conviction.score !== null ? computed(conviction.score, sources.filter((s) => s.status === 'ok').map((s) => ({ source: s.source, asOf: s.asOf, detail: s.type })), 'Weighted average of the available model subscores') : null;
  const reportWaiting = settings.mode === 'standard' && reasoning.status === 'loading';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-[#0d0d0de6] backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-3">
          <button className="flex items-center gap-2 mr-auto" onClick={() => setView('stock')} aria-label="Home">
            <svg width="22" height="22" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1a1a19" /><path d="M6 22 L13 14 L18 18 L26 8" stroke="#3987e5" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="font-bold tracking-tight">Conviction <span className="text-s1">2.0</span></span>
          </button>
          <nav className="flex rounded-lg border border-axis overflow-x-auto text-xs font-semibold max-w-full" role="tablist" aria-label="View">
            {VIEWS.map(([v, label]) => (
              <button key={v} role="tab" aria-selected={view === v} className={`px-3 py-1.5 whitespace-nowrap ${view === v ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'}`} onClick={() => setView(v)}>{label}</button>
            ))}
          </nav>
          <div className="flex rounded-lg border border-axis overflow-hidden text-xs font-semibold" role="tablist" aria-label="Reasoning mode">
            <button role="tab" aria-selected={settings.mode === 'standard'} className={`px-3 py-1.5 ${settings.mode === 'standard' ? 'bg-s1 text-white' : 'text-ink-2 hover:bg-surface-2'}`} onClick={() => setSettings({ ...settings, mode: 'standard' })}>Standard</button>
            <button role="tab" aria-selected={settings.mode === 'wharton'} className={`px-3 py-1.5 whitespace-nowrap ${settings.mode === 'wharton' ? 'bg-[#9085e9] text-white' : 'text-ink-2 hover:bg-surface-2'}`} onClick={() => setSettings({ ...settings, mode: 'wharton' })}>{MATH_MODE_LABEL}</button>
          </div>
          <button className="btn" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>Settings</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 space-y-5">
        {showSettings && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} rfInfo={asOf ? rfRun : rfNow} />}

        {view === 'portfolio' && <PortfolioPage settings={effectiveSettings} onOpenStock={openStock} />}
        {view === 'compare' && <ComparePage settings={effectiveSettings} onOpenStock={openStock} />}
        {view === 'backtest' && <BacktestPage settings={effectiveSettings} onOpenStock={openStock} />}
        {view === 'history' && <HistoryPage onOpenStock={openStock} />}
        {view === 'about' && <AboutPage onTry={openStock} />}

        {view === 'stock' && (
          <form className="card p-4 flex flex-col sm:flex-row gap-3 sm:items-end" onSubmit={(e) => { e.preventDefault(); analyze(input, asOfInput || null); }}>
            <label className="flex-1">
              <span className="text-xs text-ink-2 block mb-1">Ticker</span>
              <input className="input text-lg uppercase" placeholder="e.g. AAPL" value={input} onChange={(e) => setInput(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </label>
            <label className="sm:w-48">
              <span className="text-xs text-ink-2 block mb-1">As of (optional)</span>
              <input className="input" type="date" value={asOfInput} max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} onChange={(e) => setAsOfInput(e.target.value)} title="Score the stock using only data that existed on this date, then see what happened next" />
            </label>
            <button type="submit" className="btn btn-primary justify-center" disabled={fetching || !input.trim()}>{fetching ? 'Analyzing…' : 'Analyze'}</button>
          </form>
        )}

        {rfMissing && (rfNow.status !== 'loading' || settings.riskFreeAuto === false) && (
          <div className="rounded-lg border border-[#fab21955] bg-[#fab21914] p-3 text-sm text-[#fab219] flex flex-wrap items-center gap-2">
            <span>No risk-free rate available{rfNow.error ? ` (Treasury lookup failed: ${rfNow.error})` : ''}. The DCF is unavailable and the Sharpe ratio is skipped until one is set.</span>
            <button className="btn ml-auto" onClick={() => setShowSettings(true)}>Open settings</button>
          </div>
        )}

        {view === 'stock' && ticker && (
          <div className="space-y-5">
            <ScoreCard ticker={ticker} companyName={companyName} price={price} priceDate={priceDate} conviction={conviction} pending={!complete} asOf={asOf} onCopyLink={copyLink} copied={copied} priceProv={priceProv} scoreProv={scoreProv} />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" id="run-toolbar">
              <button className="btn btn-primary" onClick={downloadReport} disabled={!complete || conviction.score === null || reportState.status === 'working' || reportWaiting} title="One-page PDF tear sheet of this analysis">
                {reportState.status === 'working' ? 'Building report…' : reportWaiting ? 'Waiting for reasoning…' : 'Download report'}
              </button>
              {reportState.status === 'done' && <span className="text-muted">Saved {reportState.filename}</span>}
              {reportState.status === 'error' && <span className="text-[#e66767]">Report failed: {reportState.error}</span>}
              <span className="text-muted">{settings.mode === 'wharton' ? 'Report contains template text only (no AI).' : 'Report includes the AI-generated reasoning, labelled.'}</span>
              <span className="ml-auto" aria-live="polite">
                {logState.status === 'saving' && <span className="text-muted">Saving to log…</span>}
                {logState.status === 'saved' && <span className="text-muted" title={logState.reason || 'One row was written to the analysis log.'}>Saved to log{logState.reason ? ' (price unavailable)' : ''}</span>}
                {logState.status === 'failed' && <span className="rounded-full border border-[#fab21955] bg-[#fab21914] px-2 py-0.5 text-[#fab219]" title={logState.reason}>Run not saved to log</span>}
              </span>
            </div>

            <Conclusion ticker={ticker} companyName={companyName} conviction={conviction} results={results} pending={!complete} />
            <Attribution attribution={attribution} />
            {asOf && !fetching && <SinceThen ticker={ticker} forward={forward} score={conviction.score} label={conviction.label} />}

            <div className="grid gap-5 lg:grid-cols-2">
              {MODEL_ORDER.map((id) => {
                const srcs = MODEL_SOURCES[id];
                const loadingSources = srcs.filter((s) => raw[s].status === 'loading' || raw[s].status === 'idle');
                const status = results[id] ? 'done' : 'loading';
                return <ModelCard key={id} id={id} status={status} result={results[id]} loadingSources={loadingSources.length ? loadingSources : srcs} ticker={ticker} />;
              })}
            </div>

            {settings.mode === 'standard' ? (
              <StandardReasoning state={reasoning} onGenerate={generateReasoning} canGenerate={Boolean(complete && conviction.score !== null)} fallback={fallbackParas} />
            ) : (
              <WhartonReasoning results={results} conviction={conviction} />
            )}

            {complete && <DataSources sources={sources} />}
          </div>
        )}

        {view === 'stock' && !ticker && (
          <section className="card p-6 space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Six models, one score, every number shown.</h1>
              <p className="text-sm text-ink-2 mt-2 leading-relaxed">Conviction 2.0 runs a valuation, a Monte Carlo simulation, risk, momentum, financial-health and earnings/insider models on any US-listed stock, using prices, SEC filings and earnings data. Each model shows its chart, its inputs and exactly how its 0–100 subscore was computed. The conviction score is the weighted average. Every number carries its source and as-of date, and a one-page PDF report is one click away.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Try one:</span>
              {EXAMPLE_TICKERS.map((t) => <button key={t} className="btn text-xs" onClick={() => analyze(t)}>{t}</button>)}
              <button className="text-xs text-s1 hover:underline ml-1" onClick={() => setView('about')}>How it works →</button>
            </div>
            <p className="text-xs text-muted">Data: Alpaca (daily prices), SEC EDGAR (annual fundamentals), Finnhub (earnings surprises, insider transactions), U.S. Treasury (risk-free rate). Nothing here is investment advice.</p>
          </section>
        )}

        {view === 'stock' && history.length > 0 && (
          <section className="card p-4">
            <header className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Recent on this device</h2>
              <button className="text-xs text-muted hover:text-ink" onClick={() => setHistory(clearHistory())}>Clear</button>
            </header>
            <div className="flex flex-wrap gap-2">
              {history.map((h) => (
                <button key={h.time} className="btn text-xs" onClick={() => analyze(h.ticker)} title={`${h.date} · subscores ${Object.entries(h.subscores).map(([k, v]) => `${k}:${v ?? '—'}`).join(' ')}`}>
                  <span className="font-bold">{h.ticker}</span>
                  <span className="num">{h.score}</span>
                  <span className="text-muted">{scoreLabel(h.score)} · {h.date}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-2">These chips live only in this browser. The full log of runs, with price at run, is on the History tab.</p>
          </section>
        )}

        <footer className="text-[11px] text-muted pb-8 flex flex-wrap gap-x-3 gap-y-1">
          <span>Conviction 2.0 v{APP_VERSION} · For educational and competition use. Not investment advice.</span>
          <span>Prices are IEX-feed daily closes; fundamentals are as filed with the SEC.</span>
          <button className="hover:text-ink" onClick={() => setView('about')}>How it works</button>
          <a className="hover:text-ink" href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
        </footer>
      </main>
      <Analytics />
    </div>
  );
}
