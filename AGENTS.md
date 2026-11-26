# MTG Studio — instructions pour l'agent

Application web **locale** de collection Magic: The Gathering + méta MTGTop8 2026.
Serveur Node.js **zéro dépendance npm** (`node:http` + `node:sqlite`, Node ≥ 22.5) :
`node server/server.js [port]` (défaut 3000, `npm start` équivalent) → http://localhost:3000
(Ctrl+F5 pour vider le cache). Windows, machine de Sylvain. Projet perso, 100 % local.

## Lecture obligatoire avant toute tâche

1. `gotchas.md` — pièges et règles « ne jamais » (à lire en entier).
2. `API.md` — §0 (les 3 bases, quelle source de données pour quoi) puis §2/§3 (endpoints) avant toute fonctionnalité.
3. `skills/<nom>/SKILL.md` (index : `skills/README.md`) — invoquer dès que la tâche correspond à la `description` du skill (git, tests, sécurité, SQLite, endpoints, front, pipelines, fins de ligne, doc, release, packaging).

## Règles absolues (ne jamais violer)

- **LF partout** : dépôt et disque en LF (`.gitattributes` `eol=lf`, `core.autocrlf=false`) — modifier les fichiers directement, jamais de réécriture en CRLF (hook pre-commit anti-`\r`).
- **Prix = `prices.db` uniquement** : jamais de prix ni de recherche Marché via Scryfall (Scryfall = métadonnées/recherche avancée uniquement, toujours `game:paper`). Lire `API.md` §0/§3 avant de choisir une source de données.
- **`*.db` jamais servis en HTTP** ; ne jamais lire/éditer les fichiers `.env` ; l'app n'est jamais exposée publiquement.
- **Grepper avant d'écrire** : jamais de fonction ou d'endpoint parallèle à un existant — réutiliser ou généraliser.
- **Lire un fichier avant de l'éditer** ; diff minimal ; ne toucher que ce qui est demandé.
- **`index.html` + `js/` toujours modifiés de façon cohérente** (js récent + index ancien = boot bloqué avant tout fetch ; garde `if(!$('#sidebar') || !$('#burger'))` dans `js/main.js`).
- **Ne jamais tuer un process node à l'aveugle** (`pkill` n'existe pas en Git Bash ; le serveur de l'utilisateur tourne sur :3000) : tester sur un **port neuf**, tuer ciblé par PID (`netstat -ano | findstr :PORT` + `taskkill //PID <pid> //F`).
- **Jamais `2>nul`** (crée un fichier littéral `nul`) ni `/tmp` pour Python sous Windows → utiliser `price_cache/` (gitigné).
- Ne jamais suggérer `python -m http.server` (pas de POST).

## Commandes

| Action | Commande |
|---|---|
| Lancer l'app | `node server/server.js` (ou `npm start`), port 3000 |
| Health check | `curl http://localhost:3000/api/health` |
| Tester un changement | `node server/server.js 3999` + `curl` des endpoints touchés, puis kill par PID |
| Syntaxe JS modifiée | `node --check <fichier.js>` |
| Syntaxe Python modifiée | `python -m py_compile <fichier.py>` |
| Prix du jour / fusion hebdo | `python price_seed.py today` / `weekly` (aussi via `POST /api/price/today`) |
| Scrape MTGTop8 | `python scrape_run.py`, ou `POST /api/scrape` (status : `GET /api/scrape/status`) ; ciblé : `python scrape_year.py <annee> <FORMAT> [secs] [--recheck]` ou `POST /api/scrape/one` |

## Arborescence

```
MTG Studio/                  racine du dépôt
├── server/                  serveur HTTP zéro dep : server.js, app.js + routes/ controllers/ middleware/ utils/
├── index.html + css/ + js/  client monopage en modules ES (main.js, ui.js, core/, views/)
├── skills/                  skills réutilisables (index dans skills/README.md)
├── mtg_data.db              état app (collection, classeurs, matchs, tags, decks perso, réglages MKM) — WAL, jamais servie
├── prices.db                prix Cardmarket + métadonnées cartes + séries temporelles (price_seed.py / MTGJSON)
├── mtgtop8.sqlite           tournois/decks MTGTop8 2026 — exposés via /api/decks/*
├── price_seed.py            seed/màj de prices.db (modes : today, weekly, cards, cardsmeta, prices) — Python stdlib
├── scraper.py, crawl.py, scrape_run.py, scrape_year.py, check_scrape.py   scraping MTGTop8 (check_scrape.py = lecture seule, non publié dans le client)
├── API.md                   source de vérité des endpoints + schémas des 3 BDD
├── README-APP.md            mode d'emploi humain (3 niveaux de mise à jour)
├── gotchas.md               pièges du projet — à lire avant toute tâche
└── AGENTS.md                ce fichier
```

## Contexte par zone (AGENTS.md imbriqués)

Vibe charge automatiquement l'AGENTS.md du dossier touché (découverte lazy) :

- `server/AGENTS.md` — serveur : routage, conventions de réponse, caches mtime/WAL, pièges SQLite
- `js/AGENTS.md` — client : modules ES, `esc()`, prix = `prices.db` uniquement, index DECKS, popup carte, thèmes
- Communs : `API.md` (endpoints + schémas des 3 BDD), `gotchas.md` (pièges, lu avant toute tâche), `skills/` (procédures)

Invariants clés : 3 bases = `mtg_data.db` (état, `SYNC_KEYS`) / `prices.db` (prix + métas) / `mtgtop8.sqlite` (decks) ; prix affichés côté client = `GET /api/prices/last` → `dbPrice()` ; decks servis à la demande via `/api/decks/search|deck|meta|stats|playable|arch|topcards` (`decks.json.gz` abandonné) ; MTGJSON ~3 mois d'historique → `price_seed.py today` quotidien + `weekly`.

## Git

Base de travail = `developpement` (jamais `main` directement), une branche `dev-<sujet>` par tâche, PR avec CI verte (`smoke`) obligatoire — procédure complète dans le **skill `git-workflow`**. Ne jamais pousser sur `developpement`/`main` sans demande explicite.

## Avant de livrer (definition of done)

1. `node --check` sur chaque JS modifié, `python -m py_compile` sur chaque Python modifié.
2. Boot sur un **port neuf** + `curl` des endpoints touchés (JSON parsé).
3. Skill `test-smoke` ; documentation à jour dans le **même commit** (skill `docs-update` : `README-APP.md` / `API.md` / `AGENTS.md` / `gotchas.md` selon le cas).

## Décisions actées (ne pas rouvrir sans demande)

- Decks MTGTop8 servis depuis `mtgtop8.sqlite` via `/api/decks` (décision 2026-11-17, remplace `decks.json.gz`).
- L'app reste locale ; pas d'exposition publique.
- Mise à jour hebdo des prix/decks gérée via `price_seed.py weekly` + Planificateur de tâches Windows (`0 9 * * 1` recommandé).
- Thèmes UI comme décrit ci-dessus ; thème par défaut `darkmode`.
- La popup carte unique remplace `openAddPopup` (supprimé).
