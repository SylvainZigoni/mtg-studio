import { apiScrapeStart, apiScrapeStatus, apiScrapeExport } from '../controllers/scrapeController.js';

export function registerScrapeRoutes(app) {
  app.get('/api/scrape/status', apiScrapeStatus);
  app.post('/api/scrape', apiScrapeStart);
  app.post('/api/scrape/export', apiScrapeExport);
}
