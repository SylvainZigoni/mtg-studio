# Skills du projet

Dossier découvert par Vibe à chaque session. Chaque skill = un dossier `skills/<nom>/SKILL.md` avec un frontmatter :

```markdown
---
name: <nom>
description: <QUAND invoquer ce skill — c'est le déclencheur>
---
```

La `description` est cruciale : c'est elle qui décide si l'agent invoque le skill
au bon moment. Plus elle est précise, mieux ça marche.

**Ajouter un skill** : créer `skills/<nom>/SKILL.md` (frontmatter `name` + `description`-déclencheur) + une ligne dans le tableau ci-dessous, dans le **même commit** que le besoin (skill `docs-update`). La colonne « Quand l'invoquer » reprend le `description` du frontmatter — le frontmatter est la source unique, à synchroniser à chaque changement.

Liste des skills (voir chaque SKILL.md pour la procédure) :

| Skill | Quand l'invoquer |
|---|---|
| `git-workflow` | toute tâche git : branche, commit, PR |
| `pr-review` | avant de merger une PR : review critique du diff |
| `test-smoke` | après chaque modification de code |
| `security-check` | avant chaque commit/PR |
| `db-rules` | dès qu'on touche à SQLite (mtg_data.db, prices.db, mtgtop8.sqlite) |
| `api-design` | dès qu'on ajoute/modifie un endpoint ou une source de données |
| `frontend-modules` | dès qu'on touche à `index.html` ou `js/` |
| `data-pipeline` | prix (price_seed.py), scraping MTGTop8, mises à jour hebdo |
| `line-endings` | dès qu'on modifie un fichier sur la machine Windows (projet 100 % LF, jamais de CRLF) |
| `docs-update` | à chaque changement de code (doc dans le même commit) |
| `release` | préparation d'une release (version, tag, merge vers main) |
| `deploy-exe` | packaging de l'app en .exe (Node SEA) |
