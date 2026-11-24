---
name: crlf-windows
description: "Invoquer dès qu'on patch un fichier du projet depuis la machine Windows de l'utilisateur : les fichiers sont en CRLF, il faut préserver les fins de ligne et éviter les pièges Git Bash (nul, /tmp, pkill)."
---

# CRLF et pièges Windows / Git Bash

1. Les fichiers du projet sont en **CRLF** côté Windows : patcher en binaire via Python
   (`open(p,'rb')`, `old/new.replace('\n','\r\n')`) ; ne **jamais** copier-coller une ancre
   depuis `read_file` (les `"` y sont échappés).
2. Après chaque patch : vérifier `b.count(b'\r\r\n') == 0`.
3. Ne jamais utiliser `2>nul` (crée un fichier littéral `nul` indexable par git) ni `/tmp`
   pour Python sous Windows → utiliser `price_cache/` (gitigné).
4. Ne jamais tuer un process node à l'aveugle : `pkill` n'existe pas en Git Bash.
   Tester sur un **port neuf** ; tuer ciblé via `netstat -ano | findstr :PORT` puis
   `taskkill //PID <pid> //F`. Le serveur de l'utilisateur tourne sur le port 3000.
5. Ne jamais exposer l'app publiquement (décision AGENTS.md) : rester en `localhost`.
