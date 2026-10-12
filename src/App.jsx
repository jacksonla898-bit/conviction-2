import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import ScoreCard from './components/ScoreCard.jsx';
import ModelCard from './components/ModelCard.jsx';
import Conclusion from './components/Conclusion.jsx';
import SinceThen from './components/SinceThen.jsx';
import PortfolioPage from './components/PortfolioPage.jsx';
import ComparePage from './components/ComparePage.jsx';
import BacktestPage from './components/BacktestPage.jsx';
import AboutPage from './components/AboutPage.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { StandardReasoning, WhartonReasoning } from './components/Reasoning.jsx';
import { fetchAll, runModels, emptyRaw, MODEL_SOURCES, buildReasoningPayload, sinceThen } from './lib/pipeline.js';
import { computeConviction, MODEL_ORDER, scoreLabel } from './models/conviction.js';
import { loadSettings, saveSettings, loadHistory, pushHistory, clearHistory } from './lib/settings.js';
import { overallConclusion } from './lib/plainEnglish.js';
import { api } from './lib/api.js';
import { EXAMPLE_TICKERS, MATH_MODE_LABEL, REPO_URL } from './config.js';

const EMPTY_CONVICTION = { score: null, label: 'n/a', breakdown: [], excluded: [], included: [] };
const VIEWS = [
  ['stock', 'Stock'],
  ['portfolio', 'Portfolio'],
  ['compare', 'Compare'],
  ['backtest', 'Backtest'],
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
  const [raw, setRaw] = useState(emptyRaw);
  const [results, setResults] = useState({});
  const [fetching, setFetching] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [reasoning, setReasoning] = useState({ status: 'idle', text: null, error: null, model: null });
  const [rfNow, setRfNow] = useState({ status: 'loading', value: null, asOf: null, error: null });
  const [rfRun, setRfRun] = useState(null); // risk-free rate as of the current run's date (as-of analyses)
  const [copied, setCopied] = useState(false);
  const mcCache = useRef({});
  const reportRef = useRef(null);
  const runId = useRef(0);
  const savedFor = useRef(null);

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
    if (!auto) return { ...settings, riskFreeRate: settings.riskFreeRate, riskFreeSource: 'Settings (manual entry)', asOf };
    if (rf && rf.value != null) return { ...settings, riskFreeRate: String(rf.value), riskFreeSource: `Treasury 3-month yield as of ${rf.asOf} (auto)`, asOf };
    return { ...settings, riskFreeRate: '', riskFreeSource: 'unavailable', asOf };
  }, [settings, rfNow, rfRun, asOf]);

  // Re-run the math whenever raw data or settings change (no refetch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { results: r } = await runModels(raw, effectiveSettings, mcCache.current);
      if (cancelled) return;
      if (r.monteCarlo?.available) mcCache.current = { monteCarlo: r.monteCarlo, monteCarloBars: raw.prices.data?.stock };
      setResults(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [raw, effectiveSettings]);

  const conviction = useMemo(() => (Object.keys(results).length ? computeConviction(results, settings.weights) : EMPTY_CONVICTION), [results, settings.weights]);
  const allSettled = !fetching && ticker && Object.keys(results).length > 0;
  const forward = useMemo(() => sinceThen(raw), [raw]);

  // Save to history once per completed run (current-date runs only).
  useEffect(() => {
    if (!allSettled || asOf || conviction.score === null || savedFor.current === ticker + runId.current) return;
    savedFor.current = ticker + runId.current;
    const entry = {
      ticker,
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toISOString(),
      score: conviction.score,
      label: conviction.label,
      subscores: Object.fromEntries(MODEL_ORDER.map((id) => [id, results[id]?.available ? results[id].subscore : null])),
      price: raw.prices.data?.stock?.at(-1)?.close ?? null,
    };
    setHistory(pushHistory(entry));
  }, [allSettled, asOf, conviction, ticker, results, raw]);

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
    setResults({});
    setReasoning({ status: 'idle', text: null, error: null, model: null });
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

  const generateReasoning = useCallback(async () => {
    if (!ticker || conviction.score === null) return;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const payload = buildReasoningPayload(ticker, results, conviction, effectiveSettings);
    const res = await api.reason(ticker, payload);
    if (!res.ok) setReasoning({ status: 'error', text: null, error: res.error, model: null });
    else if (!res.data.text) setReasoning({ status: 'error', text: null, error: res.data.error || 'Empty response.', model: res.data.model });
    else setReasoning({ status: 'done', text: res.data.text, error: null, model: res.data.model });
  }, [ticker, results, conviction, effectiveSettings]);

  // Auto-generate once per run in Standard mode when everything has settled.
  const autoFor = useRef(null);
  useEffect(() => {
    if (settings.mode !== 'standard' || !allSettled || conviction.score === null) return;
    const key = ticker + runId.current;
    if (autoFor.current === key) return;
    autoFor.current = key;
    generateReasoning();
  }, [settings.mode, allSettled, conviction.score, ticker, generateReasoning]);

  const price = raw.prices.data?.stock?.at(-1)?.close ?? null;
  const priceDate = raw.prices.data?.stock?.at(-1)?.date ?? null;
  const companyName = raw.fundamentals.data?.companyName ?? null;
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
          <div ref={reportRef} className="space-y-5">
            <ScoreCard ticker={ticker} companyName={companyName} price={price} priceDate={priceDate} conviction={conviction} pending={fetching} asOf={asOf} onCopyLink={copyLink} copied={copied} />
            <Conclusion ticker={ticker} companyName={companyName} conviction={conviction} results={results} pending={fetching} />
            {asOf && !fetching && <SinceThen ticker={ticker} forward={forward} score={conviction.score} label={conviction.label} />}

            <div className="grid gap-5 lg:grid-cols-2">
              {MODEL_ORDER.map((id) => {
                const sources = MODEL_SOURCES[id];
                const loadingSources = sources.filter((s) => raw[s].status === 'loading' || raw[s].status === 'idle');
                const status = results[id] ? 'done' : 'loading';
                return <ModelCard key={id} id={id} status={status} result={results[id]} loadingSources={loadingSources.length ? loadingSources : sources} ticker={ticker} />;
              })}
            </div>

            {settings.mode === 'standard' ? (
              <StandardReasoning state={reasoning} onGenerate={generateReasoning} canGenerate={Boolean(allSettled && conviction.score !== null)} fallback={fallbackParas} />
            ) : (
              <WhartonReasoning ticker={ticker} results={results} conviction={conviction} reportRef={reportRef} />
            )}
          </div>
        )}

        {view === 'stock' && !ticker && (
          <section className="card p-6 space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Six models, one score, every number shown.</h1>
              <p className="text-sm text-ink-2 mt-2 leading-relaxed">Conviction 2.0 runs a valuation, a Monte Carlo simulation, risk, momentum, financial-health and earnings/insider models on any US-listed stock, using prices, SEC filings and earnings data. Each model shows its chart, its inputs and exactly how its 0–100 subscore was computed. The conviction score is the weighted average. Pick a date in the past to score a stock with only the information that existed then, and see what happened next.</p>
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
              <h2 className="text-sm font-semibold">Past analyses</h2>
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
          </section>
        )}

        <footer className="text-[11px] text-muted pb-8 flex flex-wrap gap-x-3 gap-y-1">
          <span>Conviction 2.0 · For personal research only; not investment advice.</span>
          <span>Prices are IEX-feed daily closes; fundamentals are as filed with the SEC.</span>
          <button className="hover:text-ink" onClick={() => setView('about')}>How it works</button>
          <a className="hover:text-ink" href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
        </footer>
      </main>
      <Analytics />
    </div>
  );
}
