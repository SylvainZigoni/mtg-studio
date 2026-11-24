---
name: test-smoke
description: "Invoquer après chaque modification de code (JS serveur ou client) : vérifier la syntaxe, booter le serveur sur un port neuf, tester les endpoints modifiés, puis tuer proprement le process de test."
---

# Tests de fumée

1. Syntaxe : `node --check` sur **chaque** fichier JS modifié (`server/**` et `js/**`).
2. Boot sur un **port neuf** (le serveur de l'utilisateur tourne sur 3000) :
   `node server/server.js 3999` en arrière-plan, puis
   `curl http://localhost:3999/api/health` → attendu `{"ok":true}`.
3. Tester chaque endpoint modifié avec `curl` + parsing JSON
   (params 400, inconnu 404, `*.db` jamais servi, etc.).
4. Scénario manuel clé dans le navigateur : `http://localhost:3999` + **Ctrl+F5** (vider le cache).
5. Tuer le process de test proprement (Windows, Git Bash) :
   `netstat -ano | findstr :3999` → `taskkill //PID <pid> //F`.
   **Jamais `pkill`** (n'existe pas en Git Bash) et jamais tuer le port 3000.
6. Noter les commandes exécutées et leurs résultats dans la description de la PR.
