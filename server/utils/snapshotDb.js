/* mtgtop8.sqlite (lecture seule) — base brute du scraper MTGTop8,
   désormais source unique des decks servis à l'app (/api/decks/*). */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './paths.js';

export const SNAPSHOT_DB = path.join(ROOT, 'mtgtop8.sqlite');

let db = null;

export function snapshotAvailable() {
  return fs.existsSync(SNAPSHOT_DB);
}

export function getSnapshotDb() {
  if (!db) db = new DatabaseSync(SNAPSHOT_DB, { readOnly: true });
  return db;
}
