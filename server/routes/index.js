/* Enregistrement de toutes les routes de l'API */
import { registerHealthRoutes } from './health.js';
import { registerStateRoutes } from './state.js';
import { registerPriceRoutes } from './prices.js';
import { registerMkmRoutes } from './mkm.js';
import { registerScrapeRoutes } from './scrape.js';

export function registerRoutes(app) {
  registerHealthRoutes(app);
  registerStateRoutes(app);
  registerPriceRoutes(app);
  registerMkmRoutes(app);
  registerScrapeRoutes(app);
}
