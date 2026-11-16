import { sendJson } from '../utils/http.js';

export function registerHealthRoutes(app) {
  app.get('/api/health', (req, res) => sendJson(res, 200, { ok: true }));
}
