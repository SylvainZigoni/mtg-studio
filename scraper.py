#!/usr/bin/env python3
"""MTGTop8 scraper - 2026 events & decks, resumable SQLite back-end."""
import datetime, os, re, sys, time, sqlite3, urllib.request, gzip

BASE = "https://www.mtgtop8.com/"
DB = os.environ.get("MTGTOP8_DB") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "mtgtop8.sqlite")
YEAR = int(datetime.date.today().year)  # année en cours : en 2027, scrappe 2027
DELAY = 0.12
FORMATS = {
    "MO": "Modern", "LE": "Legacy", "VI": "Vintage", "PAU": "Pauper",
    "PEA": "Peasant", "PREM": "Premodern", "EDH": "Duel Commander",
}

def decode_body(d, headers):
    """Décode le corps HTTP sans jamais perdre de caractères :
    charset déclaré dans Content-Type, sinon utf-8 strict, sinon latin-1.
    (mtgtop8.com déclare ISO-8859-1 : un decode utf-8/replace transformait
    chaque accent en U+FFFD écrit définitivement en base.)"""
    ct = headers.get("Content-Type") or ""
    m = re.search(r"charset\s*=\s*[\"']?([\w.-]+)", ct, re.I)
    if m:
        try:
            return d.decode(m.group(1))
        except (LookupError, UnicodeDecodeError):
            pass
    try:
        return d.decode("utf-8")
    except UnicodeDecodeError:
        return d.decode("latin-1")

def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(BASE + url, headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                "Accept-Encoding": "gzip"})
            r = urllib.request.urlopen(req, timeout=20)
            d = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                d = gzip.decompress(d)
            return decode_body(d, r.headers)
        except Exception as e:
            if i == tries - 1:
                print("FAIL", url, e); return None
            time.sleep(1.5)

