#!/usr/bin/env python3
"""
MTG Studio — serveur de données (version 2026-11-15a)
================================
Sert l'app (index.html, app.js, decks.json.gz) ET enregistre vos saisies
(collection, classeurs, matchs, tags) dans une vraie base de données
SQLite : le fichier `mtg_data.db` dans le même dossier.

Aucune dépendance : bibliothèque standard Python uniquement.

Lancement :   python3 server.py            (port 8000 par défaut)
              python3 server.py 9000      (port personnalisé)
Puis ouvrez : http://localhost:8000

API :
  GET  /api/state  -> {ok, state:{...}, updated_at}
  POST /api/state  -> upsert des clés reçues (sauvegarde + snapshot)
  GET  /api/health -> {ok:true}
"""

import base64
import gzip
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mtg_data.db")
BACKUPS_TABLE = "snapshots"   # historique de sauvegardes (garde-fou)
MAX_SNAPSHOTS = 100           # on conserve les 100 dernières

SYNC_KEYS = ("mtg_collection", "mtg_binders", "mtg_matches", "mtg_custom_tags", "mtg_decks")

_db_lock = threading.Lock()


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with _db_lock, db() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at REAL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, v TEXT)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS mkm_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
        )


def load_state():
    with _db_lock, db() as conn:
        rows = conn.execute("SELECT k, v FROM state").fetchall()
    return {k: v for k, v in rows}


# ------------------------------------------------------------------
# Cardmarket (API v2, https://apiv2.cardmarket.com/ws/documentation)
# OAuth 1.0a HMAC-SHA1 signé côté serveur (l'API refuse les appels
# navigateur : pas de CORS). Les jetons sont stockés dans mkm_settings.
# ------------------------------------------------------------------
MKM_BASE = "https://api.cardmarket.com/ws/v2.0"
MKM_KEYS = ("app_token", "app_secret", "access_token", "access_secret", "username")


def mkm_settings():
    with _db_lock, db() as conn:
        rows = conn.execute("SELECT k, v FROM mkm_settings").fetchall()
    return {k: v for k, v in rows}


def mkm_save(data):
    with _db_lock, db() as conn:
        for k, v in data.items():
            if k in MKM_KEYS and v:
                conn.execute(
                    "INSERT INTO mkm_settings (k, v) VALUES (?,?) "
                    "ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                    (k, str(v)),
                )


def _mkm_oauth_header(method, url, s, params=None):
    """En-tête Authorization OAuth 1.0a (HMAC-SHA1) pour Cardmarket."""
    items = {
        "oauth_consumer_key": s.get("app_token", ""),
        "oauth_token": s.get("access_token", ""),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_nonce": secrets.token_hex(8),
        "oauth_version": "1.0",
    }
    enc = urllib.parse.quote
    # paramètres de requête inclus dans la signature
    allp = dict(items)
    for k, v in (params or {}).items():
        allp[k] = str(v)
    base_params = "&".join(f"{enc(str(k), '')}={enc(str(v), '')}" for k, v in sorted(allp.items()))
    base_url = url.split("?")[0]
    if params:
        qs = "&".join(f"{enc(str(k), '')}={enc(str(v), '')}" for k, v in sorted(params.items()))
        url = f"{base_url}?{qs}"
    base = "&".join(enc(x, "") for x in (method.upper(), base_url, base_params))
    key = f"{enc(s.get('app_secret',''), '')}&{enc(s.get('access_secret',''), '')}"
    sig = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    header = "OAuth " + ", ".join(
        f'{enc(k, "")}="{enc(v, "")}"' for k, v in items.items()
    ) + f', oauth_signature="{enc(sig, "")}"'
    return url, header


