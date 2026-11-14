"use strict";
/* ============================================================
   MTG Studio — app.js
   Collection + Decks MTGTop8 2026 + Matchs + Stats + Tags
   Version 2026-11-14b (phase 2)
   ============================================================ */

/* ---------------- utilitaires ---------------- */
const FMT_NAMES = {MO:"Modern", LE:"Legacy", VI:"Vintage", PAU:"Pauper", PREM:"Premodern", EDH:"Duel Commander"};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => s.toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'').replace(/ \/\/.*/,'').trim();
const eur = v => v==null ? '—' : parseFloat(v).toFixed(2).replace('.',',') + ' €';
const fmtName = f => FMT_NAMES[f] || f;

/* ---------------- garde-fou de démarrage ----------------
   Si index.html et app.js ne sont pas de la même version (ou si une erreur
   précoce survient), on l'affiche dans le loader au lieu de tourner dans le vide. */
window.addEventListener('error', e => {
  const m = document.getElementById('loadmsg');
  if(m) m.textContent = '⚠ Erreur au chargement : ' + (e.message || e.type) +
    ' — vérifiez que index.html et app.js sont de la même version (retéléchargez les deux ensemble).';
  const p = document.getElementById('pickbtn');
  if(p) p.style.display = 'block';
});

/* ---------------- stockage local ---------------- */
const store = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){
    // quota dépassé : vider le cache scryfall
    localStorage.removeItem('mtg_sf_cache'); localStorage.setItem(k, JSON.stringify(v));
  }
    if(window.__booted && SYNC_KEYS.includes(k)) pushState();
  },
};
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
const CONDS = [['MT','Mint'],['NM','Near Mint'],['EX','Excellent'],['GD','Good'],['LP','Light Played'],['PL','Played'],['PO','Poor']];
const COND_LABEL = Object.fromEntries(CONDS);
/* langues : affichage + code Scryfall/Cardmarket */
const LANGS = {en:'Anglais', fr:'Français', de:'Allemand', es:'Espagnol', it:'Italien', pt:'Portugais', ja:'Japonais', ko:'Coréen', ru:'Russe', 'zhs':'Chinois (simplifié)', 'zht':'Chinois (traditionnel)', ph:'Phyrexian', cs:'Tchèque'};
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

/* ---------------- synchronisation BDD (server.py + SQLite) ----------------
   Toutes les saisies sont poussées vers la base SQLite du serveur
   (mtg_data.db) avec un léger délai de regroupement. localStorage reste
   un cache de repli si la page est ouverte hors serveur (file://). */
const SYNC_KEYS = ['mtg_collection','mtg_binders','mtg_matches','mtg_custom_tags','mtg_decks'];
let syncTimer = null, syncOk = null;
function pushState(){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try{
      const body = {};
      SYNC_KEYS.forEach(k => { const raw = localStorage.getItem(k); if(raw != null) body[k] = raw; });
      const r = await fetch('/api/state', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
      syncOk = r.ok; setSyncBadge(true);
    }catch(e){ syncOk = false; setSyncBadge(false); }
  }, 700);
}
function setSyncBadge(up){
  const el = document.getElementById('syncdot');
  if(!el) return;
  el.textContent = up ? '✔ sauvegardé dans la BDD' : '⚠ hors serveur — saisies seulement dans le navigateur';
  el.className = 'syncdot ' + (up ? 'ok' : 'off');
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
    syncOk = true;
  }catch(e){ syncOk = false; }
  setSyncBadge(syncOk === true);
}

/* ---------------- données decks ---------------- */
let DECKS = [];
let EVENTS = [];   // [{eid, fmt, name, place, date, players}] triés par date desc
let PDECKS = null;
function parseDeck(i){
  if(PDECKS && PDECKS[i]) return PDECKS[i];
  if(!PDECKS) PDECKS = {};
  const d = DECKS[i];
  const parse = s => (s ? s.split('||').map(x => {const m = x.match(/^(\d+)x (.+)$/); return m ? [m[2], +m[1]] : [x,1];}) : []);
  return PDECKS[i] = {main: parse(d[10]), side: parse(d[11])};
}
function buildEvents(){
  const map = new Map();
  DECKS.forEach((d,i) => {
    if(!map.has(d[9])) map.set(d[9], {eid:d[9], fmt:d[1], name:d[6], place:d[7], date:d[8], players:d[9]===null?null:null, decks:[]});
    const e = map.get(d[9]);
    if(!e.players && d[12]) e.players = d[12];
    e.decks.push(i);
  });
  EVENTS = [...map.values()].sort((a,b) => (b.date||'').localeCompare(a.date||''));
}

async function loadData(){
  let txt = null;
  try{
    const r = await fetch('decks.json.gz');
    if(r.ok){
      const blob = await r.blob();
      txt = 'DecompressionStream' in window
        ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await r.text();
    }
  }catch(e){}
  if(!txt){ try{ const r2 = await fetch('decks.json'); if(r2.ok) txt = await r2.text(); }catch(e){} }
  if(txt){
    DECKS = JSON.parse(txt);
    buildEvents();
    $('#loader').style.display='none';
    render();
    return;
  }
  $('#loadmsg').textContent = 'Impossible de charger decks.json (page ouverte hors serveur ?). Lancez "python3 -m http.server" dans le dossier, ou choisissez le fichier.';
  $('#pickbtn').style.display='block';
  $('#pickbtn').onclick = () => $('#filepick').click();
  $('#filepick').onchange = e => {
    const rd = new FileReader();
    rd.onload = () => { DECKS = JSON.parse(rd.result); buildEvents();
      $('#loader').style.display='none'; render(); };
    rd.readAsText(e.target.files[0]);
  };
}

/* ---------------- Scryfall (avec file de requêtes) ---------------- */
const sfCache = store.get('mtg_sf_cache', {});
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
  const j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent('!"'+name+'"')}&unique=prints&order=released&dir=asc&include_extras=true`);
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
      const j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent('lang:'+lg+' '+q)}&unique=prints&order=released&dir=asc&include_extras=true`);
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
  const j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent('!"'+name+'"')}&unique=prints&order=released&dir=asc&include_extras=true`);
  if(!j.data || !j.data.length) return [];
  const prints = j.data.filter(c => c.image_status !== 'missing').map(c => ({
    name:c.name, set:c.set, set_name:c.set_name, cn:c.collector_number, released_at:c.released_at,
    image:(c.image_uris && c.image_uris.normal) || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal) || null,
    image_lg:(c.image_uris && c.image_uris.large) || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.large) || null,
    eur:c.prices ? c.prices.eur : null, eur_foil:c.prices ? c.prices.eur_foil : null,
    type_line:c.type_line, mv:c.cmc, colors:c.colors, rarity:c.rarity, artist:c.artist,
    oracle_id:c.oracle_id, lang:c.lang, reserved:!!c.reserved, legalities:c.legalities || {},
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
async function printFor(entry){  // l'édition possédée, sinon la plus ancienne
  const prints = await sfPrints(entry.name);
  return prints.find(p => p.set === entry.set && (!entry.cn || p.cn === entry.cn))
      || prints.find(p => p.set === entry.set)
      || prints[0] || null;
}
function entryPrice(entry, print){   // prix de L'édition possédée (foil si foil)
  if(!print) return null;
  const v = entry.foil ? (print.eur_foil || print.eur) : (print.eur || print.eur_foil);
  return parseFloat(v) || null;
}
function setIcon(code){ return SET_ICONS[code] || null; }
let SET_ICONS = {};   // code -> url svg (rempli par sfSets)
async function sfSearch(q, page=1){
  return sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=released&dir=asc&unique=prints&page=${page}&include_extras=true`);
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

