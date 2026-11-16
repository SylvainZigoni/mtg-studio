/* Contrôleur prix : /api/price, /api/market, /api/collvalue, /api/price/today
   (port fidèle de api_price / api_market / api_collvalue / api_today de server.py) */
import { spawn } from 'node:child_process';
import { getPricesDb, pricesAvailable, blobPoints, blobAt, dayStr, todayOrdinal } from '../utils/pricesDb.js';
import { loadState } from './stateController.js';
import { sendJson } from '../utils/http.js';
import { ROOT } from '../utils/paths.js';

const MARKET_WINDOWS = { '1w': 7, '1m': 30, '1y': 365, '3y': 1095, '5y': 1825, '10y': 3650, 'rel': null };
const MARKET_TTL = 12 * 3600;
const marketCache = new Map(); // "scope|w" -> {ts, result}

const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const pct = (cur, old) => (old && cur) ? (cur / old - 1) : null;

function collectionEntries() {
  const st = loadState()['mtg_collection'];
  try {
    const entries = typeof st === 'string' ? JSON.parse(st) : st;
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function seriesFor(c, setCode, cn) {
  if (!setCode || cn == null) return null;
  const row = c.prepare('SELECT uuid FROM cards WHERE "set"=? AND cn=?').get(setCode, String(cn));
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
