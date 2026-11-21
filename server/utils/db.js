/* mtg_data.db — base de saisies (state + snapshots + mkm_settings), via node:sqlite */
import fs from 'node:fs';

import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './paths.js';

export const SYNC_KEYS = ['mtg_collection', 'mtg_binders', 'mtg_matches', 'mtg_custom_tags', 'mtg_decks'];
export const MAX_SNAPSHOTS = 100;

let db = null;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at REAL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, v TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS mkm_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  }
  return db;
}

/* mtime de mtg_data.db EN INCLUANT -wal/-shm : en mode WAL les écritures partent dans
   mtg_data.db-wal et le .db principal ne change pas -> max des mtime des 3 fichiers.
   Sert à invalider les caches qui dépendent de la collection (marché). */
export function dataMtimeMs() {
  let m = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try { m = Math.max(m, fs.statSync(DB_PATH + suffix).mtimeMs); } catch {}
  }
  return m;
}
