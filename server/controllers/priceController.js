/* Contrôleur prix : /api/price, /api/market, /api/collvalue, /api/price/today
   (port fidèle de api_price / api_market / api_collvalue / api_today de server.py) */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getPricesDb, pricesAvailable, blobPoints, blobAt, dayStr, todayOrdinal } from '../utils/pricesDb.js';
import { loadState } from './stateController.js';
import { sendJson } from '../utils/http.js';
import { ROOT, PRICES_DB } from '../utils/paths.js';

const MARKET_WINDOWS = { '1w': 7, '1m': 30, '1y': 365, '3y': 1095, '5y': 1825, '10y': 3650, 'rel': null };
const MARKET_TTL = 12 * 3600;
const marketCache = new Map(); // "scope|w" -> {ts, result}

const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const pct = (cur, old) => (old && cur) ? (cur / old - 1) : null;

function collectionEntries() {
  const st = loadState()['mtg_collection'];
  try {
    const parsed = typeof st === 'string' ? JSON.parse(st) : st;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries;   // forme { v, entries: [...] }
    return [];
  } catch {
    return [];
  }
}

function seriesFor(c, setCode, cn) {
  if (!setCode || cn == null) return null;
  const row = c.prepare('SELECT uuid FROM cards WHERE "set"=? AND cn=?').get(String(setCode).toUpperCase(), String(cn));
  if (!row) return null;
  return c.prepare('SELECT normal, foil, last_norm, last_foil, last_date, released_at, scryfall_id ' +
    'FROM series JOIN cards ON cards.uuid=series.uuid WHERE cards.uuid=?').get(row.uuid);
}

/* Historique d'une carte : ?sfid=<scryfall id> (ou ?set=&cn= ou ?uuid=) */
export function apiPrice(req, res) {
  if (!pricesAvailable()) {
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez price_seed.py (voir README).' });
  }
  const params = req.query;
  const c = getPricesDb();
  let row = null;
  if (params.sfid) {
    row = c.prepare('SELECT uuid, name, "set", cn, released_at FROM cards WHERE scryfall_id=?').get(params.sfid);
  } else if (params.uuid) {
    row = { uuid: params.uuid, name: null, set: null, cn: null, released_at: null };
  } else if (params.set && params.cn) {
    row = c.prepare('SELECT uuid, name, "set", cn, released_at FROM cards WHERE "set"=? AND cn=?').get(params.set, params.cn);
  }
  if (!row) return sendJson(res, 404, { ok: false, error: 'carte inconnue dans prices.db (extension importée ?)' });
  const s = c.prepare('SELECT normal, foil, last_norm, last_foil, last_date FROM series WHERE uuid=?').get(row.uuid);
  if (!s) return sendJson(res, 404, { ok: false, error: 'aucun prix Cardmarket pour cette carte.' });
  sendJson(res, 200, {
    ok: true,
    uuid: row.uuid,
    normal: blobPoints(s.normal).map(([d, p]) => [dayStr(d), p]),
    foil: blobPoints(s.foil).map(([d, p]) => [dayStr(d), p]),
    last: s.last_norm || s.last_foil,
    last_date: dayStr(s.last_date),
  });
}

