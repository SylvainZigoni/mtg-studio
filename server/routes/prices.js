import { apiPrice, apiPriceDays, apiPricesLast, apiMarket, apiMarketCards, apiMarketCardsStatus, apiMarketSets, apiCollvalue, apiSetvalues, apiPricerange, apiToday, apiPriceStatus, apiPriceSeed } from '../controllers/priceController.js';

export function registerPriceRoutes(app) {
  app.get('/api/price', apiPrice);
  app.get('/api/prices/last', apiPricesLast);
  app.get('/api/prices/days', apiPriceDays);
  app.get('/api/market', apiMarket);
  app.get('/api/market/cards', apiMarketCards);
  app.get('/api/market/cards/status', apiMarketCardsStatus);
  app.get('/api/market/sets', apiMarketSets);
  app.get('/api/collvalue', apiCollvalue);
  app.get('/api/setvalues', apiSetvalues);
  app.get('/api/pricerange', apiPricerange);
  app.get('/api/price/today', apiToday);
  app.get('/api/price/status', apiPriceStatus);
  app.post('/api/price/seed', apiPriceSeed);
  app.post('/api/price/today', apiToday);
}
