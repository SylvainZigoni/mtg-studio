# Pièges et règles du projet

## À ne jamais faire
- Ne jamais modifier un fichier du projet sans préserver les fins de ligne **CRLF** : patcher en binaire via Python (`open(p,'rb')`, `old/new.replace('\n','\r\n')`), ne jamais copier-coller une ancre depuis `read_file` (les `"` y sont échappées) ; vérifier `b.count(b'\r\r\n')==0` après chaque patch.
- Ne jamais chercher un prix ou la liste des cartes sur Scryfall : les prix affichés viennent exclusivement de `prices.db` (`/api/prices/last` → `dbPrice()`), la recherche Marché est 100 % locale (`/api/market/cards`). Scryfall = métadonnées/recherche avancée uniquement, toujours avec `game:paper`. Lire `API.md` §0/§3 avant de choisir une source de données.
- Ne jamais tuer un processus node à l'aveugle (`pkill` n'existe pas en Git Bash) : le serveur de l'utilisateur tourne sur le port 3000. Tester sur un **port neuf**, tuer ciblé via `netstat -ano | findstr :PORT` + `taskkill //PID <pid> //F`.
- Ne jamais utiliser `2>nul` (crée un fichier littéral `nul` indexable par git) ni `/tmp` pour Python sous Windows : utiliser `price_cache/` (gitigné).
- Ne jamais écrire une fonction ou un endpoint parallèle à un existant : toujours grepper d'abord (voir « Avant de coder »).

## Pièges techniques
- SQLite : `"set"` est un mot-clé → toujours quoter `"set"` ; `last_date` a une affinité TEXT. Blob de prix (`prices.db.series`) : `uint32 count` puis paires `(int32 jour_ordinal, float32 prix)` little-endian — décoder avec `blobPoints`/`blobAt` (`server/utils/pricesDb.js`).
- Un `<canvas>` ne résout pas `var(--…)` dans `strokeStyle`/`fillStyle` (affectation ignorée, couleur parasite héritée) : résoudre la couleur via `getComputedStyle(document.documentElement).getPropertyValue('--accent')`.
- Image d'une carte depuis son `scryfall_id` : `https://cards.scryfall.io/<size>/front/<c1>/<c2>/<uuid>.jpg` avec **1 seul caractère par dossier** (`cards.image` est NULL pour certaines lignes).
- Tout cache serveur est invalidé par le **mtime de tous les fichiers lus** : marché = `prices.db` **et** `mtg_data.db` (la collection change les quantités) ; decks = `mtgtop8.sqlite`.
- **Piège WAL** : `mtg_data.db` est en mode WAL — les écritures partent dans `mtg_data.db-wal` et le mtime du `.db` principal ne bouge pas. Pour invalider un cache sur la collection, prendre le max des mtime de `.db` + `-wal` + `-shm` (`dataMtimeMs()` dans `server/utils/db.js`, utilisé par `/api/market/cards` et `/api/market/sets`) ; sinon le cache 12 h ressert les anciens résultats même après un ajout de carte.
- Dans un template literal HTML (js/views), `// ...` n'est PAS un commentaire JS : c'est du texte rendu dans le DOM — ne jamais en placer entre des balises.
- MTGJSON publie avec 1 jour de décalage ; `reserved` n'existe plus dans AllPrintings v5 (seed via Scryfall `is:reserved`) ; **papier uniquement** : `availability` contient `"paper"` (set : `isOnlineOnly` dans SetList/{SET}.json), côté Scryfall `digital=false` / `game:paper`.
- Point de prix « aberrant » = `<= 0 €` uniquement ; les vrais prix bas (0,02–0,09 €) doivent calculer une évolution (flat, %).
- `index.html` et `js/` doivent rester cohérents (js récent + index ancien = boot bloqué avant tout fetch ; guard dans `js/main.js`).

- `$`/`$$` (`js/core/util.js`) sont des `querySelector` **globaux** : si un même id existe dans deux vues (ex. `#newtag` dans la vue collection ET dans la popup carte), le binding se pose sur le mauvais élément → toujours scoper au conteneur (`$('#modal #newtag')`).
- `sfSetPrints` doit renvoyer le print **complet** (id, oracle, image_lg, scryfall_uri…) comme `sfPrints` : sinon prix (`dbPrices(cur.id)`), sparkline (`/api/price?sfid=`) et oracle de la popup carte tombent silencieusement.
- Les `<option>` d'un `<select>` natif ne rendent pas les `<img>` → pour un choix « langue + drapeau », passer par un dropdown custom (`.langdd` dans la popup carte).
- `.rarity-dot` est partagée (collection, marché, popup) : ne jamais modifier sa taille globalement → scoper (ex. `.cp-right h2 .rarity-dot` dans la popup).

## Avant de coder
- Rechercher dans le code existant si la fonction ou l'endpoint demandé existe déjà (grep sur le nom, la route, la ressource) avant d'en écrire un nouveau ; si une fonction proche existe, la réutiliser ou la généraliser, jamais de parallèle. Lire `API.md` pour savoir quelle base/endpoint fournit la donnée.
- Ne jamais passer un gros script de patch en heredoc bash (tronqué silencieusement) : l'écrire via `write_file` dans `price_cache/` puis `python price_cache/patch_x.py`.
- Avant de livrer : `node --check` sur chaque JS modifié, test live des endpoints sur un port neuf (`curl` + parsing JSON), puis commit après `git branch --show-current` (travail sur `dev-marche`).
