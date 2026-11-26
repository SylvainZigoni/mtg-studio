import { apiDecksMeta, apiDecksCardNames, apiDecksSearch, apiDecksOne, apiDecksStats, apiDecksPlayable, apiDecksArch, apiDecksTopCards } from '../controllers/decksController.js';

export function registerDecksRoutes(app) {
  app.get('/api/decks/meta', apiDecksMeta);
  app.get('/api/decks/cardnames', apiDecksCardNames);
  app.get('/api/decks/search', apiDecksSearch);
  app.get('/api/decks/stats', apiDecksStats);
  app.get('/api/decks/playable', apiDecksPlayable);
  app.get('/api/decks/arch', apiDecksArch);
  app.get('/api/decks/topcards', apiDecksTopCards);
  app.get('/api/decks/deck', apiDecksOne);
}
