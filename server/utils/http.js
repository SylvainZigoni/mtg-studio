/* Helpers HTTP : JSON, body, query string, encodage RFC3986 (comme urllib.parse.quote(s, '')) */
import zlib from 'node:zlib';

/** Seuil sous lequel on ne compresse pas (gzip coûteux sur les petites réponses). */
const GZIP_MIN = 1024;

/** Envoie une réponse JSON (équivalent _send_json de server.py).
    Compression gzip À LA VOLÉE si le client l'accepte (Accept-Encoding, lu via res.req posé dans app.js)
    et body >= GZIP_MIN : aucun artefact .gz à générer, la compression suit toujours les données fraîches
    (un ajout de prix invalide le cache mtime et la prochaine réponse est recompressée automatiquement). */
export function sendJson(res, code, obj) {
  let body = Buffer.from(JSON.stringify(obj), 'utf8'); // JSON.stringify garde l'unicode (ensure_ascii=False)
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Accept-Encoding',
  };
  const accept = String((res.req && res.req.headers['accept-encoding']) || '');
  if (body.length >= GZIP_MIN && /\bgzip\b/.test(accept)) {
    body = zlib.gzipSync(body, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(code, headers);
  res.end(body);
}

/** Plafond du body requêté (évite un OOM sur un gros POST). */
export const MAX_BODY = 10 * 1024 * 1024;   // 10 Mo

/** Lit le body brut de la requête, plafond maxBytes (reject avec code '413' si dépassé). */
export function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooBig = false;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes && !tooBig) {
        tooBig = true;
        reject(Object.assign(new Error('body too large'), { code: '413' }));
        req.removeAllListeners('data');   // on n'accumule plus
        req.resume();                      // on vide le stream pour laisser la réponse 413 passer
        return;
      }
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => { if (!tooBig) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** Query string -> objet clé -> première valeur (comme parse_qs(...)[k][0]). */
export function parseQuery(url) {
  const q = url.split('?')[1] || '';
  const out = {};
  if (!q) return out;
  for (const part of q.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    const v = decodeURIComponent(i < 0 ? '' : part.slice(i + 1).replace(/\+/g, ' '));
    if (!(k in out)) out[k] = v;
  }
  return out;
}

/** Encodage percent strict (safe='') : encodeURIComponent + ! ' ( ) * */
export const enc = s => encodeURIComponent(String(s))
  .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
