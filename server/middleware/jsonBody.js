/* Parse le body JSON des requêtes POST/PUT/DELETE une seule fois (req.body).
   En cas d'erreur de parse, req.bodyError est renseigné (les contrôleurs répondent 400). */
import { readBody } from '../utils/http.js';

export function jsonBody(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const len = Number(req.headers['content-length'] || 0);
  if (!len) { req.body = {}; return next(); }
  readBody(req).then(buf => {
    try {
      req.body = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      req.body = undefined;
      req.bodyError = String(e.message || e);
    }
    next();
  }).catch(next);
}
