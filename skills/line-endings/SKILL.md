---
name: line-endings
description: "Invoquer dès qu'on modifie un fichier du projet depuis la machine Windows de l'utilisateur : le projet est 100 % LF (.gitattributes eol=lf, autocrlf=false en local) — ne jamais réécrire en CRLF. Pièges Git Bash : nul, /tmp, pkill."
---

# Fins de ligne (LF) et pièges Windows / Git Bash

1. Le projet est **100 % LF**, dépôt et disque : `.gitattributes` (`* text=auto eol=lf`, `*.png binary`), `core.autocrlf=false` en local. Modifier les fichiers directement avec les outils d'édition ; ne **jamais** réécrire un fichier en CRLF — le hook pre-commit local bloque tout `\r` dans les fichiers texte stagés. Ne **jamais** copier-coller une ancre depuis `read_file` (les guillemets y sont échappés).
2. Ne jamais utiliser `2>nul` (crée un fichier littéral `nul` indexable par git) ni `/tmp` pour Python sous Windows → utiliser `price_cache/` (gitigné).
3. Ne jamais tuer un process node à l'aveugle : `pkill` n'existe pas en Git Bash. Tester sur un **port neuf** ; tuer ciblé via `netstat -ano | findstr :PORT` puis `taskkill //PID <pid> //F`. Le serveur de l'utilisateur tourne sur le port 3000.
4. Ne jamais exposer l'app publiquement (décision AGENTS.md) : rester en `localhost`.
