#!/usr/bin/env python3
"""Exporte mtgtop8_2026_snapshot.sqlite -> decks.json.gz (format attendu par js/core/decks.js).
   Ecrit export_status.json (lu par le serveur Node). Usage : python export_decks.py"""
import gzip, json, os, sqlite3, time

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("MTGTOP8_DB") or os.path.join(HERE, "mtgtop8_2026_snapshot.sqlite")
OUT = os.path.join(HERE, "decks.json.gz")
STATUS = os.path.join(HERE, "export_status.json")
LOG = os.path.join(HERE, "export.log")

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
    import sys
    sys.stdout = logf
    sys.stderr = logf
    write_status(running=True, started=time.strftime("%Y-%m-%d %H:%M:%S"), ended=None, error=None, n=None)
    c = sqlite3.connect(DB)
    decks = c.execute("""
        SELECT d.did, d.format, d.rank, d.deck_name, d.archetype, d.player,
               e.name, e.place, e.event_date, d.eid, e.players
        FROM decks d JOIN events e ON e.eid = d.eid
        WHERE d.fetched = 1
        ORDER BY e.event_date DESC, d.rank, d.did
    """).fetchall()
    out = []
    for did, fmt, rank, dname, arch, player, ename, place, edate, eid, players in decks:
        rows = c.execute(
            "SELECT board, card, qty FROM deck_cards WHERE did=? ORDER BY qty DESC, card",
            (did,)).fetchall()
        main = "||".join(f"{q}x {card}" for b, card, q in rows if b == "main")
        side = "||".join(f"{q}x {card}" for b, card, q in rows if b == "side")
        out.append([did, fmt, rank, dname, arch, player, ename, place, edate, eid, main, side, players])
    c.close()
    tmp = OUT + ".new"
    with open(tmp, "wb") as f:
        with gzip.open(f, "wt", encoding="utf-8") as g:
            json.dump(out, g, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    write_status(running=False, ended=time.strftime("%Y-%m-%d %H:%M:%S"), n=len(out), error=None)
    print(f"export OK: {len(out)} decks -> decks.json.gz", flush=True)

if __name__ == "__main__":
    main()

# version 2026-11-17a
