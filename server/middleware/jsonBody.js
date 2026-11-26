/* Parse le body JSON des requêtes POST/PUT/DELETE une seule fois (req.body).
   En cas d'erreur de parse, req.bodyError est renseigné (les contrôleurs répondent 400).
   Le body est lu même sans Content-Length (chunked), avec un plafond de 10 Mo (413). */
import { readBody, sendJson } from '../utils/http.js';

export function jsonBody(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  readBody(req).then(buf => {
    try {
      req.body = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      req.body = undefined;
      req.bodyError = String(e.message || e);
    }
    next();
  }).catch(e => {
    if (e && e.code === '413') return sendJson(res, 413, { ok: false, error: 'body trop volumineux (> 10 Mo)' });
    next(e);
  });
}
