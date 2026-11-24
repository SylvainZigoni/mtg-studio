---
name: data-pipeline
description: "Invoquer pour tout ce qui alimente les bases : price_seed.py (prix MTGJSON), scraping MTGTop8 (scraper.py, scrape_run.py, scrape_year.py), mises à jour quotidiennes/hebdo, formats binaires de prices.db."
---

# Pipelines de données

1. **Prix** : `price_seed.py` (Python stdlib uniquement) — modes `prices` (re-seed complet),
   `cards`, `cardsmeta`, `today` (spawné en arrière-plan par `POST /api/price/today`, 1×/jour max),
   `weekly` (fusion fenêtre 3 mois, idempotente, comble tout trou ≤ 3 mois).
   Planification hebdo : lundi 9 h (Planificateur de tâches Windows, `0 9 * * 1` recommandé).
2. **Scraping MTGTop8** → `mtgtop8.sqlite` : `scraper.py` (année courante, YEAR dynamique),
   `scrape_year.py <annee> <FORMAT> [secs] [--recheck]`, `scrape_run.py` (spawné par
   `POST /api/scrape`, log `scrape.log`, statut `scrape_status.json`, progression
   `GET /api/scrape/status`), `check_scrape.py` (contrôle lecture seule).
   Anti-doublon : PK + `INSERT OR IGNORE`.
3. MTGJSON publie avec **1 jour de décalage** (AllPricesToday du J = prix du J-1).
4. **Papier uniquement** : `availability` contient `"paper"`, côté Scryfall `digital=false` / `game:paper`.
5. Point de prix « aberrant » = `<= 0 €` uniquement ; les vrais prix bas (0,02–0,09 €) calculent une évolution.
6. Ne jamais passer un gros script de patch en heredoc bash (tronqué silencieusement) :
   l'écrire via `write_file` dans `price_cache/` puis `python price_cache/<script>.py`.
7. Ne jamais modifier `prices.db` à la main : passer par `price_seed.py`.