def mkm_request(method, path, params=None, body=None):
    """Appel signé à l'API Cardmarket. Retourne (status, json|text)."""
    s = mkm_settings()
    if not all(s.get(k) for k in ("app_token", "app_secret", "access_token", "access_secret")):
        return 400, {"ok": False, "error": "Identifiants Cardmarket incomplets (voir Paramètres)."}
    url, header = _mkm_oauth_header(method, MKM_BASE + path, s, params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method.upper())
    req.add_header("Authorization", header)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            try:
                return r.status, json.loads(raw)
            except ValueError:
                return r.status, {"raw": raw}
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = {"error": f"HTTP {e.code}"}
        return e.code, {"ok": False, "error": payload.get("error") or payload, "status": e.code}
    except Exception as e:  # noqa: BLE001
        return 0, {"ok": False, "error": str(e)}


def mkm_route(path, payload):
    """Routage des actions Cardmarket demandées par l'app."""
    sub = path[len("/api/mkm/"):]
    username = mkm_settings().get("username", "")
    if sub == "test":
        st, j = mkm_request("GET", f"/users/{urllib.parse.quote(username)}")
        return st, {"ok": st == 200, "status": st, "user": j.get("user", {}).get("username") if isinstance(j, dict) else None, "error": j.get("error") if isinstance(j, dict) else None}
    if sub == "vacation":
        on = 1 if payload.get("on") else 0
        st, j = mkm_request("PUT", f"/users/{urllib.parse.quote(username)}/vacation", body={"vacation": on})
        return st, {"ok": st == 200 and str(j) not in ("", None), "status": st, "response": j if st != 200 else {"vacation": on}}
    if sub == "articles":
        st, j = mkm_request("GET", f"/users/{urllib.parse.quote(username)}/articles")
        if st != 200:
            return st, {"ok": False, "error": j.get("error") if isinstance(j, dict) else j}
        arts = (j.get("article") if isinstance(j, dict) else None) or []
        return 200, {"ok": True, "articles": arts, "count": j.get("nbArticles") if isinstance(j, dict) else len(arts)}
    if sub == "find_product":
        st, j = mkm_request("GET", "/products/find", params={"search": payload.get("search", ""), "idGame": 1, "idLanguage": 1, "exact": "false"})
        if st != 200 or not isinstance(j, dict):
            return st, {"ok": False, "error": j.get("error") if isinstance(j, dict) else j}
        prods = (j.get("product") if isinstance(j, dict) else None) or []
        return 200, {"ok": True, "products": prods}
    if sub == "article":
        # création d'une annonce : idProduct, count, price, language, condition, comments, isFoil, isSigned...
        st, j = mkm_request("POST", f"/users/{urllib.parse.quote(username)}/articles", body=payload.get("article"))
        return st, {"ok": st in (200, 201), "status": st, "response": j}
    if sub.startswith("article/"):
        aid = sub.split("/")[1]
        if payload.get("_delete"):
            st, j = mkm_request("DELETE", f"/users/{urllib.parse.quote(username)}/article/{aid}")
        else:
            st, j = mkm_request("PUT", f"/users/{urllib.parse.quote(username)}/article/{aid}", body=payload.get("article"))
        return st, {"ok": st == 200, "status": st, "response": j}
    return 404, {"ok": False, "error": "endpoint inconnu"}




def save_state(data):
    """data: dict clé -> valeur (déjà sérialisée en JSON string ou brut)."""
    now = time.time()
    with _db_lock, db() as conn:
        for k, v in data.items():
            if k not in SYNC_KEYS:
                continue
            if not isinstance(v, str):
                v = json.dumps(v, ensure_ascii=False)
            conn.execute(
                "INSERT INTO state (k, v, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at",
                (k, v, now),
            )
        # snapshot complet (garde-fou anti fausse manip / corruption)
        snap = json.dumps(dict(conn.execute("SELECT k, v FROM state").fetchall()),
                          ensure_ascii=False)
        conn.execute("INSERT INTO snapshots (ts, v) VALUES (?,?)", (now, snap))
        conn.execute(
            "DELETE FROM snapshots WHERE id NOT IN "
            "(SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)",
            (MAX_SNAPSHOTS,),
        )


