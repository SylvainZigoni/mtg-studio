/* prices.db (lecture seule) — blobs de séries [(jour_ordinal, prix)] :
   uint32 count en tête, puis n paires (int32 jour, float32 prix), little-endian. */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { PRICES_DB } from './paths.js';

let db = null;

export function pricesAvailable() {
  return fs.existsSync(PRICES_DB);
}

export function getPricesDb() {
  if (!db) db = new DatabaseSync(PRICES_DB, { readOnly: true });
  return db;
}

/** Décode un blob en [[jour_ordinal, prix], ...] trié. */
export function blobPoints(blob) {
  if (!blob) return [];
  const b = Buffer.from(blob);
  const n = b.readUInt32LE(0);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = [b.readInt32LE(4 + 8 * i), b.readFloatLE(8 + 8 * i)];
  return out;
}

/** Prix au dernier jour <= day (recherche binaire dans le blob). */
export function blobAt(blob, day) {
  if (!blob) return null;
  const b = Buffer.from(blob);
  const n = b.readUInt32LE(0);
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b.readInt32LE(4 + 8 * mid) <= day) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return null;
  return b.readFloatLE(8 + 8 * (lo - 1));
}

/** ordinal proleptique -> 'YYYY-MM-DD' (équivalent date.fromordinal().isoformat()) */
export function dayStr(day) {
  if (!day) return null;
  return new Date((Math.trunc(Number(day)) - 719163) * 86400000).toISOString().slice(0, 10);
}

/** ordinal du jour courant (date locale, comme date.today().toordinal()) */
export function todayOrdinal() {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000) + 719163;
}
