# MTG Studio — règles et contexte pour l'agent

Application web locale de collection Magic: The Gathering + méta MTGTop8 2026.
Dossier : `App MTG`, lancée avec `node server/server.js` (ou `npm start`, Node >= 22.5, zéro dépendance npm), ouverte sur http://localhost:3000 (Ctrl+F5 pour vider le cache). Windows, machine de Sylvain.

## Fichiers

- `server/server.js` + `server/` : serveur HTTP **Node.js zéro dépendance** (`node:http` + `node:sqlite`), découpé en `routes/` (mapping méthode+path), `controllers/` (logique métier), `middleware/` (logger, body JSON, fichiers statiques), `utils/` (paths, db, pricesDb, http, oauth). Sert l'app (index.html, css/, js/) ET enregistre les saisies (collection, classeurs, matchs, tags, decks perso, réglages MKM) dans `mtg_data.db` (SQLite créé à côté, WAL). Les `*.db` ne sont PAS servis en HTTP. Port : `node server/server.js [port]` (3000 par défaut). Ne jamais suggérer `python -m http.server` (pas de POST).
- `package.json` : `"type": "module"`, `npm start` = `node server/server.js`.
- `index.html` + `css/` + `js/` : application monopage découplée (branche `dev-client`). `index.html` charge `css/reset.css` PUIS `css/app.css`, puis `<script type="module" src="js/main.js">`. Le client est découpé en modules ES : `js/main.js` (boot, routage, recherche globale), `js/ui.js`, `js/core/` (util, store, scryfall, model, decks, cards, registry — le registry `R`/`S` évite les imports circulaires entre vues), `js/views/` (collection, browse, decks, matches, stats, cardinfo, mydecks, market, statscoll, settings). **Toujours modifier index.html et js/ de façon cohérente** : un js/ récent avec un index.html ancien fait planter le boot avant tout fetch ("Chargement des 41 366 decks…" sans fin). `js/main.js` a un garde `if(!$('#sidebar') || !$('#burger'))` pour détecter ce cas.
- `mtgtop8.sqlite` : base du scraper MTGTop8 (tournois 2026, decks, cartes) ; servie à l'app par `GET /api/decks` (dataset JSON gzippé construit depuis la snapshot, cache en mémoire invalidé sur le mtime du .sqlite) et `GET /api/decks/meta`. `decks.json.gz` n'est plus utilisé par l'app.
- `prices.db` : historique de prix Cardmarket (SQLite, ~103 935 séries + 120 143 cartes, seed 14/11/2026).
- `price_seed.py` : construit/met à jour prices.db depuis MTGJSON. Modes : `prices` (re-seed complet), `cards`, `today` (appelé en arrière-plan par le serveur via POST /api/price/today), `weekly` (fusion fenêtre 3 mois, idempotent, auto-réparateur : comble tout trou ≤ 3 mois). Reste en Python (stdlib).
- `scraper.py` + `crawl.py` + `scrape_run.py` + `scrape_year.py` : scraper MTGTop8 -> `mtgtop8.sqlite` (servie à l'app via `/api/decks`). `scraper.py` scrappe l'année en cours (YEAR dynamique) ; `scrape_year.py <annee> <FORMAT> [secs]` scrappe une année x un format précis (anti-doublon par PK + INSERT OR IGNORE). (DB = `mtgtop8.sqlite` a cote, chemins relatifs au dossier). Lancable depuis l'app : POST /api/scrape -> spawn `scrape_run.py` (phase1 + crawl) en arriere-plan, log `scrape.log`, statut `scrape_status.json`, progression via GET /api/scrape/status. Bouton dans la vue Parametres.
- `mtgtop8.sqlite` : base brute des tournois.
- `README-APP.md` : mode d'emploi (3 niveaux de mise à jour).

## Architecture clé

- MTGJSON AllPrices ne fournit que ~3 mois d'historique → accumulation : point quotidien (today) + fusion weekly qui comble les trous ≤ 3 mois.
- Endpoints serveur Node (server/routes) : `/api/state` (GET/POST), `/api/health`, `/api/price` (?sfid=/?uuid=/?set=&cn=), `/api/market` (top/flop, fenêtres 1w/1m/1y/3y/5y/10y/rel, scope all|collection, cache 12h, clé cache = scope|w hors limit), `/api/collvalue`, `/api/setvalues` (valeur totale de chaque extension en 1 requête SQL depuis prices.db, cache 12h), `/api/pricerange` (min/max des prix pour la jauge de filtre), `/api/price/today` (GET et POST, spawn `python price_seed.py today` en arrière-plan), `/api/mkm/settings` (GET/POST), `/api/mkm/*` (POST, proxy OAuth 1.0a signé HMAC-SHA1 vers api.cardmarket.com). SYNC_KEYS = mtg_collection/mtg_binders/mtg_matches/mtg_custom_tags/mtg_decks. Fichiers statiques : / -> index.html, Last-Modified + 304, `Cache-Control: no-cache` sur le HTML.
     `/api/scrape` (POST, scraping année en cours tous formats) + `/api/scrape/one` (POST {year,format,seconds}, scraping ciblé) + `/api/scrape/status` (GET) + `/api/scrape/grid` (GET, nb de decks scrapés par format x année, lu dans la snapshot — tableau Paramètres) ; `/api/decks` + `/api/decks/meta` (GET) servent les decks à l'app depuis la snapshot SQLite
- Price blobs prices.db : uint32 count puis paires (int32 jour ordinal, float32 prix). `struct.iter_unpack` exige un slice exact `memoryview(blob)[4:4+8*n]`, prix à offset +4 dans l'enregistrement.
- Parsing JSON streaming (classe Stream dans price_seed.py) : virgules via skip_ws, chaînes/nombres coupés entre buffers, colonnes "set" quoted, fichiers MTGJSON enveloppés dans `data`.
- Client (js/) : `store.set` (js/core/store.js) ne fait pushState que si window.__booted. Index DECKS : d[3]=nom deck, d[4]=archétype, d[5]=joueur, d[9]=eid, d[10]/d[11]=main/side, d[12]=players. Caches sfCache/print par norm(name).
- Vues : burger/sidebar, recherche globale, decks perso (vMyDecks/openMyDeck, changelog, commentaires, autocomplete, comparaison collection), visualiseur partagé (dvGroup type/CMC, dvTab main/side, chartBars mana, chartDonut coûts/lands, deckLegalities), collection (NM, langues, signée, addedAt, badges RL), vMarket, vStatsColl, vSettings Cardmarket + CSV "a vendre", loadPriceChart/drawPriceChart via /api/price?sfid=.

## Pièges SQLite

- `set` est un mot-clé → toujours `"set"` quoted (valable aussi pour les requêtes node:sqlite dans server/).
- last_date a une affinité TEXT (int → text ; ex "739858").
- node:sqlite : blobs lus en Uint8Array (Buffer.from(blob)), `new DatabaseSync(path, {readOnly:true})` pour prices.db, `PRAGMA journal_mode=WAL` sur mtg_data.db. Les écritures sont synchrones (pas de lock nécessaire, la boucle d'événements sérialise).

## Décisions déjà prises (ne pas rouvrir sans demande)

- Decks MTGTop8 servis depuis la snapshot SQLite via `/api/decks` (décision 2026-11-17, remplace decks.json.gz).
- L'app reste locale ; pas d'exposition publique.
- Mise à jour hebdo des prix/decks gérée via `price_seed.py weekly` + Planificateur de tâches Windows (`0 9 * * 1` recommandé).
- Thèmes UI : `css/themes.css` (sélecteurs `html[data-theme="..."]`, chargé après `app.css`), liste/apply dans `js/core/themes.js`, sélecteur dans la vue Paramètres ; choix persisté en localStorage (`mtg_theme`) et appliqué avant peinture par un script inline dans `index.html` (anti-FOUC). Thème par défaut : `darkmode`.
