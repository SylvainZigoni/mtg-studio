import { store } from './store.js';
import { dbPrice } from './pricedb.js';
import { norm, LANGS } from './util.js';
/* ---------------- Scryfall (avec file de requêtes) ---------------- */
const sfCache = store.get('mtg_sf_cache', {});

/* on ne s'interesse qu'aux cartes PAPIER : game:paper exclut les cartes online/digital (Scryfall digital=false) */
const paper = q => q.includes('game:') ? q : q + ' game:paper';
const saveCache = () => { try{ localStorage.setItem('mtg_sf_cache', JSON.stringify(sfCache)); }catch(e){} };
let sfQueue = [], sfBusy = false;
function sfFetch(url){
  return new Promise((res, rej) => { sfQueue.push({url, res, rej}); sfPump(); });
}
async function sfPump(){
  if(sfBusy) return; sfBusy = true;
  while(sfQueue.length){
    const {url, res, rej} = sfQueue.shift();
    try{
      const r = await fetch(url, {headers:{'Accept':'application/json'}});
      if(!r.ok) throw new Error(r.status);
      res(await r.json());
    }catch(e){ rej(e); }
    await new Promise(t => setTimeout(t, 110)); // ~9 req/s max
  }
  sfBusy = false;
}
async function sfCardByName(name){       // printing le plus ancien
  const k = norm(name);
  if(sfCache[k]) return sfCache[k];
  const j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(paper('!"'+name+'"'))}&unique=prints&order=released&dir=asc&include_extras=true`);
  const c = j.data && j.data.find(x => x.image_status !== 'missing') || j.data[0];
  const sub = c && {
    name: c.name, set: c.set, set_name: c.set_name, released_at: c.released_at,
    id: c.id,
    image: c.image_uris ? c.image_uris.normal : (c.card_faces && c.card_faces[0].image_uris ? c.card_faces[0].image_uris.normal : null),
    art: (c.image_uris && c.image_uris.art_crop) || null,
    eur: c.prices ? (c.prices.eur || c.prices.eur_foil) : null,
    eur_foil: c.prices ? c.prices.eur_foil : null,
    type_line: c.type_line, mv: c.cmc, colors: c.colors,
    oracle: (c.oracle_text || (c.card_faces||[]).map(f=>f.oracle_text).join(' // ')) || '',
    rarity: c.rarity, scryfall_uri: c.scryfall_uri, oracle_id: c.oracle_id,
    reserved: !!c.reserved, legalities: c.legalities || {},
  };
  if(sub){ sfCache[k] = sub; if(Object.keys(sfCache).length % 25 === 0) saveCache(); }
  return sub;
}
async function sfAutocomplete(q){       // anglais d'abord, puis FR/DE/ES/IT/PT (cache des alias)
  const k = norm(q); if(!k) return [];
  const alias = store.get('mtg_name_alias', {});   // alias -> nom anglais
  const langs = ['fr','de','es','it','pt'];
  // 1. autocomplétion anglaise native
  let list = [];
  try{ const j = await sfFetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`);
    list = j.data || []; }catch(e){}
  if(list.length) return list;
  // 2. alias déjà connu ?
  const hits = Object.keys(alias).filter(a => a.includes(k)).map(a => alias[a]);
  if(hits.length) return [...new Set(hits)];
  // 3. recherche par langue d'impression (les noms localisés sont indexés)
  for(const lg of langs){
    try{
      const j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(paper('lang:'+lg+' !"'+q+'"'))}&unique=prints&order=released&dir=asc&include_extras=true`);
      if(j.data && j.data.length){
        const names = [...new Set(j.data.map(c => c.name))];
        if(names.length){ alias[norm(q)] = names[0]; store.set('mtg_name_alias', alias); return names; }
      }
    }catch(e){}
  }
  return [];
}
/* ---- cache des éditions (prints) par carte ---- */
const PRINT_CACHE_KEY = 'mtg_sf_prints';
function getPrintCache(){ const c = store.get(PRINT_CACHE_KEY, {}); return (typeof c === 'object' && !Array.isArray(c)) ? c : {}; }
async function sfPrints(name){   // toutes les éditions d'une carte, triées de la plus ancienne
  const k = norm(name); const cache = getPrintCache();
  if(cache[k]) return cache[k];
  const j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(paper('!"'+name+'"'))}&unique=prints&order=released&dir=asc&include_extras=true`);
  if(!j.data || !j.data.length) return [];
  const prints = j.data.filter(c => c.image_status !== 'missing').map(c => ({
    name:c.name, set:c.set, set_name:c.set_name, cn:c.collector_number, released_at:c.released_at,
    image:(c.image_uris && c.image_uris.normal) || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal) || null,
    image_lg:(c.image_uris && c.image_uris.large) || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.large) || null,
    eur:c.prices ? c.prices.eur : null, eur_foil:c.prices ? c.prices.eur_foil : null,
    type_line:c.type_line, mv:c.cmc, colors:c.colors, rarity:c.rarity, artist:c.artist,
    oracle_id:c.oracle_id, id:c.id, scryfall_uri:c.scryfall_uri, lang:c.lang, printed_name:c.printed_name || null,
    finishes:c.finishes || [], reserved:!!c.reserved, legalities:c.legalities || {},
    oracle:(c.oracle_text || (c.card_faces||[]).map(f=>f.oracle_text).join(' // ')) || '',
  }));
  if(prints.length){
    delete cache[k]; cache[k] = prints;   // rafraîchit la position (LRU par ordre d'insertion)
    const keys = Object.keys(cache);
    if(keys.length > 250) delete cache[keys[0]];
    store.set(PRINT_CACHE_KEY, cache);
  }
  return prints;
}
/* printings d'une carte DANS une édition précise, toutes langues confondues.
   unique=prints déduplique par (set, n°) et masque les langues partageant le même n°
   -> on interroge explicitement chaque langue (OR combiné) pour avoir lang / n° / finishes exacts */
