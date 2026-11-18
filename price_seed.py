#!/usr/bin/env python3
"""
price_seed.py (version 2026-11-14b) — construit prices.db (historique de prix Cardmarket) depuis MTGJSON.

Deux étapes (relançables indépendamment) :
  1) python3 price_seed.py prices      # AllPrices.json.gz -> table series (streaming, ~10-20 min)
  2) python3 price_seed.py cards       # {SET}.json.gz de chaque extension -> table cards (noms, scryfall ids, ~15 min)

Aucune dépendance : bibliothèque standard Python uniquement.
Le fichier AllPrices.json.gz (148 Mo) est téléchargé automatiquement s'il est absent.
"""
import gzip, io, json, os, re, sqlite3, struct, sys, time, urllib.request

BASE_URL = "https://mtgjson.com/api/v5"
HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "prices.db")
CACHE_DIR = os.path.join(HERE, "price_cache")
EPOCH_DAY = 24 * 60 * 60

# ---------------------------------------------------------------- utilitaires
def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def db():
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=OFF")
    return con

def init_db():
    con = db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS series(uuid TEXT PRIMARY KEY, normal BLOB, foil BLOB,
        last_norm REAL, last_foil REAL, last_date TEXT);
    CREATE TABLE IF NOT EXISTS cards(scryfall_id TEXT PRIMARY KEY, uuid TEXT, name TEXT,
        "set" TEXT, cn TEXT, released_at TEXT, artist TEXT, colors TEXT, type_line TEXT,
        cmc REAL, rarity TEXT, image TEXT, reserved INTEGER DEFAULT 0, lang TEXT);
    CREATE INDEX IF NOT EXISTS cards_setcn ON cards("set", cn);
    CREATE INDEX IF NOT EXISTS cards_name ON cards(name);
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    """)
    # migration : colonnes metadonnees ajoutees pour la vue Marche
    cols = {r[1] for r in con.execute("PRAGMA table_info(cards)")}
    for col, decl in (("artist","TEXT"),("colors","TEXT"),("type_line","TEXT"),("cmc","REAL"),
                      ("rarity","TEXT"),("image","TEXT"),("reserved","INTEGER DEFAULT 0"),("lang","TEXT")):
        if col not in cols:
            con.execute(f"ALTER TABLE cards ADD COLUMN {col} {decl}")
    con.commit()
    return con

def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    log(f"Téléchargement {url} …")
    tmp = dest + ".part"
    for attempt in range(1, 4):
        try:
            size = os.path.getsize(tmp) if os.path.exists(tmp) else 0
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (MTGStudio)"})
            if size:
                req.add_header("Range", f"bytes={size}-")   # reprise là où ça a coupé
            with urllib.request.urlopen(req, timeout=60) as r:
                resume = size and getattr(r, "status", 200) == 206
                if size and not resume:
                    size = 0   # serveur sans support Range : on repart de zéro
                with open(tmp, "ab" if resume else "wb") as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
            os.replace(tmp, dest)
            return dest
        except Exception as e:
            partial = os.path.getsize(tmp) if os.path.exists(tmp) else 0
            log(f"  tentative {attempt}/3 échouée ({e}) — reprise depuis {partial} octets")
            time.sleep(2 * attempt)
    raise RuntimeError(f"téléchargement impossible après 3 tentatives : {url}")

# --------------------------------------------- étape 1 : AllPrices -> series
# Parseur streaming minimal : descend uniquement dans data/<uuid>/paper/cardmarket/retail
# et capture les maps plates {date: prix}. Tout le reste est sauté au plus vite (find C).

SKIP_RE = re.compile(rb'[{}\[\]"]')
DATE_PT = re.compile(rb'"(\d{4}-\d{2}-\d{2})"\s*:\s*([0-9.]+)')

def pack_points(pts):
    """pts: [(jour_ordinal, prix)] triés -> blob binaire compact (int32 jour + float32 prix)."""
    if not pts:
        return None
    out = bytearray(struct.pack("<I", len(pts)))
    for day, p in pts:
        out += struct.pack("<if", day, p)
    return bytes(out)

def unpack_points(blob):
    if not blob:
        return []
    (n,) = struct.unpack_from("<I", blob, 0)
    off = 4
    out = []
    for _ in range(n):
        day, price = struct.unpack_from("<if", blob, off)
        out.append((day, price))
        off += 8
    return out

def downsample(pts):
    """pts: [(date_str, prix)]. Garde tout l'historique < 400 jours, sinon 1 point par semaine (le dernier)."""
    if not pts:
        return []
    import datetime
    cutoff = datetime.date.today().toordinal() - 400
    pts = [(datetime.date(int(d[:4]), int(d[5:7]), int(d[8:10])).toordinal(), p) for d, p in pts]
    pts.sort()
    out, seen = [], []
    for day, p in pts:                      # triés par date croissante
        if day >= cutoff:
            out.append((day, p))
        else:
            wk = day // 7
            if seen and seen[-1][0] == wk:
                seen[-1] = (wk, day, p)     # dernier point de la semaine
            else:
                seen.append((wk, day, p))
    return [(d, p) for (_, d, p) in seen] + out

