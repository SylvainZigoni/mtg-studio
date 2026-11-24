/* Logique du "playable" partagée entre le contrôleur (thread principal)
   et le worker de calcul (server/utils/playableWorker.js). */
import { normName, collectionQtyMap } from './db.js';

/* version logique de la base decks + collection : tout changement de l'une
   des deux invalide le cache (pendant un scraping actif, COUNT/MAX(did) change
   à chaque batch -> le cache est servi stale et rebuildé en arrière-plan). */
export function playableVersion(c, dataMtime) {
  const v = c.prepare('SELECT COUNT(*) n, MAX(did) m FROM decks WHERE fetched=1').get();
  return v.n + '|' + v.m + '|' + dataMtime;
}

const SQL_PLAYABLE = `SELECT d.did, d.format, d.rank, d.deck_name, d.archetype, d.player,
      e.name, e.place, e.event_date, d.eid, e.players,
      (SELECT group_concat(qty || 'x ' || card, '||') FROM
         (SELECT qty, card FROM deck_cards WHERE did = d.did AND board = 'main' ORDER BY qty DESC, card)) AS main,
      (SELECT group_concat(qty || 'x ' || card, '||') FROM
         (SELECT qty, card FROM deck_cards WHERE did = d.did AND board = 'side' ORDER BY qty DESC, card)) AS side
    FROM decks d JOIN events e ON e.eid = d.eid WHERE d.fetched = 1`;

const parseList = s => s ? s.split('||').map(x => { const m = x.match(/^(\d+)x (.+)$/); return m ? [m[2], +m[1]] : [x, 1]; }) : [];

/* pct = cartes possédées / cartes requises (min par nom, comme analyze() client) */
function calcPct(coll, lists) {
  const need = new Map();
  for (const L of lists) for (const [n, q] of L) {
    const k = normName(n);
    const cur = need.get(k) || [0, 0];
    cur[0] += q;
    cur[1] = Math.min(coll.get(k) || 0, cur[0]);
    need.set(k, cur);
  }
  let tot = 0, own = 0;
  need.forEach(v => { tot += v[0]; own += v[1]; });
  return { pct: tot ? own / tot : 1, missing: tot - own };
}

export function buildPlayable(c) {
  const coll = collectionQtyMap();
  const rows = c.prepare(SQL_PLAYABLE).all();
  return rows.map(r => {
    const main = parseList(r.main), side = parseList(r.side);
    const a = calcPct(coll, [main]);
    const b = calcPct(coll, [main, side]);
    return { did: r.did, fmt: r.format, rank: r.rank, name: r.deck_name, arch: r.archetype, player: r.player,
      evname: r.name, place: r.place, date: r.event_date, eid: r.eid, players: r.players,
      pct: a.pct, missing: a.missing, pctSide: b.pct, missingSide: b.missing };
  });
}
