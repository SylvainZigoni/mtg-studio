/* Live reload dev (zéro dépendance) :
   - fs.watch sur index.html, js/ et css/ -> bump d'une version + notification SSE
   - GET /api/dev/livereload : flux Server-Sent Events pour le client (js/core/livereload.js)
   Le serveur n'écoute que sur 127.0.0.1 (app 100% locale) : aucun risque d'exposition.
   Désactivable avec LIVERELOAD=0 (ou LIVERELOAD=off). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './paths.js';

export const livereloadEnabled = !['0', 'off', 'false'].includes(String(process.env.LIVERELOAD || '').toLowerCase());

const clients = new Set();
const state = { bootId: crypto.randomUUID(), version: 0 };

function notify(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

let debounce = null;
function onFsEvent(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!['.js', '.css', '.html'].includes(ext)) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state.version++;
    console.log(`[livereload] ${filename} modifié (v${state.version}) -> reload page`);
    notify('change', { bootId: state.bootId, version: state.version, file: filename });
  }, 150);
}

export function startLivereloadWatcher() {
  if (!livereloadEnabled) return;
  const targets = [
    { p: path.join(ROOT, 'index.html'), recursive: false },
    { p: path.join(ROOT, 'js'), recursive: true },
    { p: path.join(ROOT, 'css'), recursive: true },
  ];
  for (const t of targets) {
    try {
      fs.watch(t.p, { recursive: t.recursive }, (_evt, filename) => onFsEvent(filename));
    } catch (e) {
      console.error(`[livereload] watch impossible sur ${t.p} : ${e.message}`);
    }
  }
  console.log('[livereload] actif : la page se recharge automatiquement quand index.html, js/ ou css/ change (LIVERELOAD=0 pour désactiver)');
}

export function livereloadSse(req, res) {
  if (!livereloadEnabled) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'livereload désactivé' }));
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // hello immédiat : le client mémorise bootId+version ; si un change a eu lieu
  // pendant une déconnexion, le prochain hello aura une version différente -> reload.
  res.write(`event: hello\ndata: ${JSON.stringify({ bootId: state.bootId, version: state.version })}\n\n`);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* client parti */ } }, 15000);
  clients.add(res);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}
