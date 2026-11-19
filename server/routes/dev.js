/* Routes dev : live reload (SSE). App locale uniquement (listen 127.0.0.1). */
import { livereloadSse, livereloadEnabled } from '../utils/livereload.js';

export function registerDevRoutes(app) {
  app.get('/api/dev/livereload', livereloadSse);
  app.get('/api/dev/livereload/status', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, enabled: livereloadEnabled }));
  });
}