/* ---------------- moteur de tags (point 12) ---------------- */
function deriveTags(c){
  if(!c) return [];
  const t = [];
  const mv = c.mv ?? 0;
  if(mv <= 1) t.push('one drop'); else if(mv == 2) t.push('two drop'); else if(mv == 3) t.push('three drop');
  else if(mv >= 6) t.push('grosse bombe');
  const tl = (c.type_line||'').toLowerCase();
  if(tl.includes('creature')) t.push('creature');
  if(tl.includes('instant')) t.push('instant');
  if(tl.includes('sorcery')) t.push('ritual');
  if(tl.includes('artifact')) t.push('artifact');
  if(tl.includes('enchantment')) t.push('enchantment');
  if(tl.includes('land')) t.push('land');
  if(tl.includes('planeswalker')) t.push('planeswalker');
  if(tl.includes('token')) t.push('token');
  (c.colors||[]).forEach(col => t.push({W:'blanc',U:'bleu',B:'noir',R:'rouge',G:'vert',C:'incolore'}[col]||col));
  const o = (c.oracle||'').toLowerCase();
  if(/add \{|add one mana|add \d mana|mana of any (one )?color/.test(o)) t.push('manadork');
  if(/deals .{0,30}damage to any target/.test(o)) t.push('direct damage');
  if(/deals .{0,30}damage (to|to any|target).{0,20}(player|opponent|any target)/.test(o)) t.push('player direct damage');
  if(/(destroy|exile) target/.test(o)) t.push('removal');
  if(/deals .{0,20}damage to (each|all) (creature|permanent)/.test(o) || /destroy all /.test(o)) t.push('board wipe');
  if(/counter target/.test(o)) t.push('counter');
  if(/search(es)? (your|this) library/.test(o)) t.push('tutor');
  if(/draw(s)? (a|one|two|\d) card/.test(o)) t.push('cantrip');
  if(/you gain|gains?\s\d+\s*life|lifelink/.test(o)) t.push('gain de vie');
  if(/target (player|opponent) (discards|discard)/.test(o) || /discard(s)? .{0,20}card/.test(o)) t.push('discard');
  if(/create .{0,30}token/.test(o)) t.push('génération de token');
  if(/return target .{0,30}card from your graveyard/.test(o)) t.push('réanimation');
  if(/sacrifice/.test(o)) t.push('sacrifice');
  if(/flying/.test(o)) t.push('vol');
  if(/trample/.test(o)) t.push('piétinement');
  if(/haste/.test(o)) t.push('célérité');
  if(/first strike/.test(o)) t.push('initiative');
  if(/deathtouch/.test(o)) t.push('contact mortel');
  if(/lifelink/.test(o)) t.push('lien de vie');
  if(/hexproof/.test(o)) t.push('protection');
  if(/vigilance/.test(o)) t.push('vigilance');
  if(/prowess/.test(o)) t.push('prowess');
  if(/flash/.test(o) && !tl.includes('land')) t.push('flash');
  return [...new Set(t)];
}
const CUSTOM_TAGS = 'mtg_custom_tags';
function getCustomTags(name){ return (store.get(CUSTOM_TAGS, {})[norm(name)] || []); }
function addCustomTag(name, tag){
  const all = store.get(CUSTOM_TAGS, {}); const k = norm(name);
  all[k] = [...new Set([...(all[k]||[]), tag])];
  store.set(CUSTOM_TAGS, all);
}
function removeCustomTag(name, tag){
  const all = store.get(CUSTOM_TAGS, {}); const k = norm(name);
  all[k] = (all[k]||[]).filter(t => t !== tag);
  store.set(CUSTOM_TAGS, all);
}
function allTags(name, c){ return [...deriveTags(c), ...getCustomTags(name)]; }

/* ---------------- moteur de similarité fonctionnelle (inspiré mtgsimilarcards) ----
   On décrit ce que FAIT la carte à partir de son oracle : chaque signature
   regex devient une "capacité", avec une requête Scryfall associée. Les
   cartes similaires partagent les capacités principales, même si le type,
   le coût ou la couleur diffèrent. */
const SIGS = [
  {id:'burn_any',    rx:/deals? .{0,25}damage to any target/,          label:'dégâts directs (n\'importe quelle cible)', q:'o:/deals .+damage to any target/'},
  {id:'burn_player', rx:/deals? .{0,25}damage to (a )?(target )?(player|opponent)/, label:'dégâts au joueur', q:'o:/deals .+damage to (target )?(player|opponent)/'},
  {id:'burn_crea',   rx:/deals? .{0,25}damage to target creature/,     label:'dégâts à une créature', q:'o:/deals .+damage to target creature/'},
  {id:'ping',        rx:/(it|this) (deals|deals? .{0,15}damage)/,      label:'inflige des dégâts', q:'o:/deals .+damage/'},
  {id:'counter',     rx:/counter target (spell|ability)/,              label:'contre un sort', q:'o:/counter target (spell|ability)/'},
  {id:'removal',     rx:/(destroy|exile) target (creature|artifact|enchantment|nonland|permanent)/, label:'destruction/exil ciblé', q:'o:/(destroy|exile) target/'},
  {id:'exile',       rx:/exile/,                                       label:'exil', q:'o:/exile/'},
  {id:'wipe',        rx:/(destroy|exile) (all|each)/,                  label:'nettoie le plateau', q:'o:/(destroy|exile) (all|each)/'},
  {id:'mass_damage', rx:/deals? .{0,20}damage to (each|all)/,          label:'dégâts de masse', q:'o:/deals .+damage to (each|all)/'},
  {id:'draw',        rx:/draw(s)? (a|one|two|three|\d+) card/,         label:'pioche', q:'o:/draw/'},
  {id:'draw_many',   rx:/draw(s)? (two|three|four|\d)[^,.;]*cards?/,   label:'pioche multiple', q:'o:/draw/ +2 cards/'},
  {id:'discard',     rx:/(target (player|opponent) (discards)|discard(s)?)/, label:'fait défausser', q:'o:/discard/'},
  {id:'tutor',       rx:/search(es)? (your|this) library/,             label:'tutor ( Cherchez dans votre bibliothèque )', q:'o:/search(es)? (your|this) library/'},
  {id:'ramp',        rx:/add \{|add one mana|add \d mana/,             label:'accélération de mana', q:'o:/add .+mana/'},
  {id:'token',       rx:/create(s)? .{0,35}token/,                     label:'crée des jetons', q:'o:/create/'},
  {id:'lifegain',    rx:/(you gain|gains?) .{0,10}life|lifelink/,      label:'gain de vie', q:'o:/gain .+life/'},
  {id:'reanimate',   rx:/return .{0,50}(from your graveyard|to the battlefield)/, label:'récupère depuis le cimetière', q:'o:/return .+graveyard/'},
  {id:'bounce',      rx:/return(s)? .{0,40}to (its owner|hand)/,       label:'renvoie en main', q:'o:/return .+(hand|owner)/'},
  {id:'sac',         rx:/sacrifice/,                                   label:'sacrifice', q:'o:/sacrifice/'},
  {id:'pump',        rx:/gets? \+[0-9x]/,                              label:'boost de créature', q:'o:/gets? \+/'},
  {id:'evasion',     rx:/can't be blocked/,                            label:'imblocable', q:'o:/can\'t be blocked/'},
  {id:'flying',      rx:/flying/,                                      label:'vol', q:'o:/flying/'},
  {id:'flash',       rx:/flash/,                                       label:'flash', q:'o:/flash/'},
  {id:'tapdown',     rx:/(doesn't untap|tap target|tap that)/,         label:'engage/bloque une créature', q:'o:/(doesn.t untap|tap target)/'},
  {id:'fights',      rx:/(fights|deals damage equal)/,                label:'combat forcé', q:'o:/fights/'},
  {id:'copy',        rx:/copy (of|that|target)/,                       label:'copie', q:'o:/copy/'},
  {id:'scry',        rx:/scry \d/,                                     label:'scry', q:'o:/scry/'},
  {id:'mill',        rx:/mill(ed)? \d/,                                label:'mill', q:'o:/mill/'},
  {id:'pw_abilities',rx:/loyalty/,                                     label:'planeswalker', q:null},
];
function functionalProfile(c){
  const o = (c.oracle||'').toLowerCase();
  return SIGS.filter(s => s.rx.test(o)).map(s => s);
}
/* requête Scryfall : combine les capacités principales en OR, affine par type. */
function similarQuery(c){
  const sigs = functionalProfile(c);
  const usable = sigs.filter(s => s.q);
  const tl = (c.type_line||'').toLowerCase();
  const parts = [];
  // les 3 capacités les plus discriminantes en OR
  const ors = usable.slice(0,3).map(s => `(${s.q})`);
  if(ors.length) parts.push(`(${ors.join(' or ')})`);
  else parts.push('(o:/draw/ or o:/deals/ or o:/destroy/ or o:/counter/)');   // repli générique
  const types = ['creature','instant','sorcery','artifact','enchantment','land','planeswalker'].filter(x => tl.includes(x));
  if(types.length) parts.push(`(t:${types[0]} or t:${types[1] || types[0]})`);
  if(c.mv != null) parts.push(`mv>=${Math.max(0, c.mv-2)} mv<=${c.mv+2}`);
  return parts.join(' ') + ` -oracle_id:"${c.oracle_id || c.name}"`;
}
function similarityLabels(c){ return functionalProfile(c).slice(0,4).map(s => s.label); }

/* ---------------- analyse collection ↔ decks ---------------- */
function analyze(i, withSide){
  const {main, side} = parseDeck(i);
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

/* ============================================================
   ROUTAGE (menu burger latéral)
   ============================================================ */
let view = 'collection';
function setView(v){
  view = v;
  document.querySelectorAll('.side-link').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if(window.matchMedia('(max-width:900px)').matches) document.body.classList.remove('sideopen');
  render();
}
document.querySelectorAll('.side-link').forEach(b => b.onclick = () => {
  if(b.dataset.grp != null) return;           // les titres de groupe ne naviguent pas
  setView(b.dataset.view);
});
document.querySelectorAll('.side-link[data-grp]').forEach(b => b.onclick = () => {
  const g = b.closest('.side-group'); g.classList.toggle('open');
});
$('#burger') && ($('#burger').onclick = () => {
  if(window.matchMedia('(max-width:900px)').matches) document.body.classList.toggle('sideopen');
  else document.body.classList.toggle('sideoff');
});
$('#scrim') && ($('#scrim').onclick = () => document.body.classList.remove('sideopen'));
function render(){
  const app = $('#app');
  document.querySelectorAll('.side-link').forEach(b => b.classList.toggle('active', !b.dataset.grp && b.dataset.view === view));
  const wrapSets = a => { browseMode='sets'; browseSet=null; vBrowse(a); };
  const wrapSearch = a => { browseMode='search'; vBrowse(a); };
  const R = {
    collection: vCollection, advsearch: wrapSearch, 'browse-sets': wrapSets,
    browse: vBrowse, decks: vDecks, playable: vPlayable, archetypes: vArchetypes,
    mydecks: vMyDecks, market: vMarket, statscoll: vStatsColl, settings: vSettings,
    matches: vMatches, stats: vStats, matchups: vMatchups, cardinfo: vCardInfo,
  };
  (R[view] || vCollection)(app);
}
/* ---- recherche globale (sidebar) : cartes, decks MTGTop8, archétypes, decks perso ---- */
if($('#globsearch') && $('#gsugg')){
const inp = $('#globsearch'), sugg = $('#gsugg');
  let t = null, mode = null, hits = [];
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const q = inp.value.trim();
    if(!q){ sugg.style.display='none'; return; }
    t = setTimeout(async () => {
      const k = norm(q);
      // 1. decks perso
      const mine = myDecks.filter(d => norm(d.name).includes(k) || norm(d.format).includes(k));
      // 2. decks MTGTop8 (nom, archétype, joueur) — max 8
      const t8 = [];
      for(let i = 0; i < DECKS.length && t8.length < 8; i++){
        const d = DECKS[i];
        if(norm(d[3]||'').includes(k) || norm(d[4]||'').includes(k) || norm(d[5]||'').includes(k)) t8.push(i);
      }
      // 3. cartes (autocomplétion multilingue)
      let cards = [];
      try{ cards = await sfAutocomplete(q); }catch(e){}
      cards = cards.slice(0, 8);
      hits = {mine, t8, cards};
      mode = mine.length || t8.length ? 'mixed' : 'cards';
      sugg.innerHTML = `
        ${mine.length ? `<div class="sughead">Decks perso</div>` + mine.map(d =>
          `<div class="sug" data-kind="mydeck" data-id="${d.id}">🧩 ${esc(d.name)} <span class="hint">${esc(d.format)}</span></div>`).join('') : ''}
        ${t8.length ? `<div class="sughead">Decks MTGTop8</div>` + t8.map(i =>
          `<div class="sug" data-kind="t8deck" data-id="${i}">🏆 ${esc(DECKS[i][3]||'')} <span class="hint">${esc(DECKS[i][4]||'')}</span></div>`).join('') : ''}
        ${cards.length ? `<div class="sughead">Cartes</div>` + cards.map(n =>
          `<div class="sug" data-kind="card" data-id="${esc(n)}">🃏 ${esc(n)}</div>`).join('') : ''}
        ${!mine.length && !t8.length && !cards.length ? `<div class="sug hint">Aucun résultat</div>` : ''}`;
      sugg.style.display='block';
    }, 220);
  });
  sugg.addEventListener('mousedown', async e => {
    const it = e.target.closest('.sug'); if(!it) return;
    inp.value=''; sugg.style.display='none';
    if(it.dataset.kind === 'card') showCardInfo(it.dataset.id);
    else if(it.dataset.kind === 't8deck') showDeck(+it.dataset.id);
    else if(it.dataset.kind === 'mydeck'){ setView('mydecks'); openMyDeck(it.dataset.id); }
  });
}
if(!$('#sidebar') || !$('#burger')){
  const m = document.getElementById('loadmsg');
  if(m) m.textContent = '⚠ index.html et app.js ne sont pas de la même version : retéléchargez les deux derniers fichiers publiés et remplacez-les ensemble.';
}

/* ============================================================
   VUE COLLECTION
   ============================================================ */
/* état de la vue collection */
let collF = {q:'', tags:[], colors:[], types:[], cmc:'', pmin:'', pmax:'', set:''};
let collSort = 'name', collDir = 1, collView = 'list', collChecked = new Set(), collPending = false;

/* métadonnées d'une entrée depuis le cache des prints (sync, null si pas encore connu) */
function entryPrintSync(e){
  const prints = getPrintCache()[e.norm];
  if(!prints) return null;
  return prints.find(p => p.set === e.set && (!e.cn || p.cn === e.cn))
      || prints.find(p => p.set === e.set) || prints[0] || null;
}
const TYPES_LIST = ['Creature','Instant','Sorcery','Artifact','Enchantment','Land','Planeswalker','Battle'];

function collFilterAndSort(){
  let list = entries.slice();
  const F = collF;
  const q = norm(F.q);
  if(q) list = list.filter(e => norm(e.name).includes(q));
  if(F.tags.length) list = list.filter(e => F.tags.every(t => (e.tags||[]).includes(t)));
  if(F.set) list = list.filter(e => e.set === F.set);
  // filtres nécessitant les métadonnées (print data) — inconnu => à charger
  const needMeta = F.colors.length || F.types.length || F.cmc !== '' || F.pmin !== '' || F.pmax !== '' ||
    ['cmc','price','date','type','color'].includes(collSort);
  const unknown = [];
  list = list.filter(e => {
    if(!needMeta) return true;
    const p = entryPrintSync(e);
    if(!p){ unknown.push(e); return false; }
    if(F.colors.length && !F.colors.some(c => (p.colors||[]).includes(c))) return false;
    if(F.types.length && !F.types.some(t => (p.type_line||'').toLowerCase().includes(t.toLowerCase()))) return false;
    if(F.cmc !== ''){ const mv = p.mv ?? 0;
      if(F.cmc === '7+' ? mv < 7 : mv !== +F.cmc) return false; }
    const pr = entryPrice(e, p);
    if(F.pmin !== '' && (pr == null || pr < +F.pmin)) return false;
    if(F.pmax !== '' && (pr == null || pr > +F.pmax)) return false;
    return true;
  });
  const val = e => entryPrice(e, entryPrintSync(e)) ?? -1;
  const prType = e => (entryPrintSync(e)?.type_line || 'zzz');
  const prColor = e => (entryPrintSync(e)?.colors || ['Z'])[0];
  list.sort((a,b) => {
    let r = 0;
    switch(collSort){
      case 'name': r = norm(a.name).localeCompare(norm(b.name)); break;
      case 'tag': r = ((a.tags||[])[0]||'zz').localeCompare((b.tags||[])[0]||'zz'); break;
      case 'type': r = prType(a).localeCompare(prType(b)); break;
      case 'color': r = prColor(a).localeCompare(prColor(b)); break;
      case 'cmc': r = (entryPrintSync(a)?.mv ?? 99) - (entryPrintSync(b)?.mv ?? 99); break;
      case 'date': r = (entryPrintSync(a)?.released_at || '').localeCompare(entryPrintSync(b)?.released_at || ''); break;
      case 'price': r = val(a) - val(b); break;
    }
    return r * collDir || norm(a.name).localeCompare(norm(b.name));
  });
  return {list, unknown, needMeta};
}

function vCollection(app){
  const {list, unknown, needMeta} = collFilterAndSort();
  const totalQty = list.reduce((a,e) => a + e.qty, 0);
  const checked = list.filter(e => collChecked.has(e.id));
  const setsOwned = [...new Set(entries.map(e => e.set).filter(Boolean))].sort();
  const tagCounts = {};
  entries.forEach(e => (e.tags||[]).forEach(t => tagCounts[t] = (tagCounts[t]||0) + e.qty));

  app.innerHTML = `
  <div class="panel">
    <h3 style="margin-bottom:10px">Ajouter des cartes</h3>
    <div class="row">
      <div class="suggbox">
        <input type="text" id="cardsearch" placeholder="Nom de la carte (toutes langues : Chantage, Blitzschlag…)" autocomplete="off" style="width:100%">
        <div class="suggestions" id="sugg" style="display:none"></div>
      </div>
      <input type="number" id="cardqty" value="1" min="1" max="99" style="width:80px" title="Quantité">
      <button class="btn" id="addbtn">Ajouter</button>
    </div>
    <p class="hint" style="margin-top:8px">Saisissez en anglais, français, allemand, espagnol, italien ou portugais — l'affichage reste en anglais.
    Collez une liste (« 4 Lightning Bolt », une carte par ligne) pour un import rapide. Cliquez sur une suggestion pour choisir l'édition, le foil et les tags.</p>
  </div>
  <div class="panel">
    <div class="row" style="justify-content:space-between;margin-bottom:6px">
      <h3>Ma collection — ${list.length} groupes · ${totalQty} exemplaires</h3>
      <div class="row">
        <button class="btn ghost" id="viewbtn">${collView==='list'?'▦ Vue vignettes':'☰ Vue liste'}</button>
        <button class="btn ghost" id="expbtn">Exporter</button>
        <button class="btn ghost" id="impbtn">Importer</button>
        <button class="btn danger" id="clearbtn">Vider</button>
        <input type="file" id="impfile" accept=".json" style="display:none">
      </div>
    </div>

    <div class="filterbar">
      <input type="text" id="fq" placeholder="🔍 Rechercher dans la collection…" value="${esc(collF.q)}">
      <span class="colorpick" id="fpick-colors">
        ${['W','U','B','R','G'].map(c => `<span data-c="${c}" class="${collF.colors.includes(c)?'on':''}"
          style="color:${({W:'#f4e8a6',U:'#6db3f2',B:'#b5a6f4',R:'#f26a6a',G:'#7ec97e'})[c]}">${c}</span>`).join('')}
      </span>
      <div class="multisel" id="fpick-types">
        <button class="btn ghost" style="padding:6px 10px">Type : ${collF.types.length||'tous'} ▾</button>
        <div class="opts">${TYPES_LIST.map(t => `<label><input type="checkbox" value="${t}" ${collF.types.includes(t)?'checked':''}> ${t}</label>`).join('')}</div>
      </div>
      <select id="fcmc">
        <option value="">Coût : tous</option>
        ${[0,1,2,3,4,5,6,'7+'].map(v => `<option value="${v}" ${String(collF.cmc)===String(v)?'selected':''}>CMC ${v}${v==='7+'?'+':''}</option>`).join('')}
      </select>
      <input type="number" id="fpmin" placeholder="prix min €" value="${esc(collF.pmin)}" min="0">
      <input type="number" id="fpmax" placeholder="prix max €" value="${esc(collF.pmax)}" min="0">
      <select id="fset">
        <option value="">Extension : toutes</option>
        ${setsOwned.map(s => `<option value="${s}" ${collF.set===s?'selected':''}>${s.toUpperCase()}</option>`).join('')}
      </select>
      <select id="fsort">
        ${[['name','nom (EN)'],['tag','tag'],['type','type'],['color','couleur'],['cmc','coût de mana'],['price','prix'],['date','date de parution']]
          .map(([v,l]) => `<option value="${v}" ${collSort===v?'selected':''}>Tri : ${l}</option>`).join('')}
      </select>
      <button class="btn ghost" id="fsortdir">${collDir===1?'↑':'↓'}</button>
      <button class="btn ghost" id="freset">Réinitialiser</button>
    </div>

    <div class="row" style="margin:8px 0">
      <span class="binderchip ${collF.tags.length?'':'active'}" data-t="__all">Tous (${entries.reduce((a,e)=>a+e.qty,0)})</span>
      ${tags.map(t => `<span class="binderchip ${collF.tags.includes(t)?'active':''}" data-t="${esc(t)}" title="Filtrer">${esc(t)} (${tagCounts[t]||0}) <span class="x" data-deltag="${esc(t)}" title="Supprimer ce tag partout">✕</span></span>`).join('')}
      <button class="btn ghost" id="newtag" style="padding:4px 10px">+ tag</button>
    </div>

    ${checked.length ? `<div class="bulkbar">
      <b>${checked.length} sélectionné(s)</b>
      <button class="btn ghost" id="selall">Tout (dé)sélectionner</button>
      <button class="btn ghost" id="selnone">Aucun</button>
      <select id="bulktags">${tags.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
      <button class="btn" id="bulkadd">+ tag</button>
      <button class="btn ghost" id="bulkdel">− tag</button>
      <button class="btn danger" id="bulkrm">Supprimer de la collection</button>
    </div>` : ''}

    ${needMeta && unknown.length ? `<p class="hint" id="metawait">Chargement des métadonnées des cartes (${unknown.length})…</p>` : ''}
    ${collView === 'grid' ? collGridHTML(list) : collTableHTML(list)}

    <p class="hint" style="margin-top:10px" id="collvalue">Valeur des cartes affichées : calcul…</p>
  </div>`;
  bindCollection(app, {list, unknown, needMeta});
  hydrateColl(list, app);
}

function collTableHTML(list){
  if(!list.length) return `<p class="hint">Aucune carte ne correspond aux filtres. Collection vide ? Ajoutez des cartes ci-dessus.</p>`;
  return `<table><thead><tr>
    <th style="width:26px"></th><th style="width:56px"></th><th>Carte</th><th style="width:120px">Édition</th>
    <th style="width:64px">Qté</th><th style="width:80px">Prix</th><th>Tags</th><th style="width:30px"></th>
  </tr></thead><tbody id="collbody">
  ${list.map(e => {
    const p = entryPrintSync(e);
    const pr = p ? entryPrice(e, p) : null;
    return `<tr class="entryrow" data-id="${e.id}">
      <td><input type="checkbox" class="rowchk" ${collChecked.has(e.id)?'checked':''}></td>
      <td>${p?.image ? `<img class="collthumb cinfo" data-name="${esc(e.name)}" src="${p.image}" data-zoom="${p.image_lg || p.image}" alt="">` : '<span class="hint">…</span>'}</td>
      <td><span class="link cinfo" data-name="${esc(e.name)}">${esc(e.name)}</span>${e.foil?' <span class="foil-badge" title="Foil">FOIL</span>':''}${e.signed?' <span class="pill" title="Signée">✍</span>':''}${e.cond && e.cond!=='NM'?` <span class="pill" title="État">${COND_LABEL[e.cond]||e.cond}</span>`:''}${e.lang && e.lang!=='en'?` <span class="pill">${(LANGS[e.lang]||e.lang).slice(0,3).toUpperCase()}</span>`:''}${p?.reserved?' <span class="rl-badge" title="Reserved List">RL</span>':''}</td>
      <td class="hint">${p ? `${esc(p.set_name||'')} <b>(${p.set?.toUpperCase()})</b> <span class="pill">${p.released_at?.slice(0,4)||''}</span>` : '…'}</td>
      <td><div class="qty-ctl"><button data-a="dec">−</button><b>${e.qty}</b><button data-a="inc">+</button></div></td>
      <td class="p">${pr!=null?eur(pr):'…'}</td>
      <td>${(e.tags||[]).map(t=>`<span class="tagchip filled" data-tag="${esc(t)}">${esc(t)} <span class="x" data-xtag="${esc(t)}" data-xid="${e.id}">✕</span></span>`).join('')||'<span class="hint">—</span>'}
        <button class="btn ghost" data-addtagid="${e.id}" style="padding:0 6px;font-size:12px">+</button></td>
      <td><span class="trash" title="Retirer tout ce groupe de la collection">🗑</span></td>
    </tr>`;}).join('')}
  </tbody></table>`;
}
function collGridHTML(list){
  if(!list.length) return `<p class="hint">Aucune carte ne correspond aux filtres.</p>`;
  return `<div class="collgrid">${list.map(e => {
    const p = entryPrintSync(e);
    return `<div class="colltile" data-id="${e.id}">
      <span class="qtyb">×${e.qty}${e.foil?' ✦':''}</span>
      <label class="chkb"><input type="checkbox" class="rowchk" ${collChecked.has(e.id)?'checked':''}></label>
      ${p?.image ? `<img class="gridthumb cinfo" data-name="${esc(e.name)}" src="${p.image}" data-zoom="${p.image_lg || p.image}" loading="lazy" alt="">` : '<div style="padding:20px" class="hint">chargement…</div>'}
      <div class="info">
        <div class="name cinfo" data-name="${esc(e.name)}">${esc(e.name)}</div>
        <div class="pill">${p ? p.set?.toUpperCase() : ''} ${p && entryPrice(e,p)!=null ? eur(entryPrice(e,p)) : ''}</div>
        <div>${e.cond && e.cond!=='NM' ? `<span class="pill">${COND_LABEL[e.cond]||e.cond}</span>`:''}${e.lang && e.lang!=='en' ? `<span class="pill">${(LANGS[e.lang]||e.lang).slice(0,3).toUpperCase()}</span>`:''}${e.signed?'<span class="pill">✍</span>':''}${p?.reserved?'<span class="rl-badge">RL</span>':''}</div>
        <div>${(e.tags||[]).map(t=>`<span class="tagchip filled" data-tag="${esc(t)}">${esc(t)}</span>`).join('')}</div>
        <div class="qty-ctl"><button data-a="dec">−</button><b>${e.qty}</b><button data-a="inc">+</button></div>
      </div>
    </div>`;}).join('')}</div>`;
}

/* hydratation progressive : prints manquants + prix + valeur affichée */
async function hydrateColl(list, app){
  const todo = list.filter(e => !getPrintCache()[e.norm]);
  for(const e of todo){ try{ await sfPrints(e.name); }catch(err){} }
  if(todo.length){ if(view === 'collection') vCollection(app); return; }
  let sum = 0, known = 0;
  list.forEach(e => { const p = entryPrintSync(e); const pr = p ? entryPrice(e,p) : null; if(pr!=null){ sum += pr * e.qty; known++; } });
  const el = document.getElementById('collvalue');
  if(el) el.textContent = `Valeur des cartes affichées : ${eur(sum)}${known < list.length ? ` (${list.length - known} carte(s) sans prix connu)` : ''}`;
}

function bindCollection(app, ctx){
  // ---- ajout de cartes (multilingue) ----
  const input = app.querySelector('#cardsearch'), sugg = app.querySelector('#sugg');
  let t = null, items = [];
  input.oninput = () => {
    clearTimeout(t); const q = input.value.trim();
    if(q.length < 2){ sugg.style.display='none'; return; }
    t = setTimeout(async () => {
      items = await sfAutocomplete(q);
      if(!items.length){ sugg.style.display='none'; return; }
      sugg.innerHTML = items.slice(0,8).map((n,i)=>`<div data-i="${i}">${esc(n)} <span class="pill">cliquez pour choisir l'édition</span></div>`).join('');
      sugg.style.display='block';
      sugg.querySelectorAll('div').forEach(el => el.onclick = () => {
        input.value = items[el.dataset.i]; sugg.style.display='none'; openPrintPicker(items[el.dataset.i]);
      });
    }, 280);
  };
  input.onkeydown = e => { if(e.key==='Enter'){ e.preventDefault(); app.querySelector('#addbtn').click(); } };
  app.querySelector('#addbtn').onclick = () => {
    const raw = input.value.trim(); if(!raw) return;
    const lines = raw.split(/\n|;/).map(s=>s.trim()).filter(Boolean);
    lines.forEach(l => { const m = l.match(/^(\d+)\s*x?\s+(.+)$/i);
      addEntry(m ? {name:m[2], qty:+m[1], tags:[]} : {name:l, qty:+app.querySelector('#cardqty').value||1, tags:[]}); });
    input.value=''; vCollection(app); hydrateColl(entries, app);
  };
  app.querySelector('#viewbtn').onclick = () => { collView = collView==='list'?'grid':'list'; vCollection(app); };

  // ---- filtres ----
  const upd = () => { collChecked = new Set(); vCollection(app); };
  const fq = app.querySelector('#fq');
  fq.oninput = () => { clearTimeout(fq._t); fq._t = setTimeout(() => { collF.q = fq.value; collChecked = new Set(); vCollection(app); }, 240); };
  app.querySelectorAll('#fpick-colors span').forEach(s => s.onclick = () => {
    s.classList.toggle('on');
    collF.colors = [...app.querySelectorAll('#fpick-colors span.on')].map(x => x.dataset.c); collChecked=new Set(); vCollection(app);
  });
  const ms = app.querySelector('#fpick-types');
  ms.querySelector('button').onclick = e => { e.stopPropagation(); ms.classList.toggle('open'); };
  ms.querySelectorAll('.opts input').forEach(cb => cb.onchange = () => {
    collF.types = [...ms.querySelectorAll('.opts input:checked')].map(x=>x.value); upd();
  });
  document.body.addEventListener('click', ev => { if(!ms.contains(ev.target)) ms.classList.remove('open'); });
  app.querySelector('#fcmc').onchange = e => { collF.cmc = e.target.value; upd(); };
  app.querySelector('#fpmin').onchange = e => { collF.pmin = e.target.value; upd(); };
  app.querySelector('#fpmax').onchange = e => { collF.pmax = e.target.value; upd(); };
  app.querySelector('#fset').onchange = e => { collF.set = e.target.value; upd(); };
  app.querySelector('#fsort').onchange = e => { collSort = e.target.value; vCollection(app); };
  app.querySelector('#fsortdir').onclick = () => { collDir *= -1; vCollection(app); };
  app.querySelector('#freset').onclick = () => { collF = {q:'', tags:[], colors:[], types:[], cmc:'', pmin:'', pmax:'', set:''}; upd(); };

  // ---- chips de tags ----
  app.querySelectorAll('.binderchip[data-t]').forEach(ch => ch.onclick = e => {
    if(e.target.dataset.deltag) return;
    const t = ch.dataset.t;
    if(t === '__all') collF.tags = [];
    else collF.tags = collF.tags.includes(t) ? collF.tags.filter(x=>x!==t) : [...collF.tags, t];
    collChecked = new Set(); vCollection(app);
  });
  app.querySelectorAll('[data-deltag]').forEach(x => x.onclick = e => {
    e.stopPropagation();
    const t = x.dataset.deltag;
    if(!confirm(`Supprimer le tag « ${t} » de toutes les cartes ?`)) return;
    tags = tags.filter(y => y !== t);
    entries.forEach(en => en.tags = (en.tags||[]).filter(y => y !== t));
    saveTags(); saveColl(); collF.tags = collF.tags.filter(y=>y!==t); vCollection(app);
  });
  app.querySelector('#newtag').onclick = () => {
    const n = prompt('Nom du tag ? (ex: a vendre, staple commander)'); if(!n) return;
    tags = [...new Set([...tags, n.trim()])]; saveTags(); vCollection(app);
  };

  // ---- actions ligne : quantités, tags, suppression ----
  app.querySelectorAll('.qty-ctl button').forEach(b => b.onclick = () => {
    const host = b.closest('[data-id]'); const e = entries.find(x=>x.id===host.dataset.id); if(!e) return;
    if(b.dataset.a==='inc') e.qty++;
    else { e.qty--; if(e.qty<=0){ entries = entries.filter(x=>x.id!==e.id); collChecked.delete(e.id); } }
    saveColl(); vCollection(app);
  });
  app.querySelectorAll('.trash').forEach(tr => tr.onclick = () => {
    const e = entries.find(x=>x.id===tr.closest('[data-id]').dataset.id); if(!e) return;
    if(!confirm(`Retirer les ${e.qty} × ${e.name} de la collection ?`)) return;
    entries = entries.filter(x=>x.id!==e.id); collChecked.delete(e.id); saveColl(); vCollection(app);
  });
  app.querySelectorAll('[data-xtag]').forEach(x => x.onclick = () => {
    const e = entries.find(en=>en.id===x.dataset.xid); if(!e) return;
    e.tags = (e.tags||[]).filter(t => t !== x.dataset.xtag); saveColl(); vCollection(app);
  });
  app.querySelectorAll('[data-addtagid]').forEach(bt => bt.onclick = () => {
    const e = entries.find(en=>en.id===bt.dataset.addtagid); if(!e) return;
    promptTagsFor(e);
  });
  app.querySelectorAll('.cinfo').forEach(el => el.onclick = () => showCardInfo(el.dataset.name));

  // ---- checkboxes & actions en masse ----
  app.querySelectorAll('.rowchk').forEach(cb => cb.onchange = () => {
    const id = cb.closest('[data-id]').dataset.id;
    cb.checked ? collChecked.add(id) : collChecked.delete(id);
    const lbl = app.querySelector('.bulkbar b');
    if(!lbl || collChecked.size === 0) vCollection(app);
    else lbl.textContent = `${collChecked.size} sélectionné(s)`;
  });
  const selall = app.querySelector('#selall');
  if(selall) selall.onclick = () => {
    const allSel = ctx.list.length > 0 && ctx.list.every(e => collChecked.has(e.id));
    ctx.list.forEach(e => allSel ? collChecked.delete(e.id) : collChecked.add(e.id));
    vCollection(app);
  };
  const selnone = app.querySelector('#selnone');
  if(selnone) selnone.onclick = () => { collChecked = new Set(); vCollection(app); };
  const bulkAdd = app.querySelector('#bulkadd');
  if(bulkAdd) bulkAdd.onclick = () => {
    const t = app.querySelector('#bulktags').value;
    entries.forEach(e => { if(collChecked.has(e.id)) e.tags = [...new Set([...(e.tags||[]), t])]; });
    saveColl(); vCollection(app);
  };
  const bulkDel = app.querySelector('#bulkdel');
  if(bulkDel) bulkDel.onclick = () => {
    const t = app.querySelector('#bulktags').value;
    entries.forEach(e => { if(collChecked.has(e.id)) e.tags = (e.tags||[]).filter(x=>x!==t); });
    saveColl(); vCollection(app);
  };
  const bulkRm = app.querySelector('#bulkrm');
  if(bulkRm) bulkRm.onclick = () => {
    if(!confirm(`Supprimer ${collChecked.size} groupe(s) de cartes de la collection ?`)) return;
    entries = entries.filter(e => !collChecked.has(e.id)); collChecked = new Set(); saveColl(); vCollection(app);
  };

  // ---- export / import / vider ----
  app.querySelector('#expbtn').onclick = () => {
    const blob = new Blob([JSON.stringify({v:2, entries, tags, matches, exported:new Date().toISOString()},null,1)],{type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='mtg_studio_export.json'; a.click();
  };
  app.querySelector('#impbtn').onclick = () => app.querySelector('#impfile').click();
  app.querySelector('#impfile').onchange = e => {
    const rd = new FileReader();
    rd.onload = () => { try{
      const j = JSON.parse(rd.result);
      if(j.entries){ entries = j.entries.map(x=>({foil:false,tags:[],cn:null,set:null,...x})); saveColl(); }
      else if(j.collection){ store.set('mtg_collection', j.collection); entries = loadEntries(); saveColl(); }  // import v1
      if(j.tags){ tags = [...new Set(j.tags)]; saveTags(); }
      else if(j.binders){ tags = [...new Set(j.binders.map(b=>b.name))]; saveTags(); }
      if(j.matches){ matches = j.matches; saveMatches(); }
      alert('Import réussi'); vCollection(app);
    }catch(err){ alert('Fichier invalide'); } };
    rd.readAsText(e.target.files[0]);
  };
  app.querySelector('#clearbtn').onclick = () => {
    if(confirm('Vider toute la collection ?')){ entries=[]; saveColl(); collChecked=new Set(); vCollection(app); }
  };
}

/* modal : choix de l'édition (printing) lors de l'ajout d'une carte */
async function openPrintPicker(name, preset){
  preset = preset || {};
  let prints = [];
  try{ prints = await sfPrints(name); }catch(e){}
  if(!prints.length){ addEntry({name, qty:1, tags:[]}); vCollection($('#app')); return; }
  let sel = preset.set ? Math.max(0, prints.findIndex(p => p.set === preset.set)) : 0;
  const html = `
  <button class="close" id="mclose">✕</button>
  <h3 style="margin-bottom:4px">${esc(prints[0].name)}</h3>
  <p class="hint">Choisissez l'édition que vous possédez — le visuel, le symbole et le prix suivront cette édition.</p>
  <div id="ppgrid" class="collgrid" style="margin:10px 0">
    ${prints.map((p,i) => `<div class="colltile" data-i="${i}" style="cursor:pointer;${i===sel?'outline:2px solid var(--accent)':''}">
      ${p.image?`<img src="${p.image}" loading="lazy" style="width:100%;aspect-ratio:488/680;object-fit:cover;background:#000">`:''}
      <div class="info"><b>${esc(p.set_name)}</b> <span class="pill">${p.set.toUpperCase()} · ${esc(p.cn)} · ${p.released_at?.slice(0,4)}</span>
      <div class="price">${eur(p.eur)}${p.eur_foil?` / ✦ ${eur(p.eur_foil)}`:''}</div></div>
    </div>`).join('')}
  </div>
  <div class="row" style="flex-wrap:wrap;gap:10px">
    <label class="row" style="gap:6px"><input type="checkbox" id="ppfoil"> Foil</label>
    <label class="row" style="gap:6px"><input type="checkbox" id="ppsigned"> Signée</label>
    <select id="ppcond">
      ${CONDS.map(([v,l]) => `<option value="${v}" ${v==='NM'?'selected':''}>${l}</option>`).join('')}
    </select>
    <span class="row" style="gap:4px" id="pplangwrap">
      <b>Langue :</b>
      <label style="gap:4px"><input type="radio" name="pplang" value="en" checked> EN</label>
      <label style="gap:4px"><input type="radio" name="pplang" value="fr"> FR</label>
      <label style="gap:4px"><input type="radio" name="pplang" value="other"> Autre</label>
      <select id="pplang" style="display:none"></select>
    </span>
    <input type="number" id="ppqty" value="1" min="1" max="99" style="width:80px">
    <select id="pptags" multiple size="${Math.min(6, Math.max(3, tags.length))}" style="min-width:180px">
      ${tags.map(t=>`<option>${esc(t)}</option>`).join('')}
    </select>
    <button class="btn ghost" id="ppnewtag">+ tag</button>
    <button class="btn" id="ppok">Ajouter à la collection</button>
  </div>`;
  openModal(html);
  $('#ppgrid').querySelectorAll('.colltile').forEach(tl => tl.onclick = () => {
    sel = +tl.dataset.i;
    $('#ppgrid').querySelectorAll('.colltile').forEach(x => x.style.outline = '');
    tl.style.outline = '2px solid var(--accent)';
  });
  $('#ppfoil').checked = !!preset.foil;
  // langues disponibles pour cette carte (prints locaux connus + prints scryfall)
  const availLangs = [...new Set(prints.map(p => p.lang).filter(Boolean))];
  const langSel = $('#pplang');
  langSel.innerHTML = availLangs.map(lg => `<option value="${lg}">${LANGS[lg]||lg}</option>`).join('')
    || '<option value="en">Anglais</option>';
  let langVal = preset.lang || 'en';
  document.querySelectorAll('input[name="pplang"]').forEach(r => {
    r.checked = (r.value === 'en' || r.value === 'fr') ? r.value === langVal : r.value === 'other';
    if(r.value === 'other' && r.checked) langSel.style.display = '';
    r.onchange = () => {
      langVal = r.value === 'other' ? langSel.value : r.value;
      langSel.style.display = r.value === 'other' ? '' : 'none';
    };
  });
  langSel.onchange = () => langVal = langSel.value;
  $('#ppnewtag').onclick = () => { const n = prompt('Nom du tag ?');
    if(n){ tags = [...new Set([...tags, n])]; saveTags(); openPrintPicker(name, {set:prints[sel].set, foil:$('#ppfoil').checked}); } };
  $('#ppok').onclick = () => {
    const p = prints[sel];
    const chosen = [...$('#pptags').selectedOptions].map(o=>o.value);
    addEntry({name:prints[0].name, set:p.set, cn:p.cn, foil:$('#ppfoil').checked, qty:+$('#ppqty').value||1,
      cond:$('#ppcond').value, lang:langVal, signed:$('#ppsigned').checked, tags:chosen});
    closeModal(); vCollection($('#app')); hydrateColl(entries, $('#app'));
  };
}
function promptTagsFor(e){
  const t = prompt(`Tags pour ${e.qty} × ${e.name} (séparez par des virgules).\nTags existants : ${tags.join(', ')}\nVide = retirer tous les tags`, (e.tags||[]).join(', '));
  if(t === null) return;
  const chosen = t.split(',').map(s=>s.trim()).filter(Boolean);
  chosen.forEach(c => { if(!tags.includes(c)) tags.push(c); }); saveTags();
  e.tags = [...new Set(chosen)]; saveColl(); vCollection($('#app'));
}

/* ============================================================
   VUE CARTES & EXTENSIONS
   ============================================================ */
let browseMode = 'sets', browseSet = null, browsePage = 1, browseQuery = '', browseData = null, browseQ = '';
let advF = {colors:[], types:[], cmc:'', pmin:'', pmax:'', set:'', artist:''};
let setValCache = null;   // code -> {v, date} : valorisation totale d'une extension (calcul à la demande)

function getSetValCache(){
  if(setValCache) return setValCache;
  setValCache = store.get('mtg_setval', {});
  return setValCache;
}

function vBrowse(app){
  if(browseSet) return vSetDetail(app);
  app.innerHTML = `
  <div class="panel">
    <div class="tabs">
      <button class="${browseMode==='sets'?'active':''}" data-m="sets">Par extension</button>
      <button class="${browseMode==='search'?'active':''}" data-m="search">Recherche avancée</button>
    </div>
    ${browseMode==='sets' ? `<p class="hint" style="margin-bottom:10px">Suivi de complétion et de valorisation de vos extensions. Cliquez sur une extension pour parcourir ses cartes.
      <input type="text" id="setfilter" placeholder="🔍 Filtrer les extensions…" style="margin-left:10px;min-width:220px;padding:6px 10px"></p>
      <div id="setlist"><p class="hint">Chargement des extensions…</p></div>`
    : `
    <div class="filterbar">
      <input type="text" id="sfq" placeholder="Requête Scryfall libre, ex: o:&quot;draw a card&quot; t:instant" style="flex:1;min-width:260px">
      <input type="text" id="adartist" placeholder="Artiste, ex: Rebecca Guay" value="${esc(advF.artist)}" style="min-width:170px">
      <span class="colorpick" id="adpick-colors">
        ${['W','U','B','R','G'].map(c => `<span data-c="${c}" class="${advF.colors.includes(c)?'on':''}"
          style="color:${({W:'#f4e8a6',U:'#6db3f2',B:'#b5a6f4',R:'#f26a6a',G:'#7ec97e'})[c]}">${c}</span>`).join('')}
      </span>
      <div class="multisel" id="adpick-types">
        <button class="btn ghost" style="padding:6px 10px">Type : ${advF.types.length||'tous'} ▾</button>
        <div class="opts">${TYPES_LIST.map(t => `<label><input type="checkbox" value="${t}" ${advF.types.includes(t)?'checked':''}> ${t}</label>`).join('')}</div>
      </div>
      <select id="adcmc">
        <option value="">Coût : tous</option>
        ${[0,1,2,3,4,5,6,'7+'].map(v => `<option value="${v}" ${String(advF.cmc)===String(v)?'selected':''}>CMC ${v}${v==='7+'?'+':''}</option>`).join('')}
      </select>
      <input type="number" id="admin" placeholder="prix min €" value="${esc(advF.pmin)}" min="0">
      <input type="number" id="admax" placeholder="prix max €" value="${esc(advF.pmax)}" min="0">
      <select id="adset"><option value="">Extension : toutes</option></select>
      <button class="btn" id="gosearch">Rechercher</button>
      <button class="btn ghost" id="adreset">Réinitialiser</button>
    </div>
    <div id="searchres"></div>`}
  </div>`;
  app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    browseMode = b.dataset.m; if(browseMode==='sets') browseSet=null; vBrowse(app);
  });
  if(browseMode==='sets') loadSets(app);
  else {
    const inp = app.querySelector('#sfq'); inp.value = browseQuery;
    const go = () => { browseQuery = inp.value; browsePage=1; doSearch(app); };
    inp.onkeydown = e => { if(e.key==='Enter') go(); };
    app.querySelector('#gosearch').onclick = go;
    app.querySelector('#adreset').onclick = () => { advF = {colors:[], types:[], cmc:'', pmin:'', pmax:'', set:'', artist:''}; vBrowse(app); };
    app.querySelectorAll('#adpick-colors span').forEach(s => s.onclick = () => {
      s.classList.toggle('on');
      advF.colors = [...app.querySelectorAll('#adpick-colors span.on')].map(x => x.dataset.c);
    });
    const ms = app.querySelector('#adpick-types');
    ms.querySelector('button').onclick = e => { e.stopPropagation(); ms.classList.toggle('open'); };
    ms.querySelectorAll('.opts input').forEach(cb => cb.onchange = () => {
      advF.types = [...ms.querySelectorAll('.opts input:checked')].map(x=>x.value);
      ms.querySelector('button').textContent = `Type : ${advF.types.length||'tous'} ▾`;
    });
    document.body.addEventListener('click', ev => { if(!ms.contains(ev.target)) ms.classList.remove('open'); });
    app.querySelector('#adcmc').onchange = e => advF.cmc = e.target.value;
    app.querySelector('#admin').onchange = e => advF.pmin = e.target.value;
    app.querySelector('#admax').onchange = e => advF.pmax = e.target.value;
    app.querySelector('#adartist').onkeydown = e => { if(e.key==='Enter') go(); };
    // liste des extensions dans le filtre
    sfSets().then(sets => {
      const sel = app.querySelector('#adset'); if(!sel) return;
      sel.innerHTML = `<option value="">Extension : toutes</option>` + sets.map(s =>
        `<option value="${s.code}" ${advF.set===s.code?'selected':''}>${esc(s.name)}</option>`).join('');
      sel.onchange = e => advF.set = e.target.value;
    }).catch(()=>{});
    if(browseQuery) doSearch(app);
  }
}

/* requête Scryfall combinée depuis les filtres avancés */
function buildAdvQuery(){
  const q = [];
  if(browseQuery.trim()) q.push(`(${browseQuery.trim()})`);
  if(advF.artist.trim()) q.push(`a:"${advF.artist.trim().replace(/"/g,'')}"`);
  if(advF.colors.length) q.push(`(c:${advF.colors.join(' or c:')})`);
  if(advF.types.length) q.push(`(t:${advF.types.join(' or t:')})`);
  if(advF.cmc !== '') q.push(advF.cmc==='7+' ? 'mv>=7' : `mv=${advF.cmc}`);
  if(advF.set) q.push(`set:${advF.set}`);
  let price = null;
  if(advF.pmin !== '' && advF.pmax !== '') price = `eur:[${advF.pmin} TO ${advF.pmax}]`;
  else if(advF.pmin !== '') price = `eur>=${advF.pmin}`;
  else if(advF.pmax !== '') price = `eur<=${advF.pmax}`;
  if(price) q.push(price);
  return q.length ? q.join(' ') : '';
}

/* tableau des extensions : complétion + valorisation */
async function loadSets(app){
  const box = app.querySelector('#setlist');
  try{
    const sets = (await sfSets()).filter(s => !s.digital).slice().sort((a,b) => (b.released_at||'').localeCompare(a.released_at||''));
    const owned = {};   // code -> {distinct:Set, qty, value}
    const collectOwned = () => {
      Object.keys(owned).forEach(k => delete owned[k]);
      entries.forEach(e => {
        const s = e.set || (entryPrintSync(e)?.set) || null;
        if(!s) return;
        owned[s] = owned[s] || {distinct:new Set(), qty:0, value:0};
        owned[s].distinct.add(e.norm);
        owned[s].qty += e.qty;
        const p = entryPrintSync(e);
        const pr = p ? entryPrice(e,p) : null;
        if(pr != null) owned[s].value += pr * e.qty;
      });
    };
    collectOwned();
    const renderList = (filter) => {
      const f = norm(filter||'');
      const rows = sets.filter(s => !f || norm(s.name).includes(f) || s.code.includes(f));
      box.innerHTML = `<table><thead><tr>
        <th style="width:60px"></th><th>Extension</th><th style="width:100px">Date</th>
        <th style="width:110px">Possédées</th><th style="width:130px">Complétion</th>
        <th style="width:120px">Valeur possédée</th><th style="width:190px">Valeur totale du set</th></tr></thead>
      <tbody>${rows.map(s => {
        const o = owned[s.code];
        const distinct = o ? o.distinct.size : 0;
        const pct = s.card_count ? Math.min(100, distinct / s.card_count * 100) : 0;
        const vc = getSetValCache()[s.code];
        return `<tr data-s="${s.code}" style="cursor:pointer">
          <td>${s.icon?`<img class="seticon" src="${s.icon}" style="width:24px;height:24px" alt="">`:'◈'}</td>
          <td><b>${esc(s.name)}</b> <span class="pill">${s.code.toUpperCase()}</span></td>
          <td class="hint">${s.released_at||'—'}</td>
          <td class="hint">${o ? `${distinct} / ${s.card_count}` : `0 / ${s.card_count}`}</td>
          <td>${o ? `<div class="pbar"><div style="width:${pct}%"></div></div><span class="pct">${pct.toFixed(1)}%</span>` : '<span class="pct">—</span>'}</td>
          <td class="hint">${o && o.value>0 ? `<span style="color:var(--warn)">${eur(o.value)}</span>` : '—'}</td>
          <td class="hint">${vc ? `<span style="color:var(--warn)">${eur(vc.v)}</span> <span class="pill">(${new Date(vc.date).toLocaleDateString('fr-FR')})</span>`
            : `<button class="btn ghost" data-calc="${s.code}" style="padding:3px 8px;font-size:12px">calculer</button>`}</td>
        </tr>`;}).join('')}</tbody></table>
      ${!rows.length ? '<p class="hint">Aucune extension ne correspond.</p>' : ''}`;
      box.querySelectorAll('tr[data-s]').forEach(tr => tr.onclick = () => { browseSet = tr.dataset.s; browsePage=1; vBrowse(app); });
      box.querySelectorAll('[data-calc]').forEach(b => b.onclick = async e => {
        e.stopPropagation();
        b.disabled = true; b.textContent = 'calcul…';
        await computeSetValue(b.dataset.calc);
        vBrowse(app);
      });
    };
    renderList('');
    const sf = app.querySelector('#setfilter');
    if(sf) sf.oninput = () => renderList(sf.value);
    // hydrate les entrées sans édition connue (pour compléter owned[])
    const unknown = entries.filter(e => !e.set && !entryPrintSync(e));
    if(unknown.length){ for(const e of unknown){ try{ await sfPrints(e.name); }catch(err){} } collectOwned(); renderList(app.querySelector('#setfilter')?.value || ''); }
  }catch(e){ box.innerHTML = '<p class="hint">Erreur de chargement Scryfall. Réessayez.</p>'; }
}
/* valorisation totale d'une extension : pagine toutes les cartes du set (cache 30 jours) */
async function computeSetValue(code){
  const cache = getSetValCache();
  const c = cache[code];
  if(c && (Date.now() - c.date) < 30*24*3600*1000) return c.v;
  let total = 0, page = 1, more = true;
  while(more){
    const j = await sfSearch(`set:${code}`, page);
    (j.data||[]).forEach(x => {
      const p = parseFloat(x.prices?.eur || x.prices?.eur_foil || '0') || 0;
      total += p;
    });
    more = j.has_more && page < 30;   // garde-fou
    page++;
  }
  cache[code] = {v: total, date: Date.now()};
  store.set('mtg_setval', cache);
  return total;
}
async function vSetDetail(app){
  app.innerHTML = `<div class="panel">
    <button class="btn ghost" id="back">← Toutes les extensions</button>
    <h3 style="margin-top:10px" id="settitle"></h3>
    <div id="setcards"><p class="hint">Chargement des cartes…</p></div>
    <div class="row" style="margin-top:14px" id="pager"></div>
  </div>`;
  app.querySelector('#back').onclick = () => { browseSet=null; vBrowse(app); };
  try{
    const j = await sfSearch(`set:${browseSet}`, browsePage);
    app.querySelector('#settitle').textContent = `${j.data[0]?.set_name || browseSet.toUpperCase()} — ${j.total_cards} cartes`;
    renderCardGrid(app.querySelector('#setcards'), j.data);
    const pager = app.querySelector('#pager');
    pager.innerHTML = `
      <button class="btn ghost" id="prev" ${j.has_previous?'':'disabled'}>← Précédent</button>
      <span class="hint">Page ${browsePage} / ${Math.ceil(j.total_cards/175)}</span>
      <button class="btn ghost" id="next" ${j.has_more?'':'disabled'}>Suivant →</button>`;
    if(j.has_previous) pager.querySelector('#prev').onclick = () => { browsePage--; vBrowse(app); };
    if(j.has_more) pager.querySelector('#next').onclick = () => { browsePage++; vBrowse(app); };
  }catch(e){ app.querySelector('#setcards').innerHTML = '<p class="hint">Erreur de chargement.</p>'; }
}
async function doSearch(app){
  const box = app.querySelector('#searchres');
  const q = buildAdvQuery();
  if(!q){ box.innerHTML = '<p class="hint">Saisissez une requête ou des filtres.</p>'; return; }
  box.innerHTML = '<p class="hint">Recherche…</p>';
  try{
    const j = await sfSearch(q, browsePage);
    renderCardGrid(box, j.data);
    const pager = document.createElement('div'); pager.className='row'; pager.style.marginTop='12px';
    pager.innerHTML = `<button class="btn ghost" id="prev" ${j.has_previous?'':'disabled'}>←</button>
      <span class="hint">${j.total_cards} résultats — page ${browsePage}</span>
      <button class="btn ghost" id="next" ${j.has_more?'':'disabled'}>→</button>`;
    box.appendChild(pager);
    if(j.has_previous) pager.querySelector('#prev').onclick = () => { browsePage--; doSearch(app); };
    if(j.has_more) pager.querySelector('#next').onclick = () => { browsePage++; doSearch(app); };
  }catch(e){ box.innerHTML = `<p class="hint">Aucun résultat ou erreur (vérifiez la requête : "${esc(q)}").</p>`; }
}
function renderCardGrid(box, cards){
  box.innerHTML = `<div class="cardgrid">${cards.map(c => {
    const img = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '';
    const k = norm(c.name);
    const q = collection[k]?.qty || 0;
    const price = c.prices?.eur || c.prices?.eur_foil;
    return `<div class="cardtile">
      <img src="${img}" loading="lazy" alt="${esc(c.name)}" data-name="${esc(c.name)}" data-zoom="${c.image_uris?.large || img}" class="cinfo">
      <div class="info">
        <div class="name">${esc(c.name)}</div>
        <div class="pill">${esc(c.set?.toUpperCase()||'')} · ${c.released_at?.slice(0,4)||''} · ${c.rarity||''}</div>
        <div class="price">${price?eur(price):''}</div>
        <div class="qty-ctl">
          <button data-a="dec" data-n="${esc(c.name)}">−</button><b data-q="${esc(c.name)}">${q}</b><button data-a="inc" data-n="${esc(c.name)}" data-set="${esc(c.set||'')}" data-cn="${esc(c.collector_number||'')}">+</button>
        </div>
      </div>
    </div>`; }).join('')}</div>`;
  box.querySelectorAll('.qty-ctl button').forEach(b => b.onclick = () => {
    const n = b.dataset.n, k = norm(n);
    if(b.dataset.a==='inc'){ addEntry({name:n, set:b.dataset.set||null, cn:b.dataset.cn||null, qty:1, tags:[]}); }
    else {
      const mine = entries.filter(e => e.norm === k);
      if(mine.length){ const e = mine[mine.length-1]; e.qty--; if(e.qty<=0) entries = entries.filter(x=>x.id!==e.id); saveColl(); }
    }
    b.parentElement.querySelector('b').textContent = collection[k]?.qty || 0;
  });
  box.querySelectorAll('.cardtile img').forEach(im => im.onclick = () => showCardInfo(im.dataset.name));
}
/* ============================================================
   VUE TOURNOIS & DECKS
   ============================================================ */
let deckFmt = 'MO', deckQuery = '', dqTimer = null, deckEvent = null;
function vDecks(app){
  if(deckEvent !== null) return vEventDetail(app);
  const evs = EVENTS.filter(e => e.fmt===deckFmt && (!deckQuery || (e.name+' '+e.place).toLowerCase().includes(deckQuery.toLowerCase())));
  app.innerHTML = `
  <div class="panel">
    <div class="row">
      <select id="dfmt">${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}" ${k===deckFmt?'selected':''}>${v}</option>`).join('')}</select>
      <input type="text" id="dq" placeholder="Rechercher un tournoi…" value="${esc(deckQuery)}">
      <span class="hint">${evs.length} tournois en 2026</span>
    </div>
  </div>
  <div class="deck-list">${evs.slice(0,100).map(e => `
    <div class="deck" data-e="${e.eid}">
      <h3>${esc(e.name)}</h3>
      <div class="meta">
        <span class="fmt">${fmtName(e.fmt)}</span> ${esc(e.place||'')}<br>${esc(e.date||'')}
      </div>
      <div class="hint">${e.decks.length} decks référencés</div>
    </div>`).join('')}</div>
  ${evs.length>100?'<p class="hint" style="margin-top:10px">100 premiers résultats.</p>':''}`;
  app.querySelector('#dfmt').onchange = e => { deckFmt = e.target.value; vDecks(app); };
  app.querySelector('#dq').oninput = e => { deckQuery = e.target.value; clearTimeout(dqTimer); dqTimer = setTimeout(()=>vDecks(app), 300); };
  app.querySelectorAll('[data-e]').forEach(el => el.onclick = () => { deckEvent = +el.dataset.e; vDecks(app); });
}
function vEventDetail(app){
  const ev = EVENTS.find(e => e.eid === deckEvent);
  app.innerHTML = `
  <div class="panel">
    <button class="btn ghost" id="back">← Tournois ${fmtName(ev.fmt)}</button>
    <h3 style="margin-top:10px">${esc(ev.name)}</h3>
    <p class="hint">${esc(ev.place||'')} · ${esc(ev.date||'')} · ${ev.decks.length} decks référencés</p>
  </div>
  <div class="deck-list">${ev.decks.map(i => {
    const d = DECKS[i], a = analyze(i, false), pct = Math.round(a.pct*100);
    return `<div class="deck" data-i="${i}">
      <h3>#${d[2]} ${esc(d[3])}</h3>
      <div class="meta">${esc(d[4]||'')} · ${esc(d[5]||'')}</div>
      <div class="bar"><div style="width:${pct}%;background:${pct>=95?'var(--ok)':pct>=70?'var(--warn)':'var(--bad)'}"></div></div>
      <div class="row" style="justify-content:space-between"><b style="color:${pct>=95?'var(--ok)':'var(--accent)'}">${pct}% possédé</b>
      <span class="missing">${a.missingQty} manquantes</span></div>
    </div>`; }).join('')}</div>`;
  app.querySelector('#back').onclick = () => { deckEvent=null; vDecks(app); };
  app.querySelectorAll('[data-i]').forEach(el => el.onclick = () => showDeck(+el.dataset.i));
}

/* ---- détail d'un deck : visualiseur complet (groupement, courbe, colorpies, legalités) ---- */
let dvGroup = 'type', dvTab = 'main';           // état partagé du visualiseur
function analyzeList(main, side, withSide){
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
async function gatherMeta(names){
  for(const n of names){ try{ if(!sfCache[norm(n)]) await sfCardByName(n); }catch(e){} }
}
function metaOf(name){ return sfCache[norm(name)] || null; }
const TYPE_ORDER = ['Land','Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Autre'];
function typeBucket(m){
  const t = (m?.type_line||'').toLowerCase();
  if(t.includes('land')) return 'Land';
  if(t.includes('creature')) return 'Creature';
  if(t.includes('instant')) return 'Instant';
  if(t.includes('sorcery')) return 'Sorcery';
  if(t.includes('enchantment')) return 'Enchantment';
  if(t.includes('artifact')) return 'Artifact';
  if(t.includes('planeswalker')) return 'Planeswalker';
  return 'Autre';
}
function groupCards(list){           // [[name,qty]] → [[clé, [[name,qty]…]]…]
  const g = new Map();
  for(const [n,q] of list){
    const m = metaOf(n);
    const key = dvGroup === 'cmc' ? (m ? (m.mv>=7?'7+':String(m.mv??0)) : '?') : typeBucket(m);
    if(!g.has(key)) g.set(key, []);
    g.get(key).push([n,q]);
  }
  let keys = [...g.keys()];
  if(dvGroup === 'type') keys.sort((a,b) => TYPE_ORDER.indexOf(a)-TYPE_ORDER.indexOf(b));
  else keys.sort((a,b) => a==='?'?1:b==='?'?-1:(isNaN(+a)?0:+a)-(isNaN(+b)?0:+b));
  keys.forEach(k => g.get(k).sort((x,y) => norm(x[0]).localeCompare(norm(y[0]))));
  return keys.map(k => [k, g.get(k)]);
}
function manaCurve(list){            // nb de cartes par CMC (main uniquement)
  const cur = [0,0,0,0,0,0,0,0];
  for(const [n,q] of list){
    const m = metaOf(n); if(!m) continue;
    cur[Math.min(7, m.mv ?? 0)] += q;
  }
  return cur;
}
function costColors(list){          // couleurs des coûts
  const c = {W:0,U:0,B:0,R:0,G:0,C:0};
  for(const [n,q] of list){
    const m = metaOf(n); if(!m) continue;
    (m.colors||[]).forEach(x => c[x] != null ? c[x] += q : c.C += 0);
    if(!(m.colors||[]).length) c.C += q;
  }
  return c;
}
function landProduces(list){        // couleurs produites par les lands (parse oracle)
  const c = {W:0,U:0,B:0,R:0,G:0,C:0};
  for(const [n,q] of list){
    const m = metaOf(n); if(!m || !/land/i.test(m.type_line||'')) continue;
    const adds = [...(m.oracle||'').matchAll(/Add \{([WUBRGC])\}/gi)].map(x => x[1].toUpperCase());
    if(!adds.length){ if(/any type/i.test(m.oracle||'')) continue; c.C += q; continue; }
    adds.forEach(a => c[a] != null ? c[a] += q : c.C += q);
  }
  return c;
}
const LEGAL_FMTS = [['standard','Standard'],['pioneer','Pioneer'],['modern','Modern'],['legacy','Legacy'],
  ['vintage','Vintage'],['pauper','Pauper'],['premodern','Premodern'],['commander','Commander'],['duel','Duel Commander']];
function deckLegalities(list){
  const out = {};
  for(const [fk, fl] of LEGAL_FMTS){
    let legal = true, known = false;
    for(const [n] of list){
      const lg = metaOf(n)?.legalities;
      if(!lg) continue;
      known = true;
      if(lg[fk] !== 'legal' && lg[fk] !== 'restricted'){ legal = false; break; }
    }
    out[fk] = known ? (legal ? 'legal' : 'not') : 'unknown';
  }
  return out;
}
/* rendu du corps du visualiseur — lineHTML(n,q) personnalisable */
function deckViewHTML(main, side, lineHTML){
  const list = dvTab === 'main' ? main : side;
  const groups = groupCards(list);
  const mc = manaCurve(main);
  const cc = costColors(main), lc = landProduces(main);
  const lg = deckLegalities(main.concat(side));
  const cnames = {W:'Blanc',U:'Bleu',B:'Noir',R:'Rouge',G:'Vert',C:'Incolore'};
  return `
  <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
    <span class="binderchip ${dvTab==='main'?'active':''}" data-tab="main">Main (${main.reduce((a,[,q])=>a+q,0)})</span>
    <span class="binderchip ${dvTab==='side'?'active':''}" data-tab="side">Side (${side.reduce((a,[,q])=>a+q,0)})</span>
    <span class="hint">Grouper :</span>
    <select id="dvgroup">
      <option value="type" ${dvGroup==='type'?'selected':''}>Par type</option>
      <option value="cmc" ${dvGroup==='cmc'?'selected':''}>Par coût de mana</option>
    </select>
  </div>
  <div class="statgrid" style="margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
    <div class="panel" style="margin:0"><h4 class="sub">Courbe de mana</h4><canvas class="chart" data-ch="curve"></canvas></div>
    <div class="panel" style="margin:0"><h4 class="sub">Couleurs des coûts</h4><canvas class="chart" data-ch="pie1"></canvas></div>
    <div class="panel" style="margin:0"><h4 class="sub">Mana produit par les lands</h4><canvas class="chart" data-ch="pie2"></canvas></div>
    <div class="panel" style="margin:0"><h4 class="sub">Legalité du deck</h4>
      ${Object.entries(lg).map(([k,v]) => `<span class="pill" style="margin:2px;color:${v==='legal'?'var(--ok)':v==='not'?'var(--bad)':'var(--hint)'}">${LEGAL_FMTS.find(x=>x[0]===k)[1]} : ${v==='legal'?'✔':v==='not'?'✘':'?'}</span>`).join('')}
    </div>
  </div>
  <div id="dvlist" style="margin-top:12px">
    ${groups.map(([k, items]) => `<h4 class="sub" style="margin:10px 0 4px">${dvGroup==='type'?esc(k):'CMC '+esc(k)} <span class="hint">(${items.reduce((a,[,q])=>a+q,0)})</span></h4>
      ${items.map(([n,q]) => lineHTML(n,q)).join('')}`).join('')}
  </div>`;
}
function drawDeckCharts(container){
  const main = container.__dvMain || [];
  const cv = sel => container.querySelector(`canvas[data-ch="${sel}"]`);
  const a = cv('curve'), b = cv('pie1'), c = cv('pie2');
  if(a) chartBars(a, ['0','1','2','3','4','5','6','7+'], manaCurve(main), ['#5b8cff']);
  const cnames = {W:'#f4e8a6',U:'#6db3f2',B:'#b5a6f4',R:'#f26a6a',G:'#7ec97e',C:'#c8c8c8'};
  const pie = obj => Object.entries(obj).filter(([,v]) => v>0);
  const p1 = pie(costColors(main)), p2 = pie(landProduces(main));
  if(b) chartDonut(b, p1.map(x=>x[1]), p1.map(x=>x[0]), p1.map(x=>cnames[x[0]]));
  if(c) chartDonut(c, p2.map(x=>x[1]), p2.map(x=>x[0]), p2.map(x=>cnames[x[0]]));
}
function bindDeckView(container, rerender){
  container.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { dvTab = el.dataset.tab; rerender(); });
  const gsel = container.querySelector('#dvgroup');
  if(gsel) gsel.onchange = e => { dvGroup = e.target.value; rerender(); };
}
async function showDeck(i){
  const d = DECKS[i], a = analyze(i, true);
  const {main, side} = parseDeck(i);
  const ev = EVENTS.find(e => e.eid===d[9]);
  openModal(`
    <button class="close" id="mclose2">✕</button>
    <h2>${esc(d[3])}</h2>
    <p class="hint" style="margin:6px 0">
      <span class="fmt">${fmtName(d[1])}</span> ${esc(d[4]||'')} · ${esc(d[5]||'')} · #${d[2]}<br>
      ${esc(ev?.name||'')} — ${esc(ev?.place||'')} · ${esc(d[8]||'')}</p>
    <p style="margin-bottom:10px"><b>${Math.round(a.pct*100)}% possédé</b> · ${a.missingQty} cartes manquantes
      <button class="btn ghost" id="decktags" style="margin-left:10px">🧠 Métadonnées</button></p>
    <div id="tagdist"></div>
    <div id="deckbody"><p class="hint">Chargement des métadonnées des cartes…</p></div>`);
  $('#mclose2').onclick = closeModal;
  const rerender = () => {
    const body = $('#deckbody');
    const need = a.need;
    const lineHTML = (n,q) => {
      const v = need.get(norm(n)) || [n, q, Math.min(collection[norm(n)]?.qty||0, q)];
      const ok = v[2] >= v[1];
      return `<div class="cardline" data-card="${esc(n)}"><span><b>${q}×</b> ${esc(n)}</span>
        <span class="${ok?'n':'m'}">${ok?'✔':'✘ manque '+(v[1]-v[2])}</span></div>`;
    };
    body.innerHTML = deckViewHTML(main, side, lineHTML);
    body.__dvMain = main;
    bindDeckView(body, rerender);
    drawDeckCharts(body);
    main.concat(side).forEach(([n]) => hydrateImage(n));
  };
  await gatherMeta([...new Set(main.concat(side).map(([n]) => n))]);
  rerender();
  $('#decktags').onclick = () => deckTagDistribution(main, $('#tagdist'));
}
async function hydrateImage(name){
  const lines = $$(`.cardline[data-card="${CSS.escape(name)}"]`);
  if(!lines.length) return;
  try{
    const c = sfCache[norm(name)] || await sfCardByName(name);
    if(!c?.image) return;
    lines.forEach(l => { l.querySelector('span').insertAdjacentHTML('afterbegin', `<img class="deckimg" src="${c.image}" loading="lazy">`); });
  }catch(e){}
}
async function deckTagDistribution(cardList, box){
  box.innerHTML = '<p class="hint">Analyse en cours…</p>';
  const dist = new Map();
  for(const [n] of cardList){
    let c;
    try{ c = sfCache[norm(n)] || await sfCardByName(n); }catch(e){ continue; }
    allTags(n, c).forEach(t => dist.set(t, (dist.get(t)||0)+1));
  }
  const top = [...dist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 24);
  const max = top[0]?.[1] || 1;
  box.innerHTML = `<h4 class="sub">Répartition des métadonnées (${cardList.length} cartes)</h4>
    ${top.map(([t,n]) => `<div class="row" style="justify-content:space-between;gap:8px">
      <span class="tag auto">${esc(t)}</span>
      <div class="bar" style="flex:1"><div style="width:${n/max*100}%;background:var(--accent)"></div></div>
      <span class="hint">${n}</span></div>`).join('')}`;
}

/* ============================================================
   VUE DECKS JOUABLES
   ============================================================ */
let pf = {fmt:'ALL', withSide:false, minPct:100, q:'', sort:'pct'};
function vPlayable(app){
  app.innerHTML = `
  <div class="panel"><div class="row">
    <select id="p-fmt"><option value="ALL">Tous les formats</option>
      ${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}" ${pf.fmt===k?'selected':''}>${v}</option>`).join('')}</select>
    <select id="p-sort"><option value="pct" ${pf.sort==='pct'?'selected':''}>Tri : complétude</option>
      <option value="date" ${pf.sort==='date'?'selected':''}>Tri : date</option>
      <option value="players" ${pf.sort==='players'?'selected':''}>Tri : taille du tournoi</option></select>
    <label class="hint"><input type="checkbox" id="p-side" ${pf.withSide?'checked':''}> Compter le sideboard</label>
    <input type="range" id="p-pct" min="0" max="100" value="${pf.minPct}">
    <span class="hint" id="p-pctlab">Complétude ≥ ${pf.minPct}%</span>
    <input type="text" id="p-q" placeholder="Deck / archétype / joueur…" value="${esc(pf.q)}">
  </div></div>
  <div id="pres"><p class="hint">Analyse…</p></div>`;
  const bind = (id, key) => { const el = app.querySelector(id);
    el.onchange = el.oninput = () => { pf[key] = el.type==='checkbox'?el.checked:el.value;
      if(key==='minPct') app.querySelector('#p-pctlab').textContent = `Complétude ≥ ${el.value}%`;
      clearTimeout(pf._t); pf._t = setTimeout(()=>runPlayable(app), 200); }; };
  bind('#p-fmt','fmt'); bind('#p-sort','sort'); bind('#p-side','withSide'); bind('#p-pct','minPct'); bind('#p-q','q');
  runPlayable(app);
}
function runPlayable(app){
  const box = app.querySelector('#pres');
  const q = pf.q.toLowerCase();
  const out = [];
  for(let i=0;i<DECKS.length;i++){
    const d = DECKS[i];
    if(pf.fmt!=='ALL' && d[1]!==pf.fmt) continue;
    if(q && !(d[3]+' '+d[4]+' '+d[5]).toLowerCase().includes(q)) continue;
    const a = analyze(i, pf.withSide);
    const pct = Math.round(a.pct*100);
    if(pct < pf.minPct) continue;
    out.push([i,d,a,pct]);
  }
  out.sort((x,y) => pf.sort==='pct' ? (y[3]-x[3] || y[1][8].localeCompare(x[1][8]))
    : pf.sort==='players' ? ((y[1][12]||0)-(x[1][12]||0)) : y[1][8].localeCompare(x[1][8]));
  const n100 = out.filter(o=>o[3]===100).length;
  box.innerHTML = `
  <p class="hint" style="margin-bottom:12px"><b>${out.length}</b> decks · dont <b>${n100}</b> jouables à 100%</p>
  <div class="deck-list">${out.slice(0,120).map(([i,d,a,pct])=>`
    <div class="deck" data-i="${i}">
      <h3>${esc(d[3])} ${pct===100?'✅':''}</h3>
      <div class="meta"><span class="fmt">${fmtName(d[1])}</span> ${esc(d[4]||'')} · ${esc(d[5]||'')} · #${d[2]}<br>
        ${esc(d[6])} · ${esc(d[8])}</div>
      <div class="bar"><div style="width:${pct}%;background:${pct>=95?'var(--ok)':pct>=70?'var(--warn)':'var(--bad)'}"></div></div>
      <div class="row" style="justify-content:space-between">
        <b style="color:${pct===100?'var(--ok)':pct>=70?'var(--warn)':'var(--accent)'}">${pct}%</b>
        <span class="missing">${a.missingQty} manquantes</span></div>
    </div>`).join('')}</div>
  ${out.length>120?'<p class="hint" style="margin-top:10px">120 meilleurs résultats affichés.</p>':''}`;
  box.querySelectorAll('.deck').forEach(el => el.onclick = () => showDeck(+el.dataset.i));
}

/* ============================================================
   VUE ARCHÉTYPES (analyse d'inclusion — point 1)
   ============================================================ */
let ar = {fmt:'PAU', arch:null};
function vArchetypes(app){
  if(ar.arch) return vArchetypeAnalysis(app);
  const counts = new Map();
  DECKS.forEach(d => { if(d[1]===ar.fmt) counts.set(d[4]||'(sans archétype)', (counts.get(d[4]||'(sans archétype)')||0)+1); });
  const list = [...counts.entries()].sort((a,b)=>b[1]-a[1]);
  app.innerHTML = `
  <div class="panel"><div class="row">
    <select id="a-fmt">${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}" ${k===ar.fmt?'selected':''}>${v}</option>`).join('')}</select>
    <span class="hint">${list.length} archétypes</span>
  </div></div>
  <div class="panel">
    <h3 style="margin-bottom:10px">Archétypes ${fmtName(ar.fmt)} 2026</h3>
    <div class="row">${list.map(([a,n])=>`<span class="binderchip" data-a="${esc(a)}">${esc(a)} <span class="pill">${n} decks</span></span>`).join('')}</div>
  </div>`;
  app.querySelector('#a-fmt').onchange = e => { ar.fmt = e.target.value; ar.arch=null; vArchetypes(app); };
  app.querySelectorAll('[data-a]').forEach(ch => ch.onclick = () => { ar.arch = ch.dataset.a; vArchetypes(app); });
}
let archSide = false;
function vArchetypeAnalysis(app){
  const decks = DECKS.map((d,i)=>({d,i})).filter(x => x.d[1]===ar.fmt && (x.d[4]||'(sans archétype)')===ar.arch);
  const stats = new Map(); // card -> {decks, qty, list}
  decks.forEach(({i}) => {
    const {main, side} = parseDeck(i);
    const pool = archSide ? main.concat(side) : main;
    const seen = new Set();
    pool.forEach(([n,q]) => { const k = norm(n);
      if(seen.has(k)) return; seen.add(k);
      const s = stats.get(k) || {n, decks:0, qty:0};
      s.decks++; s.qty += q; stats.set(k, s); });
  });
  const total = decks.length;
  const rows = [...stats.values()].map(s => ({
    n:s.n, pct: s.decks/total*100, avg: (s.qty/s.decks),
  })).sort((a,b)=>b.pct-a.pct || b.avg-a.avg);
  app.innerHTML = `
  <div class="panel">
    <button class="btn ghost" id="back">← Archétypes ${fmtName(ar.fmt)}</button>
    <h3 style="margin-top:10px">${esc(ar.arch)} <span class="fmt">${fmtName(ar.fmt)}</span></h3>
    <p class="hint">${total} decks en 2026 · analyse des ${archSide?'75':'60'} cartes les plus incluses</p>
    <label class="hint"><input type="checkbox" id="a-side" ${archSide?'checked':''}> Inclure le sideboard</label>
  </div>
  <div class="panel">
    <table><thead><tr><th>Carte</th><th>% d'inclusion</th><th>Quantité moyenne</th><th>Possédées</th></tr></thead><tbody>
    ${rows.slice(0,100).map(r => {
      const have = collection[norm(r.n)]?.qty || 0;
      return `<tr><td class="link cinfo">${esc(r.n)}</td>
      <td><div class="bar" style="margin:0"><div style="width:${r.pct}%;background:var(--accent)"></div></div><b>${r.pct.toFixed(0)}%</b> (${r.pct>=99.5?'core':r.pct>=50?'fréquent':'options'})</td>
      <td>x${r.avg.toFixed(1)}</td>
      <td class="${have>=Math.ceil(r.avg)?'owned':''}" style="color:${have>=Math.ceil(r.avg)?'var(--ok)':'var(--muted)'}">${have}</td></tr>`;}).join('')}
    </tbody></table>
    ${rows.length>100?'<p class="hint" style="margin-top:8px">100 cartes les plus incluses affichées (tri par inclusion).</p>':''}
  </div>`;
  app.querySelector('#back').onclick = () => { ar.arch=null; vArchetypes(app); };
  app.querySelector('#a-side').onchange = e => { archSide = e.target.checked; vArchetypeAnalysis(app); };
  app.querySelectorAll('.cinfo').forEach(td => td.onclick = () => showCardInfo(td.textContent));
}

/* ============================================================
   VUE MATCHS (saisie — points 7 & 11)
   ============================================================ */
let mullRows = [0, 0];
function vMatches(app){
  const archs = [...new Set(matches.flatMap(m => [m.myArch, m.oppArch]).filter(Boolean))].sort();
  app.innerHTML = `
  <div class="panel">
    <h3 style="margin-bottom:12px">Nouveau match</h3>
    <div class="row">
      <input type="date" id="m-date" value="${new Date().toISOString().slice(0,10)}">
      <select id="m-type"><option value="amical">Match amical</option><option value="tournoi">Tournoi</option></select>
      <select id="m-fmt">${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
      <span class="hint">Toss gagné :</span>
      <select id="m-toss"><option value="1">Oui</option><option value="0">Non</option></select>
    </div>
    <div class="row" style="margin-top:10px">
      <input type="text" id="m-mydeck" placeholder="Mon deck (nom libre)" style="min-width:220px">
      <input type="text" id="m-myarch" list="archlist" placeholder="Mon archétype" style="min-width:160px">
      <input type="text" id="m-oppname" placeholder="Adversaire (ami)" style="min-width:160px">
      <input type="text" id="m-opparch" list="archlist" placeholder="Archétype adverse" style="min-width:160px">
      <datalist id="archlist">${archs.map(a=>`<option value="${esc(a)}">`).join('')}</datalist>
    </div>
    <h4 class="sub">Manches du match (résultat + mulligans)</h4>
    <div id="mullrows">${mullRows.map((m,i)=>gameRow(i,m)).join('')}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost" id="addgame">+ Manche</button>
      <button class="btn" id="savematch">Enregistrer le match</button>
    </div>
  </div>
  <div class="panel">
    <h3 style="margin-bottom:10px">Historique (${matches.length} matchs)</h3>
    ${matches.length ? matches.slice().reverse().map(m => `
      <div class="matchline" data-id="${m.id}">
        <span class="badge ${m.result==='V'?'b-ok':'b-warn'}">${m.result==='V'?'VICTOIRE':'DÉFAITE'} ${m.score}</span>
        <span class="fmt">${fmtName(m.format)}</span>
        <b>${esc(m.myDeck||m.myArch)}</b> vs <b>${esc(m.oppArch||'?')}</b>
        <span class="hint">${esc(m.oppName||'adversaire')}</span>
        <span class="hint">${esc(m.date)} · ${m.type==='tournoi'?'tournoi':'amical'} · toss ${m.toss==1?'gagné':'perdu'} · mulligans [${m.mull.join(', ')}]</span>
        <button class="btn ghost" data-a="del" style="margin-left:auto;padding:4px 10px">✕</button>
      </div>`).join('') : '<p class="hint">Aucun match enregistré.</p>'}
  </div>`;
  app.querySelector('#addgame').onclick = () => { mullRows.push(0); vMatches(app); };
  app.querySelectorAll('[data-a="del"]').forEach(b => b.onclick = () => {
    matches = matches.filter(m => m.id !== +b.closest('[data-id]').dataset.id);
    saveMatches(); vMatches(app);
  });
  app.querySelector('#savematch').onclick = () => {
    const games = $$('#mullrows .grow').map(r => ({
      won: r.querySelector('[data-g="won"]').checked,
      mull: +r.querySelector('[data-g="mull"]').value || 0,
    }));
    if(!games.length){ alert('Ajoutez au moins une manche.'); return; }
    const won = games.filter(g=>g.won).length, lost = games.length - won;
    matches.push({
      id: Date.now(),
      date: app.querySelector('#m-date').value,
      type: app.querySelector('#m-type').value,
      format: app.querySelector('#m-fmt').value,
      myDeck: app.querySelector('#m-mydeck').value.trim(),
      myArch: app.querySelector('#m-myarch').value.trim(),
      oppName: app.querySelector('#m-oppname').value.trim(),
      oppArch: app.querySelector('#m-opparch').value.trim(),
      toss: +app.querySelector('#m-toss').value,
      result: won > lost ? 'V' : (won < lost ? 'D' : 'N'),
      score: `${won}-${lost}`,
      mull: games.map(g=>g.mull),
      games,
    });
    saveMatches(); mullRows=[0,0]; vMatches(app);
  };
}
function gameRow(i, m){
  return `<div class="row grow" style="margin-top:6px">
    <span class="hint">Manche ${i+1} :</span>
    <label class="hint"><input type="checkbox" data-g="won" ${''}> gagnée</label>
    <label class="hint">mulligans <input type="number" min="0" max="7" value="${m}" data-g="mull" style="width:64px"></label>
    <button class="btn ghost" data-a="rmg" style="padding:2px 8px">✕</button>
  </div>`;
}

/* ============================================================
   VUE STATS (point 9) + canvas charts maison
   ============================================================ */
let statScope = {tab:'global', fmt:'ALL', arch:'', friend:''};
function chartDonut(cv, vals, labels, colors){
  const ctx = cv.getContext('2d');
  const W = cv.width = 320, H = cv.height = 200;
  const total = vals.reduce((a,b)=>a+b,0) || 1;
  let ang = -Math.PI/2;
  vals.forEach((v,i) => {
    const a2 = ang + v/total*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(W/2,H/2); ctx.arc(W/2,H/2,70,ang,a2); ctx.closePath();
    ctx.fillStyle = colors[i]; ctx.fill();
    ang = a2;
  });
  ctx.fillStyle = '#232838'; ctx.beginPath(); ctx.arc(W/2,H/2,44,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#e8eaf0'; ctx.font='bold 22px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const pct = total ? Math.round(vals[0]/total*100) : 0;
  ctx.fillText(pct+'%', W/2, H/2-6);
  ctx.font='11px system-ui'; ctx.fillStyle='#9aa1b5'; ctx.fillText(labels[0], W/2, H/2+16);
}
function chartBars(cv, labels, vals, colors){
  const ctx = cv.getContext('2d');
  const W = cv.width = 560, H = cv.height = 220;
  const max = Math.max(...vals, 1);
  const bw = (W-40)/vals.length;
  ctx.font='11px system-ui'; ctx.fillStyle='#9aa1b5'; ctx.textAlign='center';
  vals.forEach((v,i) => {
    const h = v/max*(H-70);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(20+i*bw+bw*0.15, H-40-h, bw*0.7, h);
    ctx.fillStyle = '#9aa1b5';
    ctx.fillText(labels[i], 20+i*bw+bw/2, H-24);
    ctx.fillStyle='#e8eaf0';
    ctx.fillText(v, 20+i*bw+bw/2, H-46-h);
  });
}
function vStats(app){
  app.innerHTML = `
  <div class="panel">
    <div class="tabs">
      <button class="${statScope.tab==='global'?'active':''}" data-t="global">Global</button>
      <button class="${statScope.tab==='format'?'active':''}" data-t="format">Par format</button>
      <button class="${statScope.tab==='archetype'?'active':''}" data-t="archetype">Par archétype</button>
      <button class="${statScope.tab==='friends'?'active':''}" data-t="friends">Contre mes amis</button>
    </div>
    <div class="row" id="scopeselect"></div>
  </div>
  <div id="statbody"></div>`;
  app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { statScope.tab = b.dataset.t; vStats(app); });
  const sel = app.querySelector('#scopeselect');
  const body = app.querySelector('#statbody');
  const scopeMatches = () => {
    let ms = matches;
    if(statScope.tab==='format' && statScope.fmt!=='ALL') ms = ms.filter(m=>m.format===statScope.fmt);
    if(statScope.tab==='archetype' && statScope.arch) ms = ms.filter(m=>m.myArch===statScope.arch);
    if(statScope.tab==='friends' && statScope.friend) ms = ms.filter(m=>m.oppName===statScope.friend);
    return ms;
  };
  if(statScope.tab==='format'){
    sel.innerHTML = `<select id="s-fmt"><option value="ALL">Tous</option>${Object.entries(FMT_NAMES).map(([k,v])=>`<option ${statScope.fmt===k?'selected':''} value="${k}">${v}</option>`).join('')}</select>`;
    sel.querySelector('#s-fmt').onchange = e => { statScope.fmt = e.target.value; vStats(app); };
  } else if(statScope.tab==='archetype'){
    const archs = [...new Set(matches.map(m=>m.myArch).filter(Boolean))].sort();
    sel.innerHTML = `<select id="s-arch"><option value="">— choisir —option>${archs.map(a=>`<option ${statScope.arch===a?'selected':''}>${esc(a)}</option>`).join('')}</select>`;
    sel.querySelector('#s-arch').onchange = e => { statScope.arch = e.target.value; vStats(app); };
  } else if(statScope.tab==='friends'){
    const friends = [...new Set(matches.map(m=>m.oppName).filter(Boolean))].sort();
    sel.innerHTML = `<select id="s-friend"><option value="">— choisir —option>${friends.map(f=>`<option ${statScope.friend===f?'selected':''}>${esc(f)}</option>`).join('')}</select>`;
    sel.querySelector('#s-friend').onchange = e => { statScope.friend = e.target.value; vStats(app); };
  }
  renderStatsBody(body, scopeMatches(), statScope.tab);
}
function renderStatsBody(body, ms, tab){
  const games = ms.flatMap(m => m.games || []);
  const wins = ms.filter(m=>m.result==='V').length;
  const wr = ms.length ? Math.round(wins/ms.length*100) : 0;
  const totMull = games.reduce((a,g)=>a+(g.mull||0),0);
  const gamesNoMull = games.filter(g=>!g.mull), gamesMull = games.filter(g=>!!g.mull);
  const wrm = arr => { const w = arr.filter(g=>g.won).length; return arr.length ? Math.round(w/arr.length*100) : null; };
  const toss = ms.filter(m=>m.toss==1);
  body.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="v">${ms.length}</div><div class="l">matchs</div></div>
    <div class="kpi"><div class="v">${games.length}</div><div class="l">manches</div></div>
    <div class="kpi"><div class="v">${wr}%</div><div class="l">winrate match</div></div>
    <div class="kpi"><div class="v">${totMull}</div><div class="l">mulligans totaux</div></div>
  </div>
  ${ms.length<2 ? '<p class="hint">Enregistrez des matchs (onglet ⚔️) pour voir les statistiques se construire.</p>' : `
  <div class="statgrid">
    <div class="panel"><h4 class="sub">Winrate global</h4><canvas class="chart" id="donut"></canvas></div>
    <div class="panel"><h4 class="sub">Impact des mulligans (winrate par manche)</h4>
      <table><tr><td>Manche sans mulligan</td><td><b>${wrm(gamesNoMull)??'—'}%</b> (${gamesNoMull.length})</td></tr>
      <tr><td>Manche avec mulligan(s)</td><td><b>${wrm(gamesMull)??'—'}%</b> (${gamesMull.length})</td></tr></table></div>
    <div class="panel"><h4 class="sub">Winrate selon le toss (matchs)</h4>
      <table><tr><td>Toss gagné</td><td><b>${toss.length?Math.round(toss.filter(m=>m.result==='V').length/toss.length*100):'—'}%</b> (${toss.length})</td></tr>
      <tr><td>Toss perdu</td><td><b>${(ms.length-toss.length)?Math.round(ms.filter(m=>m.toss!=1&&m.result==='V').length/(ms.length-toss.length)*100):'—'}%</b> (${ms.length-toss.length})</td></tr></table></div>
    <div class="panel"><h4 class="sub">Matchs par mois</h4><canvas class="chart" id="months"></canvas></div>
  </div>`}`;
  if(ms.length>=2){
    chartDonut($('#donut'), [wins, ms.length-wins], ['victoires',''],['#3ecf6f','#ff5b6a']);
    const byMonth = new Map();
    ms.forEach(m => { const k = (m.date||'').slice(0,7); byMonth.set(k, (byMonth.get(k)||0)+1); });
    const months = [...byMonth.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-12);
    chartBars($('#months'), months.map(x=>x[0].slice(2)), months.map(x=>x[1]), ['#5b8cff']);
  }
}

/* ============================================================
   VUE MATCHUPS — matrice par format (point 10)
   ============================================================ */
let muFmt = 'MO';
function vMatchups(app){
  const ms = matches.filter(m=>m.format===muFmt && m.myArch && m.oppArch);
  const agg = new Map(); // myArch|oppArch -> {w, n}
  ms.forEach(m => {
    const k = m.myArch + '|' + m.oppArch;
    const c = agg.get(k) || {w:0,n:0};
    c.n++; if(m.result==='V') c.w++;
    agg.set(k, c);
  });
  const myArchs = [...new Set(ms.map(m=>m.myArch))].sort();
  const oppArchs = [...new Set(ms.map(m=>m.oppArch))].sort();
  app.innerHTML = `
  <div class="panel">
    <div class="row">
      <select id="mu-fmt">${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}" ${k===muFmt?'selected':''}>${v}</option>`).join('')}</select>
      <span class="hint">${ms.length} matchs exploitables (il faut l'archétype des deux decks)</span>
    </div>
  </div>
  ${!ms.length ? '<div class="panel"><p class="hint">Pas encore de matchs complets sur ce format. Enregistrez vos matchs avec les archétypes remplis pour construire la matrice.</p></div>' : `
  <div class="panel"><div style="overflow:auto">
    <table class="matrix"><thead><tr><th>Mon archétype ↓ / Adversaire →</th>
      ${oppArchs.map(a=>`<th>${esc(a)}</th>`).join('')}</tr></thead><tbody>
    ${myArchs.map(ma => `<tr><th>${esc(ma)}</th>
      ${oppArchs.map(oa => {
        const c = agg.get(ma+'|'+oa);
        if(!c) return '<td class="heat" style="opacity:.25">·</td>';
        const wr = Math.round(c.w/c.n*100);
        const col = wr>=60 ? 'var(--ok)' : wr>=40 ? 'var(--warn)' : 'var(--bad)';
        return `<td class="heat"><b style="color:${col}">${wr}%</b><br><span class="pill">${c.n} m.</span></td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div></div>`}`;
  app.querySelector('#mu-fmt').onchange = e => { muFmt = e.target.value; vMatchups(app); };
}

/* ============================================================
   VUE CARTES & TAGS (point 12)
   ============================================================ */
async function vCardInfo(app){ /* utilisé comme fiche, cf. showCardInfo */ vCardSearch(app); }
function vCardSearch(app){
  app.innerHTML = `
  <div class="panel">
    <h3 style="margin-bottom:10px">🧠 Fiche carte : métadonnées &amp; cartes similaires</h3>
    <div class="suggbox">
      <input type="text" id="cisearch" placeholder="Nom d'une carte, ex : Llanowar Elves…" autocomplete="off" style="width:100%">
      <div class="suggestions" id="cisugg" style="display:none"></div>
    </div>
    <p class="hint" style="margin-top:8px">Les tags (one drop, creature, manadork, couleur…) sont déduits automatiquement des données de règles Scryfall. Ajoutez vos propres tags (ex : anti-bête) pour affiner les recherches de cartes similaires.</p>
  </div>
  <div id="cibody"></div>`;
  const input = app.querySelector('#cisearch'), sugg = app.querySelector('#cisugg');
  let t=null, items=[];
  input.oninput = () => {
    clearTimeout(t); const q = input.value.trim();
    if(q.length<2){ sugg.style.display='none'; return; }
    t = setTimeout(async () => {
      items = await sfAutocomplete(q);
      sugg.innerHTML = items.slice(0,8).map((n,i)=>`<div data-i="${i}">${esc(n)}</div>`).join('');
      sugg.style.display = items.length?'block':'none';
      sugg.querySelectorAll('div').forEach(el => el.onclick = async () => {
        sugg.style.display='none';
        await showCardInfo(items[el.dataset.i], app.querySelector('#cibody'));
      });
    }, 260);
  };
}
async function showCardInfo(name, box){
  box = box || $('#modal');
  if(!box.classList || !box.classList.contains('modal')) openModal('');
  if(box === $('#modal')) openModal('<p class="hint">Chargement…</p>');
  let c; try{ c = sfCache[norm(name)] || await sfCardByName(name); }catch(e){}
  if(!c){ box.innerHTML = `<p class="hint">Carte introuvable sur Scryfall.</p>`; return; }
  const auto = deriveTags(c), custom = getCustomTags(name);
  const have = collection[norm(name)]?.qty || 0;
  box.innerHTML = `
    <button class="close" id="mclose">✕</button>
    <div class="row" style="align-items:flex-start;gap:20px">
      <img src="${c.image||''}" style="width:230px;border-radius:12px;background:#000">
      <div style="flex:1">
        <h2>${esc(c.name)}</h2>
        <p class="hint">${esc(c.type_line||'')} · mv ${c.mv} · ${esc(c.set_name||'')} (${esc((c.set||'').toUpperCase())}, ${esc(c.released_at||'')})</p>
        <p style="margin:8px 0"><span class="price" style="color:var(--warn);font-weight:700">${eur(c.eur)}</span>
        ${c.eur_foil?`<span class="hint"> · foil ${eur(c.eur_foil)}</span>`:''} <span class="pill">(prix Cardmarket via Scryfall)</span></p>
        <div class="qty-ctl"><button id="ci-dec">−</button><b id="ci-q">${have}</b><button id="ci-inc">+</button> <span class="hint">dans ma collection</span></div>
        <h4 class="sub">Métadonnées</h4>
        <div>${auto.map(t=>`<span class="tag auto">${esc(t)}</span>`).join('')||'<span class="hint">—</span>'}</div>
        <div>${custom.map(t=>`<span class="tag custom" data-ct="${esc(t)}">${esc(t)} ✕</span>`).join('')}
          <input type="text" id="newtag" placeholder="+ tag perso…" style="min-width:120px;padding:4px 8px">
        </div>
        <h4 class="sub">Texte de règles</h4>
        <p class="hint" style="white-space:pre-wrap">${esc(c.oracle||'')}</p>
        <h4 class="sub">Historique de prix Cardmarket</h4>
        <div id="pricehist"><p class="hint">Chargement de l'historique…</p></div>
        ${c.scryfall_uri?`<p style="margin-top:8px"><a href="${c.scryfall_uri}" target="_blank" style="color:var(--accent)">Voir sur Scryfall ↗</a></p>`:''}
      </div>
    </div>
    <h4 class="sub">Cartes ressemblantes</h4>
    <div id="simcards"><p class="hint">Recherche en cours…</p></div>`;
  const modal = box.id==='modal' ? box : box;
  modal.querySelector('#mclose')?.addEventListener('click', () => $('#modalbg').classList.remove('open'));
  modal.querySelector('#ci-inc').onclick = () => {
    const k = norm(name);
    addEntry({name, qty:1, tags:[]}); saveColl();
    modal.querySelector('#ci-q').textContent = collection[k].qty;
  };
  modal.querySelector('#ci-dec').onclick = () => {
    const k = norm(name);
    const mine = entries.filter(e => e.norm === k);
    if(mine.length){ const e = mine[mine.length-1]; e.qty--; if(e.qty<=0) entries = entries.filter(x=>x.id!==e.id); saveColl(); }
    modal.querySelector('#ci-q').textContent = collection[k]?.qty || 0;
  };
  modal.querySelector('#newtag').onkeydown = e => {
    if(e.key==='Enter' && e.target.value.trim()){ addCustomTag(name, e.target.value.trim()); showCardInfo(name, box); }
  };
  modal.querySelectorAll('[data-ct]').forEach(el => el.onclick = () => {
    removeCustomTag(name, el.dataset.ct); showCardInfo(name, box);
  });
  loadPriceChart(c, modal);
  // cartes similaires : basées sur ce que FAIT la carte (texte d'oracle)
  try{
    const j = await sfSearch(similarQuery(c), 1);
    const why = similarityLabels(c);
    const sims = (j.data||[]).filter(x => norm(x.name)!==norm(name))
      .map(x => ({name:x.name, img:(x.image_uris?.normal||x.card_faces?.[0]?.image_uris?.normal||''), set:x.set}));
    modal.querySelector('#simcards').innerHTML =
      (why.length ? `<p class="hint">Critères : ${why.map(w=>`<span class="tag auto">${esc(w)}</span>`).join('')}</p>` : '') +
      (sims.length
      ? `<div class="row">${sims.slice(0,12).map(s=>`
          <div class="cardtile" style="width:120px;cursor:pointer" data-sn="${esc(s.name)}">
            <img src="${s.img}" loading="lazy" style="width:100%;aspect-ratio:488/680;object-fit:cover">
            <div class="info" style="font-size:11px">${esc(s.name)}</div></div>`).join('')}</div>`
      : '<p class="hint">Aucune carte similaire trouvée.</p>');
    modal.querySelectorAll('[data-sn]').forEach(el => el.onclick = () => showCardInfo(el.dataset.sn, box));
  }catch(e){
    modal.querySelector('#simcards').innerHTML = '<p class="hint">Recherche indisponible.</p>';
  }
}
function openModal(html){
  $('#modal').innerHTML = html;
  $('#modalbg').classList.add('open');
  $('#modalbg').onclick = e => { if(e.target.id==='modalbg') e.target.classList.remove('open'); };
}
function closeModal(){ $('#modalbg').classList.remove('open'); }

/* ---- zoom au survol des visuels (délégation globale, une seule fois) ---- */
if(!window.__zoomInit){
  window.__zoomInit = true;
  const z = () => document.getElementById('zoomer');
  document.addEventListener('mouseover', e => {
    const im = e.target;
    if(im && im.tagName === 'IMG' && im.dataset.zoom){
      const el = z(); el.querySelector('img').src = im.dataset.zoom; el.style.display = 'block';
    }
  });
  document.addEventListener('mouseout', e => {
    if(e.target && e.target.tagName === 'IMG' && e.target.dataset.zoom){ const el = z(); if(el) el.style.display = 'none'; }
  });
  document.addEventListener('mousemove', e => {
    const el = z(); if(!el || el.style.display !== 'block') return;
    const w = 300, h = 420;
    let x = e.clientX + 18, y = e.clientY - h/2;
    if(x + w > innerWidth) x = e.clientX - w - 18;
    y = Math.max(8, Math.min(innerHeight - h - 8, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  });
}

window.__booted = true;
/* ============================================================
   VUE DECKS PERSO
   ============================================================ */
let curMyDeck = null;      // deck ouvert
function vMyDecks(app){
  curMyDeck = null;
  app.innerHTML = `
  <div class="panel"><div class="row" style="justify-content:space-between">
    <h3>Mes decks</h3>
    <button class="btn" id="newdeck">+ Nouveau deck</button>
  </div>
  ${myDecks.length ? `<table><thead><tr><th>Nom</th><th>Format</th><th>Créé le</th><th>Cartes</th><th></th></tr></thead><tbody>
    ${myDecks.map(d => `<tr>
      <td><span class="link" data-open="${d.id}">${esc(d.name)}</span></td>
      <td class="hint">${esc(d.format||'—')}</td>
      <td class="hint">${esc((d.createdAt||'').slice(0,10))}</td>
      <td>${(d.list||[]).filter(c=>!c.side).reduce((a,c)=>a+c.qty,0)} main</td>
      <td><span class="trash" data-del="${d.id}">🗑</span></td>
    </tr>`).join('')}</tbody></table>`
  : '<p class="hint">Aucun deck perso. Créez-en un pour suivre vos listes, commentaires et modifications.</p>'}
  </div>`;
  app.querySelector('#newdeck').onclick = () => {
    const name = prompt('Nom du deck ?'); if(!name) return;
    const format = prompt('Format ? (Modern, Legacy, Commander…)', 'Modern') || 'Modern';
    myDecks.push({ id:'d'+Math.random().toString(36).slice(2,10), name, format,
      createdAt:new Date().toISOString(), comments:'', list:[], changelog:[{date:new Date().toISOString(), text:'Deck créé'}] });
    saveDecks(); vMyDecks(app);
  };
  app.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openMyDeck(el.dataset.open));
  app.querySelectorAll('[data-del]').forEach(el => el.onclick = () => {
    if(!confirm('Supprimer ce deck ?')) return;
    myDecks = myDecks.filter(d => d.id !== el.dataset.del); saveDecks(); vMyDecks(app);
  });
}
function logDeck(d, text){
  d.changelog = [{date:new Date().toISOString(), text}, ...(d.changelog||[])].slice(0, 200);
  saveDecks();
}
function openMyDeck(id){
  const d = myDecks.find(x => x.id === id); if(!d) return;
  curMyDeck = d;
  const app = $('#app');
  const main = (d.list||[]).filter(c => !c.side).map(c => [c.name, c.qty]);
  const side = (d.list||[]).filter(c => c.side).map(c => [c.name, c.qty]);
  const a = analyzeList(main, side, false);
  const lineHTML = (n,q) => {
    const it = d.list.find(c => c.name === n && !!c.side === (dvTab==='side'));
    const k = norm(n); const own = Math.min(collection[k]?.qty||0, q);
    return `<div class="cardline" data-card="${esc(n)}">
      <span><b>${q}×</b> <span class="link" data-ci="${esc(n)}">${esc(n)}</span></span>
      <span class="row" style="gap:6px">
        <span class="${own>=q?'n':'m'}">${own>=q?'✔':'✘ '+own+'/'+q}</span>
        <button class="btn ghost" data-mq="dec" style="padding:0 8px">−</button>
        <button class="btn ghost" data-mq="inc" style="padding:0 8px">+</button>
        <span class="trash" data-rmcard="1">🗑</span>
      </span></div>`;
  };
  app.innerHTML = `
  <button class="btn ghost" id="backmy">← Mes decks</button>
  <div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap">
    <h3 style="margin:0">${esc(d.name)} <span class="pill">${esc(d.format||'')}</span></h3>
    <b style="color:${a.pct>=1?'var(--ok)':'var(--accent)'}">${Math.round(a.pct*100)}% possédé · ${a.missingQty} manquantes</b>
  </div>
  <div class="row" style="margin-top:10px;flex-wrap:wrap">
    <div class="suggbox" style="flex:1;min-width:240px">
      <input type="text" id="mdcard" placeholder="Ajouter une carte (toutes langues)…" autocomplete="off" style="width:100%">
      <div class="suggestions" id="mdsugg" style="display:none"></div>
    </div>
    <input type="number" id="mdqty" value="1" min="1" max="99" style="width:70px">
    <label class="hint"><input type="checkbox" id="mdside"> sideboard</label>
  </div>
  <div id="mdbody" style="margin-top:12px"></div>
  </div>
  <div class="panel"><h4 class="sub">Commentaires sur le deck</h4>
    <textarea id="mdcomments" rows="4" style="width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px">${esc(d.comments||'')}</textarea>
    <button class="btn" id="mdsavec" style="margin-top:6px">Enregistrer les commentaires</button>
  </div>
  <div class="panel"><h4 class="sub">Historique des modifications</h4>
    ${(d.changelog||[]).map(c => `<div class="row" style="gap:10px"><span class="hint" style="min-width:150px">${esc(c.date.slice(0,10))}</span><span>${esc(c.text)}</span></div>`).join('') || '<p class="hint">Aucune modification enregistrée.</p>'}
  </div>`;
  const rerender = async () => {
    const body = app.querySelector('#mdbody');
    const m2 = (d.list||[]).filter(c => !c.side).map(c => [c.name, c.qty]);
    const s2 = (d.list||[]).filter(c => c.side).map(c => [c.name, c.qty]);
    await gatherMeta([...new Set(m2.concat(s2).map(([n]) => n))]);
    body.innerHTML = deckViewHTML(m2, s2, lineHTML);
    body.__dvMain = m2;
    bindDeckView(body, rerender);
    drawDeckCharts(body);
    m2.concat(s2).forEach(([n]) => hydrateImage(n));
    body.querySelectorAll('[data-mq]').forEach(b => b.onclick = () => {
      const ln = b.closest('.cardline').querySelector('.link').dataset.ci;
      const it = d.list.find(c => c.name === ln && !!c.side === (dvTab==='side'));
      if(!it) return;
      it.qty += b.dataset.mq === 'inc' ? 1 : -1;
      if(it.qty <= 0) d.list = d.list.filter(c => c !== it);
      logDeck(d, `${it.qty <= 0 ? 'Retrait' : 'Quantité'} : ${ln} → ${Math.max(it.qty,0)}${dvTab==='side'?' (side)':''}`);
      rerender();
    });
    body.querySelectorAll('[data-rmcard]').forEach(b => b.onclick = () => {
      const ln = b.closest('.cardline').querySelector('.link').dataset.ci;
      d.list = d.list.filter(c => !(c.name === ln && !!c.side === (dvTab==='side')));
      logDeck(d, `Retrait : ${ln}${dvTab==='side'?' (side)':''}`);
      rerender();
    });
    body.querySelectorAll('[data-ci]').forEach(el => el.onclick = () => showCardInfo(el.dataset.ci));
  };
  rerender();
  app.querySelector('#backmy').onclick = () => vMyDecks(app);
  app.querySelector('#mdsavec').onclick = () => { d.comments = app.querySelector('#mdcomments').value; saveDecks(); };
  // autocomplétion ajout de carte
  const inp = app.querySelector('#mdcard'), sugg = app.querySelector('#mdsugg');
  let dt = null;
  inp.addEventListener('input', () => {
    clearTimeout(dt); const q = inp.value.trim(); if(!q){ sugg.style.display='none'; return; }
    dt = setTimeout(async () => {
      let list = []; try{ list = await sfAutocomplete(q); }catch(e){}
      sugg.innerHTML = list.slice(0,10).map(n => `<div class="sug" data-n="${esc(n)}">${esc(n)}</div>`).join('') || '<div class="sug hint">Aucun résultat</div>';
      sugg.style.display='block';
    }, 220);
  });
  sugg.addEventListener('mousedown', e => {
    const it = e.target.closest('.sug'); if(!it || !it.dataset.n) return;
    const n = it.dataset.n, qty = +app.querySelector('#mdqty').value || 1;
    const isSide = app.querySelector('#mdside').checked;
    const ex = d.list.find(c => c.name === n && !!c.side === isSide);
    if(ex) ex.qty += qty; else d.list.push({name:n, qty, side:isSide});
    logDeck(d, `Ajout : ${qty}× ${n}${isSide?' (side)':''}`);
    inp.value=''; sugg.style.display='none';
    rerender();
  });
}

/* ============================================================
   VUE MARCHÉ (historique MTGJSON via /api/market)
   ============================================================ */
const MARKET_LABELS = {['1w']:'1 semaine',['1m']:'1 mois',['1y']:'1 an',['3y']:'3 ans',['5y']:'5 ans',['10y']:'10 ans',['rel']:'depuis la sortie'};
let mkF = {w:'1m', scope:'all'};
function vMarket(app){
  app.innerHTML = `
  <div class="panel">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Marché — évolutions de prix Cardmarket</h3>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="mk-w">${Object.entries(MARKET_LABELS).map(([k,l]) => `<option value="${k}" ${mkF.w===k?'selected':''}>${l}</option>`).join('')}</select>
        <span class="binderchip ${mkF.scope==='all'?'active':''}" data-sc="all">Toutes cartes</span>
        <span class="binderchip ${mkF.scope==='collection'?'active':''}" data-sc="collection">Ma collection</span>
      </div>
    </div>
    <p class="hint" style="margin:6px 0 2px">Source : prix retail Cardmarket (EUR) via MTGJSON, accumulés dans <code>prices.db</code> (exécutez <code>price_seed.py prices</code> puis <code>price_seed.py cards</code> une fois ; les prix du jour s'ajoutent automatiquement à chaque ouverture de l'app). MTGJSON ne fournit qu'environ 3 mois de recul initial : les fenêtres plus larges comparent au plus ancien prix connu, et l'historique s'allonge au fil des jours.</p>
    <div id="mkres"><p class="hint">Chargement…</p></div>
  </div>`;
  const run = () => {
    const box = app.querySelector('#mkres');
    box.innerHTML = '<p class="hint">Chargement…</p>';
    fetch(`/api/market?w=${mkF.w}&scope=${mkF.scope}&limit=15`).then(r => r.json()).then(j => {
      if(!j.ok){ box.innerHTML = `<p class="hint">⚠ ${esc(j.error||'indisponible')}</p>`; return; }
      const tbl = (title, rows, cls) => !rows.length ? '' : `
        <h4 class="sub" style="margin-top:14px">${title}</h4>
        <table><thead><tr><th>#</th><th>Carte</th><th>Extension</th><th>Avant</th><th>Maintenant</th><th>Évolution</th></tr></thead><tbody>
        ${rows.map((r,i) => `<tr>
          <td class="hint">${i+1}</td>
          <td><span class="link" data-sf="${r.sfid||''}" data-nm="${esc(r.name)}">${esc(r.name)}</span>${r.foil?' <span class="foil-badge">FOIL</span>':''}${r.qty>1?` <span class="hint">×${r.qty}</span>`:''}</td>
          <td class="hint">${(r.set||'').toUpperCase()}</td>
          <td class="p">${eur(r.was)}</td><td class="p">${eur(r.now)}</td>
          <td style="color:${r.pct>=0?'var(--ok)':'var(--bad)'};font-weight:700">${r.pct>=0?'+':''}${(r.pct*100).toFixed(1)}%</td>
        </tr>`).join('')}</tbody></table>`;
      box.innerHTML = `
        <p class="hint">${j.n} cartes comparées sur la période${j.scope==='collection'?' (celles de votre collection reconnues dans prices.db)':''}.</p>
        ${tbl('📈 Top hausses', j.top)}${tbl('📉 Top baisses', j.flop)}`;
      box.querySelectorAll('[data-nm]').forEach(el => el.onclick = () => el.dataset.sf ? showCardInfo(el.dataset.nm) : showCardInfo(el.dataset.nm));
    }).catch(e => { box.innerHTML = `<p class="hint">Serveur injoignable (${e})</p>`; });
  };
  app.querySelector('#mk-w').onchange = e => { mkF.w = e.target.value; run(); };
  app.querySelectorAll('[data-sc]').forEach(el => el.onclick = () => { mkF.scope = el.dataset.sc; vMarket(app); });
  run();
}

/* courbe de prix : une ou deux lignes (normal, foil) */
function drawPriceChart(cv, series){
  const all = series.filter(s => s.pts.length);
  if(!all.length) return false;
  const ctx = cv.getContext('2d');
  const W = cv.width = cv.clientWidth * (window.devicePixelRatio||1), H = cv.height = 220 * (window.devicePixelRatio||1);
  ctx.scale(1,1);
  const pad = {l:46*(window.devicePixelRatio||1), r:10, t:14, b:26*(window.devicePixelRatio||1)};
  const dpr = window.devicePixelRatio||1;
  const xs = all.flatMap(s => s.pts.map(p => p[0]));
  const ys = all.flatMap(s => s.pts.map(p => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = 0, y1 = Math.max(...ys)*1.08;
  const X = v => pad.l + (v-x0)/(x1-x0||1)*(W-pad.l-pad.r);
  const Y = v => H-pad.b - v/(y1||1)*(H-pad.t-pad.b);
  ctx.clearRect(0,0,W,H);
  ctx.font = `${11*dpr}px sans-serif`;
  // grille horizontale (prix)
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.fillStyle = 'rgba(255,255,255,.45)';
  for(let g=0; g<=4; g++){
    const yv = y1*g/4, y = Y(yv);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke();
    ctx.fillText(yv.toFixed(yv<10?2:0)+'€', 4*dpr, y+4*dpr);
  }
  // dates min/max
  ctx.fillText(new Date(x0).toLocaleDateString('fr-FR'), pad.l, H-8*dpr);
  const lab = new Date(x1).toLocaleDateString('fr-FR');
  ctx.fillText(lab, W-pad.r-ctx.measureText(lab).width, H-8*dpr);
  // lignes
  for(const s of all){
    ctx.strokeStyle = s.color; ctx.lineWidth = 2*dpr; ctx.beginPath();
    s.pts.forEach((p,i) => { const x = X(p[0]), y = Y(p[1]); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); });
    ctx.stroke();
  }
  // légende
  let lx = pad.l;
  for(const s of all){
    if(!s.pts.length) continue;
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 2*dpr, 10*dpr, 3*dpr);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(s.label, lx+14*dpr, 8*dpr);
    lx += 24*dpr + ctx.measureText(s.label).width + 24*dpr;
  }
  return true;
}
async function loadPriceChart(c, modal){
  const box = modal.querySelector('#pricehist');
  if(!box) return;
  if(!c.id){ box.innerHTML = '<p class="hint">Historique indisponible.</p>'; return; }
  let j = null;
  try{ j = await (await fetch(`/api/price?sfid=${c.id}`)).json(); }catch(e){}
  if(!j || !j.ok){ box.innerHTML = `<p class="hint">⚠ ${esc((j&&j.error)||'prices.db absent : exécutez price_seed.py pour activer le marché.')}</p>`; return; }
  const series = [];
  if(j.normal.length) series.push({label:'Normal', color:'#5b8cff', pts:j.normal.map(p => [new Date(p[0]).getTime(), p[1]])});
  if(j.foil && j.foil.length) series.push({label:'Foil', color:'#e0b84d', pts:j.foil.map(p => [new Date(p[0]).getTime(), p[1]])});
  if(series.every(s => !s.pts.length)){ box.innerHTML = '<p class="hint">Aucun historique pour cette carte.</p>'; return; }
  const first = series.flatMap(s => s.pts)[0], lastN = j.normal[j.normal.length-1], lastF = j.foil && j.foil[j.foil.length-1];
  box.innerHTML = `
    <canvas class="chart" id="pricecv" style="width:100%;height:220px"></canvas>
    <p class="hint">${j.normal.length+j.foil.length} points · dernier prix : ${eur(lastN?lastN[1]:lastF[1])} (${lastN?lastN[0]:lastF[0]})
      ${lastF?` · foil ${eur(lastF[1])}`:''}</p>`;
  drawPriceChart(box.querySelector('#pricecv'), series);
}

/* ============================================================
   VUE STATISTIQUES COLLECTION
   ============================================================ */
let scF = {fmt:'MO', from:'', to:'', ntop:24};
function vStatsColl(app){
  const totalQty = entries.reduce((a,e) => a+e.qty, 0);
  app.innerHTML = `
  <div class="statgrid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="panel" style="margin:0"><h3>Vue d'ensemble</h3><div id="scov"><p class="hint">Calcul…</p></div></div>
    <div class="panel" style="margin:0"><h4 class="sub">Cartes par année d'impression</h4><canvas class="chart" id="scyears"></canvas></div>
    <div class="panel" style="margin:0"><h4 class="sub">Extensions les plus représentées</h4><div id="scsets"></div></div>
    <div class="panel" style="margin:0"><h4 class="sub">Cartes les plus possédées</h4><div id="sctop"></div></div>
  </div>
  <div class="panel"><h3>Valorisation de la collection</h3><div id="scval"><p class="hint">Calcul…</p></div></div>
  <div class="panel"><h3>Cartes les plus jouées par format — taux de possession</h3>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <select id="sc-fmt">${Object.entries(FMT_NAMES).map(([k,v]) => `<option value="${k}" ${scF.fmt===k?'selected':''}>${v}</option>`).join('')}</select>
      <label class="hint">du <input type="date" id="sc-from" value="${scF.from}" style="color-scheme:dark"></label>
      <label class="hint">au <input type="date" id="sc-to" value="${scF.to}" style="color-scheme:dark"></label>
      <button class="btn ghost" id="sc-clear">Toutes dates</button>
    </div>
    <div id="scowned"></div>
  </div>`;
  // ---- vue d'ensemble + année (depuis le cache des prints)
  const withMeta = entries.filter(e => entryPrintSync(e));
  const years = {};
  entries.forEach(e => { const p = entryPrintSync(e); if(!p) return;
    const y = (p.released_at||'').slice(0,4) || '?';
    years[y] = (years[y]||0) + e.qty; });
  const ykeys = Object.keys(years).filter(y => y !== '?').sort();
  app.querySelector('#scov').innerHTML = `
    <p style="font-size:26px;font-weight:700">${entries.length} groupes · ${totalQty} exemplaires</p>
    <p class="hint">${withMeta.length === entries.length ? 'métadonnées complètes' : `métadonnées chargées pour ${withMeta.length}/${entries.length} (affichez la collection pour compléter)`}</p>`;
  const cy = app.querySelector('#scyears');
  if(ykeys.length) chartBars(cy, ykeys, ykeys.map(k => years[k]), ['#5b8cff']);
  else cy.replaceWith('<p class="hint">Métadonnées pas encore chargées.</p>');
  // ---- top extensions / top cartes
  const setCount = {};
  entries.forEach(e => setCount[e.set] = (setCount[e.set]||0) + e.qty);
  const topSets = Object.entries(setCount).sort((a,b) => b[1]-a[1]).slice(0,10);
  app.querySelector('#scsets').innerHTML = topSets.map(([s,n]) => `<div class="row" style="justify-content:space-between"><span class="link" data-set="${s}">${s.toUpperCase()}</span><span class="hint">${n} ex.</span></div>`).join('') || '<p class="hint">—</p>';
  const topCards = entries.slice().sort((a,b) => b.qty-a.qty).slice(0,10);
  app.querySelector('#sctop').innerHTML = topCards.map(e => `<div class="row" style="justify-content:space-between"><span class="link" data-nm="${esc(e.name)}">${esc(e.name)}</span><span class="hint">×${e.qty}</span></div>`).join('') || '<p class="hint">—</p>';
  app.querySelectorAll('[data-set]').forEach(el => el.onclick = () => { browseMode='sets'; browseSet=el.dataset.set; setView('browse-sets'); });
  app.querySelectorAll('[data-nm]').forEach(el => el.onclick = () => showCardInfo(el.dataset.nm));
  // ---- valorisation via serveur
  fetch('/api/collvalue').then(r => r.json()).then(j => {
    const box = app.querySelector('#scval');
    if(!j.ok){ box.innerHTML = `<p class="hint">⚠ ${esc(j.error||'indisponible')}</p>`; return; }
    const rows = [['Maintenant', j.now]];
    [['w1','il y a 1 semaine'],['m1','il y a 1 mois'],['m3','il y a 3 mois'],['y1','il y a 1 an'],['y3','il y a 3 ans'],['y5','il y a 5 ans'],['y10','il y a 10 ans']]
      .forEach(([k,l]) => { if(j.past[k]) rows.push([l, j.past[k]]); });
    const ref = rows[0][1] || 1;
    box.innerHTML = `
      <p style="font-size:22px;font-weight:700;color:var(--warn)">${eur(j.now)}</p>
      <p class="hint">${j.matched}/${j.total} entrées reconnues dans prices.db</p>
      <table><thead><tr><th>Date</th><th>Valeur</th><th>Évolution</th></tr></thead><tbody>
      ${rows.map(([l,v],i) => `<tr><td>${l}</td><td class="p">${eur(v)}</td>
        <td>${i ? `<span style="color:${v>=ref?'var(--ok)':'var(--bad)'}">${v>=ref?'+':''}${((v/ref-1)*100).toFixed(1)}%</span>` : '<span class="hint">référence</span>'}</td></tr>`).join('')}
      </tbody></table>`;
  }).catch(() => { app.querySelector('#scval').innerHTML = '<p class="hint">Serveur injoignable.</p>'; });
  // ---- cartes les plus jouées par format (données MTGTop8 locales)
  const runOwned = () => {
    const box = app.querySelector('#scowned');
    const f = scF.fmt, from = scF.from, to = scF.to;
    const counts = new Map();
    DECKS.forEach(d => {
      if(d[1] !== f) return;
      if(from && (d[8]||'') < from) return;
      if(to && (d[8]||'') > to) return;
      const {main} = parseDeck(DECKS.indexOf(d));
      main.forEach(([n,q]) => counts.set(n, (counts.get(n)||0) + q));
    });
    const top = [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0, +scF.ntop || 24);
    const totalDecks = DECKS.filter(d => d[1] === f && (!from || (d[8]||'') >= from) && (!to || (d[8]||'') <= to)).length;
    box.innerHTML = !top.length ? '<p class="hint">Aucun deck sur cette période.</p>' : `
      <p class="hint">${totalDecks} decks ${fmtName(f)}${from||to?` entre ${from||'…'} et ${to||'…'}`:''} — top ${top.length} cartes par nombre d'exemplaires joués.</p>
      <table><thead><tr><th>Carte</th><th>Jouée</th><th>Possédées</th><th>Taux</th></tr></thead><tbody>
      ${top.map(([n,q]) => {
        const own = collection[norm(n)]?.qty || 0;
        const pct = Math.min(100, Math.round(own/q*100));
        return `<tr><td><span class="link" data-nm="${esc(n)}">${esc(n)}</span></td><td class="hint">${q}</td><td class="${own>=q?'n':'m'}">${own}</td>
          <td><div class="bar" style="min-width:90px"><div style="width:${pct}%;background:${pct>=100?'var(--ok)':pct>=50?'var(--warn)':'var(--bad)'}"></div></div><span class="hint">${pct}%</span></td></tr>`;
      }).join('')}</tbody></table>`;
    box.querySelectorAll('[data-nm]').forEach(el => el.onclick = () => showCardInfo(el.dataset.nm));
  };
  app.querySelector('#sc-fmt').onchange = e => { scF.fmt = e.target.value; runOwned(); };
  app.querySelector('#sc-from').onchange = e => { scF.from = e.target.value; runOwned(); };
  app.querySelector('#sc-to').onchange = e => { scF.to = e.target.value; runOwned(); };
  app.querySelector('#sc-clear').onclick = () => { scF.from = scF.to = ''; vStatsColl(app); };
  runOwned();
}

/* ============================================================
   VUE PARAMÈTRES (Cardmarket)
   ============================================================ */
function vSettings(app){
  app.innerHTML = `
  <div class="panel"><h3>Paramètres Cardmarket</h3>
  <p class="hint">Renseignez vos jetons de l'API Cardmarket (https://apiv2.cardmarket.com/ws/documentation). Ils sont stockés côté serveur (BDD) et servent à piloter votre compte : mise en vente, prix, vacances… Les appels passent par le serveur local, qui signe les requêtes OAuth 1.0a.</p>
  <div class="statgrid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
    <label>Nom d'utilisateur MKM<input id="s-user" style="width:100%"></label>
    <label>App Token<input id="s-at" style="width:100%"></label>
    <label>App Secret<input id="s-as" type="password" style="width:100%"></label>
    <label>Access Token<input id="s-act" style="width:100%"></label>
    <label>Access Token Secret<input id="s-acs" type="password" style="width:100%"></label>
  </div>
  <div class="row" style="margin-top:10px;flex-wrap:wrap">
    <button class="btn" id="s-save">💾 Enregistrer</button>
    <button class="btn ghost" id="s-test">🔌 Tester la connexion</button>
    <button class="btn ghost" id="s-vac-on">🏖 Vacances ON</button>
    <button class="btn ghost" id="s-vac-off">🏗 Vacances OFF</button>
    <button class="btn ghost" id="s-csv">📄 Export CSV « a vendre »</button>
    <span id="s-status" class="hint"></span>
  </div>
  <p class="hint" id="s-info" style="margin-top:8px">Statut : inconnu (enregistrez d'abord vos jetons).</p>
  </div>`;
  const st = m => { app.querySelector('#s-status').textContent = m; };
  const loadSettings = async () => {
    try{
      const r = await fetch('/api/mkm/settings'); const j = await r.json();
      if(j.present){
        app.querySelector('#s-user').value = j.username || '';
        app.querySelector('#s-info').textContent = 'Statut : jetons enregistrés ✔';
      }
    }catch(e){ st('Serveur injoignable.'); }
  };
  const getPayload = () => ({
    username: app.querySelector('#s-user').value.trim(),
    app_token: app.querySelector('#s-at').value.trim(),
    app_secret: app.querySelector('#s-as').value,
    access_token: app.querySelector('#s-act').value.trim(),
    access_secret: app.querySelector('#s-acs').value,
  });
  app.querySelector('#s-save').onclick = async () => {
    const p = getPayload();
    if(!p.username || !p.app_token || !p.app_secret || !p.access_token || !p.access_secret)
      return st('⚠ Tous les champs sont requis.');
    const r = await fetch('/api/mkm/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(p)});
    st(r.ok ? 'Enregistrés ✔' : 'Échec de l\'enregistrement');
    loadSettings();
  };
  app.querySelector('#s-test').onclick = async () => {
    st('Test en cours…');
    try{
      const r = await fetch('/api/mkm/test', {method:'POST'});
      const j = await r.json();
      st(j.ok ? `Connexion OK ✔ (compte : ${j.account || '?'})` : `Erreur : ${j.error||r.status}`);
    }catch(e){ st('Serveur injoignable.'); }
  };
  app.querySelector('#s-vac-on').onclick = () => setVacation(true, st);
  app.querySelector('#s-vac-off').onclick = () => setVacation(false, st);
  app.querySelector('#s-csv').onclick = () => {
    const rows = [['ProdID','Name','Expansion','Rarity','Foil','Signed','Language','Qty','Condition','Price','Comment']];
    entries.forEach(e => {
      if(!(e.tags||[]).some(t => norm(t) === norm('a vendre'))) return;
      rows.push(['', e.name, (e.set||'').toUpperCase(), '', e.foil?'X':'', e.signed?'X':'', LANGS[e.lang]||'Anglais',
        e.qty, COND_LABEL[e.cond||'NM'], '', (e.tags||[]).join(' ')]);
    });
    if(rows.length === 1) return st('Aucune carte taguée « a vendre ».');
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff'+csv], {type:'text/csv'}));
    const aEl = document.createElement('a'); aEl.href = url; aEl.download = 'stock_cardmarket.csv'; aEl.click();
    URL.revokeObjectURL(url);
  };
  loadSettings();
}
async function setVacation(on, st){
  st(on ? 'Activation des vacances…' : 'Désactivation des vacances…');
  try{
    const r = await fetch('/api/mkm/vacation', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({on})});
    const j = await r.json();
    st(j.ok ? (on ? 'Compte en vacances ✔' : 'Compte de retour de vacances ✔') : `Erreur : ${j.error||r.status}`);
  }catch(e){ st('Serveur injoignable.'); }
}

pullState().then(loadData);
// mise à jour quotidienne des prix (AllPricesToday → prices.db), 1×/jour côté serveur
fetch('/api/price/today', {method:'POST'}).catch(() => {});
