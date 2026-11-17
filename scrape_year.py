#!/usr/bin/env python3
"""Scraping MTGTop8 pour UNE annee et UN format.
   Usage : python scrape_year.py <annee> <FORMAT> [secondes_crawl]
   Ex    : python scrape_year.py 2022 PREM 3600
   Anti-doublon : cles primaires (eid, did, did+board+card) + INSERT OR IGNORE / REPLACE,
   relancer ne cree aucun doublon. Ecrit scrape_status.json (lu par GET /api/scrape/status)."""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS = os.path.join(HERE, "scrape_status.json")
LOG = os.path.join(HERE, "scrape.log")

sys.path.insert(0, HERE)
from scraper import FORMATS, YEAR

def write_status(**kw):
    st = {}
    try:
        with open(STATUS, encoding="utf-8") as f:
            st = json.load(f)
    except Exception:
        pass
    st.update(kw)
    st["pid"] = os.getpid()
    with open(STATUS, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    try:
        year = int(sys.argv[1])
    except ValueError:
        print(f"annee invalide : {sys.argv[1]}"); sys.exit(2)
    fmt = sys.argv[2].upper()
    secs = sys.argv[3] if len(sys.argv) > 3 else "3600"
    if fmt not in FORMATS:
        print(f"format inconnu : {fmt} (attendu : {', '.join(FORMATS)})"); sys.exit(2)
    if not (2000 <= year <= YEAR + 1):
        print(f"annee invalide : {year}"); sys.exit(2)
    logf = open(LOG, "a", buffering=1, encoding="utf-8", errors="replace")
    sys.stdout = logf
    sys.stderr = logf
    print(f"=== scrape_year {year} {fmt} demarre {time.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    write_status(running=True, scope=f"{fmt}/{year}",
                 phase=f"phase1 : listing des tournois {year} ({FORMATS[fmt]})",
                 started=time.strftime("%Y-%m-%d %H:%M:%S"), ended=None, error=None)
    r1 = subprocess.run([sys.executable, os.path.join(HERE, "scraper.py"), "phase1", fmt, str(year)],
                        cwd=HERE, stdout=logf, stderr=logf)
    write_status(phase=f"crawl : decks et cartes {fmt} {year}", phase1_rc=r1.returncode)
    r2 = subprocess.run([sys.executable, os.path.join(HERE, "crawl.py"), secs, "all", fmt, str(year)],
                        cwd=HERE, stdout=logf, stderr=logf)
    ok = r1.returncode == 0 and r2.returncode == 0
    write_status(running=False,
                 phase=f"termine {fmt}/{year}" if ok else f"termine avec erreurs {fmt}/{year}",
                 ended=time.strftime("%Y-%m-%d %H:%M:%S"),
                 phase1_rc=r1.returncode, crawl_rc=r2.returncode,
                 error=None if ok else "voir scrape.log")

if __name__ == "__main__":
    main()

# version 2026-11-17c