# ------------------------------------------------------------------
# Prix (prices.db optionnel, généré par price_seed.py — voir README)
# ------------------------------------------------------------------
PRICES_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prices.db")
MARKET_WINDOWS = {"1w": 7, "1m": 30, "1y": 365, "3y": 1095, "5y": 1825, "10y": 3650, "rel": None}
_market_cache = {}          # (scope, w) -> (ts, résultat)
MARKET_TTL = 12 * 3600
import datetime as _dt
import struct as _struct


def prices_available():
    return os.path.exists(PRICES_DB)


def pdb():
    return sqlite3.connect(f"file:{PRICES_DB}?mode=ro", uri=True)


def blob_points(blob):
    """Décode un blob de série [(jour_ordinal, prix)] trié."""
    if not blob:
        return []
    (n,) = _struct.unpack_from("<I", blob, 0)
    return list(_struct.iter_unpack("<if", memoryview(blob)[4:4 + 8 * n]))


def blob_at(blob, day):
    """Prix au dernier jour <= day (recherche binaire directe dans le blob)."""
    if not blob:
        return None
    (n,) = _struct.unpack_from("<I", blob, 0)
    lo, hi = 0, n
    while lo < hi:
        mid = (lo + hi) // 2
        if _struct.unpack_from("<i", blob, 4 + 8 * mid)[0] <= day:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0:
        return None
    return _struct.unpack_from("<f", blob, 8 + 8 * (lo - 1))[0]


def _day_str(day):
    return _dt.date.fromordinal(int(day)).isoformat() if day else None


def api_price(params):
    """Historique d'une carte : ?sfid=<scryfall id> (ou ?set=&cn= ou ?uuid=)."""
    if not prices_available():
        return 503, {"ok": False, "error": "prices.db absent : lancez price_seed.py (voir README)."}
    with pdb() as c:
        row = None
        if params.get("sfid"):
            row = c.execute("SELECT uuid, name, \"set\", cn, released_at FROM cards WHERE scryfall_id=?",
                            (params.get("sfid"),)).fetchone()
        elif params.get("uuid"):
            row = (params.get("uuid"), None, None, None, None)
        elif params.get("set") and params.get("cn"):
            row = c.execute("SELECT uuid, name, \"set\", cn, released_at FROM cards WHERE \"set\"=? AND cn=?",
                            (params.get("set"), params.get("cn"))).fetchone()
        if not row:
            return 404, {"ok": False, "error": "carte inconnue dans prices.db (extension importée ?)"}
        uuid = row[0]
        s = c.execute("SELECT normal, foil, last_norm, last_foil, last_date FROM series WHERE uuid=?",
                      (uuid,)).fetchone()
    if not s:
        return 404, {"ok": False, "error": "aucun prix Cardmarket pour cette carte."}
    return 200, {"ok": True, "uuid": uuid,
        "normal": [[_day_str(d), p] for d, p in blob_points(s[0])],
        "foil": [[_day_str(d), p] for d, p in blob_points(s[1])],
        "last": s[2] or s[3], "last_date": _day_str(s[4])}


def _collection_entries():
    """Entrées de collection depuis la BDD de state : [{name,set,cn,foil,qty}]."""
    st = load_state().get("mtg_collection")
    try:
        entries = json.loads(st) if isinstance(st, str) else st
        return entries if isinstance(entries, list) else []
    except Exception:
        return []


def _series_for(c, set_code, cn, name):
    row = None
    if set_code and cn:
        row = c.execute("SELECT uuid FROM cards WHERE \"set\"=? AND cn=?", (set_code, cn)).fetchone()
    if not row:
        return None
    return c.execute("SELECT normal, foil, last_norm, last_foil, last_date, released_at, scryfall_id FROM series "
                     "JOIN cards ON cards.uuid=series.uuid WHERE cards.uuid=?", (row[0],)).fetchone()


