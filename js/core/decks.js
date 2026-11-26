import { norm } from './util.js';
import { collection } from './model.js';

/* ---------------- analyse collection ↔ decks ---------------- */
/* parse une liste "4x Carte||2x Autre" -> [[name, qty], ...] */
function parseLists(mainStr, sideStr){
  const parse = s => (s ? s.split('||').map(x => {const m = x.match(/^(\d+)x (.+)$/); return m ? [m[2], +m[1]] : [x,1];}) : []);
  return {main: parse(mainStr), side: parse(sideStr)};
}
/* % de cartes possédées (collection) pour un main/side donné */
function analyzeLists(main, side, withSide){
  const need = new Map();
  const add = (name, qty) => {
    const k = norm(name);
    const cur = need.get(k) || [name, 0, Math.min(collection[k]?.qty||0, qty)];
    cur[1] += qty;
    cur[2] = Math.min(collection[k]?.qty||0, cur[1]);
    need.set(k, cur);
  };
  main.forEach(([n,q]) => add(n,q));
  if(withSide) side.forEach(([n,q]) => add(n,q));
  let tot=0, own=0;
  need.forEach(v => {tot += v[1]; own += v[2];});
  return {need, pct: tot ? own/tot : 1, missingQty: tot-own};
}

export { parseLists, analyzeLists };
