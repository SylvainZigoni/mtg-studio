/* Endpoints decks MTGTop8 servis depuis la snapshot SQLite (readOnly) :
   /api/decks/search (paginé ; FTS5 trigram pour q >= 3 cars ; filtre card= exact
   casse ignorée via ix_cards_card ; cache des COUNT par version de la base ;
   pagination keyset en tri date via afterDate/afterId),
   /api/decks/deck?did=, /api/decks/meta, /api/decks/stats, /api/decks/playable (worker + cache),
   /api/decks/arch, /api/decks/topcards. */
import { sendJson} from '../utils/http.js';
import { SNAPSHOT_DB, snapshotAvailable, getSnapshotDb } from '../utils/snapshotDb.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { dataMtimeMs, normName } from '../utils/db.js';
import { DB_PATH } from '../utils/paths.js';
import { playableVersion, buildPlayable } from '../utils/playable.js';

/* GET /api/decks/meta — compteurs pour le loader et le panneau de scraping. */
export function apiDecksMeta(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const c = getSnapshotDb();
  const one = (sql, ...args) => {
    try { const r = c.prepare(sql).get(...args); return r ? Object.values(r)[0] : 0; }
    catch { return 0; }
  };
  const formats = [];
  try {
    for (const f of c.prepare('SELECT code, name FROM formats').all()) {
      formats.push({
        code: f.code, name: f.name,
        events: one('SELECT COUNT(*) n FROM events WHERE format=?', f.code),
        decks: one('SELECT COUNT(*) n FROM decks WHERE format=? AND fetched=1', f.code),
      });
    }
  } catch { /* table formats absente */ }
  sendJson(res, 200, {
    ok: true,
    decks: one('SELECT COUNT(*) n FROM decks WHERE fetched=1'),
    events: one('SELECT COUNT(DISTINCT eid) n FROM decks WHERE fetched=1'),
    cards: one('SELECT COUNT(*) n FROM deck_cards'),
    maxDate: one('SELECT MAX(event_date) n FROM events WHERE fetched=1'),
    minDate: one('SELECT MIN(event_date) n FROM events WHERE fetched=1'),
    formats,
  });
}

/* ============================================================
   Lecture paginée côté serveur (migration "classique") :
   - GET /api/decks/search?view=events|decks&fmt=&q=&dateFrom=&dateTo=&players=&sort=&dir=&page=&limit=
       view=decks  -> lignes decks 13 champs (main/side vides), total pour la pagination
       view=events -> tournois agrégés {eid, fmt, name, place, date, players, decks}
   - GET /api/decks/deck?did=123 -> 1 deck complet (13 champs avec main/side)
   - GET /api/decks/stats?fmt=    -> agrégats {total, archetypes[], formats[]}
   ============================================================ */

const escLike = s => s.replace(/[\\%_]/g, c => '\\' + c);

const SORT_DECKS = {
  date: 'e.event_date', rank: 'd.rank', name: 'd.deck_name', arch: 'd.archetype',
  player: 'd.player', players: 'e.players', fmt: 'd.format', evname: 'e.name',
};
const SORT_EVENTS = {
  date: 'e.event_date', players: 'e.players', name: 'e.name', place: 'e.place', fmt: 'e.format',
};
const PLAYERS_MIN = { gt19: 19, gt49: 49, gt99: 99, gt199: 199 };

/* ---------- recherche paginée : filtres, cache des COUNT, keyset date ---------- */

/* cache des agrégats (total, eventsTotal/decksTotal, archs) : clé = requête, invalidé
   quand la version logique de la base (COUNT|MAX(did) de decks) change */
const searchCountCache = new Map(); // cle -> { ver, data } ; plafond 300 entrées
function decksVersion(c) {
  const v = c.prepare('SELECT COUNT(*) n, MAX(did) m FROM decks').get();
  return v.n + '|' + v.m;
}
function cachedCounts(c, key, build) {
  const ver = decksVersion(c);
  const hit = searchCountCache.get(key);
  if (hit && hit.ver === ver) return hit.data;
  const data = build();
  if (searchCountCache.size > 300) searchCountCache.delete(searchCountCache.keys().next().value);
  searchCountCache.set(key, { ver, data });
  return data;
}

