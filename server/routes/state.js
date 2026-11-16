import { getState, postState } from '../controllers/stateController.js';

export function registerStateRoutes(app) {
  app.get('/api/state', getState);
  app.post('/api/state', postState);
}
