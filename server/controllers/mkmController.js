/* Contrôleur Cardmarket : réglages stockés dans mtg_data.db + proxy signé OAuth 1.0a
   vers https://api.cardmarket.com/ws/v2.0 (l'API refuse les appels navigateur : pas de CORS).
   Port fidèle de mkm_settings / mkm_save / mkm_request / mkm_route de server.py. */
import https from 'node:https';
import { getDb } from '../utils/db.js';
import { sendJson, enc } from '../utils/http.js';
import { mkmOauthHeader } from '../utils/oauth.js';

const MKM_BASE = 'https://api.cardmarket.com/ws/v2.0';
export const MKM_KEYS = ['app_token', 'app_secret', 'access_token', 'access_secret', 'username'];

export function mkmSettings() {
  const rows = getDb().prepare('SELECT k, v FROM mkm_settings').all();
  return Object.fromEntries(rows.map(r => [r.k, r.v]));
}

export function getMkmSettings(req, res) {
  const s = mkmSettings();
  sendJson(res, 200, {
    ok: true,
    present: Object.fromEntries(MKM_KEYS.map(k => [k, !!s[k]])),
    username: s.username || '',
  });
}

export function postMkmSettings(req, res) {
  try {
    if (req.bodyError) throw new Error(req.bodyError);
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('body must be an object');
    const db = getDb();
    const up = db.prepare('INSERT INTO mkm_settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
    for (const [k, v] of Object.entries(data)) {
      if (MKM_KEYS.includes(k) && v) up.run(k, String(v));
    }
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e) });
  }
}

/** Appel signé à l'API Cardmarket. Retourne {status, json}. */
function mkmRequest(method, path, params = null, body = null) {
  const s = mkmSettings();
  if (!['app_token', 'app_secret', 'access_token', 'access_secret'].every(k => s[k])) {
    return Promise.resolve({ status: 400, json: { ok: false, error: 'Identifiants Cardmarket incomplets (voir Paramètres).' } });
  }
  const [url, header] = mkmOauthHeader(method, MKM_BASE + path, s, params);
  const data = body != null ? Buffer.from(JSON.stringify(body), 'utf8') : null;
  return new Promise(resolve => {
    const req = https.request(url, {
      method: method.toUpperCase(),
      timeout: 30000,
      headers: {
        'Authorization': header,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let j;
        try { j = JSON.parse(raw); } catch { j = { raw }; }
        if (res.statusCode >= 400) {
          const payload = (j && typeof j === 'object') ? j : {};
          resolve({ status: res.statusCode, json: { ok: false, error: payload.error || j, status: res.statusCode } });
        } else {
          resolve({ status: res.statusCode, json: j });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ status: 0, json: { ok: false, error: String(e.message || e) } }));
    if (data) req.write(data);
    req.end();
  });
}

/** Routage des actions Cardmarket demandées par l'app. */
export async function mkmRoute(req, res) {
  try {
    if (req.bodyError) throw new Error(req.bodyError);
    const payload = req.body || {};
    const path = req.path;
    const sub = path.slice('/api/mkm/'.length);
    const username = mkmSettings().username || '';
    let st, j;
    if (sub === 'test') {
      ({ status: st, json: j } = await mkmRequest('GET', `/users/${enc(username)}`));
      return sendJson(res, st || 502, {
        ok: st === 200, status: st,
        user: (j && j.user && j.user.username) || null,
        error: j && j.error != null ? j.error : null,
      });
    }
    if (sub === 'vacation') {
      const on = payload.on ? 1 : 0;
      ({ status: st, json: j } = await mkmRequest('PUT', `/users/${enc(username)}/vacation`, null, { vacation: on }));
      return sendJson(res, st || 502, { ok: st === 200, status: st, response: st !== 200 ? j : { vacation: on } });
    }
    if (sub === 'articles') {
      ({ status: st, json: j } = await mkmRequest('GET', `/users/${enc(username)}/articles`));
      if (st !== 200) return sendJson(res, st || 502, { ok: false, error: (j && j.error) || j });
      const arts = (j && j.article) || [];
      return sendJson(res, 200, { ok: true, articles: arts, count: (j && j.nbArticles) != null ? j.nbArticles : arts.length });
    }
    if (sub === 'find_product') {
      ({ status: st, json: j } = await mkmRequest('GET', '/products/find', { search: payload.search || '', idGame: 1, idLanguage: 1, exact: 'false' }));
      if (st !== 200 || !j || typeof j !== 'object') return sendJson(res, st || 502, { ok: false, error: (j && j.error) || j });
      return sendJson(res, 200, { ok: true, products: j.product || [] });
    }
    if (sub === 'article') {
      // création d'une annonce : idProduct, count, price, language, condition, comments, isFoil, isSigned...
      ({ status: st, json: j } = await mkmRequest('POST', `/users/${enc(username)}/articles`, null, payload.article));
      return sendJson(res, st || 502, { ok: st === 200 || st === 201, status: st, response: j });
    }
    if (sub.startsWith('article/')) {
      const aid = sub.split('/')[1];
      if (!/^\d+$/.test(aid || '')) return sendJson(res, 400, { ok: false, error: 'aid invalide (nombre attendu)' });
      if (payload._delete) {
        ({ status: st, json: j } = await mkmRequest('DELETE', `/users/${enc(username)}/article/${enc(aid)}`));
      } else {
        ({ status: st, json: j } = await mkmRequest('PUT', `/users/${enc(username)}/article/${enc(aid)}`, null, payload.article));
      }
      return sendJson(res, st || 502, { ok: st === 200, status: st, response: j });
    }
    sendJson(res, 404, { ok: false, error: 'endpoint inconnu' });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e) });
  }
}
