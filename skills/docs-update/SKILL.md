---
name: docs-update
description: "Invoquer à chaque changement de code : la documentation doit être mise à jour dans le même commit (README-APP.md, API.md, AGENTS.md, gotchas.md)."
---

# Documentation dans le même commit que le code

1. Règle : **code + doc dans le même commit**, jamais séparément.
2. Quel fichier mettre à jour :
   - `README-APP.md` : mode d'emploi utilisateur (lancement, fonctionnalités, mises à jour hebdo).
   - `API.md` : tout nouvel endpoint / changement de source de données (table §2 + §3).
   - `AGENTS.md` (racine + `server/AGENTS.md` + `js/AGENTS.md` imbriqués) : contexte et décisions verrouillées ("ne pas rouvrir sans demande").
   - `gotchas.md` : **chaque nouveau piège découvert** (c'est le fichier que tout agent doit lire avant de coder).
3. Si un fichier est renommé/supprimé (ex. `app.js` → `js/`), mettre à jour **toutes**
   les références dans tous les docs.
4. Ne pas documenter l'évident ; documenter les décisions et les pièges.
