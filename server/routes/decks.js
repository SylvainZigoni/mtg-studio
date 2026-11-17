import { apiDecks, apiDecksMeta } from '../controllers/decksController.js';

export function registerDecksRoutes(app) {
  app.get('/api/decks/meta', apiDecksMeta);
  app.get('/api/decks', apiDecks);
}
