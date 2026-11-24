---
name: git-workflow
description: "Invoquer pour toute tâche impliquant git : créer une branche, committer, pousser, ouvrir ou merger une PR. Base de travail = developpement, jamais main directement."
---

# Workflow git

1. **Base = `developpement`** (jamais `main` directement) :
   `git fetch origin` puis `git checkout -b dev-<sujet> origin/developpement`.
2. Un commit = une unité de changement, message descriptif en français
   (ex. `Fix popup carte : ...`, `Ajout endpoint /api/market/sets`).
3. Push : `git push -u origin dev-<sujet>`, puis PR `dev-<sujet>` → `developpement`.
4. Avant de merger : invoquer le skill `pr-review` et relire le diff soi-même.
5. `main` ne reçoit que les releases (voir skill `release`). Ne jamais push
   directement sur `main` ou `developpement` si la protection de branche est active.
6. Ne jamais committer de données perso ni de binaires régénérables
   (`*.db`, `prices.db`, `mtgtop8.sqlite`, caches — voir `.gitignore`).
