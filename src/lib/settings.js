import { DEFAULT_WEIGHTS } from '../models/conviction.js';
import { DCF_DEFAULTS } from '../models/dcf.js';
import { loadJson, saveJson } from './storage.js';

export const SETTINGS_KEY = 'conviction2.settings.v1';
export const HISTORY_KEY = 'conviction2.history.v1';

export const PORTFOLIOS_KEY = 'conviction2.portfolios.v1';
export const PORTFOLIO_DRAFT_KEY = 'conviction2.portfolioDraft.v1';

export const DEFAULT_SETTINGS = {
  mode: 'standard', // 'standard' | 'wharton' ("Show the math")
  view: 'stock', // 'stock' | 'portfolio' | 'compare' | 'backtest' | 'about'
  riskFreeAuto: true, // true = use the Treasury 3-month yield fetched by /api/riskfree
  riskFreeRate: '', // percent, manual override used when riskFreeAuto is false
  weights: { ...DEFAULT_WEIGHTS },
  dcf: { ...DCF_DEFAULTS },
  portfolioBlend: { conviction: 50, target: 30, risk: 20 },
};

export const DEFAULT_PORTFOLIO = {
  name: '',
  holdings: [
    { ticker: '', amount: '' },
    { ticker: '', amount: '' },
    { ticker: '', amount: '' },
  ],
  amountMode: 'percent', // 'percent' | 'dollars' (only affects labels; weights are normalized either way)
  horizon: { value: 3, unit: 'months' },
  targetGrowth: 10,
  thesis: '',
};

export function loadPortfolioDraft() {
  const d = loadJson(PORTFOLIO_DRAFT_KEY, null);
  return d ? { ...DEFAULT_PORTFOLIO, ...d, horizon: { ...DEFAULT_PORTFOLIO.horizon, ...(d.horizon || {}) } } : DEFAULT_PORTFOLIO;
}

export function savePortfolioDraft(d) {
  saveJson(PORTFOLIO_DRAFT_KEY, d);
}

export function loadPortfolios() {
  const p = loadJson(PORTFOLIOS_KEY, []);
  return Array.isArray(p) ? p : [];
}

export function savePortfolioEntry(entry) {
  const list = loadPortfolios().filter((p) => p.id !== entry.id);
  list.unshift(entry);
  saveJson(PORTFOLIOS_KEY, list.slice(0, 50));
  return list.slice(0, 50);
}

export function deletePortfolioEntry(id) {
  const list = loadPortfolios().filter((p) => p.id !== id);
  saveJson(PORTFOLIOS_KEY, list);
  return list;
}

export function loadSettings() {
  const saved = loadJson(SETTINGS_KEY, null);
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    weights: { ...DEFAULT_WEIGHTS, ...(saved.weights || {}) },
    dcf: { ...DCF_DEFAULTS, ...(saved.dcf || {}) },
    portfolioBlend: { ...DEFAULT_SETTINGS.portfolioBlend, ...(saved.portfolioBlend || {}) },
  };
}

export function saveSettings(s) {
  saveJson(SETTINGS_KEY, s);
}

export function loadHistory() {
  const h = loadJson(HISTORY_KEY, []);
  return Array.isArray(h) ? h : [];
}

export function pushHistory(entry) {
  const h = loadHistory().filter((e) => !(e.ticker === entry.ticker && e.date === entry.date));
  h.unshift(entry);
  const trimmed = h.slice(0, 50);
  saveJson(HISTORY_KEY, trimmed);
  return trimmed;
}

export function clearHistory() {
  saveJson(HISTORY_KEY, []);
  return [];
}