/* Filtres decks. q >= 3 caractères -> FTS5 trigram (decks_fts, LIKE insensible à la casse
   grâce au tokenizeur trigram) ; q < 3 caractères -> LIKE classique sur decks.
   card= (view=decks) : filtre exact, casse ignorée — ne garde que les decks dont
   deck_cards contient exactement ce nom (index ix_cards_card ; nom inconnu = 0 deck).
   Renvoie { from, where, args } (args des JOIN en tête, avant ceux du WHERE).
   idcol = colonne de tiebreak du keyset. */
function filtersDecks(q, idcol) {
  const qs = String(q.q || '').trim();
  const useFts = qs.length >= 3;
  let from = useFts
    ? 'decks_fts f JOIN decks d ON d.did = f.rowid JOIN events e ON e.eid = d.eid'
    : 'decks d JOIN events e ON e.eid = d.eid';
  const where = ['d.fetched = 1'];
  const args = [];
  const cargs = [];
  const cardQ = String(q.card || '').trim();
  if (cardQ) {
    from += ' JOIN (SELECT DISTINCT did FROM deck_cards WHERE card = ? COLLATE NOCASE) cd ON cd.did = d.did';
    cargs.push(cardQ);
  }
  const fmts = String(q.fmt || '').split(',').map(s => s.trim()).filter(Boolean);
  if (fmts.length) { where.push('d.format IN (' + fmts.map(() => '?').join(',') + ')'); args.push(...fmts); }
  if (q.dateFrom) { where.push('e.event_date >= ?'); args.push(String(q.dateFrom)); }
  if (q.dateTo)   { where.push('e.event_date <= ?'); args.push(String(q.dateTo)); }
  const pmin = PLAYERS_MIN[q.players];
  if (pmin) { where.push('(e.players IS NULL OR e.players = 0 OR e.players > ?)'); args.push(pmin); }
  if (qs) {
    const like = '%' + escLike(qs) + '%';
    if (useFts) where.push("(f.player LIKE ? ESCAPE '\\' OR f.deck_name LIKE ? ESCAPE '\\' OR f.archetype LIKE ? ESCAPE '\\')");
    else where.push("(lower(d.player) LIKE ? ESCAPE '\\' OR lower(d.deck_name) LIKE ? ESCAPE '\\' OR lower(d.archetype) LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  if (q.eid) { where.push('d.eid = ?'); args.push(parseInt(q.eid, 10) || 0); }
  const arch = String(q.arch || '').trim();
  if (arch) {
    if (arch === '(sans archétype)') where.push("(d.archetype IS NULL OR d.archetype = '')");
    else { where.push('lower(d.archetype) = lower(?)'); args.push(arch); }
  }
  if (q.afterDate) {   // keyset tri date : on ignore OFFSET, curseur sur (event_date, idcol)
    const op = q.dir === 'asc' ? '>' : '<';
    where.push('(e.event_date ' + op + ' ? OR (e.event_date = ? AND ' + idcol + ' ' + op + ' ?))');
    args.push(String(q.afterDate), String(q.afterDate), parseInt(q.afterId, 10) || 0);
  }
  return { from, where: where.join(' AND '), args: [...cargs, ...args] };
}

/* Filtres vue events : e.fetched=1 + mêmes filtres sur la table events (+ keyset sur e.eid) */
function filtersEvents(q) {
  const where = ['e.fetched = 1'];
  const args = [];
  const fmts = String(q.fmt || '').split(',').map(s => s.trim()).filter(Boolean);
  if (fmts.length) { where.push('e.format IN (' + fmts.map(() => '?').join(',') + ')'); args.push(...fmts); }
  if (q.dateFrom) { where.push('e.event_date >= ?'); args.push(String(q.dateFrom)); }
  if (q.dateTo)   { where.push('e.event_date <= ?'); args.push(String(q.dateTo)); }
  const pmin = PLAYERS_MIN[q.players];
  if (pmin) { where.push('(e.players IS NULL OR e.players = 0 OR e.players > ?)'); args.push(pmin); }
  const qs = String(q.q || '').trim().toLowerCase();
  if (qs) {
    const like = '%' + escLike(qs) + '%';
    where.push("(lower(e.name || ' ' || COALESCE(e.place, '')) LIKE ? ESCAPE '\\')");
    args.push(like);
  }
  if (q.afterDate) {
    const op = q.dir === 'asc' ? '>' : '<';
    where.push('(e.event_date ' + op + ' ? OR (e.event_date = ? AND e.eid ' + op + ' ?))');
    args.push(String(q.afterDate), String(q.afterDate), parseInt(q.afterId, 10) || 0);
  }
  return { where: where.join(' AND '), args };
}

export function apiDecksSearch(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const q = req.query || {};
  const c = getSnapshotDb();
  const view = q.view === 'decks' ? 'decks' : 'events';
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 25));
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const keyset = !!q.afterDate;

  if (view === 'decks') {
    const { from, where, args } = filtersDecks(q, 'd.did');
    const sortCol = SORT_DECKS[q.sort] || 'e.event_date';
    const ck = 'decks|' + from + '|' + where + '|' + args.map(String).join('|');
    const counts = cachedCounts(c, ck, () => ({
      total: c.prepare('SELECT COUNT(*) n FROM ' + from + ' WHERE ' + where).get(...args).n,
      eventsTotal: c.prepare('SELECT COUNT(DISTINCT d.eid) n FROM ' + from + ' WHERE ' + where).get(...args).n,
      archs: c.prepare('SELECT d.format f, d.archetype a, COUNT(*) n FROM ' + from + ' WHERE ' + where + ' GROUP BY d.format, d.archetype ORDER BY n DESC LIMIT 100').all(...args)
        .map(r => ({ fmt: r.f, arch: r.a || '(sans archétype)', n: r.n })),
    }));
    const rows = c.prepare('SELECT d.did, d.format, d.rank, d.deck_name, d.archetype, d.player, e.name, e.place, e.event_date, d.eid, e.players FROM ' + from + ' WHERE ' + where + ' ORDER BY ' + sortCol + ' ' + dir + ', d.did ' + dir + ' LIMIT ?' + (keyset ? '' : ' OFFSET ?'))
      .all(...args, limit, ...(keyset ? [] : [(page - 1) * limit]));
    return sendJson(res, 200, { ok: true, view, total: counts.total, eventsTotal: counts.eventsTotal, archs: counts.archs, page, limit,
      rows: rows.map(r => [r.did, r.format, r.rank, r.deck_name, r.archetype, r.player, r.name, r.place, r.event_date, r.eid, '', '', r.players]) });
  }

  const { where, args } = filtersEvents(q);
  const sortCol = SORT_EVENTS[q.sort] || 'e.event_date';
  const ck = 'events|' + where + '|' + args.map(String).join('|');
  const counts = cachedCounts(c, ck, () => ({
    total: c.prepare('SELECT COUNT(DISTINCT e.eid) n FROM events e JOIN decks d ON d.eid = e.eid AND d.fetched = 1 WHERE ' + where).get(...args).n,
    decksTotal: c.prepare('SELECT COUNT(d.did) n FROM events e JOIN decks d ON d.eid = e.eid AND d.fetched = 1 WHERE ' + where).get(...args).n,
    archs: c.prepare('SELECT d.format f, d.archetype a, COUNT(*) n FROM events e JOIN decks d ON d.eid = e.eid AND d.fetched = 1 WHERE ' + where + ' GROUP BY d.format, d.archetype ORDER BY n DESC LIMIT 100').all(...args)
      .map(r => ({ fmt: r.f, arch: r.a || '(sans archétype)', n: r.n })),
  }));
  const rows = c.prepare('SELECT e.eid, e.format, e.name, e.place, e.event_date, e.players, COUNT(d.did) nd FROM events e JOIN decks d ON d.eid = e.eid AND d.fetched = 1 WHERE ' + where + ' GROUP BY e.eid ORDER BY ' + sortCol + ' ' + dir + ', e.eid ' + dir + ' LIMIT ?' + (keyset ? '' : ' OFFSET ?'))
    .all(...args, limit, ...(keyset ? [] : [(page - 1) * limit]));
  sendJson(res, 200, { ok: true, view: 'events', total: counts.total, decksTotal: counts.decksTotal, archs: counts.archs, page, limit,
    rows: rows.map(r => ({ eid: r.eid, fmt: r.format, name: r.name, place: r.place, date: r.event_date, players: r.players, decks: r.nd })) });
}