const ALL_LANGS_Q = Object.keys(LANGS).map(l => `lang:${l}`).join(' or ');
async function sfSetPrints(name, setCode){
  let j = null;
  try{
    j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(paper(`set:${setCode} (${ALL_LANGS_Q}) !"${name}"`))}&unique=prints&include_extras=true`);
  }catch(e){}
  if(!j || !j.data || !j.data.length){
    try{
      j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(paper(`set:${setCode} !"${name}"`))}&unique=prints&include_extras=true`);
    }catch(e){}
  }
  if(!j || !j.data) return [];
  return j.data.filter(c => c.image_status !== 'missing').map(c => ({
    name:c.name, printed_name:c.printed_name || null, set:c.set, set_name:c.set_name, cn:c.collector_number,
    released_at:c.released_at,
    image:(c.image_uris && c.image_uris.normal) || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal) || null,
    image_lg:(c.image_uris && c.image_uris.large) || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.large) || null,
    eur:c.prices ? c.prices.eur : null, eur_foil:c.prices ? c.prices.eur_foil : null,
    lang:c.lang, finishes:c.finishes || [], type_line:c.type_line, mv:c.cmc, colors:c.colors, rarity:c.rarity, artist:c.artist,
    oracle_id:c.oracle_id, id:c.id, scryfall_uri:c.scryfall_uri, reserved:!!c.reserved, legalities:c.legalities || {},
    oracle:(c.oracle_text || (c.card_faces||[]).map(f=>f.oracle_text).join(' // ')) || '',
  }));
}
async function printFor(entry){  // l'édition possédée, sinon la plus ancienne
  const prints = await sfPrints(entry.name);
  return prints.find(p => p.set === entry.set && (!entry.cn || p.cn === entry.cn))
      || prints.find(p => p.set === entry.set)
      || prints[0] || null;
}
function entryPrice(entry, print){   // prix de L'édition possédée (foil si foil) — lu dans prices.db via le scryfall_id du print
  if(!print || !print.id) return null;
  return dbPrice(print.id, entry.foil);
}
function setIcon(code){ return SET_ICONS[code] || null; }
let SET_ICONS = {};   // code -> url svg (rempli par sfSets)
function sfSearchUrl(q, page, ord){
  // ord = {order, dir} : tri délégué à Scryfall -> globalement correct entre les pages
  const o = ord ? `&order=${ord.order}&dir=${ord.dir}` : '&order=released&dir=asc';
  return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(paper(q))}${o}&unique=prints&page=${page}&include_extras=true`;
}
async function sfSearch(q, page=1, ord){
  return sfFetch(sfSearchUrl(q, page, ord));
}
async function sfSets(){
  const k = 'mtg_sf_sets';
  let list = store.get(k);
  if(!list){
    const j = await sfFetch('https://api.scryfall.com/sets');
    list = j.data.map(s => ({code:s.code, name:s.name, released_at:s.released_at, icon:s.icon_svg_uri, card_count:s.card_count, digital:s.digital}));
    store.set(k, list);
  }
  list.forEach(s => { if(!s.digital) SET_ICONS[s.code] = s.icon; });
  return list;
}
async function sfArtists(){   // catalogue des noms d'artistes (autocomplétion), mis en cache local
  const k = 'mtg_sf_artists';
  let list = store.get(k);
  if(!list){
    const j = await sfFetch('https://api.scryfall.com/catalog/artist-names');
    list = (j.data || []).slice().sort((a,b) => a.localeCompare(b));
    store.set(k, list);
  }
  return list;
}

/* métadonnées d'une entrée depuis le cache des prints (sync, null si pas encore connu) */
function entryPrintSync(e){
  const prints = getPrintCache()[e.norm];
  if(!prints) return null;
  return prints.find(p => p.set === e.set && (!e.cn || p.cn === e.cn))
      || prints.find(p => p.set === e.set) || prints[0] || null;
}
export { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS };
