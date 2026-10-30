import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import HomePage from './pages/HomePage.jsx';
import AnalyzePage from './pages/AnalyzePage.jsx';
import PortfolioHub from './pages/PortfolioHub.jsx';
import MethodologyPage from './pages/MethodologyPage.jsx';
import StockResults from './components/StockResults.jsx';
import AssetAnalysis from './components/AssetAnalysis.jsx';
import GraderPage from './components/GraderPage.jsx';
import OptimizerPage from './components/OptimizerPage.jsx';
import StressTestPage from './components/StressTestPage.jsx';
import MyPortfoliosPage from './components/MyPortfoliosPage.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import { DrawerProvider } from './components/ui.jsx';
import { runAssetAnalysis } from './lib/assetPipeline.js';
import { fetchAll, runModels, emptyRaw, SOURCES, buildReasoningPayload, sinceThen, dataSources } from './lib/pipeline.js';
import { computeConviction, MODEL_ORDER } from './models/conviction.js';
import { computeAttribution } from './models/attribution.js';
import { loadSettings, saveSettings, loadHistory, pushHistory, clearHistory } from './lib/settings.js';
import { loadJson, saveJson } from './lib/storage.js';
import { overallConclusion } from './lib/plainEnglish.js';
import { buildLogPayload } from './lib/logPayload.js';
import { buildReportData } from './lib/reportData.js';
import { SRC, fetched, computed } from './lib/provenance.js';
import { api } from './lib/api.js';
import { savePortfolio, addSnapshot } from './lib/savedPortfolios.js';
import { MATH_MODE_LABEL, WHARTON_BADGE, REPO_URL, APP_VERSION } from './config.js';

const EMPTY_CONVICTION = { score: null, label: 'n/a', breakdown: [], excluded: [], included: [] };
const IDLE_REASONING = { status: 'idle', text: null, error: null, model: null };
const NAV = [['home', 'Home'], ['analyze', 'Analyze'], ['portfolio', 'Portfolio'], ['methodology', 'Methodology']];
const ANALYZE_TABS = ['analysis', 'compare', 'backtest', 'history'];
const PORTFOLIO_TABS = ['grade', 'optimize', 'stress', 'saved'];
const PORTFOLIO_STATE_KEY = 'conviction2.portfolioHoldings.v2';
const DEFAULT_PORTFOLIO = { holdings: [{ ticker: 'SPY', amount: '60' }, { ticker: 'AGG', amount: '40' }, { ticker: '', amount: '' }], mode: 'percent', name: '', activeId: null };
// Older links used ?view=…; map them onto the four pages.
const LEGACY_VIEWS = { stock: ['analyze', 'analysis'], portfolio: ['portfolio', 'grade'], grader: ['portfolio', 'grade'], optimize: ['portfolio', 'optimize'], compare: ['analyze', 'compare'], backtest: ['analyze', 'backtest'], history: ['analyze', 'history'], about: ['methodology', null] };

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const t = (p.get('t') || '').toUpperCase();
  const asof = p.get('asof') || '';
  let page = p.get('page') || '';
  let tab = p.get('tab') || '';
  if (!page && p.get('view') && LEGACY_VIEWS[p.get('view')]) [page, tab] = LEGACY_VIEWS[p.get('view')];
  const ticker = /^[A-Z0-9.\-]{1,10}$/.test(t) ? t : null;
  if (ticker && !page) page = 'analyze';
  return {
    ticker,
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(asof) ? asof : null,
    page: NAV.some(([v]) => v === page) ? page : 'home',
    tab: tab || null,
  };
}

