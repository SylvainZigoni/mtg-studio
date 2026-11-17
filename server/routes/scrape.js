import { apiScrapeStart, apiScrapeStatus } from '../controllers/scrapeController.js';

export function registerScrapeRoutes(app) {
  app.get('/api/scrape/status', apiScrapeStatus);
  app.post('/api/scrape', apiScrapeStart);
}
