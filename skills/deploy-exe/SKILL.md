---
name: deploy-exe
description: "Invoquer pour packager l'app en exécutable Windows (.exe) : Node SEA (Node >= 22.5 déjà requis par engines), bundling, assets, bases à côté de l'exe, distribution zip avec LICENSE."
---

# Packaging .exe (Node SEA)

1. Node SEA : `node --experimental-sea-config sea-config.json` puis injection du blob
   dans une copie du binaire `node` via `postject` → `mtg-studio.exe`.
2. Le serveur est en ESM (`"type":"module"`) et SEA ne supporte historiquement que le CJS :
   bundler d'abord (ex. `esbuild` en **devDependency** uniquement — zéro dépendance runtime)
   pour produire un bundle CJS, puis SEA.
3. Fichiers statiques (`index.html`, `css/`, `js/`, `assets/`) : embarqués (assets SEA)
   ou servis depuis un dossier à côté de l'exe.
4. Les bases (`mtg_data.db`, `prices.db`, `mtgtop8.sqlite`) ne vont **jamais** dans l'exe :
   créées/lues à côté de l'exe ou dans `%APPDATA%`.
5. Distribuer en **zip** avec le fichier `LICENSE` inclus (obligation MIT de conserver
   l'avis de copyright dans toute distribution du binaire).
6. Exe non signé → SmartScreen « Éditeur inconnu » au premier lancement : l'utilisateur
   clique « Informations complémentaires → Exécuter quand même ». Un certificat de
   signature Authenticode est payant et facultatif pour un usage perso.
7. Ne jamais exposer l'app en public (décision AGENTS.md) : rester en `localhost`.
