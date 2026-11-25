---
name: frontend-modules
description: "Invoquer dès qu'on modifie index.html, css/ ou js/ (vues, core, main) : cohérence HTML/JS, registry R/S, échappement HTML, scoping des sélecteurs, images/drapeaux, prix côté client."
---

# Règles du client (js/ vanilla, modules ES)

1. **`index.html` et `js/` toujours modifiés ensemble** (ordre CSS : `reset.css`, `app.css`,
   `themes.css` ; script `<script type="module" src="js/main.js">`). js récent + index ancien
   = boot bloqué (guard dans `js/main.js`).
2. Nouvelle vue : `js/views/<x>.js` + import dans `js/main.js` + enregistrement dans `R.views`.
   Utiliser le registry `R`/`S` (`js/core/registry.js`) pour éviter les imports circulaires.
3. **Tout `innerHTML` / template HTML : `esc()` sur chaque donnée externe** (`esc()` dans `js/core/util.js`).
4. `$`/`$$` sont des `querySelector` globaux → en cas d'id dupliqué entre vues, scoper au
   conteneur (ex. `$('#modal #newtag')`).
5. Dans un template literal HTML, `// ...` entre balises est rendu dans le DOM → ne jamais en mettre.
6. Canvas : `var(--…)` ne résout pas dans `strokeStyle`/`fillStyle` → `getComputedStyle(document.documentElement).getPropertyValue('--accent')`.
7. Images cartes : URL depuis le `scryfall_id` (`https://cards.scryfall.io/<size>/front/<c1>/<c2>/<uuid>.jpg`, 1 caractère par dossier). Drapeaux : `/assets/icons/flags/<code>.svg` via `langFlagHTML(code)`.
8. Prix affichés côté client : toujours `dbPrice(sfid, foil)` depuis `GET /api/prices/last` chargé au boot (`js/core/pricedb.js`). Repli Scryfall UNIQUEMENT pour la valeur de set si `prices.db` absent.
9. `store.set` (`js/core/store.js`) ne fait `pushState` que si `window.__booted`.
