import { apiDecks, apiDecksMeta, apiDecksSearch, apiDecksOne, apiDecksStats } from '../controllers/decksController.js';

export function registerDecksRoutes(app) {
  app.get('/api/decks/meta', apiDecksMeta);
  app.get('/api/decks/search', apiDecksSearch);
  app.get('/api/decks/stats', apiDecksStats);
  app.get('/api/decks/deck', apiDecksOne);
  app.get('/api/decks', apiDecks);
}