class Stream:
    """Lecteur gzip bufferisé avec primitives de scan d'octets."""
    def __init__(self, path, chunk=1 << 20):
        self.f = gzip.open(path, "rb")
        self.buf = b""
        self.pos = 0
        self.chunk = chunk
    def _fill(self):
        if self.pos >= len(self.buf):
            self.buf = self.f.read(self.chunk)
            self.pos = 0
            if not self.buf:
                raise EOFError("fin de flux inattendue")
    def peek(self):
        if self.pos >= len(self.buf): self._fill()
        return self.buf[self.pos:self.pos+1]
    def skip_ws(self):
        """Saute espaces ET virgules (séparateurs de valeurs JSON)."""
        while True:
            while self.pos < len(self.buf) and self.buf[self.pos:self.pos+1] in (b" ", b"\n", b"\t", b"\r", b","):
                self.pos += 1
            if self.pos < len(self.buf): return self.buf[self.pos:self.pos+1]
            self._fill()
    def read_string(self):
        """Lit une chaîne JSON, en ignorant les guillemets échappés (\\")."""
        assert self.skip_ws() == b'"', "chaîne attendue"
        self.pos += 1
        parts = []
        while True:
            idx = self.buf.find(b'"', self.pos)
            if idx != -1:
                j, bs = idx - 1, 0
                while j >= 0 and self.buf[j] == 92:   # backslash
                    bs += 1; j -= 1
                if bs % 2 == 1:   # quote échappée : on continue la chaîne
                    parts.append(self.buf[self.pos:idx + 1])
                    self.pos = idx + 1
                    continue
                parts.append(self.buf[self.pos:idx])
                self.pos = idx + 1
                return b"".join(parts).decode()
            parts.append(self.buf[self.pos:])
            self.buf = self.f.read(self.chunk)
            self.pos = 0
            if not self.buf:
                raise EOFError("chaîne non terminée")
    def skip_value(self):
        """Saute une valeur JSON complète ({}, [], "str", nombre, littéral) au plus vite."""
        c = self.skip_ws()
        if c in (b"{", b"["):
            self.skip_container()
        elif c == b'"':
            self.read_string()
        else:  # nombre / true / false / null
            while True:
                m = re.compile(rb"[,\]}]").search(self.buf, self.pos)
                if m:
                    self.pos = m.start()
                    return
                self.buf = self.f.read(self.chunk)
                self.pos = 0
    def skip_container(self):
        """Saute un conteneur en comptant les crochets hors chaînes (find C, pas boucle Python)."""
        assert self.skip_ws() in (b"{", b"["), "conteneur attendu"
        depth = 0
        in_str = False
        while True:
            m = SKIP_RE.search(self.buf, self.pos)
            if m is None:
                self.buf = self.f.read(self.chunk)
                self.pos = 0
                if not self.buf:
                    raise EOFError("conteneur non terminé")
                continue
            i = m.start()
            ch = self.buf[i]
            if in_str:
                if ch == ord('"'):
                    # échappement \" ?
                    j, bs = i - 1, 0
                    while j >= 0 and self.buf[j] == 92:
                        bs += 1; j -= 1
                    if bs % 2 == 0:
                        in_str = False
            else:
                if ch == ord('"'): in_str = True
                elif ch in (123, 91): depth += 1   # { [
                elif ch in (125, 93):              # } ]
                    depth -= 1
                    if depth == 0:
                        self.pos = i + 1
                        return
            self.pos = i + 1
    def read_flat_map(self):
        """Lit un objet plat {"date": nombre} sans échappements. Retourne [(date, prix)]."""
        assert self.skip_ws() == b"{", "objet attendu"
        self.pos += 1
        pts = []
        while True:
            if self.skip_ws() == b"}":
                self.pos += 1
                return pts
            # clé
            d = self.read_string()
            if self.skip_ws() == b":":
                self.pos += 1
            # valeur (nombre pouvant chevaucher plusieurs buffers)
            NUM_RE = re.compile(rb"[-0-9.eE+]+")
            # valeur (nombre pouvant chevaucher plusieurs buffers)
            parts = []
            while True:
                if self.pos >= len(self.buf):
                    self.buf = self.f.read(self.chunk)
                    self.pos = 0
                    if not self.buf:
                        break
                m = NUM_RE.match(self.buf, self.pos)
                if not m:
                    if parts:
                        break          # le nombre était complet, pos est déjà sur le token suivant
                    raise ValueError(f"nombre attendu près de {self.buf[self.pos:self.pos+30]!r}")
                parts.append(m.group())
                self.pos = m.end()
                if self.pos < len(self.buf):
                    break
            pts.append((d, float(b"".join(parts))))
    def key_or_close(self):
        """Dans un objet : retourne (b'"', clé) ou (b'}', None)."""
        c = self.skip_ws()
        if c == b"}":
            self.pos += 1
            return b"}", None
        return b'"', self.read_string()

