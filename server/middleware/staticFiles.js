/* Sert les fichiers statiques de l'app depuis la racine du projet
   (équivalent SimpleHTTPRequestHandler de server.py, avec les mêmes idées :
   / -> index.html, Last-Modified + If-Modified-Since -> 304, no-cache sur le HTML).
   Les *.db ne sont PAS servis (données personnelles). */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../utils/paths.js';
import { sendJson } from '../utils/http.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function staticFiles(req, res) {
  let p;
  try {
    p = decodeURIComponent(req.path);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad request' });
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    return sendJson(res, 403, { ok: false, error: 'forbidden' });
  }
  // jamais de base servie en HTTP : .db, .sqlite, .sqlite3 + sidecars WAL (-wal/-shm/-journal)
  if (/\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/i.test(file)) {
    return sendJson(res, 404, { ok: false, error: 'not found' });
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { ok: false, error: 'not found' });
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': st.mtime.toUTCString(),
    };
    // l'app est une page vivante : pas de cache agressif sur le HTML
    if (p === '/' || p === '/index.html' || p.endsWith('.html')) headers['Cache-Control'] = 'no-cache';
    const ims = req.headers['if-modified-since'];
    if (ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(new Date(ims).getTime() / 1000)) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