/* Top/flop : ?w=1w|1m|1y|3y|5y|10y|rel &scope=all|collection &limit=20 (cache 12h) */
export function apiMarket(req, res) {
  if (!pricesAvailable()) {
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez price_seed.py (voir README).' });
  }
  const w = req.query.w || '1m';
  if (!(w in MARKET_WINDOWS)) return sendJson(res, 400, { ok: false, error: 'fenêtre invalide' });
  const scope = req.query.scope || 'all';
  const key = `${scope}|${w}`;
  const now = Date.now() / 1000;
  const hit = marketCache.get(key);
  if (hit && now - hit.ts < MARKET_TTL) return sendJson(res, 200, hit.result);

  const limit = Math.min(Number(req.query.limit || 20) || 20, 50);
  const days = MARKET_WINDOWS[w];
  const targetDay = days ? todayOrdinal() - days : null;
  const results = [];
  const c = getPricesDb();
  if (scope === 'collection') {
    for (const e of collectionEntries()) {
      const s = seriesFor(c, e.set, e.cn != null ? String(e.cn) : '');
      if (!s) continue;
      const cur = e.foil ? s.last_foil : s.last_norm;
      const blob = e.foil ? s.foil : s.normal;
      if (!cur) continue;
      let old;
      if (targetDay) old = blobAt(blob, targetDay);
      else { const pts = blobPoints(blob); old = pts.length ? pts[0][1] : null; }
      if (old == null || old < 0.1) continue; // points aberrants MTGJSON
      const p = pct(cur, old);
      if (p == null) continue;
      results.push({ name: e.name, set: e.set, cn: e.cn, now: round2(cur), was: round2(old), pct: p, qty: e.qty || 1, foil: !!e.foil, sfid: s.scryfall_id });
    }
  } else {
    const rows = c.prepare('SELECT scryfall_id, cards.uuid, name, cards."set", released_at, last_norm, normal, last_foil, foil ' +
      'FROM series JOIN cards ON cards.uuid=series.uuid').all();
    for (const s of rows) {
      const cur = s.last_norm || s.last_foil;
      const blob = s.last_norm ? s.normal : s.foil;
      if (!cur || cur < 0.5) continue;
      let old;
      if (targetDay) old = blobAt(blob, targetDay);
      else { const pts = blobPoints(blob); old = pts.length ? pts[0][1] : null; }
      if (old == null || old < 0.1) continue;
      const p = pct(cur, old);
      if (p == null) continue;
      results.push({ name: s.name, set: s.set, cn: null, now: round2(cur), was: round2(old), pct: p, qty: 1, foil: false, sfid: s.scryfall_id });
    }
  }
  // dédoublonnage par nom (on garde l'impression la plus chère)
  const best = new Map();
  for (const r of results) {
    const k = String(r.name).toLowerCase();
    if (!best.has(k) || r.now > best.get(k).now) best.set(k, r);
  }
  const uniq = [...best.values()];
  const out = {
    ok: true, w, scope,
    top: [...uniq].sort((a, b) => b.pct - a.pct).slice(0, limit),
    flop: [...uniq].sort((a, b) => a.pct - b.pct).slice(0, limit),
    n: uniq.length,
  };
  marketCache.set(key, { ts: now, result: out });
  sendJson(res, 200, out);
}

/* GET /api/market/cards — vue "cartes" du Marché : filtres + TRI GLOBAL + pagination sur prices.db.
   ?from=&to= (ordinals) &name=&artist=&colors=W,U&types=&cmc=&set=&reserved=1&scope=all|collection
   &sort=name|set|rarity|was|now|pct &dir=asc|desc &page=1 &limit=25
   -> { ok, from, to, total, page, pages, kpi, hist, index:[[date,val]], rows:[{...,spark}] }
   Les cartes sans prix à "from" sont triées en dernier. Cache 12h par requête (max 8 entrées). */