def seed_prices():
    src = download(f"{BASE_URL}/AllPrices.json.gz", os.path.join(CACHE_DIR, "AllPrices.json.gz"))
    con = init_db()
    st = Stream(src)
    assert st.skip_ws() == b'{'; st.pos += 1
    # objet racine : itérer meta / data
    n = 0
    t0 = time.time()
    batch = []
    while True:
        kind, key = st.key_or_close()
        if kind == b"}":
            break
        if st.skip_ws() == b":":
            st.pos += 1
        if key != "data":
            st.skip_value()
            continue
        assert st.skip_ws() == b'{'; st.pos += 1
        while True:
            kind, uuid = st.key_or_close()
            if kind == b"}":
                break
            if st.skip_ws() == b":":
                st.pos += 1
            # entrée du uuid
            assert st.skip_ws() == b'{'; st.pos += 1
            normal = foil = None
            while True:
                kind2, k2 = st.key_or_close()
                if kind2 == b"}":
                    break
                if st.skip_ws() == b":":
                    st.pos += 1
                if k2 == "paper":
                    assert st.skip_ws() == b'{'; st.pos += 1
                    while True:
                        k3, prov = st.key_or_close()
                        if k3 == b"}":
                            break
                        if st.skip_ws() == b":":
                            st.pos += 1
                        if prov == "cardmarket":
                            assert st.skip_ws() == b'{'; st.pos += 1
                            while True:
                                k4, sub = st.key_or_close()
                                if k4 == b"}":
                                    break
                                if st.skip_ws() == b":":
                                    st.pos += 1
                                if sub == "retail":
                                    assert st.skip_ws() == b'{'; st.pos += 1
                                    while True:
                                        k5, kind5 = st.key_or_close()
                                        if k5 == b"}":
                                            break
                                        if st.skip_ws() == b":":
                                            st.pos += 1
                                        if kind5 == "normal":
                                            normal = st.read_flat_map()
                                        elif kind5 == "foil":
                                            foil = st.read_flat_map()
                                        else:
                                            st.skip_value()
                                else:
                                    st.skip_value()
                        else:
                            st.skip_value()
                else:
                    st.skip_value()
            if normal or foil:
                nd = downsample(normal or [])
                fd = downsample(foil or [])
                last = (nd or fd)[-1]
                batch.append((uuid, pack_points(nd), pack_points(fd),
                              nd[-1][1] if nd else None,
                              fd[-1][1] if fd else None,
                              last[0]))
                n += 1
                if n % 2000 == 0:
                    con.executemany("INSERT OR REPLACE INTO series VALUES(?,?,?,?,?,?)", batch)
                    con.commit()
                    batch = []
                    log(f"{n} cartes… ({time.time()-t0:.0f}s)")
    if batch:
        con.executemany("INSERT OR REPLACE INTO series VALUES(?,?,?,?,?,?)", batch)
    con.execute("INSERT OR REPLACE INTO meta VALUES('prices_seed', ?)", (time.strftime("%Y-%m-%d"),))
    con.commit()
    log(f"Terminé : {n} cartes avec prix Cardmarket en {time.time()-t0:.0f}s")

