---
name: release
description: "Invoquer pour préparer une release : bump de version (source unique package.json), changelog, vérifications, merge developpement vers main, tag."
---

# Release

1. Version dans **`package.json`** (`"version"`) = seule source de vérité ; synchroniser
   la meta `version` de `index.html` si elle existe encore.
2. Changelog : bloc de version en tête de `README-APP.md` (format `2026-11-14b`).
3. Vérifications avant release : skill `test-smoke` complet, `git status` propre,
   `LICENSE` présent, skill `security-check` passé.
4. Merge `developpement` → `main` **via PR** (main protégée, pas de push direct), puis tag
   (ex. `git tag 2026-11-24a` sur le merge).
5. Le merge vers `main` ne se fait qu'en release, pas à chaque PR.
