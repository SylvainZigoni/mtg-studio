#!/usr/bin/env python3
"""Parallel resumable crawler: python3 crawl.py <seconds> [events|decks]"""
import os, sys, time, threading, queue, urllib.request, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scraper import BASE, parse_event_page, parse_deck_page, db

WORKERS = 4
MIN_INTERVAL = 0.12
_local = threading.local()

def get(url):
    op = getattr(_local, "op", None)
    if op is None:
        op = _local.op = urllib.request.build_opener()
        op.addheaders = [("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"),
                         ("Accept-Encoding", "gzip")]
    for attempt in range(3):
        try:
            r = op.open(BASE + url, timeout=25)
            d = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                d = gzip.decompress(d)
            return d.decode("utf-8", "replace")
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1.5 + attempt)

def crawl(seconds, phase=None):
    c = db()
    c.execute("PRAGMA journal_mode=WAL")
    end = time.time() + seconds
    lock = threading.Lock()
    pend_events = [r for r in c.execute("SELECT eid, format FROM events WHERE fetched=0 ORDER BY eid")]
    pend_decks = [] if phase == "events" else \
        [r for r in c.execute("SELECT did, eid, format FROM decks WHERE fetched=0 ORDER BY did")]
    work = queue.Queue()
    for row in pend_events:
        work.put(("event", row))
    for row in pend_decks:
        work.put(("deck", row))
    total = work.qsize()
    done = [0]
    print(f"pending: {len(pend_events)} events, {len(pend_decks)} decks", flush=True)

    def worker():
        while True:
            if time.time() > end:
                return
            try:
                kind, row = work.get(timeout=2)
            except queue.Empty:
                return
            time.sleep(MIN_INTERVAL)
            if kind == "event":
                eid, f = row
                h = get(f"event?e={eid}&f={f}")
                if h is None:
                    with lock:
                        c.execute("UPDATE events SET fetched=2 WHERE eid=?", (eid,))
                        c.commit()
                    work.task_done(); continue
                name, place, iso, players, stars, decks = parse_event_page(h)
                with lock:
                    c.execute("UPDATE events SET name=COALESCE(?,name), place=COALESCE(?,place), "
                              "event_date=COALESCE(?,event_date), players=COALESCE(?,players), "
                              "stars=?, fetched=1 WHERE eid=?",
                              (name, place, iso, players, stars, eid))
                    for rank, did, dname, player in decks:
                        c.execute("INSERT OR IGNORE INTO decks (did, eid, format, rank, deck_name, player) "
                                  "VALUES (?,?,?,?,?,?)", (did, eid, f, rank, dname, player))
                        work.put(("deck", (did, eid, f)))
                    c.commit()
            else:
                did, eid, f = row
                h = get(f"event?e={eid}&d={did}&f={f}")
                if h is None:
                    with lock:
                        c.execute("UPDATE decks SET fetched=2 WHERE did=?", (did,))
                        c.commit()
                    work.task_done(); continue
                arch, md, sb = parse_deck_page(h)
                with lock:
                    c.execute("UPDATE decks SET archetype=COALESCE(?,archetype), fetched=1 WHERE did=?",
                              (arch, did))
                    for card, qty in md:
                        c.execute("INSERT OR REPLACE INTO deck_cards VALUES (?,?,?,?)", (did, "main", card, qty))
                    for card, qty in sb:
                        c.execute("INSERT OR REPLACE INTO deck_cards VALUES (?,?,?,?)", (did, "side", card, qty))
                    c.commit()
            with lock:
                done[0] += 1
                if done[0] % 500 == 0:
                    print(f"  {done[0]}/{total}", flush=True)
            work.task_done()

    ts = [threading.Thread(target=worker, daemon=True) for _ in range(WORKERS)]
    for t in ts: t.start()
    for t in ts: t.join(max(0, end - time.time()) + 5)
    c.close()

if __name__ == "__main__":
    secs = int(sys.argv[1]) if len(sys.argv) > 1 else 250
    crawl(secs, sys.argv[2] if len(sys.argv) > 2 else None)

# version 2026-11-14b