const marketCardsCache = new Map();
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, special: 3, mythic: 4, bonus: 5 };
export function apiMarketCards(req, res) {
  if (!pricesAvailable()) return sendJson(res, 503, { ok: false, error: 'prices.db absent.' });
  const q = req.query;
  const from = parseInt(q.from, 10) || 0;
  const to = Math.max(from, parseInt(q.to, 10) || todayOrdinal());
  if (!from) return sendJson(res, 400, { ok: false, error: 'from/to requis (ordinals de jours)' });
  const key = JSON.stringify({ ...q, from, to });
  const nowS = Date.now() / 1000;
  const mtime = fs.statSync(PRICES_DB).mtimeMs;   // une mise à jour de prices.db invalide le cache
  const hit = marketCardsCache.get(key);
  if (hit && hit.mtime === mtime && nowS - hit.ts < MARKET_TTL) return sendJson(res, 200, hit.result);
  if (marketCardsCache.size > 8) marketCardsCache.delete(marketCardsCache.keys().next().value);

  const c = getPricesDb();
  const where = ['(s.last_norm IS NOT NULL OR s.last_foil IS NOT NULL)'];
  const args = [];
  const name = String(q.name || '').trim().toLowerCase();
  if (name) { where.push('LOWER(c.name) LIKE ?'); args.push('%' + name + '%'); }
  const artist = String(q.artist || '').trim().toLowerCase();
  if (artist) { where.push('LOWER(c.artist) LIKE ?'); args.push('%' + artist + '%'); }
  if (q.set) { where.push('c."set" = ?'); args.push(String(q.set).toUpperCase()); }
  if (String(q.reserved) === '1' || String(q.reserved) === 'true') where.push('c.reserved = 1');
  const cols = String(q.colors || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (cols.length) {
    where.push('(' + cols.map(() => 'c.colors LIKE ?').join(' OR ') + ')');
    args.push(...cols.map(c => '%,' + c + ',%'));
  }
  const types = String(q.types || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (types.length) {
    where.push('(' + types.map(() => 'LOWER(c.type_line) LIKE ?').join(' OR ') + ')');
    args.push(...types.map(t => '%' + t + '%'));
  }
  if (q.cmc !== undefined && q.cmc !== '') {
    if (String(q.cmc) === '7+') where.push('c.cmc >= 7');
    else { where.push('c.cmc = ?'); args.push(parseFloat(q.cmc)); }
  }
  if ((q.scope || 'all') === 'collection') {
    const keys = collectionEntries().map(e => (e.set || '').toUpperCase() + '|' + (e.cn != null ? String(e.cn) : '')).filter(s => s !== '|');
    if (keys.length) { where.push(`(c."set" || '|' || c.cn) IN (${keys.map(() => '?').join(',')})`); args.push(...keys); }
    else where.push('0');
  }
  const sql = `WITH picked AS (
      SELECT LOWER(name) AS lname, "set" AS st, cn,
             COALESCE(MIN(CASE WHEN lang='English' THEN scryfall_id END), MIN(scryfall_id)) AS sfid
      FROM cards GROUP BY LOWER(name), "set", cn)
    SELECT c.scryfall_id, c.name, c."set", c.cn, c.rarity, c.lang, s.normal, s.foil
    FROM picked p JOIN cards c ON c.scryfall_id = p.sfid JOIN series s ON s.uuid = c.uuid
    WHERE ${where.join(' AND ')}`;
  const rows = c.prepare(sql).all(...args);

  const qtyMap = new Map();   // "SET|CN" -> qté possédée dans la collection (colonne Coll. + impact)
  for (const e of collectionEntries()) {
    const k = (e.set || '').toUpperCase() + '|' + (e.cn != null ? String(e.cn) : '');
    if (k !== '|') qtyMap.set(k, (qtyMap.get(k) || 0) + (e.qty || 1));
  }
  const out = rows.map(r => {
    const blob = r.normal || r.foil;
    const was = blobAt(blob, from);
    const nowP = blobAt(blob, to);
    const wasEff = (was != null && was >= 0.1) ? was : null;   // points aberrants MTGJSON (< 0,10 EUR) = pas de prix fiable
    const qty = qtyMap.get((r.set || '').toUpperCase() + '|' + (r.cn != null ? String(r.cn) : '')) || 0;
    const flat = (wasEff != null && nowP != null) ? round2(nowP - wasEff) : null;
    return { sfid: r.scryfall_id, name: r.name, set: r.set, cn: r.cn, rarity: r.rarity, lang: r.lang, qty,
             was: was != null ? round2(was) : null, now: nowP != null ? round2(nowP) : null,
             pct: (wasEff && nowP) ? nowP / wasEff - 1 : null, flat,
             impact: flat != null ? round2(flat * qty) : null, _wasEff: wasEff != null, _blob: blob };
  });
  const sort = q.sort || 'pct';
  const dir = q.dir === 'asc' ? 1 : -1;
  const cmp = ({
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
    set: (a, b) => String(a.set).localeCompare(String(b.set)) || String(a.name).localeCompare(String(b.name)),
    rarity: (a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9) || String(a.name).localeCompare(String(b.name)),
    was: (a, b) => (a.was ?? -1) - (b.was ?? -1),
    now: (a, b) => (a.now ?? -1) - (b.now ?? -1),
    pct: (a, b) => (a.pct ?? -Infinity) - (b.pct ?? -Infinity),
    flat: (a, b) => (a.flat ?? -Infinity) - (b.flat ?? -Infinity),
    impact: (a, b) => (a.impact ?? -Infinity) - (b.impact ?? -Infinity),
    qty: (a, b) => (a.qty || 0) - (b.qty || 0),
  })[sort] || ((a, b) => (a.pct ?? -Infinity) - (b.pct ?? -Infinity));
  out.sort((a, b) => {
    const aNo = !a._wasEff, bNo = !b._wasEff;
    if (aNo !== bNo) return aNo ? 1 : -1;
    if (aNo && bNo) return (b.now ?? -1) - (a.now ?? -1);
    return cmp(a, b) * dir;
  });

  const pcts = out.filter(r => r.pct != null).map(r => r.pct).sort((a, b) => a - b);
  const n = out.length;
  const up = pcts.filter(p => p > 0).length, down = pcts.filter(p => p < 0).length;
  const median = pcts.length ? pcts[Math.floor(pcts.length / 2)] : null;
  const avg = pcts.length ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null;
  let hist = [];
  if (pcts.length) {
    const lo = pcts[0], hi = pcts[pcts.length - 1], B = 12, span = Math.max(1e-9, hi - lo);
    hist = Array.from({ length: B }, (_, i) => ({ lo: lo + span * i / B, hi: lo + span * (i + 1) / B, n: 0 }));
    for (const p of pcts) hist[Math.min(B - 1, Math.floor((p - lo) / span * B))].n++;
  }

  const daysIn = allHistorizedDays().days.filter(d => d >= from && d <= to);
  const idxSums = new Array(daysIn.length).fill(0), idxCnt = new Array(daysIn.length).fill(0);
  const idxSample = out.length > 20000 ? out.filter((_, i) => i % Math.ceil(out.length / 20000) === 0) : out;
  for (const r of idxSample) {
    if (!r._wasEff || !r._blob) continue;
    const pts = blobPoints(r._blob);
    let k = 0;
    for (let i = 0; i < daysIn.length; i++) {
      const d = daysIn[i];
      while (k < pts.length && pts[k][0] <= d) k++;
      if (k > 0) { idxSums[i] += pts[k - 1][1] / (r.was >= 0.1 ? r.was : pts[k - 1][1]) * 100; idxCnt[i]++; }
    }
  }
  const index = daysIn.map((d, i) => [dayStr(d), idxCnt[i] ? round2(idxSums[i] / idxCnt[i]) : null]).filter(p => p[1] != null);

  const limit = Math.min(100, Math.max(5, parseInt(q.limit, 10) || 25));
  const pages = Math.max(1, Math.ceil(n / limit));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  const pageRows = out.slice((page - 1) * limit, page * limit).map(r => {
    let spark = [];
    if (r._blob) {
      const pts = blobPoints(r._blob).filter(p => p[0] >= from && p[0] <= to);
      const stride = Math.max(1, Math.ceil(pts.length / 60));
      spark = pts.filter((_, i) => i % stride === 0).map(p => [dayStr(p[0]), round2(p[1])]);
      if (pts.length) { const last = pts[pts.length - 1]; if (spark[spark.length - 1][0] !== dayStr(last[0])) spark.push([dayStr(last[0]), round2(last[1])]); }
    }
    const { _blob, _wasEff, ...row } = r;
    return { ...row, spark };
  });

  const result = { ok: true, from: dayStr(from), to: dayStr(to), total: n, page, pages, limit,
    kpi: { n, up, down, flat: pcts.length - up - down, median: median != null ? round2(median * 100) / 100 : null, avg: avg != null ? round2(avg * 100) / 100 : null },
    hist, index, rows: pageRows };
  marketCardsCache.set(key, { ts: nowS, mtime, result });
  sendJson(res, 200, result);
}

/* Valorisation de la collection : maintenant et aux fenêtres passées */
/* Valeur totale de CHAQUE extension en une seule requête SQL depuis prices.db (cache 12h).
   Équivalent à la somme des prix Scryfall par set, mais instantané : pas d'appel API externe. */
const setValsCache = { ts: 0, result: null };
export function apiSetvalues(req, res) {
  if (!pricesAvailable()) {
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez price_seed.py (voir README).' });
  }
  const now = Date.now() / 1000;
  if (setValsCache.result && now - setValsCache.ts < MARKET_TTL) return sendJson(res, 200, setValsCache.result);
  const rows = getPricesDb().prepare(
    'SELECT c."set" AS code, SUM(COALESCE(s.last_norm, s.last_foil, 0)) AS v ' +
    'FROM cards c JOIN series s ON s.uuid = c.uuid GROUP BY c."set"'
  ).all();
  const values = {};
  for (const r of rows) if (r.code) values[r.code] = round2(r.v);
  const out = { ok: true, n: Object.keys(values).length, values };
  setValsCache.ts = now;
  setValsCache.result = out;
  sendJson(res, 200, out);
}

/* bornes de prix (min/max) des cartes ayant une série dans prices.db — pour la jauge de filtre prix (cache 12h) */
const priceRangeCache = { ts: 0, result: null };
export function apiPricerange(req, res) {
  if (!pricesAvailable()) {
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez price_seed.py (voir README).' });
  }
  const now = Date.now() / 1000;
  if (priceRangeCache.result && now - priceRangeCache.ts < MARKET_TTL) return sendJson(res, 200, priceRangeCache.result);
  const r = getPricesDb().prepare(
    'SELECT MIN(COALESCE(last_norm, last_foil, 0)) AS mn, ' +
    'MAX(MAX(COALESCE(last_norm, 0), COALESCE(last_foil, 0))) AS mx FROM series'
  ).get();
  const out = { ok: true, min: r.mn || 0, max: r.mx || 0 };
  priceRangeCache.ts = now;
  priceRangeCache.result = out;
  sendJson(res, 200, out);
}

export function apiCollvalue(req, res) {
  if (!pricesAvailable()) {
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez price_seed.py (voir README).' });
  }
  const windows = { w1: 7, m1: 30, m3: 91, y1: 365, y3: 1095, y5: 1825, y10: 3650 };
  const today = todayOrdinal();
  const sums = Object.fromEntries(Object.keys(windows).map(k => [k, 0]));
  let nowVal = 0, matched = 0, total = 0;
  const c = getPricesDb();
  for (const e of collectionEntries()) {
    total++;
    const s = seriesFor(c, e.set, e.cn != null ? String(e.cn) : '');
    if (!s) continue;
    const blob = e.foil ? s.foil : s.normal;
    const last = (e.foil ? s.last_foil : s.last_norm) || 0;
    if (!last) continue;
    matched++;
    const qty = e.qty || 1;
    nowVal += last * qty;
    for (const [k, d] of Object.entries(windows)) {
      let old = blobAt(blob, today - d);
      if (old == null) { const pts = blobPoints(blob); old = pts.length ? pts[0][1] : null; }
      if (old) sums[k] += old * qty;
    }
  }
  sendJson(res, 200, {
    ok: true, now: round2(nowVal), matched, total,
    past: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, round2(v)])),
  });
}

/* Jours historisés de prices.db (union des jours de tous les blobs), cache invalidé par le mtime. */
let daysCache = { mtime: -1, result: null };
function allHistorizedDays() {
  const mtime = fs.statSync(PRICES_DB).mtimeMs;
  if (daysCache.result && daysCache.mtime === mtime) return daysCache.result;
  const c = getPricesDb();
  const days = new Set();
  let from = null;
  for (const r of c.prepare('SELECT normal, foil FROM series').all()) {
    for (const blob of [r.normal, r.foil]) {
      if (!blob) continue;
      const b = Buffer.from(blob);
      const n = b.readUInt32LE(0);
      for (let i = 0; i < n; i++) {
        const d = b.readInt32LE(4 + 8 * i);
        days.add(d);
        if (from === null || d < from) from = d;
      }
    }
  }
  const result = { ok: true, from: dayStr(from), to: dayStr(todayOrdinal()), n: days.size, days: [...days].sort((a, b) => a - b) };
  daysCache = { mtime, result };
  return result;
}
/* GET /api/prices/days — { from, to, n, days:[ordinals] } (jours avec >= 1 prix dans prices.db) */
export function apiPriceDays(req, res) {
  if (!pricesAvailable())
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez une mise a jour (Parametres).' });
  sendJson(res, 200, allHistorizedDays());
}

