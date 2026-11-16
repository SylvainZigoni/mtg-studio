import { apiPrice, apiMarket, apiCollvalue, apiSetvalues, apiPricerange, apiToday } from '../controllers/priceController.js';

export function registerPriceRoutes(app) {
  app.get('/api/price', apiPrice);
  app.get('/api/market', apiMarket);
  app.get('/api/collvalue', apiCollvalue);
  app.get('/api/setvalues', apiSetvalues);
  app.get('/api/pricerange', apiPricerange);
  app.get('/api/price/today', apiToday);
  app.post('/api/price/today', apiToday);
}
