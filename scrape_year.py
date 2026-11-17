#!/usr/bin/env python3
"""Scraping MTGTop8 pour UNE annee et UN format.
   Usage : python scrape_year.py <annee> <FORMAT> [secondes_crawl] [--recheck]
   --recheck : remet d'abord les events du couple format/annee a fetched=0 pour re-lister leurs decks
   (utile apres un fix de parsing : les decks deja presents ne sont ni re-telecharges ni doubles).
   Ex    : python scrape_year.py 2022 PREM 3600
   Anti-doublon : cles primaires (eid, did, did+board+card) + INSERT OR IGNORE / REPLACE,
   relancer ne cree aucun doublon. Ecrit scrape_status.json (lu par GET /api/scrape/status)."""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS = os.path.join(HERE, "scrape_status.json")
LOG = os.path.join(HERE, "scrape.log")

sys.path.insert(0, HERE)
from scraper import FORMATS, YEAR, db

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
    recheck = "--recheck" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__); sys.exit(2)
    try:
        year = int(args[0])
    except ValueError:
        print(f"annee invalide : {args[0]}"); sys.exit(2)
    fmt = args[1].upper()
    secs = args[2] if len(args) > 2 else "3600"
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
    if recheck:
        cc = db()
        cc.execute("UPDATE events SET fetched=0 WHERE format=? AND event_date LIKE ?", (fmt, str(year) + "%"))
        cc.commit()
        n = cc.execute("SELECT COUNT(*) FROM events WHERE format=? AND event_date LIKE ? AND fetched=0",
                       (fmt, str(year) + "%")).fetchone()[0]
        cc.close()
        print(f"recheck: {n} events remis a fetched=0 pour {fmt} {year}", flush=True)
        write_status(phase=f"recheck : {n} events remis a jour ({fmt} {year})")
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
