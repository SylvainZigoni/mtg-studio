# Pièges et règles du projet

Lu obligatoirement avant toute tâche (référencé par `AGENTS.md`). Chaque nouveau piège découvert y est documenté dans le même commit (skill `docs-update`).

## À ne jamais faire

Voir **AGENTS.md → « Règles absolues »** (LF partout, prix = `prices.db` uniquement, `*.db` jamais servis, grep avant d'écrire, lire avant d'éditer, cohérence `index.html`/`js/`, test sur port neuf, pas de `2>nul`…).

Spécifique à cette session (Vibe) : ne jamais copier-coller une ancre depuis `read_file` (les guillemets y sont échappés).

## Pièges techniques

### Bases de données (SQLite)

- `"set"` est un mot-clé → toujours quoter `"set"` ; `last_date` a une affinité TEXT.
- Blob de prix (`prices.db.series`) : `uint32 count` puis paires `(int32 jour_ordinal, float32 prix)` little-endian — décoder avec `blobPoints`/`blobAt` (`server/utils/pricesDb.js`).

### Fichiers servis en HTTP

- Le middleware statique bloque les bases par **extension** : `.db`, `.sqlite`, `.sqlite3` + sidecars `-wal`/`-shm`/`-journal` (regex dans `server/middleware/staticFiles.js`). Avant 2026-11-27, seul `.db` était bloqué → `mtgtop8.sqlite` (197 Mo) et `mtg_data.db-wal` étaient servis en clair (200). Tester avec `curl -o /dev/null -w '%{http_code}' http://localhost:PORT/mtgtop8.sqlite` → attendu 404.

### Python sqlite3 (scraper)

- `sqlite3.connect()` ouvre une **transaction implicite** : un `close()` sans `commit()` fait un **ROLLBACK** — un backfill one-shot (ex. `PRAGMA user_version`) exécuté hors scraping est perdu silencieusement (les `executescript` committent, pas les `execute` suivants). Toujours `c.commit()` après un backfill (cf. `db()` dans `scraper.py`).

### Caches & mtime

- Tout cache serveur est invalidé par le **mtime de tous les fichiers lus** : marché = `prices.db` **et** `mtg_data.db` (la collection change les quantités) ; decks = `mtgtop8.sqlite`.
- **Piège WAL** : `mtg_data.db` est en mode WAL — les écritures partent dans `mtg_data.db-wal` et le mtime du `.db` principal ne bouge pas. Pour invalider un cache sur la collection, prendre le max des mtime de `.db` + `-wal` + `-shm` (`dataMtimeMs()` dans `server/utils/db.js`, utilisé par `/api/market/cards` et `/api/market/sets`) ; sinon le cache 12 h ressert les anciens résultats même après un ajout de carte.

### Client (DOM, canvas, images)

- Un `<canvas>` ne résout pas `var(--…)` dans `strokeStyle`/`fillStyle` (affectation ignorée, couleur parasite héritée) : résoudre la couleur via `getComputedStyle(document.documentElement).getPropertyValue('--accent')`.
- Image d'une carte depuis son `scryfall_id` : `https://cards.scryfall.io/<size>/front/<c1>/<c2>/<uuid>.jpg` avec **1 seul caractère par dossier** (`cards.image` est NULL pour certaines lignes).
- Dans un template literal HTML (js/views), `// ...` n'est PAS un commentaire JS : c'est du texte rendu dans le DOM — ne jamais en placer entre des balises.
- `index.html` et `js/` doivent rester cohérents (js récent + index ancien = boot bloqué avant tout fetch ; guard dans `js/main.js`).
- `$`/`$$` (`js/core/util.js`) sont des `querySelector` **globaux** : si un même id existe dans deux vues (ex. `#newtag` dans la vue collection ET dans la popup carte), le binding se pose sur le mauvais élément → toujours scoper au conteneur (`$('#modal #newtag')`).
- `sfSetPrints` doit renvoyer le print **complet** (id, oracle, image_lg, scryfall_uri…) comme `sfPrints` : sinon prix (`dbPrices(cur.id)`), sparkline (`/api/price?sfid=`) et oracle de la popup carte tombent silencieusement.
- Les `<option>` d'un `<select>` natif ne rendent pas les `<img>` → pour un choix « langue + drapeau », passer par un dropdown custom (`.langdd` dans la popup carte).
- `.rarity-dot` est partagée (collection, marché, popup) : ne jamais modifier sa taille globalement → scoper (ex. `.cp-right h2 .rarity-dot` dans la popup).

### Données externes (MTGJSON / Scryfall)

- Ne jamais chercher un prix ou la liste des cartes sur Scryfall : les prix affichés viennent exclusivement de `prices.db` (`/api/prices/last` → `dbPrice()`), la recherche Marché est 100 % locale (`/api/market/cards`). Scryfall = métadonnées/recherche avancée uniquement, toujours avec `game:paper`. Lire `API.md` §0/§3 avant de choisir une source de données.
- MTGJSON publie avec 1 jour de décalage ; `reserved` n'existe plus dans AllPrintings v5 (seed via Scryfall `is:reserved`) ; **papier uniquement** : `availability` contient `"paper"` (set : `isOnlineOnly` dans SetList/{SET}.json), côté Scryfall `digital=false` / `game:paper`.

### Prix

- Point de prix « aberrant » = `<= 0 €` uniquement ; les vrais prix bas (0,02–0,09 €) doivent calculer une évolution (flat, %).

## Avant de coder

- Rechercher dans le code existant si la fonction ou l'endpoint demandé existe déjà (grep sur le nom, la route, la ressource) avant d'en écrire un nouveau ; si une fonction proche existe, la réutiliser ou la généraliser, jamais de parallèle. Lire `API.md` pour savoir quelle base/endpoint fournit la donnée.
- Ne jamais passer un gros script de patch en heredoc bash (tronqué silencieusement) : l'écrire via `write_file` dans `price_cache/` puis `python price_cache/patch_x.py`.

Avant de livrer : voir **AGENTS.md → « Avant de livrer (definition of done) »** + skill `test-smoke` — `node --check` sur chaque JS modifié, test live des endpoints sur un port neuf (`curl` + parsing JSON), puis commit sur la branche courante `dev-<sujet>` (base `developpement`, voir skill `git-workflow`).
