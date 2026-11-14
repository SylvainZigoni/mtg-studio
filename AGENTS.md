# MTG Studio — règles et contexte pour l'agent

Application web locale de collection Magic: The Gathering + méta MTGTop8 2026.
Dossier : `App MTG`, lancée avec `python server.py`, ouverte sur http://localhost:8000 (Ctrl+F5 pour vider le cache). Windows, machine de Sylvain.

## Fichiers

- `server.py` : serveur HTTP Python, **zéro dépendance** (bibliothèque standard). Sert l'app ET enregistre les saisies (collection, classeurs, matchs, tags) dans `mtg_data.db` (SQLite créé à côté). Ne jamais suggérer `python -m http.server` (pas de POST).
- `index.html` + `app.js` : application monopage. **Toujours modifier les deux de façon cohérente** : un app.js récent avec un index.html ancien fait planter le boot avant tout fetch ("Chargement des 41 366 decks…" sans fin). app.js a un garde `if(!$('#sidebar') || !$('#burger'))` pour détecter ce cas.
- `decks.json.gz` : 41 366 decks MTGTop8, tournois 2026 (Modern, Legacy, Vintage, Pauper, Premodern, Duel Commander).
- `prices.db` : historique de prix Cardmarket (SQLite, ~103 935 séries + 120 143 cartes, seed 14/11/2026).
- `price_seed.py` : construit/met à jour prices.db depuis MTGJSON. Modes : `prices` (re-seed complet), `cards`, `weekly` (fusion fenêtre 3 mois, idempotent, auto-réparateur : comble tout trou ≤ 3 mois).
- `scraper.py` + `crawl.py` : scraper MTGTop8.
- `mtgtop8_2026_snapshot.sqlite` : base brute des tournois.
- `README-APP.md` : mode d'emploi (3 niveaux de mise à jour).

## Architecture clé

- MTGJSON AllPrices ne fournit que ~3 mois d'historique → accumulation : point quotidien (today) + fusion weekly qui comble les trous ≤ 3 mois.
- Endpoints server.py : `/api/price`, `/api/market` (top/flop, fenêtres 1w/1m/1y/3y/5y/10y/rel, scope all|collection, cache 12h), `/api/collvalue`, `/api/price/today` (GET et POST), `/api/mkm/*`. SYNC_KEYS inclut mtg_decks.
- Price blobs prices.db : uint32 count puis paires (int32 jour ordinal, float32 prix). `struct.iter_unpack` exige un slice exact `memoryview(blob)[4:4+8*n]`, prix à offset +4 dans l'enregistrement.
- Parsing JSON streaming (classe Stream dans price_seed.py) : virgules via skip_ws, chaînes/nombres coupés entre buffers, colonnes "set" quoted, fichiers MTGJSON enveloppés dans `data`.
- app.js : `store.set` ne fait pushState que si window.__booted. Index DECKS : d[3]=nom deck, d[4]=archétype, d[5]=joueur, d[9]=eid, d[10]/d[11]=main/side, d[12]=players. Caches sfCache/print par norm(name).
- Vues : burger/sidebar, recherche globale, decks perso (vMyDecks/openMyDeck, changelog, commentaires, autocomplete, comparaison collection), visualiseur partagé (dvGroup type/CMC, dvTab main/side, chartBars mana, chartDonut coûts/lands, deckLegalities), collection (NM, langues, signée, addedAt, badges RL), vMarket, vStatsColl, vSettings Cardmarket + CSV "a vendre", loadPriceChart/drawPriceChart via /api/price?sfid=.

## Pièges SQLite

- `set` est un mot-clé → toujours `"set"` quoted.
- last_date a une affinité TEXT (int → text).

## Décisions déjà prises (ne pas rouvrir sans demande)

- decks.json.gz converti en SQLite : refusé pour l'instant.
- L'app reste locale ; pas d'exposition publique.
- Mise à jour hebdo des prix/decks gérée via `price_seed.py weekly` + Planificateur de tâches Windows (`0 9 * * 1` recommandé).
