/* Worker de calcul du "playable" : connexions readOnly dédiées, le thread
   principal reste réactif pendant le scan (~30-40 s sur 200k+ decks). */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { buildPlayable } from './playable.js';

try {
  const c = new DatabaseSync(workerData.SNAPSHOT_DB, { readOnly: true });
  const list = buildPlayable(c);
  c.close();
  parentPort.postMessage({ key: workerData.key, builtAt: Date.now(), list });
} catch (e) {
  parentPort.postMessage({ key: workerData.key, error: String(e && e.message || e) });
}
