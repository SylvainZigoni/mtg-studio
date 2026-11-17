#!/usr/bin/env python3
"""Scraping MTGTop8 complet : phase1 (listing des tournois 2026) puis crawl (decks + cartes).
   Ecrit scrape_status.json, lu par le serveur Node (POST /api/scrape, GET /api/scrape/status).
   Usage : python scrape_run.py [secondes_crawl]   (defaut 3600)"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS = os.path.join(HERE, "scrape_status.json")
LOG = os.path.join(HERE, "scrape.log")

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
    logf = open(LOG, "a", buffering=1, encoding="utf-8", errors="replace")
    sys.stdout = logf
    sys.stderr = logf
    print(f"=== scrape_run demarre {time.strftime('%Y-%m-%d %H:%M:%S')} ===", flush=True)
    secs = sys.argv[1] if len(sys.argv) > 1 else "3600"
    write_status(running=True, phase="phase1 : listing des tournois 2026",
                 started=time.strftime("%Y-%m-%d %H:%M:%S"), ended=None, error=None)
    r1 = subprocess.run([sys.executable, os.path.join(HERE, "scraper.py"), "phase1"], cwd=HERE, stdout=logf, stderr=logf)
    write_status(phase="crawl : decks et cartes", phase1_rc=r1.returncode)
    r2 = subprocess.run([sys.executable, os.path.join(HERE, "crawl.py"), secs], cwd=HERE, stdout=logf, stderr=logf)
    ok = r1.returncode == 0 and r2.returncode == 0
    write_status(running=False, phase="termine" if ok else "termine avec erreurs",
                 ended=time.strftime("%Y-%m-%d %H:%M:%S"),
                 phase1_rc=r1.returncode, crawl_rc=r2.returncode,
                 error=None if ok else "voir scrape.log")

if __name__ == "__main__":
    main()

# version 2026-11-17a