def _pct(cur, old):
    return (cur / old - 1) if (old and cur) else None


def api_market(params):
    """Top/flop : ?w=1w|1m|1y|3y|5y|10y|rel &scope=all|collection &limit=20."""
    if not prices_available():
        return 503, {"ok": False, "error": "prices.db absent : lancez price_seed.py (voir README)."}
    w = params.get("w", "1m")
    if w not in MARKET_WINDOWS:
        return 400, {"ok": False, "error": "fenêtre invalide"}
    scope = params.get("scope", "all")
    key = (scope, w)
    now = time.time()
    if key in _market_cache and now - _market_cache[key][0] < MARKET_TTL:
        return 200, _market_cache[key][1]
    limit = min(int(params.get("limit", 20) or 20), 50)
    target_day = _dt.date.today().toordinal() - MARKET_WINDOWS[w] if MARKET_WINDOWS[w] else None
    results = []
    with pdb() as c:
        if scope == "collection":
            entries = _collection_entries()
            for e in entries:
                s = _series_for(c, e.get("set"), str(e.get("cn") or ""), e.get("name"))
                if not s:
                    continue
                normal, foil, last_n, last_f = s[0], s[1], s[2], s[3]
                if e.get("foil"):
                    cur, blob = (last_f, foil)
                else:
                    cur, blob = (last_n, normal)
                if not cur:
                    continue
                old = blob_at(blob, target_day) if target_day else (blob_points(blob)[0][1] if blob_points(blob) else None)
                if old is None or old < 0.1:   # ignore les points aberrants de MTGJSON
                    continue
                pct = _pct(cur, old)
                if pct is None:
                    continue
                results.append({"name": e.get("name"), "set": e.get("set"), "cn": e.get("cn"),
                                "now": round(cur, 2), "was": round(old, 2), "pct": pct,
                                "qty": e.get("qty", 1), "foil": bool(e.get("foil")), "sfid": s[6]})
        else:
            for s in c.execute("SELECT scryfall_id, cards.uuid, name, cards.\"set\", released_at, "
                               "last_norm, normal, last_foil, foil FROM series JOIN cards ON cards.uuid=series.uuid"):
                sfid, uuid, name, set_code, rel, last_n, nblob, last_f, fblob = s
                cur = last_n or last_f
                blob = nblob if last_n else fblob
                if not cur or cur < 0.5:
                    continue
                pts0 = blob_points(blob) if not target_day else None
                if target_day:
                    old = blob_at(blob, target_day)
                else:
                    pts0 = pts0 or blob_points(blob)
                    old = pts0[0][1] if pts0 else None
                if old is None or old < 0.1:   # ignore les points aberrants (<0,10 €) de MTGJSON
                    continue
                pct = _pct(cur, old)
                if pct is None:
                    continue
                results.append({"name": name, "set": set_code, "cn": None, "now": round(cur, 2),
                                "was": round(old, 2), "pct": pct, "qty": 1, "foil": False, "sfid": sfid})
    # dédoublonnage par nom (on garde l'impression la plus chère)
    best = {}
    for r in results:
        k = r["name"].lower()
        if k not in best or r["now"] > best[k]["now"]:
            best[k] = r
    uniq = list(best.values())
    top = sorted(uniq, key=lambda r: r["pct"], reverse=True)[:limit]
    flop = sorted(uniq, key=lambda r: r["pct"])[:limit]
    out = {"ok": True, "w": w, "scope": scope, "top": top, "flop": flop, "n": len(uniq)}
    _market_cache[key] = (now, out)
    return 200, out


