---
name: api-design
description: "Invoquer avant d'ajouter ou modifier un endpoint serveur, ou avant de choisir une source de données : lire API.md §0/§3, respecter les conventions de réponse, de cache et de routage."
---

# Design d'API et sources de données

1. **Lire `API.md` §0 (les 3 bases) et §3 (qui lit quoi côté client) avant toute décision.**
   Règle d'or : prix = **uniquement** `prices.db` (`GET /api/prices/last` → `dbPrice()` dans
   `js/core/pricedb.js`). Scryfall = métadonnées / recherche avancée uniquement, toujours `game:paper`.
2. Nouvelle route : `server/routes/<x>.js` (fonction `register*Routes(app)`) +
   `server/controllers/<x>Controller.js`. Ne jamais créer d'endpoint parallèle à un
   existant (grep d'abord).
3. Réponses : `{ ok: true, … }` ; erreurs `{ ok: false, error }` avec 400 (params),
   404 (inconnu), 409 (déjà en cours), 502 (échec calcul), 503 (base absente → message
   disant quelle commande lancer).
4. Caches serveur : TTL 12 h, invalidés par le **mtime des fichiers lus**
   (prix/marché : `prices.db` + `mtg_data.db` ; decks : `mtgtop8.sqlite`) — cf. skill `db-rules` piège WAL.
5. Statique : `/` → `index.html` avec `Cache-Control: no-cache` ; autres fichiers
   `Last-Modified` + 304 ; `*.db` bloqués.
6. **Mettre à jour `API.md` dans le même commit** que l'endpoint (skill `docs-update`).
