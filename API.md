# API.md — source de vérité des endpoints et des sources de données

Serveur : `node server/server.js [port]` (défaut **3000**, Node ≥ 22.5, **zéro dépendance npm**).
Routes enregistrées dans `server/routes/index.js` (une `register*Routes(app)` par fichier dans `server/routes/`) → contrôleurs dans `server/controllers/`.

**Rôle** : source de vérité des endpoints et des sources de données — tout endpoint ajouté/modifié/supprimé est documenté ici (§2 + §3) dans le même commit que le code (skills `api-design` + `docs-update`).

**Règle d'or** : toute donnée affichée dans l'app provient d'une des 3 bases locales ci-dessous
(ou de l'API Scryfall, côté client uniquement, pour les métadonnées). Ne jamais « recoder avec une
autre source » : lire cette table avant toute nouvelle fonctionnalité.

---

## 0. Les 3 bases de données (où sont les données)

| Fichier | Rôle | Alimentation | Servie en HTTP ? |
|---|---|---|---|
| `mtg_data.db` | état de l'app : collection, classeurs, matchs, tags, decks perso, réglages MKM | POST `/api/state` (app) | **NON** (`*.db` bloqués par le middleware statique) |
| `prices.db` | **prix Cardmarket de TOUTES les cartes papier** + métadonnées cartes (`cards`) + séries temporelles (`series`) | `price_seed.py` depuis MTGJSON (`today` quotidien, `weekly` fusion 3 mois) | NON, mais exposée via les endpoints `/api/price*` ci-dessous |
| `mtgtop8.sqlite` | tournois/decks MTGTop8 2026 (papier uniquement) | `scraper.py` / `scrape_run.py` / `scrape_year.py` | NON, exposée via `/api/decks*` |

Schémas :

- `mtg_data.db` : `state(k PK, v JSON, updated_at)` — clés synchronisées `SYNC_KEYS` = `mtg_collection`, `mtg_binders`, `mtg_matches`, `mtg_custom_tags`, `mtg_decks` ; `snapshots` (garde-fou des sauvegardes) ; `mkm_settings`.
- `prices.db` :
  - `cards(scryfall_id PK, uuid, name, "set", cn, released_at, artist, colors, type_line, cmc, rarity, image, reserved, lang)` — 100 % **papier** (> 110 000 cartes), `reserved` seedé via Scryfall `is:reserved` (MTGJSON v5 n'a plus le champ).
  - `series(uuid PK, normal BLOB, foil BLOB, last_norm, last_foil, last_date)` — lien `cards.uuid = series.uuid`.
  - `meta(k, v)` — `today_done`, `last_weekly`, `run` (pid en cours).
  - **Blob de prix** : `uint32 count` (little-endian) puis `count` paires `(int32 jour_ordinal, float32 prix)` triées par jour. Décodage Node : `server/utils/pricesDb.js` (`blobPoints`, `blobAt`).
  - Pièges SQLite (`"set"` à quoter, `last_date` TEXT) : voir `gotchas.md` → « Bases de données ».
- `mtgtop8.sqlite` : `formats`, `events(eid PK, …, fetched)`, `decks(did PK, eid, …, fetched)`, `deck_cards(did, board, card, qty)`, + recherche par carte : index `ix_cards_card` (utilisé par le filtre `card=` exact) ; `cards(card PK)` + `cards_fts` (FTS5 trigram) + triggers `cards_ai`/`cards_fts_ai` = dictionnaire des noms maintenu pour une future autocomplétion — migration one-shot `PRAGMA user_version=2` (backfill dans `db()` de `scraper.py`, **commit explicite** requis).

**Jours** : ordinals proleptiques (ex. 739939 = 2026-11-19) ; conversion `dayStr()` côté serveur, `ordOf()/isoOf()` côté client (`js/core/pricedb.js`). Décalage de publication MTGJSON (1 jour) : `gotchas.md` → « Données externes ».

**Source de vérité côté client pour les prix affichés** : `GET /api/prices/last` → map `scryfall_id -> [last_norm, last_foil]`, chargée au boot dans `js/core/pricedb.js` (`dbPrice(sfid, foil)`). Repli Scryfall UNIQUEMENT pour le calcul de valeur de set si `prices.db` absent.

**Images** : dérivées du `scryfall_id` — `https://cards.scryfall.io/<size>/front/<c1>/<c2>/<uuid>.jpg` (1 caractère par dossier, testé 200 en HEAD). **Drapeaux de langue** : `/assets/icons/flags/<code>.svg` (statique, helper `langFlagHTML(code)` dans `js/core/util.js`).

**Scryfall (API externe, client uniquement)** : métadonnées, recherche avancée, autocomplétion — toujours avec `game:paper` (`paper()` dans `js/core/scryfall.js`). Ne JAMAIS scanner Scryfall pour les prix ou la recherche Marché (trop lent) : tout est dans `prices.db`.

---

## 1. Conventions

- Réponses JSON : `{ ok: true, … }` ; erreurs `{ ok: false, error }` avec 400 (params), 404 (inconnu), 409 (déjà en cours), 500 (erreur interne), 501 (non implémenté), 502 (calcul en échec), 503 (base absente — message dit quoi lancer).
- Caches serveur : TTL 12 h (`MARKET_TTL`), invalidés par le **mtime des fichiers lus** (`prices.db` + `mtg_data.db` pour le marché, `mtgtop8.sqlite` pour les decks) — piège WAL (mtime `-wal`/`-shm`, `dataMtimeMs()`) : `gotchas.md` → « Caches & mtime ».
- Fichiers statiques : `/` → `index.html` (`Cache-Control: no-cache`), autres fichiers avec `Last-Modified` + `304` ; **les `*.db` ne sont jamais servis**.

---

## 2. Endpoints

### Santé & état

| Route | Params | Réponse | Source |
|---|---|---|---|
| `GET /api/health` | — | `{ok:true}` | — |
| `GET /api/state` | — | `{ok, state:{…}}` (toutes les clés) | `mtg_data.db.state` |
| `POST /api/state` | body `{clé: valeur}` (clés limitées à `SYNC_KEYS`) | `{ok:true}` ; chaque save est snapshotée | `mtg_data.db.state` + `snapshots` |

### Prix — historique d'une carte

| Route | Params | Réponse | Source |
|---|---|---|---|
| `GET /api/price` | `?sfid=` **ou** `?uuid=` **ou** `?set=&cn=` | `{ok, uuid, normal:[["YYYY-MM-DD", prix]…], foil:[[…]…], last, last_date}` (404 si carte/série inconnue) | `prices.db` `cards`+`series` |

### Prix — maps globales (boot client)

| Route | Params | Réponse | Source |
|---|---|---|---|
| `GET /api/prices/last` | — | `{ok, lastPoint:"YYYY-MM-DD", n, map:{scryfall_id:[last_norm, last_foil]}}` — **SOURCE UNIQUE des prix affichés** (`js/core/pricedb.js`) | `prices.db` `series.last_*`, cache mtime |
| `GET /api/prices/days` | — | `{ok, from, to, n, days:[ordinal…]}` — jours historisés (timeline vert/rouge + jauge de dates) | union des jours des blobs `series` |

### Marché

| Route | Params | Réponse | Source |
|---|---|---|---|
| `GET /api/market` | `?w=1w\|1m\|1y\|3y\|5y\|10y\|rel` (défaut 1m), `&scope=all\|collection`, `&limit=` (≤50, défaut 20) | `{ok, w, scope, n, top:[{name,set,cn,now,was,pct,qty,foil,sfid}]…, flop:[…]}` ; `rel` = 1er point de la série | `prices.db` + collection (`mtg_data.db`) si scope=collection ; cache 12 h clé `scope\|w` |
| `GET /api/market/cards` | `from`,`to` (ordinals, requis) + filtres `name, artist, set, colors=W,U,…, types, cmc` (`7+` ok), `reserved=1`, `scope=collection`, `foil=0\|1` (défaut tous), tri `sort=name\|set\|rarity\|qty\|was\|now\|pct\|flat\|impact\|foil` + `dir=asc\|desc`, `page`, `limit` (5–100, défaut 25) | `{ok, from, to, total, page, pages, limit, kpi:{n,up,down,flat,median,avg, tot:{was,flat,pct}, upSum,downSum, top3[], flop3[], coll:{n,was,now,flat,pct}}, hist:[{lo,hi,n}], index:[[iso,val]], totalSeries:[[iso,€]], rows:[{sfid,name,set,cn,rarity,lang,img,img_lg,foil,qty,was,now,pct,flat,impact,spark:[[iso,€]]}]}` — **1 ligne par finition ayant un blob de prix** ; recherche 100 % locale | `prices.db.cards` LEFT JOIN `series` ; qté collection résolue par `(set,cn,foil)` → `scryfall_id` (`resolveCollSfid`) ; cache 12 h invalidé par mtime `prices.db` **et** `mtg_data.db` + `-wal`/`-shm` (WAL, `dataMtimeMs()`) |
| `GET /api/market/cards/status` | — | `{ok, running, phase, page, cards, since}` (poll pendant le calcul) | mémoire serveur |
| `GET /api/market/sets` | `from`,`to` (ordinals, requis) | `{ok, from, to, n, sets:[{set,n,was,now,flat,pct,impact}]}` — coût d'une édition = somme des prix à `from` (« avant ») puis `to` (« après »), **1 valorisation par impression et par finition** — normal + foil si prix foil dispo (même dédup \`(LOWER(name),\"set\",cn)\` que \`/api/market/cards\`, anglais préféré ; une carte imprimée en plusieurs langues n'est comptée qu'une fois par finition) ; `was` = `blobAt(from)`, repli 1er prix valide dans `[from,to]` ; `impact` = Σ (flat × qté) des entrées collection de l'édition, flat sur la **finition possédée** (résolue par `(set,cn)` → scryfall_id) — cohérent avec le KPI impact de la vue Cartes ; `pct` en fraction | `prices.db` + collection (`mtg_data.db`) ; cache 12 h invalidé par mtime `prices.db` **et** `mtg_data.db` + `-wal`/`-shm` (WAL, `dataMtimeMs()`) |
| `GET /api/collvalue` | — | `{ok, now, past:{w1,m1,m3,y1,y3,y5,y10}, matched, total}` — valeur de la collection maintenant et aux fenêtres passées | `prices.db` + `mtg_data.db` |
| `GET /api/setvalues` | — | `{ok, n, values:{CODE: €}}` — valeur totale par extension en 1 requête | `prices.db` (cache 12 h) |
| `GET /api/pricerange` | — | `{ok, min, max}` — bornes des prix (jauge de filtre) | `prices.db` `series` (cache 12 h) |

Seuils « aberrant » : `gotchas.md` → « Prix » (`<= 0 €` ignoré, vrais prix bas 0,02–0,09 € comptés). Si aucun prix valide à `from`, « avant » = 1er prix valide dans `[from, to]`.

### Mise à jour de prices.db (boutons Paramètres)

| Route | Params | Réponse | Source |
|---|---|---|---|
| `GET /api/price/status` | — | `{ok, cards, series, lastPoint, todayDone, lastWeekly, run, mtime}` | `prices.db` `meta` + compteurs |
| `POST /api/price/seed` | body `{mode: today\|weekly\|prices\|cards}` (défaut today) | `{ok, started, mode}` ; spawn `python price_seed.py <mode>` en arrière-plan (409 si déjà en cours, lu dans `meta.run`) | MTGJSON via `price_seed.py`, log `price_seed.log` |
| `GET\|POST /api/price/today` | — | `{ok, started:true}` ; spawn `price_seed.py today` (point quotidien AllPricesToday) | MTGJSON |

### Decks MTGTop8

| Route | Params | Réponse | Source |
|---|---|---|---|
| `GET /api/decks/meta` | — | `{ok, decks, events, cards, maxDate, minDate, formats:[{code,name,events,decks}]}` — compteurs (loader + panneau scraping) | `mtgtop8.sqlite` |
| `GET /api/decks/names` | `kind=card\|player` (requis, 400 sinon), `q` (≥ 3 cars → FTS5 trigram `cards_fts`/`decks_fts`, sinon LIKE sur `cards`/`decks`) | `{ok, kind, names:[…]}` (max 12) — autocomplétion des recherches joueur/carte : uniquement des valeurs présentes dans la base (cartes de `deck_cards`, joueurs de `decks`) | `mtgtop8.sqlite` ; 503 si absente |
| `GET /api/decks/search` | `view=events\|decks` (défaut events), `fmt` (CSV), `q` (≥ 3 cars → FTS5 trigram `decks_fts`, sinon LIKE), `card` (**view=decks uniquement** : nom exact, casse ignorée — `card = ? COLLATE NOCASE` sur `deck_cards` via `ix_cards_card` ; nom inconnu = 0 deck), `dateFrom`, `dateTo`, `players=gt19\|gt49\|gt99\|gt199`, `eid`, `arch` (« (sans archétype) » accepté), `sort` (decks : date\|rank\|name\|arch\|player\|players\|fmt\|evname ; events : date\|players\|name\|place\|fmt), `dir=asc\|desc`, `page` (défaut 1), `limit` (1–200, défaut 25), keyset `afterDate`+`afterId` (tri date) | `{ok, view, total, eventsTotal\|decksTotal, archs:[{fmt,arch,n}], page, limit, rows}` — view=decks : rows = tableaux 13 champs (main/side vides) ; view=events : rows = `{eid,fmt,name,place,date,players,decks}`. Cache des COUNT invalidé par version de la base (`COUNT\|MAX(did)`) | `mtgtop8.sqlite` (`fetched=1`) ; 503 si absente |
| `GET /api/decks/deck` | `did` (requis ; 400 sinon) | `{ok, deck:[13 champs avec main/side]}` — 404 si introuvable. Index 13 champs : d[0]=did, d[1]=format, d[2]=rank, d[3]=deck_name, d[4]=archetype, d[5]=player, d[6]=event, d[7]=place, d[8]=event_date, d[9]=eid, d[10]=main, d[11]=side, d[12]=players | `mtgtop8.sqlite` |
| `GET /api/decks/stats` | `fmt` (optionnel) | `{ok, fmt, total, archetypes:[{arch,n}] (top 500), formats:[{code,n}]}` | `mtgtop8.sqlite` |
| `GET /api/decks/playable` | `fmt=ALL\|CODE`, `minPct=0..100`, `q=`, `withSide=1`, `sort=pct\|date\|players`, `page`, `limit` (1–500, défaut 200) | decks « jouables » vs collection, calculés côté serveur en **worker** ; cache clé = version snapshot + mtime collection (`dataMtimeMs()`). `{ok, total, page, limit, cached, stale, builtAt, rows:[{did, pct, missing, d:[13 champs]}]}` ; **202 `{ok:false, building:true}`** si aucun cache (le client réessaie) | `mtgtop8.sqlite` + `mtg_data.db` |
| `GET /api/decks/arch` | `fmt` (requis ; 400 sinon), `arch`, `side=1` | `{ok, fmt, arch, side, total, cards:[{card, decks, qty}] (top 200)}` — cartes agrégées de l'archétype (board main, + side si `side=1`) | `mtgtop8.sqlite` |
| `GET /api/decks/topcards` | `fmt`, `dateFrom`, `dateTo`, `limit` (défaut 24, max 200) | `{ok, totalDecks, cards:[{card, qty}]}` — cartes les plus jouées (main) sur la période | `mtgtop8.sqlite` |

### Scraping MTGTop8 (boutons Paramètres)

| Route | Params | Réponse | Source |
|---|---|---|---|
| `POST /api/scrape` | body `{seconds}` (défaut 3600, min 60) | `{ok, started, seconds}` ; spawn `scrape_run.py` (409 si déjà en cours) | `mtgtop8.sqlite`, log `scrape.log` |
| `POST /api/scrape/one` | body `{year, format: MO\|LE\|VI\|PAU\|PEA\|PREM\|EDH, seconds, recheck}` | `{ok, started, year, format, seconds, recheck}` ; spawn `scrape_year.py <year> <FORMAT> <secs> [--recheck]` | idem |
| `GET /api/scrape/status` | — | `{ok, running, pid, phase, …}` lu dans `scrape_status.json` | fichier de statut |
| `GET /api/scrape/grid` | — | `{ok, grid:{FORMAT:{année:{total, fetched}}}}` — nb de decks scrapés par format × année | `mtgtop8.sqlite` |

### Cardmarket (MKM) — proxy signé OAuth 1.0a

| Route | Params | Réponse | Source |
|---|---|---|---|
| `GET /api/mkm/settings` | — | `{ok, present:{appToken,appSecret,accessToken,accessSecret}, username}` (les secrets ne sont jamais renvoyés en clair) | `mtg_data.db.mkm_settings` |
| `POST /api/mkm/settings` | body = réglages (app token, secret, …) | `{ok:true}` | `mtg_data.db.mkm_settings` |
| `POST /api/mkm/*` | body JSON proxifié tel quel (`/api/mkm/test`, `/vacation`, `/articles`, `/find_product`, …) | réponse Cardmarket relayée | `https://api.cardmarket.com` via signature HMAC-SHA1 (`server/utils/oauth.js`) |

---

## 3. Qui lit quoi côté client (anti «mauvaise source»)

| Donnée | Endpoint / module client | À NE PAS faire |
|---|---|---|
| Prix affiché (tuiles, popup, collection) | `/api/prices/last` → `js/core/pricedb.js` `dbPrice(sfid, foil)` | ne pas appeler Scryfall pour un prix |
| Timeline jours historisés + jauge dates | `/api/prices/days` → `priceDays()` / `mountPriceTimeline()` | — |
| Historique/sparkline d'une carte (popup fiche) | `/api/price?sfid=` → sparkline 2 courbes via `R.drawSpark` (normal+foil) ; `loadPriceChart`/`drawPriceChart` restent exposés via R (marché) | — |
| Recherche Marché (cartes) | `/api/market/cards` (100 % `prices.db`) | ne pas paginer Scryfall |
| Recherche Marché (éditions) | `/api/market/sets` (100 % `prices.db` + collection `mtg_data.db`) | ne pas paginer Scryfall |
| Top/flop, valeur collection, valeur par set | `/api/market`, `/api/collvalue`, `/api/setvalues` | — |
| Decks metagame | `/api/decks/search` (params `q`, `card`, `fmt`, `dateFrom`/`dateTo`, `players`, `sort`…) \| `/api/decks/names?kind=card\|player` (autocomplétion) \| `/api/decks/deck` \| `/api/decks/meta` \| `/api/decks/stats` \| `/api/decks/playable` \| `/api/decks/arch` \| `/api/decks/topcards` | ne pas relire `decks.json.gz` (abandonné) ; plus de dataset complet servi |
| Collection / decks perso / matchs | `/api/state` (SYNC_KEYS) → `js/core/store.js` | — |
| Métadonnées carte, recherche avancée, autocomplete, images | API Scryfall **avec `game:paper`** (`js/core/scryfall.js`) | ne pas s'en servir pour les prix |
| Vignettes | URL `cards.scryfall.io` construite depuis `scryfall_id` | `cards.image` est NULL pour certaines lignes |

*Dernière revue : 2026-11-26.*
