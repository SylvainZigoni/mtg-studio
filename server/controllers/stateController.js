/* Contrôleur /api/state — lecture/écriture de la base de saisies (mtg_data.db).
   POST n'accepte que les clés SYNC_KEYS ; chaque sauvegarde est snapshotée (garde-fou). */
import { getDb, SYNC_KEYS, MAX_SNAPSHOTS } from '../utils/db.js';
import { sendJson } from '../utils/http.js';

export function loadState() {
  const rows = getDb().prepare('SELECT k, v FROM state').all();
  return Object.fromEntries(rows.map(r => [r.k, r.v]));
}

export function saveState(data) {
  const db = getDb();
  const now = Date.now() / 1000;
  db.exec('BEGIN');
  try {
    const up = db.prepare(
      'INSERT INTO state (k, v, updated_at) VALUES (?,?,?) ' +
      'ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at'
    );
    for (const [k, v] of Object.entries(data)) {
      if (!SYNC_KEYS.includes(k)) continue;
      up.run(k, typeof v === 'string' ? v : JSON.stringify(v), now);
    }
    // snapshot complet (garde-fou anti fausse manip / corruption)
    const rows = db.prepare('SELECT k, v FROM state').all();
    db.prepare('INSERT INTO snapshots (ts, v) VALUES (?,?)')
      .run(now, JSON.stringify(Object.fromEntries(rows.map(r => [r.k, r.v]))));
    db.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)')
      .run(MAX_SNAPSHOTS);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getState(req, res) {
  sendJson(res, 200, { ok: true, state: loadState() });
}

export function postState(req, res) {
  try {
    if (req.bodyError) throw new Error(req.bodyError);
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('body must be an object');
    saveState(data);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e) });
  }
}