export function apiDecksOne(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const did = parseInt((req.query || {}).did, 10);
  if (!did) return sendJson(res, 400, { ok: false, error: 'param did requis' });
  const c = getSnapshotDb();
  const r = c.prepare(`SELECT d.did, d.format, d.rank, d.deck_name, d.archetype, d.player,
       e.name, e.place, e.event_date, d.eid, e.players,
       (SELECT group_concat(qty || 'x ' || card, '||') FROM
          (SELECT qty, card FROM deck_cards WHERE did = d.did AND board = 'main' ORDER BY qty DESC, card)) AS main,
       (SELECT group_concat(qty || 'x ' || card, '||') FROM
          (SELECT qty, card FROM deck_cards WHERE did = d.did AND board = 'side' ORDER BY qty DESC, card)) AS side
    FROM decks d JOIN events e ON e.eid = d.eid
    WHERE d.did = ? AND d.fetched = 1`).get(did);
  if (!r) return sendJson(res, 404, { ok: false, error: 'deck introuvable (did=' + did + ')' });
  sendJson(res, 200, { ok: true, deck: [r.did, r.format, r.rank, r.deck_name, r.archetype, r.player,
    r.name, r.place, r.event_date, r.eid, r.main || '', r.side || '', r.players] });
}

export function apiDecksStats(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const q = req.query || {};
  const c = getSnapshotDb();
  const fmt = String(q.fmt || '').trim();
  const w = fmt ? 'WHERE fetched = 1 AND format = ?' : 'WHERE fetched = 1';
  const args = fmt ? [fmt] : [];
  const total = c.prepare('SELECT COUNT(*) n FROM decks ' + w).get(...args).n;
  const archetypes = c.prepare('SELECT archetype a, COUNT(*) n FROM decks ' + w + ' GROUP BY archetype ORDER BY n DESC, a LIMIT 500').all(...args)
    .map(r => ({ arch: r.a || '(sans archetype)', n: r.n }));
  const formats = c.prepare('SELECT format f, COUNT(*) n FROM decks ' + w + ' GROUP BY format ORDER BY n DESC').all(...args)
    .map(r => ({ code: r.f, n: r.n }));
  sendJson(res, 200, { ok: true, fmt: fmt || null, total, archetypes, formats });
}


