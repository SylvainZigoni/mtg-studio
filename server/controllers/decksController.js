/* Dataset decks MTGTop8 servi depuis la snapshot SQLite (GET /api/decks) :
   construit une fois, gzippe en memoire, cache invalide sur le mtime du .sqlite.
   Format de sortie identique a l'ancien decks.json.gz (tableau de 13 champs, voir js/core/decks.js). */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { sendJson } from '../utils/http.js';
import { SNAPSHOT_DB, snapshotAvailable, getSnapshotDb } from '../utils/snapshotDb.js';

let cache = null; // { mtimeMs, buf }

const SQL_DECKS = `SELECT d.did, d.format, d.rank, d.deck_name, d.archetype, d.player,
       e.name, e.place, e.event_date, d.eid, e.players,
       (SELECT group_concat(qty || 'x ' || card, '||') FROM
          (SELECT qty, card FROM deck_cards WHERE did = d.did AND board = 'main' ORDER BY qty DESC, card)) AS main,
       (SELECT group_concat(qty || 'x ' || card, '||') FROM
          (SELECT qty, card FROM deck_cards WHERE did = d.did AND board = 'side' ORDER BY qty DESC, card)) AS side
  FROM decks d JOIN events e ON e.eid = d.eid
  WHERE d.fetched = 1
  ORDER BY e.event_date DESC, d.rank, d.did`;

function buildGzip() {
  const c = getSnapshotDb();
  const rows = c.prepare(SQL_DECKS).all();
  const out = rows.map(r => [r.did, r.format, r.rank, r.deck_name, r.archetype, r.player,
    r.name, r.place, r.event_date, r.eid, r.main || '', r.side || '', r.players]);
  return zlib.gzipSync(Buffer.from(JSON.stringify(out), 'utf8'), { level: 6 });
}

/* GET /api/decks — dataset complet ; Content-Encoding: gzip, le navigateur decompresse seul. */
export function apiDecks(req, res) {
  if (!snapshotAvailable())
    return sendJson(res, 503, { ok: false, error: 'mtgtop8.sqlite absente : lancez le scraping (Parametres).' });
  const st = fs.statSync(SNAPSHOT_DB);
  const lm = new Date(st.mtimeMs).toUTCString();
  if (req.headers['if-modified-since'] &&
      new Date(req.headers['if-modified-since']).getTime() >= Math.floor(st.mtimeMs / 1000) * 1000) {
    res.writeHead(304, { 'Last-Modified': lm, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  if (!cache || cache.mtimeMs !== st.mtimeMs) cache = { mtimeMs: st.mtimeMs, buf: buildGzip() };
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Encoding': 'gzip',
    'Content-Length': cache.buf.length,
    'Last-Modified': lm,
    'Cache-Control': 'no-cache',
  });
  res.end(cache.buf);
}

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
    formats,
  });
}
