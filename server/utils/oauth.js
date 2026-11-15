/* Signature OAuth 1.0a HMAC-SHA1 pour l'API Cardmarket (port de _mkm_oauth_header de server.py) */
import crypto from 'node:crypto';
import { enc } from './http.js';

/**
 * Retourne [url, headerAuthorization].
 * method: 'GET'|'POST'|..., url: URL de base sans query, s: réglages mkm,
 * params: paramètres de requête inclus dans la signature (et ajoutés à l'URL).
 */
export function mkmOauthHeader(method, url, s, params = null) {
  const items = {
    oauth_consumer_key: s.app_token || '',
    oauth_token: s.access_token || '',
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: crypto.randomBytes(8).toString('hex'),
    oauth_version: '1.0',
  };
  const allp = { ...items };
  for (const [k, v] of Object.entries(params || {})) allp[k] = String(v);
  const baseParams = Object.keys(allp).sort()
    .map(k => `${enc(k)}=${enc(allp[k])}`).join('&');
  const baseUrl = url.split('?')[0];
  let finalUrl = baseUrl;
  if (params) {
    const qs = Object.keys(params).sort()
      .map(k => `${enc(k)}=${enc(String(params[k]))}`).join('&');
    finalUrl = `${baseUrl}?${qs}`;
  }
  const base = [method.toUpperCase(), baseUrl, baseParams].map(enc).join('&');
  const key = `${enc(s.app_secret || '')}&${enc(s.access_secret || '')}`;
  const sig = crypto.createHmac('sha1', key).update(base, 'utf8').digest('base64');
  const header = 'OAuth ' + Object.entries(items).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ')
    + `, oauth_signature="${enc(sig)}"`;
  return [finalUrl, header];
}
