---
name: pr-review
description: "Invoquer avant de merger une PR (ou pour auto-review son propre diff) : review critique du code, recherche de régressions, secrets, failles XSS/SQL, doublons."
---

# Review critique d'une PR

1. `git diff origin/developpement...HEAD` — lire **tout** le diff, pas seulement les fichiers "principaux".
2. Checklist :
   - **Régression** : le changement casse-t-il un comportement existant (boot `index.html`/`js/`, synchro BDD) ?
   - **Sécurité** : invoquer `security-check` (secrets, `innerHTML` sans `esc()`, SQL, `*.db` servis).
   - **Doublon** : la fonction/l'endpoint existait-il déjà ? (grep d'abord — règle gotchas.md « Avant de coder »).
   - **Cohérence** : `index.html` et `js/` modifiés ensemble ? Nouvel endpoint documenté dans `API.md` ?
   - **Pièges** : gotchas.md respecté (CRLF, WAL, canvas, `//` dans les templates…) ?
   - **Tests** : skill `test-smoke` exécuté et résultats notés dans la PR ?
3. Poser les questions bloquantes en commentaire de PR ; ne **jamais** merger sans avoir relu le diff.
4. Le merge se fait dans `developpement`, via l'interface GitHub (pas de push direct).
