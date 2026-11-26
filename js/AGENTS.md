# js/ — règles spécifiques au client (JS vanilla, modules ES)

AGENTS.md imbriqué : chargé automatiquement par Vibe quand on touche un fichier de `js/` ou `index.html`.
Règles générales : `AGENTS.md` racine + `gotchas.md`. Qui lit quoi côté client (endpoints) : `API.md` §3.

- `index.html` charge `css/reset.css` puis `css/app.css` puis `css/themes.css`, puis `<script type="module" src="js/main.js">`. **Toujours modifier `index.html` et `js/` ensemble** (js récent + index ancien = boot bloqué avant tout fetch ; garde `if(!$('#sidebar') || !$('#burger'))` dans `js/main.js`).
- Modules ES ; le registry `R`/`S` (`js/core/registry.js`) évite les imports circulaires entre vues. Nouvelle vue : `js/views/<x>.js` + import dans `js/main.js` + enregistrement dans `R.views`.
- **Tout `innerHTML` / template HTML : `esc()` sur chaque donnée externe** (`js/core/util.js`) — y compris dans les attributs (`src`, `href`, `data-*`).
- `$`/`$$` sont des `querySelector` globaux → en cas d'id dupliqué entre vues, scoper au conteneur (`$('#modal #newtag')`).
- Canvas : `var(--…)` ne résout pas dans `fillStyle`/`strokeStyle` → `getComputedStyle(document.documentElement).getPropertyValue('--…')`.
- Dans un template literal HTML, `// ...` entre balises est rendu dans le DOM → ne jamais en mettre.
- **Prix affichés = toujours `dbPrice(sfid, foil)`** depuis `GET /api/prices/last` chargé au boot (`js/core/pricedb.js`) — jamais Scryfall pour un prix, y compris filtres/tri/bornes de jauge (filtrer/trier localement via `dbPrice`, bornes via `/api/pricerange`). Scryfall = métadonnées / recherche avancée uniquement, toujours `game:paper`. Repli Scryfall pour la valeur d'un set UNIQUEMENT si `prices.db` absent (`computeSetValue` dans `browse.js`).
- Images cartes : URL construite depuis le `scryfall_id` (`https://cards.scryfall.io/<size>/front/<c1>/<c2>/<uuid>.jpg`, 1 caractère par dossier) ; drapeaux `/assets/icons/flags/<code>.svg` via `langFlagHTML(code)`.
- `store.set` (`js/core/store.js`) ne fait `pushState` que si `window.__booted` (posé une seule fois dans `main.js`, après le boot).
- Index DECKS (tableaux 13 champs) : d[3]=nom, d[4]=archétype, d[5]=joueur, d[9]=eid, d[10]/d[11]=main/side, d[12]=players.
- Decks MTGTop8 servis **à la demande** : `/api/decks/search|deck|meta|stats|playable|arch|topcards` — plus de dataset complet au boot, `decks.json` abandonné.
- Popup carte unique : `R.showCardInfo(name, _, ctx)` (`js/views/cardinfo.js`, modale `.wide`) ; helpers : dropdown langue `.langdd`, `R.drawSpark` multi-séries, `R.rarityDotHTML` (toujours scopée, ex. `.cp-right h2 .rarity-dot`).
- Thèmes UI : `css/themes.css` (sélecteurs `html[data-theme="…"]`, chargé après `app.css`), liste/apply dans `js/core/themes.js`, persistance localStorage `mtg_theme`, défaut `darkmode`.
- Avant de livrer : skill `test-smoke` ; `index.html` + `js/` cohérents (CI vérifie aussi les patterns interdits).
