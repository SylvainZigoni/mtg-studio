/* Mini routeur : middlewares en chaîne, routes exactes (method + path),
   routes préfixe (postPrefix), puis fallback (statique GET / 404 JSON). */
import { parseQuery, sendJson } from './utils/http.js';

export function createApp() {
  const middlewares = [];
  const routes = [];
  let fallback = (req, res) => sendJson(res, 404, { ok: false, error: 'not found' });

  const app = {
    use(fn) { middlewares.push(fn); },
    get(path, handler) { routes.push({ method: 'GET', path, handler }); },
    post(path, handler) { routes.push({ method: 'POST', path, handler }); },
    postPrefix(prefix, handler) { routes.push({ method: 'POST', path: prefix, handler, prefix: true }); },
    setFallback(fn) { fallback = fn; },

    async handle(req, res) {
      const qpos = req.url.indexOf('?');
      req.path = qpos < 0 ? req.url : req.url.slice(0, qpos);
      req.query = parseQuery(req.url);

      const runMiddleware = async i => {
        if (i < middlewares.length) return middlewares[i](req, res, err => runMiddleware(i + 1).catch(err2 => Promise.reject(err || err2)));
        const r = routes.find(r =>
          r.method === req.method && (r.prefix ? req.path.startsWith(r.path) : req.path === r.path));
        if (!r) return fallback(req, res);
        return r.handler(req, res);
      };

      try {
        await runMiddleware(0);
      } catch (e) {
        console.error(`[erreur] ${req.method} ${req.path} :`, e);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(e.message || e) });
        else res.end();
      }
    },
  };
  return app;
}
