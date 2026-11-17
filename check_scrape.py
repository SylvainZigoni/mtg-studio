#!/usr/bin/env python3
"""Outil de CONTROLE (lecture seule, aucune ecriture en base) : compare ce que MTGTop8
   affiche pour un format/annee avec ce qui est reellement dans mtgtop8.sqlite.

   Usage :
     python check_scrape.py [FORMAT] [YEAR] [--decks] [--max-events N]
   - sans --decks : compare seulement les evenements (listing pagine, rapide)
   - --decks      : fetche chaque page event et compare les decks (did) un par un
   Exemples :
     python check_scrape.py PREM 2022 --decks     # controle fin PREM 2022
     python check_scrape.py                       # tous formats, annee en cours, events only
   Rapport JSON ecrit dans check_report.json (a cote du script).
   Outil de dev cote projet uniquement : non publie dans le client."""
import json, os, sqlite3, sys, time

from scraper import DB, FORMATS, YEAR, DELAY, get, parse_event_rows, find_meta_year, parse_event_page

HERE = os.path.dirname(os.path.abspath(__file__))


def site_events(fmt, year):
    """Liste les events de `year` pour le format, en parcourant les pages meta paginees."""
    h = get(f"format?f={fmt}")
    if not h:
        return None, {}
    meta = find_meta_year(h, year)
    out = {}
    if meta is None:
        return None, out
    cp = 1
    while True:
        h = get(f"format?f={fmt}&meta={meta}&cp={cp}")
        if not h:
            break
        for eid, name, place, iso in parse_event_rows(h):
            if iso.startswith(str(year)):
                out[eid] = (name, iso)
        if f"meta={meta}&cp={cp+1}" not in h:
            break
        cp += 1
        time.sleep(DELAY)
    return meta, out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    deep = "--decks" in sys.argv
    maxev = int(sys.argv[sys.argv.index("--max-events") + 1]) if "--max-events" in sys.argv else None
    fmt = args[0].upper() if args else None
    year = int(args[1]) if len(args) > 1 else YEAR
    fmts = [fmt] if fmt else list(FORMATS)

    c = sqlite3.connect(DB)
    report = {"year": year, "deep": deep, "generated": time.strftime("%Y-%m-%d %H:%M:%S"), "formats": {}}
    for f in fmts:
        fname = FORMATS.get(f, f)
        print(f"=== {fname} {year} ===", flush=True)
        meta, site = site_events(f, year)
        if meta is None:
            print(f"  meta {year} introuvable sur le site pour {f} (format desactive ?)", flush=True)
            report["formats"][f] = {"error": f"meta {year} introuvable"}
            continue
        ylike = str(year) + "%"
        db_ev = {r[0]: r[1] for r in c.execute(
            "SELECT eid, event_date FROM events WHERE format=? AND event_date LIKE ?", (f, ylike))}
        miss_ev = sorted(set(site) - set(db_ev))
        extra_ev = sorted(set(db_ev) - set(site))
        db_decks = {}
        for eid, did in c.execute(
                "SELECT d.eid, d.did FROM decks d JOIN events e ON e.eid=d.eid WHERE d.format=? AND e.event_date LIKE ?",
                (f, ylike)):
            db_decks.setdefault(eid, set()).add(did)
        res = {"meta": meta, "site_events": len(site), "db_events": len(db_ev),
               "missing_events": miss_ev, "extra_events": extra_ev,
               "db_decks": sum(len(v) for v in db_decks.values()),
               "site_decks": None, "missing_decks": [], "events_incomplets": []}
        print(f"  events: site={len(site)} db={len(db_ev)} manquants={len(miss_ev)} en_trop={len(extra_ev)}", flush=True)
        if deep:
            eids = sorted(site)
            if maxev:
                eids = eids[:maxev]
            site_decks = {}
            for i, eid in enumerate(eids):
                h = get(f"event?e={eid}&f={f}")
                if h:
                    site_decks[eid] = {d[1] for d in parse_event_page(h)[5]}  # dids (int)
                if (i + 1) % 50 == 0:
                    print(f"    {i+1}/{len(eids)} pages event", flush=True)
                time.sleep(DELAY)
            miss_dids = []
            for eid in eids:
                sd = site_decks.get(eid, set())
                dd = db_decks.get(eid, set())
                if sd - dd:
                    res["events_incomplets"].append(
                        {"eid": eid, "site": len(sd), "db": len(dd), "manquants": sorted(sd - dd)})
                    miss_dids += sorted(sd - dd)
            res["site_decks"] = sum(len(v) for v in site_decks.values())
            res["missing_decks"] = miss_dids
            print(f"  decks: site={res['site_decks']} db={res['db_decks']} "
                  f"manquants={len(miss_dids)} ({len(res['events_incomplets'])} events incomplets)", flush=True)
        report["formats"][f] = res
    c.close()
    with open(os.path.join(HERE, "check_report.json"), "w", encoding="utf-8") as fp:
        json.dump(report, fp, ensure_ascii=False, indent=1)
    print("rapport -> check_report.json", flush=True)


if __name__ == "__main__":
    main()

# version 2026-11-17d
