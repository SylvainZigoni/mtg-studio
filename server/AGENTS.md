# server/ — règles spécifiques au serveur Node

AGENTS.md imbriqué : chargé automatiquement par Vibe quand on touche un fichier de `server/`.
Règles générales : `AGENTS.md` racine + `gotchas.md` (lu avant toute tâche). Endpoints et schémas des bases : `API.md`.

- Structure : `server.js` (bootstrap) + `app.js` (mini-routeur : middlewares en chaîne, routes exactes, `postPrefix`, fallback statique) ; une `register*Routes(app)` par fichier dans `routes/` → contrôleurs dans `controllers/` ; middlewares dans `middleware/` ; utilitaires dans `utils/`.
- Réponses : `{ok:true,…}` / `{ok:false,error}` ; codes 400 (params), 404 (inconnu), 409 (déjà en cours), 500 (erreur interne), 501 (non implémenté), 502 (calcul en échec), 503 (base absente — le message dit quelle commande lancer).
- Body POST : parsé une seule fois par `middleware/jsonBody.js` via `readBody(req)` (`utils/http.js`), **plafonné à 10 Mo → 413**, lu même sans Content-Length (chunked).
- SQLite (pièges dans `gotchas.md` → « Bases de données ») : `"set"` toujours quoté ; paramètres **bindés** (`?`), jamais de concaténation de valeurs utilisateur ; `new DatabaseSync(path)` pour `mtg_data.db` (`PRAGMA journal_mode=WAL`), `{readOnly:true}` pour `prices.db` / `mtgtop8.sqlite` ; blobs lus en `Uint8Array` (`Buffer.from`).
- Caches : invalidés par le **mtime des fichiers lus** — `dataMtimeMs()` (`utils/db.js` : mtg_data.db + `-wal`/`-shm`) et `pricesMtimeMs()` (`controllers/priceController.js` : prices.db + `-wal`/`-shm`) ; TTL max 12 h (`MARKET_TTL`). Le WAL fait que le mtime du `.db` seul ne suffit jamais.
- Statique : `middleware/staticFiles.js` — `/` → `index.html` (`Cache-Control: no-cache`), autres fichiers `Last-Modified` + 304 ; **les `*.db` ne sont jamais servis** (404) ; les `*.db` ne sont jamais commitées (`.gitignore`) ; ne jamais lire/éditer les `.env`.
- Scripts Python en arrière-plan (scrape/prix) : pattern `spawn('python', …)` + fichier de statut + 409 si déjà en cours — voir `scrapeController.js` et `priceController.js`.
- Avant de livrer : skill `test-smoke` (boot sur port 3999 + curl des endpoints touchés) ; tout endpoint ajouté/modifié/supprimé → skill `api-design` + `API.md` §2/§3 **dans le même commit** (skill `docs-update`).