# --------------------------------------- étape 2 : extensions -> table cards
def seed_cards():
    os.makedirs(CACHE_DIR, exist_ok=True)
    listfile = download(f"{BASE_URL}/SetList.json.gz", os.path.join(CACHE_DIR, "SetList.json.gz"))
    setlist = json.load(gzip.open(listfile))
    con = init_db()
    codes = [s["code"] for s in setlist["data"]]
    done = set(r[0] for r in con.execute('SELECT DISTINCT "set" FROM cards'))
    todo = [c for c in codes if c not in done]
    log(f"{len(todo)} extensions à importer ({len(done)} déjà faites)…")
    for i, code in enumerate(todo):
        try:
            p = download(f"{BASE_URL}/{code.upper()}.json.gz", os.path.join(CACHE_DIR, f"{code}.json.gz"))
            data = json.load(gzip.open(p)).get("data") or {}
            rows = []
            for c in (data.get("cards") or []) + (data.get("tokens") or []):
                sfid = (c.get("identifiers") or {}).get("scryfallId")
                if sfid:
                    rows.append((sfid, c.get("uuid"), c.get("name"), code,
                                 c.get("number"), c.get("releaseDate")))
            con.executemany('INSERT OR REPLACE INTO cards (scryfall_id, uuid, name, "set", cn, released_at) VALUES(?,?,?,?,?,?)', rows)
            con.commit()
            if i % 25 == 0:
                log(f"extension {code} ({i+1}/{len(todo)}) — {len(rows)} cartes")
        except Exception as e:
            log(f"⚠ {code} ignorée : {e}")
    con.execute("INSERT OR REPLACE INTO meta VALUES('cards_seed', ?)", (time.strftime("%Y-%m-%d"),))
    con.commit()
    total = con.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    log(f"Table cards : {total} cartes")

def _read_scalar(st):
    """Lit un scalaire JSON (nombre/littéral) via le Stream, retourne la valeur Python."""
    parts = []
    while True:
        m = re.compile(rb"[,\]}]").search(st.buf, st.pos)
        if m:
            parts.append(st.buf[st.pos:m.start()]); st.pos = m.start()
            return json.loads(b"".join(parts).decode())
        parts.append(st.buf[st.pos:])
        st.buf = st.f.read(st.chunk); st.pos = 0
        if not st.buf:
            raise EOFError("scalaire non termine")

