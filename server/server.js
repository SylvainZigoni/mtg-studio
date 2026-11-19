#!/usr/bin/env node
/* ============================================================
   MTG Studio — serveur de données (version 2026-11-16b, phase 2)
   ============================================================
   Serveur Node.js ZÉRO DÉPENDANCE (node:http + node:sqlite, Node >= 22.5).
   Sert l'app (index.html, css/, js/) ET enregistre les saisies
   (collection, classeurs, matchs, tags, decks perso, réglages Cardmarket)
   dans mtg_data.db (SQLite, à côté). Les prix sont lus dans prices.db
   (généré/maintenu par price_seed.py, resté en Python).

   Lancement :   node server/server.js          (port 3000)
                  node server/server.js 8000     (port personnalisé)
                  npm start
   Puis ouvrir :  http://localhost:3000

   API :
     GET  /api/health          -> {ok:true}
     GET  /api/state           -> {ok, state:{...}}
     POST /api/state           -> upsert des clés SYNC_KEYS (sauvegarde + snapshot)
     GET  /api/price?sfid=…    -> historique d'une carte (prices.db)
     GET  /api/market?w=&scope=&limit=   -> top/flop (cache 12h)
     GET  /api/collvalue       -> valorisation de la collection
     GET|POST /api/price/today -> lance price_seed.py today en arrière-plan
     GET|POST /api/mkm/settings, POST /api/mkm/* -> proxy signé OAuth Cardmarket
     GET|POST /api/scrape, GET /api/scrape/status -> scraping MTGTop8 année en cours (scrape_run.py : phase1 + crawl)
     POST /api/scrape/one {year,format,seconds}, GET /api/scrape/grid -> scraping ciblé année x format (scrape_year.py) + grille formats x années lue dans la snapshot
     GET  /api/decks         -> dataset decks depuis mtgtop8.sqlite (JSON gzippe, cache mtime)
     GET  /api/decks/meta    -> compteurs (decks/events/cartes/max date, par format)
   ============================================================ */
import http from 'node:http';
import { createApp } from './app.js';
import { registerRoutes } from './routes/index.js';
import { logger } from './middleware/logger.js';
import { jsonBody } from './middleware/jsonBody.js';
import { staticFiles } from './middleware/staticFiles.js';
import { sendJson } from './utils/http.js';
import { getDb } from './utils/db.js';
import { PORT, DB_PATH } from './utils/paths.js';

import { startLivereloadWatcher } from './utils/livereload.js';

getDb(); // initialise les tables si besoin

const app = createApp();
app.use(logger);
app.use(jsonBody);
registerRoutes(app);
app.setFallback((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') return staticFiles(req, res);
  sendJson(res, 404, { ok: false, error: 'unknown endpoint' });
});

const server = http.createServer((req, res) => { app.handle(req, res); });
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} déjà utilisé : un autre serveur MTG Studio tourne déjà (ou le port est pris). Arrêt.`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`MTG Studio : http://localhost:${PORT}`);
  console.log(`Données enregistrées dans : ${DB_PATH}`);
  startLivereloadWatcher();
});
process.on('SIGINT', () => { console.log('\nArrêt du serveur.'); server.close(() => process.exit(0)); });
