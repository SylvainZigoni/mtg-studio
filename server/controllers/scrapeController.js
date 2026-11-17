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