def seed_cardsmeta():
    """AllPrintings.json.gz -> enrichit la table cards (artiste, couleurs, type, cmc,
    rarete, image, reserved, lang). Un seul gros fichier telecharge (avec reprise), parse en streaming."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    dest = os.path.join(CACHE_DIR, "AllPrintings.json.gz")
    src = download(f"{BASE_URL}/AllPrintings.json.gz", dest)
    con = init_db()
    st = Stream(src)
    assert st.skip_ws() == b"{"; st.pos += 1
    n = 0; t0 = time.time()
    while True:
        kind, key = st.key_or_close()
        if kind == b"}": break
        if st.skip_ws() == b":": st.pos += 1
        if key != "data": st.skip_value(); continue
        assert st.skip_ws() == b"{"; st.pos += 1
        while True:   # chaque extension
            kind, code = st.key_or_close()
            if kind == b"}": break
            if st.skip_ws() == b":": st.pos += 1
            assert st.skip_ws() == b"{"; st.pos += 1   # objet du set
            while True:
                k2, what = st.key_or_close()
                if k2 == b"}": break
                if st.skip_ws() == b":": st.pos += 1
                if what not in ("cards", "tokens"): st.skip_value(); continue
                assert st.skip_ws() == b"["; st.pos += 1
                while True:   # chaque carte du tableau
                    if st.skip_ws() == b"]": st.pos += 1; break
                    assert st.skip_ws() == b"{"; st.pos += 1
                    f = {}
                    while True:
                        k3, key3 = st.key_or_close()
                        if k3 == b"}": break
                        if st.skip_ws() == b":": st.pos += 1
                        if key3 in ("uuid","name","number","rarity","artist","type","language","releaseDate"):
                            f[key3] = st.read_string()
                        elif key3 in ("manaValue","reserved"):
                            f[key3] = _read_scalar(st)
                        elif key3 == "colors":
                            assert st.skip_ws() == b"["; st.pos += 1
                            cols = []
                            while True:
                                if st.skip_ws() == b"]": st.pos += 1; break
                                cols.append(st.read_string())
                            f[key3] = cols
                        elif key3 in ("identifiers","imageUris"):
                            want = "scryfallId" if key3 == "identifiers" else "small"
                            tag = "sfid" if key3 == "identifiers" else "img"
                            assert st.skip_ws() == b"{"; st.pos += 1
                            while True:
                                k4, key4 = st.key_or_close()
                                if k4 == b"}": break
                                if st.skip_ws() == b":": st.pos += 1
                                if key4 == want: f[tag] = st.read_string()
                                else: st.skip_value()
                        else:
                            st.skip_value()
                    sfid = f.get("sfid")
                    if sfid:
                        con.execute("INSERT OR REPLACE INTO cards (scryfall_id, uuid, name, \"set\", cn, released_at, artist, colors, type_line, cmc, rarity, image, reserved, lang) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            (sfid, f.get("uuid"), f.get("name"), code, f.get("number"), f.get("releaseDate"),
                             f.get("artist"), "," + ",".join(f.get("colors") or []) + ",",
                             f.get("type"), f.get("manaValue"), f.get("rarity"),
                             f.get("img"), 1 if f.get("reserved") else 0, f.get("language")))
                        n += 1
                    if n % 20000 == 0:
                        con.commit(); log(f"{n} cartes lues… ({time.time()-t0:.0f}s)")
    con.commit()
    con.execute("INSERT OR REPLACE INTO meta VALUES('cards_meta', ?)", (time.strftime("%Y-%m-%d"),))
    con.commit()
    total = con.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    log(f"Table cards : {total} cartes, metadonnees a jour ({time.time()-t0:.0f}s)")

# ------------------- étape 3 : mise à jour quotidienne (AllPricesToday)
def update_today(force=False):
    """Ajoute les prix du jour à prices.db (à lancer une fois par jour).
    Accumule ainsi l'historique au fil du temps : MTGJSON ne fournit plus
    que ~3 mois de recul dans AllPrices."""
    import datetime
    today = datetime.date.today()
    con = init_db()
    done = con.execute("SELECT v FROM meta WHERE k='today_done'").fetchone()
    if done and done[0] == today.isoformat() and not force:
        log("Prix du jour déjà intégrés.")
        return
    dest = os.path.join(CACHE_DIR, "AllPricesToday.json.gz")
    if os.path.exists(dest):
        os.remove(dest)                    # toujours re-télécharger (5,6 Mo)
    src = download(f"{BASE_URL}/AllPricesToday.json.gz", dest)
    st = Stream(src)
    st.skip_ws()
    assert st.skip_ws() == b"{"; st.pos += 1
    n = 0
    t0 = time.time()
    upd = []
    while True:
        kind, key = st.key_or_close()
        if kind == b"}":
            break
        if st.skip_ws() == b":":
            st.pos += 1
        if key != "data":
            st.skip_value()
            continue
        assert st.skip_ws() == b"{"; st.pos += 1
        while True:
            kind, uuid = st.key_or_close()
            if kind == b"}":
                break
            if st.skip_ws() == b":":
                st.pos += 1
            assert st.skip_ws() == b"{"; st.pos += 1
            normal = foil = None
            while True:
                kind2, k2 = st.key_or_close()
                if kind2 == b"}":
                    break
                if st.skip_ws() == b":":
                    st.pos += 1
                if k2 == "paper":
                    assert st.skip_ws() == b"{"; st.pos += 1
                    while True:
                        k3, prov = st.key_or_close()
                        if k3 == b"}":
                            break
                        if st.skip_ws() == b":":
                            st.pos += 1
                        if prov == "cardmarket":
                            assert st.skip_ws() == b"{"; st.pos += 1
                            while True:
                                k4, sub = st.key_or_close()
                                if k4 == b"}":
                                    break
                                if st.skip_ws() == b":":
                                    st.pos += 1
                                if sub == "retail":
                                    assert st.skip_ws() == b"{"; st.pos += 1
                                    while True:
                                        k5, kind5 = st.key_or_close()
                                        if k5 == b"}":
                                            break
                                        if st.skip_ws() == b":":
                                            st.pos += 1
                                        if kind5 == "normal":
                                            normal = st.read_flat_map()
                                        elif kind5 == "foil":
                                            foil = st.read_flat_map()
                                        else:
                                            st.skip_value()
                                else:
                                    st.skip_value()
                        else:
                            st.skip_value()
                else:
                    st.skip_value()
            if not (normal or foil):
                continue
            nd = normal[-1] if normal else None
            fd = foil[-1] if foil else None
            upd.append((uuid, nd, fd))
            n += 1
            if n % 10000 == 0:
                log(f"{n} cartes lues…")
    log(f"{n} cartes avec prix du jour — écriture dans prices.db…")
    for uuid, nd, fd in upd:
        row = con.execute("SELECT normal, foil, last_norm, last_foil, last_date FROM series WHERE uuid=?", (uuid,)).fetchone()
        if row:
            nb, fb, lnorm, lfoil, last_date = row
            for blob, pt, col in ((nb, nd, "normal"), (fb, fd, "foil")):
                if not pt:
                    continue
                day = datetime.date(int(pt[0][:4]), int(pt[0][5:7]), int(pt[0][8:10])).toordinal()
                if blob is None:
                    packed = pack_points([(day, pt[1])])
                    if col == "normal":
                        nb = packed
                    else:
                        fb = packed
                    continue
                (cnt,) = struct.unpack_from("<I", blob, 0)
                if cnt <= 0:
                    packed = pack_points([(day, pt[1])])
                    if col == "normal":
                        nb = packed
                    else:
                        fb = packed
                    continue
                last_day = struct.unpack_from("<i", blob, 4 + 8 * (cnt - 1))[0]
                if day > last_day:      # append simple en fin de blob
                    ba = bytearray(blob)
                    ba[0:4] = struct.pack("<I", cnt + 1)
                    ba += struct.pack("<if", day, pt[1])
                    if col == "normal":
                        nb = bytes(ba)
                    else:
                        fb = bytes(ba)
            con.execute("UPDATE series SET normal=?, foil=? WHERE uuid=?", (nb, fb, uuid))
            # last_* = queue reelle des blobs (source de verite) : jamais en retard sur les points ajoutes
            def _tail(blob):
                if not blob:
                    return None
                (cnt,) = struct.unpack_from("<I", blob, 0)
                if cnt <= 0:
                    return None
                return struct.unpack_from("<if", blob, 4 + 8 * (cnt - 1))
            tn = _tail(nb)
            tf = _tail(fb)
            if tn:
                lnorm = tn[1]
            if tf:
                lfoil = tf[1]
            days = [t[0] for t in (tn, tf) if t]
            if days:
                try:
                    prev = int(last_date)
                except (TypeError, ValueError):
                    prev = 0
                last_date = str(max(max(days), prev))
            con.execute("UPDATE series SET last_norm=?, last_foil=?, last_date=? WHERE uuid=?",
                        (lnorm, lfoil, last_date, uuid))
        else:
            npts = downsample(normal[-1:] if normal else [])
            fpts = downsample(foil[-1:] if foil else [])
            if npts or fpts:
                con.execute("INSERT OR REPLACE INTO series VALUES(?,?,?,?,?,?)",
                            (uuid, pack_points(npts), pack_points(fpts),
                             npts[-1][1] if npts else None,
                             fpts[-1][1] if fpts else None,
                             (npts or fpts)[-1][0]))
    con.execute("INSERT OR REPLACE INTO meta VALUES('today_done', ?)", (today.isoformat(),))
    con.commit()
    log(f"Prix du jour intégrés ({time.time()-t0:.0f}s).")


# ------------------- étape 4 : routine hebdomadaire (fusion auto-réparatrice)
def _map_to_days(pts):
    """[(date_str, prix)] -> [(jour_ordinal, prix)] trié."""
    import datetime
    out = [(datetime.date(int(d[:4]), int(d[5:7]), int(d[8:10])).toordinal(), p) for d, p in pts]
    out.sort()
    return out


def weekly():
    """Routine hebdomadaire : fusionne la fenêtre ~3 mois d'AllPrices dans
    prices.db. Contrairement à « today » (+1 jour), cette fusion comble
    TOUT trou jusqu'à 3 mois (si la base n'a pas été mise à jour pendant
    longtemps). Si prices.db est absent/vide, fait un seeding complet.
    Idéal en cron local ou en tâche planifiée : une exécution par semaine
    suffit pour ne jamais perdre de point."""
    con = init_db()
    if con.execute("SELECT COUNT(*) FROM series").fetchone()[0] == 0:
        log("prices.db vide : seeding complet (étape prices)…")
        seed_prices()
        con = init_db()
    if con.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0:
        log("table cards vide : import des extensions (étape cards)…")
        seed_cards()
    dest = os.path.join(CACHE_DIR, "AllPrices.json.gz")
    if os.path.exists(dest):
        os.remove(dest)          # toujours re-télécharger (fichier mis à jour par MTGJSON)
    src = download(f"{BASE_URL}/AllPrices.json.gz", dest)
    st = Stream(src)
    assert st.skip_ws() == b"{"; st.pos += 1
    n = news = 0
    t0 = time.time()
    while True:
        kind, key = st.key_or_close()
        if kind == b"}":
            break
        if st.skip_ws() == b":":
            st.pos += 1
        if key != "data":
            st.skip_value()
            continue
        assert st.skip_ws() == b"{"; st.pos += 1
        while True:
            kind, uuid = st.key_or_close()
            if kind == b"}":
                break
            if st.skip_ws() == b":":
                st.pos += 1
            assert st.skip_ws() == b"{"; st.pos += 1
            normal = foil = None
            while True:
                kind2, k2 = st.key_or_close()
                if kind2 == b"}":
                    break
                if st.skip_ws() == b":":
                    st.pos += 1
                if k2 == "paper":
                    assert st.skip_ws() == b"{"; st.pos += 1
                    while True:
                        k3, prov = st.key_or_close()
                        if k3 == b"}":
                            break
                        if st.skip_ws() == b":":
                            st.pos += 1
                        if prov == "cardmarket":
                            assert st.skip_ws() == b"{"; st.pos += 1
                            while True:
                                k4, sub = st.key_or_close()
                                if k4 == b"}":
                                    break
                                if st.skip_ws() == b":":
                                    st.pos += 1
                                if sub == "retail":
                                    assert st.skip_ws() == b"{"; st.pos += 1
                                    while True:
                                        k5, kind5 = st.key_or_close()
                                        if k5 == b"}":
                                            break
                                        if st.skip_ws() == b":":
                                            st.pos += 1
                                        if kind5 == "normal":
                                            normal = st.read_flat_map()
                                        elif kind5 == "foil":
                                            foil = st.read_flat_map()
                                        else:
                                            st.skip_value()
                                else:
                                    st.skip_value()
                        else:
                            st.skip_value()
                else:
                    st.skip_value()
            if not (normal or foil):
                continue
            nd = _map_to_days(normal or [])
            fd = _map_to_days(foil or [])
            n += 1
            row = con.execute("SELECT normal, foil FROM series WHERE uuid=?", (uuid,)).fetchone()
            if row is None:
                nds, fds = downsample(nd), downsample(fd)
                con.execute("INSERT OR REPLACE INTO series VALUES(?,?,?,?,?,?)",
                            (uuid, pack_points(nds), pack_points(fds),
                             nds[-1][1] if nds else None,
                             fds[-1][1] if fds else None,
                             (nds or fds)[-1][0]))
                news += 1
            else:
                changed = False
                for blob, pts, col in ((row[0], nd, "normal"), (row[1], fd, "foil")):
                    if not pts:
                        continue
                    if blob is None:
                        con.execute(f"UPDATE series SET {col}=? WHERE uuid=?",
                                    (pack_points(downsample(pts)), uuid))
                        changed = True
                        continue
                    (cnt,) = struct.unpack_from("<I", blob, 0)
                    old = [(struct.unpack_from("<i", blob, 4 + 8 * k)[0],
                            struct.unpack_from("<f", blob, 8 + 8 * k)[0]) for k in range(cnt)]
                    have = {d for d, _ in old}
                    add = [p for p in pts if p[0] not in have]   # comble aussi les trous intérieurs (pas que la queue)
                    if not add:
                        continue
                    merged = sorted(old + add)
                    con.execute(f"UPDATE series SET {col}=? WHERE uuid=?", (pack_points(merged), uuid))
                    changed = True
                    news += 1
                # rafraîchit les colonnes "last_*"
                lrow = con.execute("SELECT last_norm, last_foil, last_date FROM series WHERE uuid=?", (uuid,)).fetchone()
                ln = nd[-1][1] if nd else None
                lf = fd[-1][1] if fd else None
                lastd = (nd or fd)[-1][0]
                if lrow and (ln is not None or lf is not None):
                    try:
                        prev = int(lrow[2])
                    except (TypeError, ValueError):
                        prev = 0
                    con.execute("UPDATE series SET last_norm=?, last_foil=?, last_date=? WHERE uuid=?",
                                (ln if ln is not None else lrow[0],
                                 lf if lf is not None else lrow[1],
                                 max(lastd, prev), uuid))
            if n % 5000 == 0:
                con.commit()
                log(f"{n} cartes fusionnées… (+{news})")
    con.execute("INSERT OR REPLACE INTO meta VALUES('last_weekly', ?)", (time.strftime("%Y-%m-%d"),))
    con.commit()
    log(f"Fusion terminée : {n} cartes vues, {news} ajouts, en {time.time()-t0:.0f}s")


if __name__ == "__main__":
    os.makedirs(CACHE_DIR, exist_ok=True)
    what = sys.argv[1] if len(sys.argv) > 1 else "prices"
    con = init_db()
    con.execute("INSERT OR REPLACE INTO meta VALUES('run', ?)", (f"{what} {time.strftime('%Y-%m-%d %H:%M:%S')} pid={os.getpid()}",))
    con.commit()
    try:
        if what == "prices":
            seed_prices()
        elif what == "cards":
            seed_cards()
        elif what == "cardsmeta":
            seed_cardsmeta()
        elif what == "today":
            update_today(force="--force" in sys.argv)
        elif what == "weekly":
            weekly()
        else:
            print(__doc__)
    finally:
        try:
            con.execute("DELETE FROM meta WHERE k='run'")
            con.commit()
        except Exception:
            pass
