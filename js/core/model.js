import { store, SYNC_KEYS, pushState, setSyncBadge, syncState } from './store.js';
import { norm, esc, $, eur, CONDS, COND_LABEL, LANGS, fmtName, FMT_NAMES } from './util.js';
import { getPrintCache, sfPrints, entryPrintSync, entryPrice } from './scryfall.js';
/* ---------------- modèle de collection v2 ----------------
   entries : liste de groupes de cartes réellement possédés :
   { id, name, norm, set, cn, foil, qty, tags:[...] }
   - "tags" remplace les classeurs : un tag par usage (ex: "a vendre",
     "staple commander"). 3 Lightning Bolt peuvent être répartis en
     2 exemplaires "a vendre" + 1 "staple commander".
   - set/cn identifient l'édition précise possédée (symbole, visuel et
     prix de CETTE édition). foil indique si les exemplaires sont foil.
   Migration automatique depuis l'ancien format {norm:{qty,binders}}. */
const OLD_BINDERS = store.get('mtg_binders', null);   // peut être [{id,name}] (v1) ou ['tag'] (v2)
let tags = (() => {
  let b = OLD_BINDERS && OLD_BINDERS.length ? OLD_BINDERS : ['Général'];
  if(b.length && typeof b[0] === 'object') b = b.map(x => x.name);   // migration classeurs v1 -> tags
  b = [...new Set(b)];
  store.set('mtg_binders', b);
  return b;
})();
function loadEntries(){
  const raw = store.get('mtg_collection', null);
  if(raw && raw.v === 2) return (raw.entries || []).map(e => ({foil:false, signed:false, cond:'NM', lang:'en',
    addedAt:null, tags:[], cn:null, set:null, ...e}));
  // --- migration v1 ---
  const out = [];
  if(raw && typeof raw === 'object'){
    const nameOf = id => (OLD_BINDERS||[]).find(b => b.id === id)?.name || null;
    Object.keys(raw).forEach(k => {
      const c = raw[k]; if(!c || !c.qty) return;
      out.push({ id:'e'+Math.random().toString(36).slice(2,10), name:c.name||k, norm:k,
        set:null, cn:null, foil:false, signed:false, cond:'NM', lang:'en',
        addedAt:new Date().toISOString().slice(0,10), qty:c.qty,
        tags:[...new Set((c.binders||[]).map(nameOf).filter(Boolean))] });
    });
  }
  store.set('mtg_collection', {v:2, entries: out});
  return out;
}
let entries = loadEntries();
let collection = {};               // index dérivé : norm -> {name, qty} (compat analyse decks)
let myDecks = store.get('mtg_decks', []);   // decks perso : {id,name,format,createdAt,comments,list:[{name,qty,side}],changelog:[]}
function rebuildIndex(){
  collection = {};
  entries.forEach(e => {
    const c = collection[e.norm] || (collection[e.norm] = {name:e.name, qty:0});
    c.qty += e.qty;
  });
}
rebuildIndex();
let matches = store.get('mtg_matches', []);
const saveColl = () => { rebuildIndex(); store.set('mtg_collection', {v:2, entries}); };
const saveTags = () => store.set('mtg_binders', tags);
const saveMatches = () => store.set('mtg_matches', matches);
const saveDecks = () => store.set('mtg_decks', myDecks);
/* conditions Cardmarket (ordre standard MKM) */
/* langues : affichage + code Scryfall/Cardmarket */
function addEntry(o){             // {name, set, cn, foil, qty, tags, cond, lang, signed}
  const k = norm(o.name);
  const same = entries.find(e => e.norm === k && (e.set||null) === (o.set||null)
    && (e.cn||null) === (o.cn||null) && !!e.foil === !!o.foil && !!e.signed === !!o.signed
    && (e.cond||'NM') === (o.cond||'NM') && (e.lang||'en') === (o.lang||'en')
    && JSON.stringify([...(e.tags||[])].sort()) === JSON.stringify([...(o.tags||[])].sort()));
  if(same){ same.qty += o.qty; }
  else entries.push({ id:'e'+Math.random().toString(36).slice(2,10), norm:k,
    set:null, cn:null, foil:false, signed:false, cond:'NM', lang:'en', addedAt:new Date().toISOString().slice(0,10),
    tags:[], ...o, norm:k });
  saveColl();
}

async function pullState(){
  // au démarrage : la BDD fait foi si le serveur répond
  try{
    const r = await fetch('/api/state');
    if(!r.ok) throw 0;
    const j = await r.json();
    const st = j.state || {};
    if(Object.keys(st).length){
      // la BDD fait foi : on restaure
      SYNC_KEYS.forEach(k => {
        if(k in st) localStorage.setItem(k, typeof st[k] === 'string' ? st[k] : JSON.stringify(st[k]));
      });
      entries = loadEntries(); rebuildIndex();
      matches = store.get('mtg_matches', []);
      myDecks = store.get('mtg_decks', []);
    }else{
      // BDD vide : on y envoie les données locales existantes (première utilisation)
      const hasLocal = SYNC_KEYS.some(k => { const v = localStorage.getItem(k); return v != null && v !== '{}' && v !== '[]'; });
      if(hasLocal) pushState();
    }
    syncState.ok = true;
  }catch(e){ syncState.ok = false; }
  setSyncBadge(syncState.ok === true);
}

export function setEntries(v){ entries = v; }
export function setTags(v){ tags = v; }
export function setMatches(v){ matches = v; }
export function setMyDecks(v){ myDecks = v; }

export { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks };
