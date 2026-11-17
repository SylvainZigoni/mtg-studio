/* Controleur scraping MTGTop8 : lance scrape_run.py (phase1 + crawl) en arriere-plan
   et rapporte la progression lue dans scrape_status.json + mtgtop8_2026_snapshot.sqlite. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sendJson } from '../utils/http.js';
import { ROOT } from '../utils/paths.js';

const STATUS_FILE = path.join(ROOT, 'scrape_status.json');
const SNAPSHOT_DB = path.join(ROOT, 'mtgtop8_2026_snapshot.sqlite');

function readJsonFile(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}

function readStatusFile() {
  return readJsonFile(STATUS_FILE, { running: false });
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/* POST /api/scrape  body: {seconds?: number} — refuse si un run est deja en cours */
export function apiScrapeStart(req, res) {
  const st = readStatusFile();
  if (st.running && pidAlive(st.pid))
    return sendJson(res, 409, { ok: false, error: `un scraping est deja en cours (pid ${st.pid})` });
  const seconds = Math.max(60, Math.floor(Number(req.body && req.body.seconds) || 3600));
  try {
    const child = spawn('python', ['scrape_run.py', String(seconds)], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.on('error', e => console.error(`[scrape] erreur : ${e.message}`));
    child.unref();
    sendJson(res, 200, { ok: true, started: true, seconds });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
}

const FORMATS_OK = new Set(['MO', 'LE', 'VI', 'PAU', 'PEA', 'PREM', 'EDH']);

/* POST /api/scrape/one  body: {year, format, seconds} — scraping d'une année x un format (scrape_year.py) */
export function apiScrapeOne(req, res) {
  const st = readStatusFile();
  if (st.running && pidAlive(st.pid))
    return sendJson(res, 409, { ok: false, error: `un scraping est deja en cours (pid ${st.pid})` });
  const b = req.body || {};
  const fmt = String(b.format || '').toUpperCase();
  const year = Math.floor(Number(b.year));
  const seconds = Math.max(60, Math.floor(Number(b.seconds) || 3600));
  if (!FORMATS_OK.has(fmt)) return sendJson(res, 400, { ok: false, error: 'format invalide' });
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear() + 1)
    return sendJson(res, 400, { ok: false, error: 'annee invalide' });
  try {
    const child = spawn('python', ['scrape_year.py', String(year), fmt, String(seconds)], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.on('error', e => console.error(`[scrape/one] erreur : ${e.message}`));
    child.unref();
    sendJson(res, 200, { ok: true, started: true, year, format: fmt, seconds });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
}

/* GET /api/scrape/grid — nb de decks par (format, année), lus dans la snapshot SQLite */
export function apiScrapeGrid(req, res) {
  const empty = () => sendJson(res, 200, { ok: true, grid: {} });
  if (!fs.existsSync(SNAPSHOT_DB)) return empty();
  let c;
  try { c = new DatabaseSync(SNAPSHOT_DB, { readOnly: true }); } catch { return empty(); }
  try {
    const grid = {};
    for (const r of c.prepare(`SELECT d.format AS f, substr(e.event_date, 1, 4) AS y,
                                      COUNT(*) AS total,
                                      SUM(CASE WHEN d.fetched = 1 THEN 1 ELSE 0 END) AS fetched
                               FROM decks d JOIN events e ON e.eid = d.eid
                               GROUP BY d.format, y`).all()) {
      if (!r.f || !r.y) continue;
      (grid[r.f] = grid[r.f] || {})[r.y] = { total: r.total, fetched: r.fetched || 0 };
    }
    sendJson(res, 200, { ok: true, grid });
  } finally { c.close(); }
}

/* Progression lue dans la base snapshot (equivalent du status() de scraper.py) */
function snapshotStats() {
  if (!fs.existsSync(SNAPSHOT_DB)) return null;
  let c;
  try { c = new DatabaseSync(SNAPSHOT_DB, { readOnly: true }); }
  catch { return null; }
  try {
    const one = (sql, ...args) => {
      try { const r = c.prepare(sql).get(...args); return r ? Object.values(r)[0] : 0; }
      catch { return 0; }
    };
    const formats = [];
    try {
      for (const f of c.prepare('SELECT code, name, meta_2026 FROM formats').all()) {
        formats.push({
          code: f.code, name: f.name, meta: f.meta_2026,
          events: one('SELECT COUNT(*) n FROM events WHERE format=?', f.code),
          eventsFetched: one('SELECT COUNT(*) n FROM events WHERE format=? AND fetched=1', f.code),
          decks: one('SELECT COUNT(*) n FROM decks WHERE format=?', f.code),
          decksFetched: one('SELECT COUNT(*) n FROM decks WHERE format=? AND fetched=1', f.code),
        });
      }
    } catch { /* table formats absente */ }
    return {
      events: one('SELECT COUNT(*) n FROM events'),
      eventsFetched: one('SELECT COUNT(*) n FROM events WHERE fetched=1'),
      decks: one('SELECT COUNT(*) n FROM decks'),
      decksFetched: one('SELECT COUNT(*) n FROM decks WHERE fetched=1'),
      cards: one('SELECT COUNT(*) n FROM deck_cards'),
      formats,
    };
  } finally { c.close(); }
}

/* GET /api/scrape/status */
export function apiScrapeStatus(req, res) {
  const st = readStatusFile();
  const running = !!(st.running && pidAlive(st.pid));
  sendJson(res, 200, {
    ok: true,
    running,
    phase: st.phase || null,
    started: st.started || null,
    ended: st.ended || null,
    error: st.error || null,
    pid: st.pid || null,
    stats: snapshotStats(),
  });
}