/* ============================================================
   GET /api/decks/playable — decks "jouables" vs collection, calculés
   CÔTÉ SERVEUR dans un worker (le serveur reste réactif pendant le scan).
   Cache : clé = COUNT/MAX(did) de mtgtop8.sqlite + dataMtimeMs() (collection).
   - clé à jour        -> on sert le cache (cached:true)
   - clé changée       -> on sert le cache courant (stale:true) + rebuild en worker
   - aucun cache       -> 202 {building:true}, le client réessaie
   Params : fmt=ALL|CODE & minPct=0..100 & q= & withSide=1 & sort=pct|date|players & page= & limit=
   Réponse : { ok, total, page, limit, cached, stale, builtAt, rows:[{did, pct, missing, d:[13 champs]}] }
   ============================================================ */

let playableCache = null;   // { key, builtAt, list }
let playableWorker = null;

function requestPlayableBuild(key) {
  if (playableWorker) return;                       // un build est déjà en cours
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const w = new Worker(path.join(dir, '../utils/playableWorker.js'), {
    workerData: { SNAPSHOT_DB, DB_PATH, key },
  });
  playableWorker = w;
  w.on('message', m => {
    playableWorker = null;
    if (m.error) { console.error('[playable] build erreur:', m.error); return; }
    playableCache = { key: m.key, builtAt: m.builtAt, list: m.list };
  });
  w.on('error', e => { console.error('[playable] worker erreur:', e); playableWorker = null; });
  w.on('exit', () => { playableWorker = null; });
}

export function apiDecksPlayable(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const q = req.query || {};
  const c = getSnapshotDb();
  const key = playableVersion(c, dataMtimeMs());
  const hit = !!(playableCache && playableCache.key === key);
  if (!hit) requestPlayableBuild(key);
  if (!playableCache)
    return sendJson(res, 202, { ok: false, building: true, error: 'analyse en cours de calcul côté serveur — réessayez dans quelques secondes' });
  const list = playableCache.list;

  const fmt = String(q.fmt || '').trim();
  const minPct = Math.max(0, Math.min(1, (parseInt(q.minPct, 10) || 0) / 100));
  const withSide = q.withSide === '1' || q.withSide === 'true';
  const qn = normName(q.q || '');
  const sort = q.sort || 'pct';
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 200));

  const out = [];
  for (const r of list) {
    if (fmt && fmt !== 'ALL' && r.fmt !== fmt) continue;
    if (qn && !(normName(r.name) + ' ' + normName(r.arch) + ' ' + normName(r.player)).includes(qn)) continue;
    const pct = withSide ? r.pctSide : r.pct;
    if (pct < minPct) continue;
    out.push({ r, pct });
  }
  if (sort === 'players') out.sort((a, b) => ((b.r.players || 0) - (a.r.players || 0)) || (b.pct - a.pct));
  else if (sort === 'date') out.sort((a, b) => String(b.r.date || '').localeCompare(String(a.r.date || '')) || (b.pct - a.pct));
  else out.sort((a, b) => (b.pct - a.pct) || String(b.r.date || '').localeCompare(String(a.r.date || '')));

  const total = out.length;
  const rows = out.slice((page - 1) * limit, page * limit).map(o => ({
    did: o.r.did, pct: o.pct, missing: withSide ? o.r.missingSide : o.r.missing,
    d: [o.r.did, o.r.fmt, o.r.rank, o.r.name, o.r.arch, o.r.player, o.r.evname, o.r.place, o.r.date, o.r.eid, '', '', o.r.players],
  }));
  sendJson(res, 200, { ok: true, total, page, limit, cached: hit, stale: !hit, builtAt: playableCache.builtAt, rows });
}

/* ============================================================
   GET /api/decks/arch?fmt=CODE&arch=LABEL[&side=1][&limit=200]
     -> analyse d'inclusion d'un archétype : total de decks + cartes agrégées
        {card, decks (nb de decks contenant la carte), qty (exemplaires totaux)}
   GET /api/decks/topcards?fmt=CODE[&dateFrom=][&dateTo=][&limit=24]
     -> cartes les plus jouées (main) sur la période : {totalDecks, cards:[{card, qty}]}
   ============================================================ */

export function apiDecksArch(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const q = req.query || {};
  const c = getSnapshotDb();
  const fmt = String(q.fmt || '').trim();
  if (!fmt) return sendJson(res, 400, { ok: false, error: 'param fmt requis' });
  const arch = String(q.arch || '');
  const side = q.side === '1';
  let archSql = '', archArgs = [];
  if (arch === '(sans archétype)') archSql = "AND (d.archetype IS NULL OR d.archetype = '')";
  else if (arch) { archSql = 'AND lower(d.archetype) = lower(?)'; archArgs = [arch]; }
  const boards = side ? "('main','side')" : "('main')";
  const total = c.prepare('SELECT COUNT(*) n FROM decks d WHERE d.fetched = 1 AND d.format = ? ' + archSql).get(fmt, ...archArgs).n;
  const cards = c.prepare('SELECT c.card card, COUNT(DISTINCT c.did) decks, SUM(c.qty) qty FROM deck_cards c JOIN decks d ON d.did = c.did WHERE d.fetched = 1 AND d.format = ? AND c.board IN ' + boards + ' ' + archSql + ' GROUP BY c.card ORDER BY decks DESC, qty DESC LIMIT 200')
    .all(fmt, ...archArgs)
    .map(r => ({ card: r.card, decks: r.decks, qty: r.qty }));
  sendJson(res, 200, { ok: true, fmt, arch: arch || null, side, total, cards });
}

export function apiDecksTopCards(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const q = req.query || {};
  const c = getSnapshotDb();
  const dw = ['d.fetched = 1'], dargs = [];
  if (q.fmt) { dw.push('d.format = ?'); dargs.push(String(q.fmt)); }
  if (q.dateFrom) { dw.push('e.event_date >= ?'); dargs.push(String(q.dateFrom)); }
  if (q.dateTo) { dw.push('e.event_date <= ?'); dargs.push(String(q.dateTo)); }
  const totalDecks = c.prepare('SELECT COUNT(*) n FROM decks d JOIN events e ON e.eid = d.eid WHERE ' + dw.join(' AND ')).get(...dargs).n;
  const where = ["c.board = 'main'"], args = [];
  if (q.fmt) { where.push('d.format = ?'); args.push(String(q.fmt)); }
  if (q.dateFrom) { where.push('e.event_date >= ?'); args.push(String(q.dateFrom)); }
  if (q.dateTo) { where.push('e.event_date <= ?'); args.push(String(q.dateTo)); }
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 24));
  const cards = c.prepare('SELECT c.card card, SUM(c.qty) qty FROM deck_cards c JOIN decks d ON d.did = c.did JOIN events e ON e.eid = d.eid WHERE ' + where.join(' AND ') + ' GROUP BY c.card ORDER BY qty DESC LIMIT ?')
    .all(...args, limit)
    .map(r => ({ card: r.card, qty: r.qty }));
  sendJson(res, 200, { ok: true, totalDecks, cards });
}