function writeUrl({ page, tab, ticker, asOf }) {
  const p = new URLSearchParams();
  if (page && page !== 'home') p.set('page', page);
  if (tab && ((page === 'analyze' && tab !== 'analysis') || (page === 'portfolio' && tab !== 'grade'))) p.set('tab', tab);
  if (page === 'analyze' && (!tab || tab === 'analysis') && ticker) p.set('t', ticker);
  if (page === 'analyze' && (!tab || tab === 'analysis') && ticker && asOf) p.set('asof', asOf);
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

export default function App() {
  const initialUrl = useRef(readUrl());
  const [settings, setSettings] = useState(loadSettings);
  const [page, setPage] = useState(initialUrl.current.page);
  const [analyzeTab, setAnalyzeTab] = useState(ANALYZE_TABS.includes(initialUrl.current.tab) ? initialUrl.current.tab : 'analysis');
  const [portfolioTab, setPortfolioTab] = useState(PORTFOLIO_TABS.includes(initialUrl.current.tab) ? initialUrl.current.tab : 'grade');
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState('');
  const [asOfInput, setAsOfInput] = useState(initialUrl.current.asOf || '');
  const [ticker, setTicker] = useState(null);
  const [asOf, setAsOf] = useState(null);
  const [runAt, setRunAt] = useState(null);
  const [raw, setRaw] = useState(emptyRaw);
  const [results, setResults] = useState({});
  const [computedFor, setComputedFor] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [reasoning, setReasoning] = useState(IDLE_REASONING);
  const [rfNow, setRfNow] = useState({ status: 'loading', value: null, asOf: null, error: null });
  const [rfRun, setRfRun] = useState(null);
  const [copied, setCopied] = useState(false);
  const [logState, setLogState] = useState({ status: 'idle', reason: null });
  const [assetRun, setAssetRun] = useState(null);
  const [portfolio, setPortfolioState] = useState(() => ({ ...DEFAULT_PORTFOLIO, ...(loadJson(PORTFOLIO_STATE_KEY, null) || {}) }));
  const [lastGrade, setLastGrade] = useState(null); // { holdings (normalized), analyses, grade, at } shared by Optimize and Stress Test
  const [savedVersion, setSavedVersion] = useState(0); // bumps when the saved list changes
  const esRef = useRef(null);
  const mcCache = useRef({});
  const runId = useRef(0);
  const savedFor = useRef(null);
  const loggedFor = useRef(null);
  const autoFor = useRef(null);
  const modeRef = useRef(settings.mode);
  modeRef.current = settings.mode;

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => { saveJson(PORTFOLIO_STATE_KEY, portfolio); }, [portfolio]);
  const setPortfolio = useCallback((patchOrFn) => setPortfolioState((p) => ({ ...p, ...(typeof patchOrFn === 'function' ? patchOrFn(p) : patchOrFn) })), []);

  // ---- theme ----
  const [systemDark, setSystemDark] = useState(() => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (!mq) return undefined;
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : systemDark ? 'dark' : 'light';
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // ---- URL ----
  useEffect(() => { writeUrl({ page, tab: page === 'analyze' ? analyzeTab : page === 'portfolio' ? portfolioTab : null, ticker, asOf }); }, [page, analyzeTab, portfolioTab, ticker, asOf]);

  // ---- risk-free rate ----
  useEffect(() => {
    api.riskfree().then((res) => {
      if (res.ok) setRfNow({ status: 'ok', value: res.data.rate, asOf: res.data.asOf, error: null });
      else setRfNow({ status: 'error', value: null, asOf: null, error: res.error });
    });
  }, []);

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
  esRef.current = effectiveSettings;

  // ---- stock models ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { results: r } = await runModels(raw, effectiveSettings, mcCache.current);
      if (cancelled) return;
      if (r.monteCarlo?.available) mcCache.current = { monteCarlo: r.monteCarlo, monteCarloBars: raw.prices.data?.stock };
      setResults(r);
      setComputedFor({ raw, es: effectiveSettings });
    })();
    return () => { cancelled = true; };
  }, [raw, effectiveSettings]);

  const conviction = useMemo(() => (Object.keys(results).length ? computeConviction(results, settings.weights) : EMPTY_CONVICTION), [results, settings.weights]);
  const attribution = useMemo(() => computeAttribution(conviction, results, settings.weights), [conviction, results, settings.weights]);
  const forward = useMemo(() => sinceThen(raw), [raw]);
  const sources = useMemo(() => dataSources(raw, effectiveSettings), [raw, effectiveSettings]);
  const rfReady = settings.riskFreeAuto === false || (asOf ? rfRun !== null : rfNow.status !== 'loading');
  const complete = Boolean(ticker && !fetching && rfReady && computedFor && computedFor.raw === raw && computedFor.es === effectiveSettings && SOURCES.every((s) => raw[s].status === 'ok' || raw[s].status === 'error') && MODEL_ORDER.every((id) => results[id]));
  const price = raw.prices.data?.stock?.at(-1)?.close ?? null;
  const priceDate = raw.prices.data?.stock?.at(-1)?.date ?? null;
  const companyName = raw.fundamentals.data?.companyName ?? null;

  useEffect(() => {
    if (!complete || asOf || conviction.score === null || savedFor.current === runId.current) return;
    savedFor.current = runId.current;
    setHistory(pushHistory({ ticker, date: new Date().toISOString().slice(0, 10), time: new Date().toISOString(), score: conviction.score, label: conviction.label, subscores: Object.fromEntries(MODEL_ORDER.map((id) => [id, results[id]?.available ? results[id].subscore : null])), price }));
  }, [complete, asOf, conviction, ticker, results, price]);

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
    setPage('analyze');
    setAnalyzeTab('analysis');
    setTicker(t);
    setInput(t);
    setAsOf(a);
    setAsOfInput(a || '');
    setRunAt(new Date());
    setResults({});
    setComputedFor(null);
    setReasoning(IDLE_REASONING);
    setLogState({ status: 'idle', reason: null });
    setFetching(true);
    setCopied(false);
    window.scrollTo({ top: 0 });
    setAssetRun({ status: 'loading', analysis: null });
    const det = await api.asset(t);
    if (runId.current !== myRun) return;
    if (det.ok && det.data.assetType !== 'stock') {
      setRaw(emptyRaw());
      let analysis;
      try {
        analysis = await runAssetAnalysis(det.data.ticker || t, esRef.current, { asOf: a });
      } catch (err) {
        analysis = { ticker: t, assetType: 'unsupported', error: `Analysis failed: ${err.message}`, conviction: { score: null, label: 'n/a', breakdown: [], excluded: [] }, order: [], labels: {}, results: {}, dailyReturns: [], sources: [] };
      }
      if (runId.current !== myRun) return;
      setAssetRun({ status: 'done', analysis });
      setFetching(false);
      return;
    }
    setAssetRun(null);
    if (a) {
      setRfRun(null);
      api.riskfree(a).then((res) => { if (runId.current === myRun) setRfRun(res.ok ? { value: res.data.rate, asOf: res.data.asOf } : { value: null, asOf: null, error: res.error }); });
    }
    await fetchAll(t, (snap) => { if (runId.current === myRun) setRaw(snap); }, a);
    if (runId.current === myRun) setFetching(false);
  }, []);

  useEffect(() => { if (initialUrl.current.ticker) analyze(initialUrl.current.ticker, initialUrl.current.asOf); }, [analyze]);

  // ---- AI reasoning (Standard mode only; the AI module is only ever loaded here, behind the mode check) ----
  const generateReasoning = useCallback(async () => {
    if (modeRef.current !== 'standard' || !ticker || conviction.score === null) return;
    const myRun = runId.current;
    setReasoning({ status: 'loading', text: null, error: null, model: null });
    const payload = buildReasoningPayload(ticker, results, conviction, effectiveSettings);
    const { requestReasoning } = await import('./lib/ai.js');
    const res = await requestReasoning('standard', ticker, payload);
    if (runId.current !== myRun || modeRef.current !== 'standard') return;
    if (!res.ok) setReasoning({ status: 'error', text: null, error: res.error, model: null });
    else if (!res.data.text) setReasoning({ status: 'error', text: null, error: res.data.error || 'Empty response.', model: res.data.model });
    else setReasoning({ status: 'done', text: res.data.text, error: null, model: res.data.model });
  }, [ticker, results, conviction, effectiveSettings]);
  useEffect(() => { if (settings.mode !== 'standard') { setReasoning(IDLE_REASONING); autoFor.current = null; } }, [settings.mode]);
  useEffect(() => {
    if (settings.mode !== 'standard' || !complete || conviction.score === null) return;
    if (autoFor.current === runId.current) return;
    autoFor.current = runId.current;
    generateReasoning();
  }, [settings.mode, complete, conviction.score, generateReasoning]);

  // ---- tear sheet (stock) ----
  const exportStockPdf = useCallback(async () => {
    if (!complete || conviction.score === null) throw new Error('The analysis is not complete yet.');
    const mode = modeRef.current;
    const data = buildReportData({ mode, ticker, companyName, runAt: runAt || new Date(), asOf, price, priceAsOf: priceDate, conviction, attribution, results, sources, appVersion: APP_VERSION, reasoning: mode === 'standard' ? reasoning : null });
    const { generateTearSheet } = await import('./lib/tearSheet.js');
    return generateTearSheet(data);
  }, [complete, conviction, ticker, companyName, runAt, asOf, price, priceDate, attribution, results, sources, reasoning]);

  useEffect(() => {
    if (import.meta.env.DEV) window.__run = { ticker, mode: settings.mode, page, complete, conviction, attribution, results, sources, logState, reasoningStatus: reasoning.status, assetRun, portfolio, lastGrade, theme };
  });

  // ---- navigation helpers ----
  const go = useCallback((p, tab = null) => {
    setPage(p);
    if (p === 'analyze' && tab) setAnalyzeTab(tab);
    if (p === 'portfolio' && tab) setPortfolioTab(tab);
    setShowSettings(false);
    window.scrollTo({ top: 0 });
  }, []);
  const openStock = useCallback((sym, asOfDate = null) => analyze(sym, asOfDate), [analyze]);
  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/?t=${encodeURIComponent(ticker)}${asOf ? `&asof=${asOf}` : ''}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy this link:', url); }
  }, [ticker, asOf]);
  const fallbackParas = useMemo(() => overallConclusion(ticker, companyName, conviction, results, fetching), [ticker, companyName, conviction, results, fetching]);
  const priceProv = price !== null && priceDate ? fetched(price, SRC.ALPACA, priceDate, 'latest daily close, IEX feed, split-adjusted') : null;
  const scoreProv = conviction.score !== null ? computed(conviction.score, sources.filter((s) => s.status === 'ok').map((s) => ({ source: s.source, asOf: s.asOf, detail: s.type })), 'Weighted average of the available model subscores') : null;
  const reportWaiting = settings.mode === 'standard' && reasoning.status === 'loading';
  const rfMissing = effectiveSettings.riskFreeRate === '' || effectiveSettings.riskFreeRate === null;

  // ---- shared portfolio: grading results carry over, snapshots for saved portfolios ----
  const onGraded = useCallback((res) => {
    setLastGrade({ ...res, at: Date.now() });
    if (portfolio.activeId && res.grade && res.grade.score !== null) {
      const p = Object.fromEntries(res.grade.pillars.map((x) => [x.id, x.score]));
      addSnapshot(portfolio.activeId, { score: res.grade.score, label: res.grade.label, quality: p.quality, diversification: p.diversification, risk: p.risk });
      setSavedVersion((v) => v + 1);
    }
  }, [portfolio.activeId]);
  const saveCurrent = useCallback((name, holdings, mode) => {
    const entry = savePortfolio({ name, holdings, mode, id: portfolio.activeId });
    setPortfolio({ activeId: entry.id, name: entry.name, holdings: entry.holdings.length ? [...entry.holdings, { ticker: '', amount: '' }] : holdings, mode: entry.mode });
    setSavedVersion((v) => v + 1);
    return entry;
  }, [portfolio.activeId, setPortfolio]);
  const openSaved = useCallback((entry) => {
    setPortfolio({ activeId: entry.id, name: entry.name, holdings: [...entry.holdings, { ticker: '', amount: '' }], mode: entry.mode });
    setLastGrade(null);
    go('portfolio', 'grade');
  }, [go, setPortfolio]);
  const holdingsSummary = portfolio.holdings.filter((h) => h.ticker.trim()).map((h) => `${h.ticker.toUpperCase()} ${h.amount}${portfolio.mode === 'percent' ? '%' : portfolio.mode === 'dollars' ? '$' : ' sh'}`).join(' · ');

  return (
    <DrawerProvider>
      <div className="min-h-screen" key={theme}>
        <header className="sticky top-0 z-20 border-b border-line bg-page/90 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 py-2.5 flex flex-wrap items-center gap-2 md:gap-3">
            <button className="flex items-center gap-2 shrink-0 mr-auto md:mr-0" onClick={() => go('home')} aria-label="Home">
              <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="var(--ink)" /><path d="M6 22 L13 14 L18 18 L26 8" stroke="var(--page)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="font-bold tracking-tight hidden sm:inline">Conviction <span className="text-accent">2.0</span></span>
            </button>
            <nav className="order-last w-full md:order-none md:w-auto flex gap-0.5 overflow-x-auto text-sm font-semibold md:mx-auto" role="tablist" aria-label="Main">
              {NAV.map(([v, label]) => <button key={v} role="tab" aria-selected={page === v} className={`px-2.5 md:px-3 py-1.5 rounded-lg whitespace-nowrap ${page === v ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'}`} onClick={() => go(v)}>{label}</button>)}
            </nav>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="seg" role="tablist" aria-label="Reasoning mode">
                <button role="tab" aria-selected={settings.mode === 'standard'} onClick={() => setSettings({ ...settings, mode: 'standard' })}>Standard</button>
                <button role="tab" aria-selected={settings.mode === 'wharton'} onClick={() => setSettings({ ...settings, mode: 'wharton' })}>{MATH_MODE_LABEL}</button>
              </div>
              <button className="btn btn-ghost px-2" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} aria-label="Settings" title="Settings">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              </button>
            </div>
          </div>
          {settings.mode === 'wharton' && <div className="border-t border-accent/30 bg-accent/10 text-center text-xs font-semibold text-ink py-1" role="status" id="wharton-badge">{WHARTON_BADGE}</div>}
        </header>

        {showSettings && <SettingsDrawer settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} rfInfo={asOf ? rfRun : rfNow} />}

        <main className="mx-auto max-w-6xl px-4 py-5 space-y-5">
          {rfMissing && (rfNow.status !== 'loading' || settings.riskFreeAuto === false) && page !== 'home' && page !== 'methodology' && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink-2 flex flex-wrap items-center gap-2">
              <span>No risk-free rate available{rfNow.error ? ` (lookup failed: ${rfNow.error})` : ''}. The DCF is unavailable and the Sharpe ratio is skipped until one is set.</span>
              <button className="btn btn-sm ml-auto" onClick={() => setShowSettings(true)}>Open settings</button>
            </div>
          )}

          {page === 'home' && <HomePage onAnalyze={analyze} onBuildPortfolio={() => go('portfolio', 'grade')} recent={history} onClearRecent={() => setHistory(clearHistory())} onMethodology={() => go('methodology')} />}

          {page === 'analyze' && (
            <AnalyzePage tab={analyzeTab} onTab={(t) => go('analyze', t)} input={input} setInput={setInput} asOfInput={asOfInput} setAsOfInput={setAsOfInput} onSubmit={analyze} fetching={fetching} hasResult={Boolean(ticker)} settings={effectiveSettings} onOpenStock={openStock}>
              {ticker && assetRun && <AssetAnalysis analysis={assetRun.analysis} loading={assetRun.status === 'loading'} settings={effectiveSettings} onCopyLink={copyLink} copied={copied} />}
              {ticker && !assetRun && (
                <StockResults
                  ticker={ticker} companyName={companyName} price={price} priceDate={priceDate} conviction={conviction} attribution={attribution} results={results} raw={raw}
                  complete={complete} fetching={fetching} asOf={asOf} forward={forward} sources={sources} settings={effectiveSettings} reasoning={reasoning} onGenerate={generateReasoning}
                  onExportPdf={exportStockPdf} reportWaiting={reportWaiting} logState={logState} onCopyLink={copyLink} copied={copied} priceProv={priceProv} scoreProv={scoreProv} fallbackParas={fallbackParas}
                />
              )}
            </AnalyzePage>
          )}

          {page === 'portfolio' && (
            <PortfolioHub tab={portfolioTab} onTab={(t) => go('portfolio', t)} holdingsSummary={holdingsSummary}>
              {portfolioTab === 'grade' && <GraderPage settings={effectiveSettings} portfolio={portfolio} setPortfolio={setPortfolio} lastGrade={lastGrade} onGraded={onGraded} onOpenStock={openStock} onGoTab={(t) => go('portfolio', t)} onSave={saveCurrent} />}
              {portfolioTab === 'optimize' && <OptimizerPage settings={effectiveSettings} portfolio={portfolio} setPortfolio={setPortfolio} lastGrade={lastGrade} onOpenStock={openStock} onGoTab={(t) => go('portfolio', t)} onSave={saveCurrent} />}
              {portfolioTab === 'stress' && <StressTestPage settings={effectiveSettings} portfolio={portfolio} setPortfolio={setPortfolio} lastGrade={lastGrade} onOpenStock={openStock} onGoTab={(t) => go('portfolio', t)} onSave={saveCurrent} />}
              {portfolioTab === 'saved' && <MyPortfoliosPage version={savedVersion} activeId={portfolio.activeId} onOpen={openSaved} onChanged={() => setSavedVersion((v) => v + 1)} onCleared={(id) => { if (portfolio.activeId === id) setPortfolio({ activeId: null, name: '' }); }} />}
            </PortfolioHub>
          )}

          {page === 'methodology' && <MethodologyPage mode={settings.mode} onTry={analyze} />}

          <footer className="text-[11px] text-muted pb-8 flex flex-wrap gap-x-3 gap-y-1 pt-4">
            <span>Conviction 2.0 v{APP_VERSION} · For educational and competition use. Not investment advice.</span>
            <span>Prices are daily closes (split-adjusted); fundamentals are as filed with the SEC.</span>
            <button className="hover:text-ink" onClick={() => go('methodology')}>Methodology</button>
            <a className="hover:text-ink" href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
          </footer>
        </main>
        <Analytics />
      </div>
    </DrawerProvider>
  );
}
