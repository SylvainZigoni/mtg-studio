# MTG Studio — app de collection, méta et stats Magic

> **Version 2026-11-16b** — serveur basculé en Node.js zéro dépendance (phase 2 : `server/` découpé en routes/contrôleurs/middlewares/utils, client en modules ES + CSS séparé).

## Contenu
- `server/server.js` : le serveur à lancer (Node >= 22.5, zéro dépendance npm : `node:http` + `node:sqlite`). Sert l'app + enregistre vos données dans SQLite
- `server/` : routes (`routes/`), contrôleurs (`controllers/`), middlewares (`middleware/`), utilitaires (`utils/`)
- `index.html` + `css/` + `js/` : l'application (client en modules ES, `css/reset.css` puis `css/app.css`)
- `mtgtop8_2026_snapshot.sqlite` : base du scraper MTGTop8 (tournois 2026, decks, cartes) ; l'app la lit via `GET /api/decks`, servi par le serveur Node
- `price_seed.py` : construit/met à jour `prices.db` depuis MTGJSON (reste en Python, appelé aussi par le serveur pour les prix du jour)

## Lancer l'app (recommandé)
```
node server/server.js        # ou : npm start
```
Ouvrez http://localhost:3000 (port personnalisable : `node server/server.js 8000`)

Le serveur n'a **aucune dépendance** (API standard de Node) et crée
automatiquement à côté de lui un fichier `mtg_data.db` : c'est la base SQLite
où sont enregistrées vos saisies (collection avec éditions/foil/tags,
classeurs-tags, matchs), à chaque modification. Les fichiers `*.db` ne sont
pas servis en HTTP.

