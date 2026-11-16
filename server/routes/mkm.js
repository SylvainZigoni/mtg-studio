import { getMkmSettings, postMkmSettings, mkmRoute } from '../controllers/mkmController.js';

export function registerMkmRoutes(app) {
  app.get('/api/mkm/settings', getMkmSettings);
  app.post('/api/mkm/settings', postMkmSettings);
  app.postPrefix('/api/mkm/', mkmRoute); // /api/mkm/test, /vacation, /articles, /find_product, /article...
}
