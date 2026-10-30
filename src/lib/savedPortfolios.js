// Saved portfolios: local only (this browser), no accounts. Every read/write goes through storage.js,
// which wraps localStorage in try/catch, so a blocked or full store never crashes the app.
//
//   { id, name, createdAt, updatedAt, holdings: [{ticker, amount}], mode: 'percent'|'dollars'|'shares',
//     thesis?: { horizon, targetGrowth, thesis },           (carried over from the older thesis view)
//     snapshots: [{ date, score, label, quality, diversification, risk }] }

import { loadJson, saveJson } from './storage.js';

export const SAVED_KEY = 'conviction2.savedPortfolios.v2';
const LEGACY_KEY = 'conviction2.portfolios.v1';
const MIGRATED_FLAG = 'conviction2.savedPortfolios.migrated';
export const BACKUP_VERSION = 1;

const uid = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const today = () => new Date().toISOString().slice(0, 10);

function clean(p) {
  return {
    id: String(p.id || uid()),
    name: String(p.name || 'Untitled portfolio').slice(0, 80),
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
    holdings: (Array.isArray(p.holdings) ? p.holdings : []).map((h) => ({ ticker: String(h.ticker || '').toUpperCase().slice(0, 12), amount: String(h.amount ?? '') })).filter((h) => h.ticker),
    mode: ['percent', 'dollars', 'shares'].includes(p.mode) ? p.mode : 'percent',
    thesis: p.thesis && typeof p.thesis === 'object' ? { horizon: p.thesis.horizon || null, targetGrowth: p.thesis.targetGrowth ?? null, thesis: String(p.thesis.thesis || '') } : null,
    snapshots: (Array.isArray(p.snapshots) ? p.snapshots : []).filter((s) => s && typeof s === 'object' && typeof s.score === 'number' && typeof s.date === 'string').map((s) => ({
      date: s.date, score: s.score, label: s.label || null,
      quality: typeof s.quality === 'number' ? s.quality : null, diversification: typeof s.diversification === 'number' ? s.diversification : null, risk: typeof s.risk === 'number' ? s.risk : null,
    })),
  };
}

/** Bring entries saved by the older thesis view into the single list (once). */
function migrateLegacy(list) {
  if (loadJson(MIGRATED_FLAG, false)) return list;
  const legacy = loadJson(LEGACY_KEY, []);
  const out = [...list];
  if (Array.isArray(legacy)) {
    for (const e of legacy) {
      if (!e || !e.def) continue;
      out.push(clean({
        name: e.name, createdAt: e.date ? `${e.date}T00:00:00.000Z` : undefined, updatedAt: e.date ? `${e.date}T00:00:00.000Z` : undefined,
        holdings: e.def.holdings, mode: e.def.amountMode === 'dollars' ? 'dollars' : 'percent',
        thesis: { horizon: e.def.horizon, targetGrowth: e.def.targetGrowth, thesis: e.def.thesis },
        snapshots: typeof e.score === 'number' ? [{ date: e.date || today(), score: e.score, label: e.label || null }] : [],
      }));
    }
  }
  saveJson(MIGRATED_FLAG, true);
  saveJson(SAVED_KEY, out);
  return out;
}

export function loadSaved() {
  const raw = loadJson(SAVED_KEY, []);
  const list = (Array.isArray(raw) ? raw : []).map(clean);
  return migrateLegacy(list);
}

function persist(list) {
  saveJson(SAVED_KEY, list);
  return list;
}

export function savePortfolio({ name, holdings, mode, thesis = null, id = null }) {
  const list = loadSaved();
  const now = new Date().toISOString();
  if (id) {
    const i = list.findIndex((p) => p.id === id);
    if (i >= 0) {
      list[i] = clean({ ...list[i], name: name || list[i].name, holdings, mode, thesis: thesis || list[i].thesis, updatedAt: now });
      persist(list);
      return list[i];
    }
  }
  const entry = clean({ id: uid(), name, holdings, mode, thesis, createdAt: now, updatedAt: now, snapshots: [] });
  list.unshift(entry);
  persist(list);
  return entry;
}

export function renamePortfolio(id, name) {
  const list = loadSaved().map((p) => (p.id === id ? { ...p, name: String(name || p.name).slice(0, 80), updatedAt: new Date().toISOString() } : p));
  return persist(list);
}

export function deletePortfolio(id) {
  return persist(loadSaved().filter((p) => p.id !== id));
}

export function duplicatePortfolio(id) {
  const list = loadSaved();
  const src = list.find((p) => p.id === id);
  if (!src) return list;
  const now = new Date().toISOString();
  const copy = clean({ ...src, id: uid(), name: `${src.name} (copy)`, createdAt: now, updatedAt: now, snapshots: [] });
  list.splice(list.indexOf(src) + 1, 0, copy);
  return persist(list);
}

/** Append a score snapshot for a saved portfolio (one per grade run). */
export function addSnapshot(id, { score, label, quality, diversification, risk }) {
  if (typeof score !== 'number') return loadSaved();
  const list = loadSaved().map((p) => (p.id === id ? { ...p, updatedAt: new Date().toISOString(), snapshots: [...p.snapshots, { date: new Date().toISOString(), score, label: label || null, quality: quality ?? null, diversification: diversification ?? null, risk: risk ?? null }] } : p));
  return persist(list);
}

export function exportBackup() {
  return JSON.stringify({ app: 'Conviction 2.0', kind: 'saved-portfolios', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), portfolios: loadSaved() }, null, 2);
}

/**
 * Validate a backup file's text. Returns { ok: true, portfolios } or { ok: false, error }.
 * Rejects anything that is not the expected shape; never partially imports a malformed file.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!data || typeof data !== 'object' || data.kind !== 'saved-portfolios' || !Array.isArray(data.portfolios)) return { ok: false, error: 'This is not a Conviction 2.0 portfolio backup (missing the "saved-portfolios" marker or the portfolios list).' };
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) return { ok: false, error: `Unsupported backup version ${data.version}; this app reads version ${BACKUP_VERSION} or older.` };
  const portfolios = [];
  for (let i = 0; i < data.portfolios.length; i++) {
    const p = data.portfolios[i];
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !Array.isArray(p.holdings)) return { ok: false, error: `Portfolio #${i + 1} is malformed (needs a name and a holdings list).` };
    if (!p.holdings.every((h) => h && typeof h === 'object' && typeof h.ticker === 'string')) return { ok: false, error: `Portfolio "${p.name}" has a malformed holding (each needs a ticker).` };
    if (p.snapshots !== undefined && !Array.isArray(p.snapshots)) return { ok: false, error: `Portfolio "${p.name}" has a malformed snapshot list.` };
    portfolios.push(clean(p));
  }
  return { ok: true, portfolios };
}

/** Merge imported portfolios into the list: same id → replaced, otherwise added. Returns the new list. */
export function importBackup(portfolios) {
  const list = loadSaved();
  for (const p of portfolios) {
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = p;
    else list.push(p);
  }
  return persist(list);
}
