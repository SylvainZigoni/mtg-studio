---
name: security-check
description: "Invoquer avant chaque commit ou PR : détecter secrets commités, injections XSS (innerHTML non échappé), injections SQL, fichiers sensibles servis en HTTP, dépendances vulnérables, exposition réseau."
---

# Check sécurité avant commit/PR

1. Secrets : `git grep -iE "token|secret|api[_-]?key|password|beacon"` sur le diff.
   Tout secret en clair = **bloquant** (révoquer + retirer ; cf. beacon analytics retiré de `index.html`).
   Les jetons Cardmarket restent dans `mtg_data.db` (`mkm_settings`), jamais dans le client ni git.
2. XSS : dans `js/`, tout `innerHTML` / template HTML doit passer les données externes par `esc()` (`js/core/util.js`). Vérifier chaque `${...}`.
3. SQL (node:sqlite, `server/`) : `"set"` toujours quoté ; paramètres **bindés**, jamais de concaténation de chaînes dans la requête.
4. Fichiers sensibles : les `*.db` ne sont **jamais** servis en HTTP (middleware `server/middleware/staticFiles.js`) — vérifier toute nouvelle route statique.
5. Réseau : l'app reste **locale** (`localhost`), pas de binding `0.0.0.0`, pas d'exposition publique (décision AGENTS.md).
6. Dépendances : si `package.json` a changé, `npm audit` ; le projet vise zéro dépendance npm runtime.
7. Tout doute → le signaler dans la description de la PR, ne pas merger.