/* GET /api/prices/last — map scryfall_id -> [last_norm, last_foil] : dernier prix connu de chaque carte,
   lu dans prices.db. Cache memoire invalide par le mtime du fichier (une mise a jour des prix le purge). */
let lastMapCache = { mtime: -1, result: null };
export function apiPricesLast(req, res) {
  if (!pricesAvailable())
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez une mise a jour (Parametres).' });
  const mtime = fs.statSync(PRICES_DB).mtimeMs;
  if (lastMapCache.result && lastMapCache.mtime === mtime) return sendJson(res, 200, lastMapCache.result);
  const c = getPricesDb();
  const rows = c.prepare('SELECT c.scryfall_id AS id, s.last_norm AS n, s.last_foil AS f FROM cards c JOIN series s ON s.uuid = c.uuid WHERE s.last_norm IS NOT NULL OR s.last_foil IS NOT NULL').all();
  const map = {};
  for (const r of rows) {
    if (!r.id) continue;
    map[r.id] = [r.n != null ? round2(r.n) : null, r.f != null ? round2(r.f) : null];
  }
  const lastOrd = c.prepare('SELECT MAX(CAST(last_date AS INTEGER)) d FROM series').get().d;
  const out = { ok: true, lastPoint: dayStr(lastOrd), n: Object.keys(map).length, map };
  lastMapCache = { mtime, result: out };
  sendJson(res, 200, out);
}

