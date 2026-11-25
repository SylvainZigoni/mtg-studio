---
name: db-rules
description: "Invoquer dès qu'on lit/écrit dans une base SQLite du projet (mtg_data.db, prices.db, mtgtop8.sqlite) : schéma, quoting, blobs de prix, WAL, invalidation de cache, snapshots."
---

# Règles des bases SQLite

Les 3 bases et leurs schémas : lire `API.md` §0. Jamais de `*.db` servi en HTTP.

1. `"set"` est un mot-clé SQL → **toujours quoter** `"set"` (aussi en node:sqlite).
2. `last_date` (prices.db.series) a une affinité **TEXT** (ex. `"739858"`).
3. node:sqlite (`server/utils/db.js`) : `new DatabaseSync(path)` pour `mtg_data.db`
   (`PRAGMA journal_mode=WAL`), `{readOnly:true}` pour `prices.db` ;
   blobs lus en `Uint8Array` (`Buffer.from(blob)`).
4. Blob de prix (`prices.db.series`) : `uint32 count` little-endian puis `count`
   paires `(int32 jour_ordinal, float32 prix)` triées par jour.
   Décodage : `blobPoints` / `blobAt` dans `server/utils/pricesDb.js` — ne jamais réinventer.
5. **Piège WAL** : les écritures partent dans `mtg_data.db-wal`, le mtime du `.db`
   ne bouge pas → pour invalider un cache, prendre le max des mtime de
   `.db` + `-wal` + `-shm` (`dataMtimeMs()` dans `server/utils/db.js`).
6. `POST /api/state` : clés limitées à `SYNC_KEYS`
   (`mtg_collection`, `mtg_binders`, `mtg_matches`, `mtg_custom_tags`, `mtg_decks`) ;
   chaque save est snapshotée (table `snapshots`, garde les 100 dernières).
7. Jours = ordinals proleptiques (739939 = 2026-11-19) ; conversion serveur `dayStr()`,
   client `ordOf()/isoOf()` (`js/core/pricedb.js`).
