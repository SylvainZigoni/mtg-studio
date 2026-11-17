import { apiScrapeStart, apiScrapeStatus, apiScrapeOne, apiScrapeGrid } from '../controllers/scrapeController.js';

export function registerScrapeRoutes(app) {
  app.get('/api/scrape/status', apiScrapeStatus);
  app.post('/api/scrape', apiScrapeStart);
  app.post('/api/scrape/one', apiScrapeOne);
  app.get('/api/scrape/grid', apiScrapeGrid);
}