Un badge en haut à droite de l'app indique « ✔ sauvegardé dans la BDD ».
En ouvrant la page hors serveur (file://), l'app retombe sur le localStorage
du navigateur et le badge affiche « ⚠ hors serveur ».

## Sauvegarde et sécurité des données
- `mtg_data.db` est un simple fichier : copiez-le pour le sauvegarder.
- À chaque enregistrement, le serveur garde aussi un **snapshot** des 100
  dernières versions (table `snapshots`) : en cas de fausse manipulation,
  l'historique est récupérable.
- La BDD fait foi : au démarrage, l'app restaure depuis `mtg_data.db`.
- Les boutons Exporter/Importer (JSON) restent disponibles.

## Fonctionnalités clés
- **Recherche multilingue** : tapez les noms en anglais, français, allemand,
  espagnol, italien ou portugais (noms complets pour les langues non
  anglaises) ; l'affichage reste toujours en anglais.
- **Collection par édition** : chaque groupe de cartes mémorise son édition,
  son numéro collector, son statut foil, sa quantité et ses tags. Visuel,
  symbole d'extension et prix (EUR Cardmarket) suivent l'édition possédée.
- **Tags** (ex-classeurs) : un même exemplaire peut porter plusieurs tags ;
  3 Lightning Bolt peuvent être 2 « a vendre » + 1 « staple commander ».
- **Filtres et tri** : tag, couleur, type, coût de mana, fourchette de prix,
  extension ; tri par tag, couleur, type, CMC, prix, nom, date de parution.
- **Vue liste ou vignettes**, zoom du visuel au survol, modification en
  masse via les checkboxes (ajout/retrait de tag, suppression).
- **Suivi des extensions** : complétion (possédées/total), taux, valeur
  possédée et valeur totale calculable à la demande (cache 30 jours).
- **Recherche avancée** : filtres identiques à la collection + recherche par
  artiste + requête Scryfall libre.
- **Cartes similaires** : basées sur ce que fait la carte (texte d'oracle),
  pas seulement type/coût/couleur.
- **Menu burger latéral** avec recherche globale : cartes (toutes langues),
  decks MTGTop8 (nom/archétype/joueur), decks perso.
- **Decks perso** : création, ajout de cartes (main/side), commentaires,
  historique automatique des modifications (changelog daté), comparaison
  avec votre collection.
- **Visualiseur de decks** (MTGTop8 et perso) : groupement par type ou par
  coût de mana, onglets main/side, courbe de mana, colorpie des coûts,
  colorpie du mana produit par les lands, legalité par format.
- **État, langue, signature** : à l'ajout d'une carte, choisissez l'état
  (Near Mint par défaut), la langue (EN par défaut, FR, ou une autre langue
  disponible), foil et signée. Badges dans la collection ; badge **RL** pour
  les cartes de la Reserved List.
- **Cardmarket (onglet Paramètres)** : renseignez vos jetons de l'API
  officielle (https://apiv2.cardmarket.com/ws/documentation) ; test de
  connexion, mode vacances ON/OFF, export CSV du stock « a vendre »
  (format tableau MKM). Les requêtes sont signées OAuth 1.0a par le serveur
  (l'API Cardmarket interdit les appels directs depuis un navigateur).
  Les jetons sont stockés dans la BDD, jamais dans le navigateur.

## En cours (phase 2) — désormais livré
- Page **Marché** : top/flop des évolutions de prix (1 semaine, 1 mois, 1 an,
  3/5/10 ans, depuis la sortie), toutes cartes ou restreint à votre collection.
- **Statistiques de collection** : vue d'ensemble, histogramme par année,
  top extensions, cartes les plus possédées, valorisation actuelle et passée,
  taux de possession des cartes les plus jouées par format (filtre de dates).
- **Historique de prix** dans la fiche carte : courbe normal + foil (Cardmarket).

### Activer le marché (le plus simple)
Téléchargez directement `prices.db` (déjà construit, mis à jour chaque lundi
par une tâche planifiée) et déposez-le à côté de `server/`. Sinon, construisez-le :
```
python3 price_seed.py prices   # télécharge AllPrices.json.gz (148 Mo), construit prices.db (~2 min)
python3 price_seed.py cards    # télécharge les extensions MTGJSON : noms + ids Scryfall (~2 min)
```
Puis relancez le serveur Node : la page Marché, les statistiques et la courbe de
prix fonctionnent.

### Tenir prices.db à jour
- **Automatique (cloud)** : une tâche planifiée s'exécute chaque lundi à
  10 h 30 et republie un `prices.db` à jour en artefact. Si vous n'ouvrez pas
  l'app pendant des semaines, téléchargez la dernière version.
- **Automatique (app)** : à chaque ouverture de l'app, le serveur intègre les
  prix du jour (AllPricesToday, 5,6 Mo, 1 fois/jour max) — granularité
  quotidienne tant que l'app est ouverte.
- **Automatique (cron local, recommandé)** : `python3 price_seed.py weekly`
  fusionne la fenêtre des 3 derniers mois et **comble tout trou** jusqu'à
  3 mois d'absence. Une exécution par semaine suffit à ne rien perdre :
  ```
  # Linux/macOS (crontab -e) : chaque lundi à 9 h
  0 9 * * 1  cd /chemin/vers/mtg-studio && python3 price_seed.py weekly
  ```
  Sous Windows : Planificateur de tâches → hebdomadaire, lundi, action
  `python price_seed.py weekly` dans le dossier de l'app.
- **Important** : MTGJSON ne fournit qu'environ 3 mois de recul initial ;
  les fenêtres du Marché plus larges comparent au plus ancien prix connu,
  et l'historique s'allonge au fil des mises à jour.
- `price_cache/` : téléchargements MTGJSON mis en cache (peut être vidé).
- `prices.db` : historique de prix compact (binaire) ; sauvegardez-le.

## Mise à jour des decks
- La tâche planifiée du lundi 10 h met à jour la base SQLite du scraper.
- Depuis l'app : Paramètres → panneau « Mise à jour MTGTop8 » → « Lancer le scraping »
  (`scraper.py phase1` + `crawl.py 3600`, base `mtgtop8_2026_snapshot.sqlite`).
  En ligne de commande : `python scraper.py phase1` puis `python crawl.py 3600`.
- L'appli lit les decks **directement dans la base SQLite** via `GET /api/decks`
  (le serveur construit le JSON depuis la snapshot, le gzippe et le met en cache ;
  le cache est invalidé automatiquement quand la base change). Rechargez ensuite
  la page (Ctrl+F5).

## Sources externes
- Visuels, toutes les extensions, prix (EUR Cardmarket) : API publique
  Scryfall, appelée directement par le navigateur avec un cache local.