def db():
    c = sqlite3.connect(DB, check_same_thread=False)
    c.executescript("""
    CREATE TABLE IF NOT EXISTS formats(code TEXT PRIMARY KEY, name TEXT, meta_2026 INTEGER);
    CREATE TABLE IF NOT EXISTS events(
      eid INTEGER PRIMARY KEY, format TEXT, name TEXT, place TEXT,
      event_date TEXT, stars INTEGER, players INTEGER,
      fetched INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS decks(
      did INTEGER PRIMARY KEY, eid INTEGER, format TEXT, rank INTEGER,
      deck_name TEXT, archetype TEXT, player TEXT, fetched INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS deck_cards(
      did INTEGER, board TEXT, card TEXT, qty INTEGER,
      PRIMARY KEY (did, board, card));
    CREATE INDEX IF NOT EXISTS ix_decks_eid ON decks(eid);
    CREATE INDEX IF NOT EXISTS ix_cards_did ON deck_cards(did);
    CREATE INDEX IF NOT EXISTS ix_cards_card ON deck_cards(card);
    CREATE INDEX IF NOT EXISTS ix_events_date ON events(event_date);
    CREATE INDEX IF NOT EXISTS ix_decks_format ON decks(format);
    CREATE TABLE IF NOT EXISTS cards(card TEXT PRIMARY KEY);
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      card, tokenize='trigram', content='cards', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON deck_cards BEGIN
      INSERT OR IGNORE INTO cards(card) VALUES (new.card);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_fts_ai AFTER INSERT ON cards BEGIN
      INSERT INTO cards_fts(rowid, card) VALUES (new.rowid, new.card);
    END;
    CREATE VIRTUAL TABLE IF NOT EXISTS decks_fts USING fts5(
      player, deck_name, archetype, tokenize='trigram', content='decks', content_rowid='did');
    CREATE TRIGGER IF NOT EXISTS decks_fts_ai AFTER INSERT ON decks BEGIN
      INSERT INTO decks_fts(rowid, player, deck_name, archetype)
      VALUES (new.did, COALESCE(new.player,''), COALESCE(new.deck_name,''), COALESCE(new.archetype,''));
    END;
    CREATE TRIGGER IF NOT EXISTS decks_fts_ad AFTER DELETE ON decks BEGIN
      INSERT INTO decks_fts(decks_fts, rowid, player, deck_name, archetype)
      VALUES('delete', old.did, old.player, old.deck_name, old.archetype);
    END;
    CREATE TRIGGER IF NOT EXISTS decks_fts_au AFTER UPDATE ON decks BEGIN
      INSERT INTO decks_fts(decks_fts, rowid, player, deck_name, archetype)
      VALUES('delete', old.did, old.player, old.deck_name, old.archetype);
      INSERT INTO decks_fts(rowid, player, deck_name, archetype)
      VALUES (new.did, COALESCE(new.player,''), COALESCE(new.deck_name,''), COALESCE(new.archetype,''));
    END;
    """)
    # backfill one-shot de la FTS si la table vient d'etre creee sur une base deja remplie
    if c.execute('PRAGMA user_version').fetchone()[0] < 1:
        c.execute("INSERT INTO decks_fts(rowid, player, deck_name, archetype) SELECT did, COALESCE(player,''), COALESCE(deck_name,''), COALESCE(archetype,'') FROM decks")
        c.execute('PRAGMA user_version=1')
        c.commit()
    # backfill one-shot du dictionnaire de cartes + FTS trigram (recherche par carte)
    # (commit explicite : sqlite3 Python ouvre une transaction implicite, sans commit
    #  le close() fait un ROLLBACK et le backfill est perdu)
    if c.execute('PRAGMA user_version').fetchone()[0] < 2:
        c.execute("INSERT OR IGNORE INTO cards(card) SELECT DISTINCT card FROM deck_cards")
        c.execute("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
        c.execute('PRAGMA user_version=2')
        c.commit()
    return c

def parse_event_rows(h):
    rows = re.findall(
        r'<td width=70% class=S14><a href=event\?e=(\d+)&f=\w+>([^<]+)</a>\s*'
        r'(?:@ <a class=und[^>]*>([^<]*)</a>)?.*?</td>.*?class=S12>(\d\d/\d\d/\d\d)</td>',
        h, re.S)
    out = []
    for eid, name, place, d in rows:
        dd, mm, yy = d.split("/")
        out.append((int(eid), name.strip(), (place or "").strip(), f"20{yy}-{mm}-{dd}"))
    return out

def find_meta_year(h, year):
    m = re.search(rf'f=\w+&meta=(\d+)&a?="?><div[^>]*>All {year} Decks', h)
    return int(m.group(1)) if m else None

def parse_event_page(h):
    t = re.search(r'<div class=event_title>([^<]+?)(?:\s*@\s*(?:<a[^>]*>)?([^<]*))?</div>', h)
    name, place = (t.group(1).strip(), (t.group(2) or "").strip()) if t else (None, None)
    m = re.search(r'(\d+) players? - (\d\d)/(\d\d)/(\d\d)', h)
    players = int(m.group(1)) if m else None
    iso = f"20{m.group(4)}-{m.group(3)}-{m.group(2)}" if m else None
    stars = len(re.findall(r'<img src=/graph/star\.png>', h))
    decks = re.findall(
        r'align=center class=S14>([\d\-]+)</div>.*?href=\?e=\d+&d=(\d+)&f=\w+>[^<]*(?:<img[^>]*>)?</a>.*?'
        r'href=\?e=\d+&d=\d+&f=\w+>([^<]+)</a>.*?class=player href=search\?player=[^>]*>([^<]+)</a>', h, re.S)
    return name, place, iso, players, stars, [(int(r.split('-')[0]), int(d), n.strip(), p.strip()) for r, d, n, p in decks]

def parse_deck_page(h):
    a = re.search(r'archetype\?a=\d+>([^<]+) decks', h)
    arch = a.group(1).strip() if a else None
    rows = re.findall(r'<div id=(md|sb)\w+ class="deck_line[^"]*"[^>]*>\s*(\d+) <span class=L14>([^<]+)</span>', h)
    md, sb = [], []
    for board, qty, card in rows:
        (md if board == "md" else sb).append((card.strip(), int(qty)))
    return arch, md, sb

def phase1(fmt=None, year=None):
    year = year or YEAR
    c = db()
    for f, fname in FORMATS.items():
        if fmt and f != fmt:
            continue
        h = get(f"format?f={f}")
        if not h:
            continue
        meta = find_meta_year(h, year)
        print(f"{fname} {year}: meta={meta}", flush=True)
        seen, cp = set(), 1
        for eid, name, place, iso in parse_event_rows(h):  # page principale : section "LAST 20 EVENTS"
            if eid not in seen:
                seen.add(eid)
                if iso.startswith(str(year)):
                    c.execute("INSERT OR IGNORE INTO events (eid, format, name, place, event_date) VALUES (?,?,?,?,?)",
                              (eid, f, name, place, iso))
        c.commit()
        if meta is None:
            continue
        c.execute("INSERT OR REPLACE INTO formats VALUES (?,?,?)", (f, fname, meta))
        while True:
            h = get(f"format?f={f}&meta={meta}&cp={cp}")
            if not h:
                break
            new = 0
            for eid, name, place, iso in parse_event_rows(h):
                if eid not in seen:
                    seen.add(eid); new += 1
                    if iso.startswith(str(year)):
                        c.execute("INSERT OR IGNORE INTO events (eid, format, name, place, event_date) VALUES (?,?,?,?,?)",
                                  (eid, f, name, place, iso))
            c.commit()
            if f"meta={meta}&cp={cp+1}" not in h:
                break
            cp += 1
            time.sleep(DELAY)
        print(f"  -> {len(seen)} events seen", flush=True)
    c.close()

def status():
    c = db()
    q = lambda s: c.execute(s).fetchone()[0]
    print(f"events {q('SELECT COUNT(*) FROM events WHERE fetched=1')}/{q('SELECT COUNT(*) FROM events')} | "
          f"decks {q('SELECT COUNT(*) FROM decks WHERE fetched=1')}/{q('SELECT COUNT(*) FROM decks')} | "
          f"card rows {q('SELECT COUNT(*) FROM deck_cards')}")
    for f, name, meta in c.execute("SELECT code, name, meta_2026 FROM formats"):
        et = q(f"SELECT COUNT(*) FROM events WHERE format='{f}'")
        ef = q(f"SELECT COUNT(*) FROM events WHERE format='{f}' AND fetched=1")
        dt = q(f"SELECT COUNT(*) FROM decks WHERE format='{f}'")
        df = q(f"SELECT COUNT(*) FROM decks WHERE format='{f}' AND fetched=1")
        print(f"  {name:15s} events {ef}/{et}  decks {df}/{dt}")
    c.close()

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "phase1":
        phase1(sys.argv[2] if len(sys.argv) > 2 else None,
               int(sys.argv[3]) if len(sys.argv) > 3 else None)
    else:
        status()

# version 2026-11-14b