def api_collvalue(params):
    """Valorisation de la collection : maintenant et aux fenêtres passées."""
    if not prices_available():
        return 503, {"ok": False, "error": "prices.db absent : lancez price_seed.py (voir README)."}
    windows = {"w1": 7, "m1": 30, "m3": 91, "y1": 365, "y3": 1095, "y5": 1825, "y10": 3650}
    today = _dt.date.today().toordinal()
    sums = {k: 0.0 for k in windows}
    now_val = 0.0
    matched = total = 0
    with pdb() as c:
        for e in _collection_entries():
            total += 1
            s = _series_for(c, e.get("set"), str(e.get("cn") or ""), e.get("name"))
            if not s:
                continue
            blob = s[1] if e.get("foil") else s[0]
            last = (s[3] if e.get("foil") else s[2]) or 0
            if not last:
                continue
            matched += 1
            qty = e.get("qty", 1)
            now_val += last * qty
            for k, days in windows.items():
                old = blob_at(blob, today - days)
                if old is None:
                    pts0 = blob_points(blob)
                    old = pts0[0][1] if pts0 else None
                if old:
                    sums[k] += old * qty
    return 200, {"ok": True, "now": round(now_val, 2), "matched": matched, "total": total,
                 "past": {k: round(v, 2) for k, v in sums.items()}}


def api_today():
    """Met à jour les prix du jour (AllPricesToday) en tâche de fond. 1 fois/jour max."""
    try:
        import price_seed
    except ImportError:
        return 501, {"ok": False, "error": "price_seed.py introuvable à côté de server.py."}
    def work():
        try:
            price_seed.update_today()
        except Exception as e:  # noqa: BLE001
            print(f"[price/today] erreur : {e}", flush=True)
    threading.Thread(target=work, daemon=True).start()
    return 200, {"ok": True, "started": True}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/state":
            self._send_json(200, {"ok": True, "state": load_state()})
        elif p == "/api/health":
            self._send_json(200, {"ok": True})
        elif p == "/api/price":
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            params = {k: v[0] for k, v in qs.items()}
            st, j = api_price(params)
            self._send_json(st, j)
        elif p == "/api/market":
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            params = {k: v[0] for k, v in qs.items()}
            st, j = api_market(params)
            self._send_json(st, j)
        elif p == "/api/collvalue":
            st, j = api_collvalue({})
            self._send_json(st, j)
        elif p == "/api/price/today":
            st, j = api_today()
            self._send_json(st, j)
        elif p == "/api/mkm/settings":
            s = mkm_settings()
            self._send_json(200, {"ok": True,
                "present": {k: bool(s.get(k)) for k in MKM_KEYS},
                "username": s.get("username", "")})
        else:
            super().do_GET()

    def do_POST(self):
        p = self.path.split("?")[0]
        if p == "/api/state":
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(data, dict):
                    raise ValueError("body must be an object")
                save_state(data)
                self._send_json(200, {"ok": True})
            except Exception as e:  # noqa: BLE001
                self._send_json(400, {"ok": False, "error": str(e)})
        elif p == "/api/mkm/settings":
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                mkm_save(data)
                self._send_json(200, {"ok": True})
            except Exception as e:  # noqa: BLE001
                self._send_json(400, {"ok": False, "error": str(e)})
        elif p.startswith("/api/mkm/"):
            try:
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                st, j = mkm_route(p, payload)
                self._send_json(st if st else 502, j)
            except Exception as e:  # noqa: BLE001
                self._send_json(400, {"ok": False, "error": str(e)})
        elif p == "/api/price/today":
            st, j = api_today()
            self._send_json(st, j)
        else:
            self._send_json(404, {"ok": False, "error": "unknown endpoint"})

    def log_message(self, fmt, *args):  # logs discrets
        if "/api/" in (str(args[0]) if args else ""):
            return
        super().log_message(fmt, *args)

    def end_headers(self):
        # l'app est une page vivante : pas de cache agressif
        if self.path.startswith("/index.html") or self.path == "/":
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    init_db()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"MTG Studio : http://localhost:{PORT}")
    print(f"Données enregistrées dans : {DB_PATH}")
    with ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur.")


if __name__ == "__main__":
    main()