/* GET /api/price/status — état de prices.db (dernier point, today_done, last_weekly, run en cours, mtime) */
export function apiPriceStatus(req, res) {
  if (!pricesAvailable())
    return sendJson(res, 503, { ok: false, error: 'prices.db absent : lancez une mise à jour (Parametres).' });
  const c = getPricesDb();
  const meta = {};
  try { for (const r of c.prepare('SELECT k, v FROM meta').all()) meta[r.k] = r.v; } catch {}
  const one = s => { try { const r = c.prepare(s).get(); return r ? Object.values(r)[0] : null; } catch { return null; } };
  const lastOrd = one('SELECT MAX(CAST(last_date AS INTEGER)) d FROM series');
  sendJson(res, 200, {
    ok: true,
    cards: one('SELECT COUNT(*) n FROM cards'),
    series: one('SELECT COUNT(*) n FROM series'),
    lastPoint: dayStr(lastOrd),
    todayDone: meta.today_done || null,
    lastWeekly: meta.last_weekly || null,
    run: meta.run || null,
    mtime: fs.statSync(PRICES_DB).mtime.toLocaleString('sv-SE'),
  });
}

/* POST /api/price/seed  body: {mode: today|weekly|prices|cards} — met à jour prices.db depuis MTGJSON */
export function apiPriceSeed(req, res) {
  const mode = (req.body && ['today', 'weekly', 'prices', 'cards'].includes(req.body.mode)) ? req.body.mode : 'today';
  if (!pricesAvailable())
    return sendJson(res, 503, { ok: false, error: 'prices.db absent.' });
  let run = null;
  try {
    const r = getPricesDb().prepare("SELECT v FROM meta WHERE k='run'").get();
    run = r && r.v;
  } catch {}
  if (run) {
    const m = /pid=(\d+)/.exec(run);
    const pid = m ? +m[1] : null;
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch {} }
    if (alive) return sendJson(res, 409, { ok: false, error: `une mise à jour est déjà en cours : ${run}` });
  }
  try {
    const fd = fs.openSync(path.join(ROOT, 'price_seed.log'), 'a');
    const child = spawn('python', ['price_seed.py', mode], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', e => console.error(`[price/seed] erreur : ${e.message}`));
    child.unref();
    fs.closeSync(fd);
    sendJson(res, 200, { ok: true, started: true, mode });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
}

/* Met à jour les prix du jour (AllPricesToday) en tâche de fond via price_seed.py (1×/jour max côté seed) */
export function apiToday(req, res) {
  try {
    const child = spawn('python', ['price_seed.py', 'today'], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.on('error', e => console.error(`[price/today] erreur : ${e.message}`));
    child.unref();
    sendJson(res, 200, { ok: true, started: true });
  } catch (e) {
    sendJson(res, 501, { ok: false, error: String(e.message || e) });
  }
}
