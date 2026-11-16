import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS, TYPES_LIST, frDate } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks, ownedQtyMap } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal, priceRangeHTML, wirePriceRange, setPriceBounds } from '../ui.js';
import { R, S } from '../core/registry.js';

/* ============================================================
   VUE CARTES & EXTENSIONS
   ============================================================ */
let browseMode = 'sets', browseSet = null, browsePage = 1, browseQuery = '', browseData = null, browseQ = '';
let advF = {colors:[], types:[], cmc:'', pmin:'', pmax:'', set:'', artist:'', reserved:false, owned:false};
let advSort = '', advLast = null, advOwnedLocal = false;   // tri courant + dernière réponse Scryfall + repli filtre collection local
let setValCache = null;   // code -> {v, date} : valorisation totale d'une extension (calcul à la demande)
let setSortKey = 'date', setSortDir = -1, setFilterVal = '';  // tri du tableau des extensions (défaut : date décroissante)

function getSetValCache(){
  if(setValCache) return setValCache;
  setValCache = store.get('mtg_setval', {});
  return setValCache;
}

/* barre de filtres commune : recherche avancée ET détail d'une extension */
function advFilterBarHTML(withSet){
  return `
    <div class="filterbar">
      <div class="suggbox" style="flex:1;min-width:260px">
        <input type="text" id="sfq" placeholder="Requête Scryfall libre (o:&quot;draw a card&quot; t:instant…) ou nom de carte en français/anglais (Foudre, Lightning Bolt…)" autocomplete="off" style="width:100%">
        <div class="suggestions" id="sfqsugg" style="display:none"></div>
      </div>
      <div class="suggbox" style="min-width:170px">
        <input type="text" id="adartist" placeholder="Artiste, ex: Rebecca Guay" value="${esc(advF.artist)}" autocomplete="off" style="width:100%">
        <div class="suggestions" id="adsugg" style="display:none"></div>
      </div>
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
      ${priceRangeHTML()}
      ${withSet ? '<select id="adset"><option value="">Extension : toutes</option></select>' : ''}
      <select id="adsort" title="Trier les résultats">
        ${ADV_SORTS.map(([v,l]) => `<option value="${v}" ${advSort===v?'selected':''}>Tri : ${l}</option>`).join('')}
      </select>
      <label class="row" style="gap:6px" title="Ne rechercher que les cartes de la Reserved List (is:reserved)">
        <input type="checkbox" id="adres" ${advF.reserved?'checked':''}> Reserved List
      </label>
      <label class="row" style="gap:6px" title="Intègre les cartes de ma collection à la requête Scryfall : filtrage global sur toutes les pages, tris conservés">
        <input type="checkbox" id="adown" ${advF.owned?'checked':''}> Dans ma collection
      </label>
      <button class="btn" id="gosearch">Rechercher</button>
      <button class="btn ghost" id="adreset">Réinitialiser</button>
    </div>`;
}
/* branche la barre de filtres ; la recherche porte sur la vue courante
   (set:browseSet si on est dans le détail d'une extension) */
function wireAdvFilters(app){
  const inp = app.querySelector('#sfq'); inp.value = browseQuery;
  const go = () => { browseQuery = inp.value; browsePage=1; doSearch(app); };
  inp.onkeydown = e => { if(e.key==='Enter') go(); };
  app.querySelector('#gosearch').onclick = go;
  // autocomplétion du nom de carte (multilingue : Foudre -> Lightning Bolt…) dans la barre de recherche
  const sugg = app.querySelector('#sfqsugg');
  let st = null, sitems = [];
  inp.oninput = () => {
    clearTimeout(st);
    const q = inp.value.trim();
    if(q.length < 2){ sugg.style.display='none'; return; }
    st = setTimeout(async () => {
      try{ sitems = await sfAutocomplete(q); }catch(e){ sitems = []; }
      if(!sitems.length){ sugg.style.display='none'; return; }
      sugg.innerHTML = sitems.slice(0,8).map((n,i)=>`<div data-i="${i}">🃏 ${esc(n)}</div>`).join('');
      sugg.style.display='block';
      sugg.querySelectorAll('div').forEach(el => el.onmousedown = e => {
        e.preventDefault();
        inp.value = sitems[el.dataset.i]; sugg.style.display='none'; go();
      });
    }, 280);
  };
  inp.addEventListener('blur', () => setTimeout(() => sugg.style.display='none', 150));
  // autocomplétion de l'artiste (catalogue Scryfall mis en cache)
  const ainp = app.querySelector('#adartist'), asugg = app.querySelector('#adsugg');
  let at = null;
  ainp.oninput = () => {
    advF.artist = ainp.value;   // synchro du filtre artiste (a:"…") à la saisie
    clearTimeout(at);
    const q = ainp.value.trim().toLowerCase();
    if(q.length < 2){ asugg.style.display='none'; return; }
    at = setTimeout(async () => {
      const list = await sfArtists();
      const hits = list.filter(a => a.toLowerCase().includes(q)).slice(0,10);
      if(!hits.length){ asugg.style.display='none'; return; }
      asugg.innerHTML = hits.map((a,i)=>`<div data-i="${i}">🎨 ${esc(a)}</div>`).join('');
      asugg.style.display='block';
      asugg.querySelectorAll('div').forEach(el => el.onmousedown = e => {
        e.preventDefault();
        ainp.value = hits[el.dataset.i]; advF.artist = ainp.value;
        asugg.style.display='none'; go();
      });
    }, 250);
  };
  ainp.addEventListener('blur', () => setTimeout(() => asugg.style.display='none', 150));
  app.querySelector('#adreset').onclick = () => { advF = {colors:[], types:[], cmc:'', pmin:'', pmax:'', set:'', artist:'', reserved:false, owned:false}; browsePage=1; vBrowse(app); };
  app.querySelector('#adres').onchange = e => { advF.reserved = e.target.checked; };
  app.querySelector('#adown').onchange = e => { advF.owned = e.target.checked; browsePage = 1; doSearch(app); };   // la clause change la requête -> re-recherche
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
  wirePriceRange(app, advF, () => { browsePage = 1; doSearch(app); });
  app.querySelector('#adartist').onkeydown = e => { if(e.key==='Enter') go(); };
  app.querySelector('#adsort').onchange = e => { advSort = e.target.value; browsePage = 1; doSearch(app); };   // re-requête : le tri Scryfall change l'ordre global des pages
  // liste des extensions dans le filtre (recherche avancée uniquement), triées par nom d'édition
  const sel = app.querySelector('#adset');
  if(sel) sfSets().then(sets => {
    const sorted = sets.slice().sort((a,b) => (a.name||'').localeCompare(b.name||''));
    sel.innerHTML = `<option value="">Extension : toutes</option>` + sorted.map(s =>
      `<option value="${s.code}" ${advF.set===s.code?'selected':''}>${esc(s.name)}</option>`).join('');
    sel.onchange = e => advF.set = e.target.value;
  }).catch(()=>{});
}

function vBrowse(app){
  if(browseSet) return vSetDetail(app);
  app.innerHTML = `
  <div class="panel">
    ${browseMode==='sets' ? `<p class="hint" style="margin-bottom:10px">Suivi de complétion et de valorisation de vos extensions. Cliquez sur une extension pour parcourir ses cartes.
      <input type="text" id="setfilter" placeholder="🔍 Filtrer les extensions…" style="margin-left:10px;min-width:220px;padding:6px 10px">
      <button class="btn ghost" id="calcAll" style="margin-left:8px;padding:5px 10px" title="Calcule la valeur totale de chaque extension (cache 30 jours ; les extensions inconnues paginent l'API Scryfall)">💰 Tout calculer</button></p>
      <div id="setlist"><p class="hint">Chargement des extensions…</p></div>`
    : advFilterBarHTML(true) + `<div id="searchres"></div>`}
  </div>`;
  // plus d'onglets en haut : la navigation Par extension / Recherche avancée se fait via le menu burger
  if(browseMode==='sets') loadSets(app);
  else {
    wireAdvFilters(app);
    if(browseQuery) doSearch(app);
  }
}

/* requête Scryfall combinée depuis les filtres avancés.
   nameQ : nom anglais résolu (si la saisie était un nom localisé, ex: Foudre -> Lightning Bolt) */
function buildAdvQuery(nameQ){
  const q = [];
  if(nameQ) q.push(`!"${nameQ}"`);
  else if(browseQuery.trim()) q.push(`(${browseQuery.trim()})`);
  if(advF.artist.trim()) q.push(`a:"${advF.artist.trim().replace(/"/g,'')}"`);
  if(advF.colors.length) q.push(`(c:${advF.colors.join(' or c:')})`);
  if(advF.types.length) q.push(`(t:${advF.types.join(' or t:')})`);
  if(advF.cmc !== '') q.push(advF.cmc==='7+' ? 'mv>=7' : `mv=${advF.cmc}`);
  if(browseSet) q.push(`set:${browseSet}`);   // détail d'extension : l'extension courante est fixée
  else if(advF.set) q.push(`set:${advF.set}`);
  if(advF.reserved) q.push('is:reserved');
  /* (la clause "Dans ma collection" est ajoutée dans doSearch, après résolution du nom) */
  if(advF.pmin !== '') q.push(`eur>=${advF.pmin}`);   // 2 clauses : la syntaxe eur:[x TO y] de Scryfall casse avec les espaces
  if(advF.pmax !== '') q.push(`eur<=${advF.pmax}`);
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
      setFilterVal = filter || '';
      const f = norm(setFilterVal);
      const cache = getSetValCache();
      // lignes enrichies (possédées/complétion/valeurs) puis triées selon l'en-tête actif
      const rows = sets.filter(s => !f || norm(s.name).includes(f) || s.code.includes(f)).map(s => {
        const o = owned[s.code];
        const distinct = o ? o.distinct.size : 0;
        const pct = s.card_count ? Math.min(100, distinct / s.card_count * 100) : 0;
        return { s, o, distinct, pct, vc: cache[s.code] };
      });
      const keyVal = r => {
        switch(setSortKey){
          case 'name':  return (r.s.name||'').toLowerCase();
          case 'date':  return r.s.released_at || '';
          case 'owned': return r.distinct;
          case 'pct':   return r.pct;
          case 'value': return r.o ? r.o.value : null;
          case 'total': return r.vc ? r.vc.v : null;
        }
        return null;
      };
      rows.sort((a, b) => {
        const va = keyVal(a), vb = keyVal(b);
        if(va == null && vb == null) return 0;
        if(va == null) return 1;    // valeurs inconnues (ex : set non calculé) toujours en dernier
        if(vb == null) return -1;
        const c = typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb;
        return c * setSortDir;
      });
      const th = (key, label, w) => `<th data-sort="${key}"${w ? ` style="width:${w}px"` : ''}>${label}<span class="sarr">${setSortKey===key ? (setSortDir===1 ? '▲' : '▼') : ''}</span></th>`;
      box.innerHTML = `<table><thead><tr>
        <th style="width:60px"></th>
        ${th('name','Extension')}
        ${th('date','Date',100)}
        ${th('owned','Possédées',110)}
        ${th('pct','Complétion',130)}
        ${th('value','Valeur possédée',120)}
        ${th('total','Valeur totale du set',190)}</tr></thead>
      <tbody>${rows.map(r => {
        const s = r.s;
        const o = r.o, distinct = r.distinct, pct = r.pct, vc = r.vc;
        return `<tr data-s="${s.code}" style="cursor:pointer">
          <td>${s.icon?`<img class="seticon" src="${s.icon}" style="width:24px;height:24px" alt="">`:'◈'}</td>
          <td><b>${esc(s.name)}</b> <span class="pill">${s.code.toUpperCase()}</span></td>
          <td class="hint">${frDate(s.released_at)}</td>
          <td class="hint">${o ? `${distinct} / ${s.card_count}` : `0 / ${s.card_count}`}</td>
          <td>${o ? `<div class="pbar"><div style="width:${pct}%"></div></div><span class="pct">${pct.toFixed(1)}%</span>` : '<span class="pct">—</span>'}</td>
          <td class="hint">${o && o.value>0 ? `<span style="color:var(--warn)">${eur(o.value)}</span>` : '—'}</td>
          <td class="hint">${vc ? `<span style="color:var(--warn)">${eur(vc.v)}</span> <span class="pill">(${new Date(vc.date).toLocaleDateString('fr-FR')})</span>`
            : `<button class="btn ghost" data-calc="${s.code}" style="padding:3px 8px;font-size:12px">calculer</button>`}</td>
        </tr>`;}).join('')}</tbody></table>
      ${!rows.length ? '<p class="hint">Aucune extension ne correspond.</p>' : ''}`;
      box.querySelectorAll('th[data-sort]').forEach(h => h.onclick = () => {
        const k = h.dataset.sort;
        if(setSortKey === k) setSortDir *= -1;          // même colonne : on inverse le sens
        else { setSortKey = k; setSortDir = 1; }         // nouvelle colonne : ascendant
        renderList(setFilterVal);
      });
      box.querySelectorAll('tr[data-s]').forEach(tr => tr.onclick = () => { browseSet = tr.dataset.s; browsePage=1; vBrowse(app); });
      box.querySelectorAll('[data-calc]').forEach(b => b.onclick = async e => {
        e.stopPropagation();
        b.disabled = true; b.textContent = 'calcul…';
        try{ await fetchAllSetValues(); }                      // instantané via prices.db (1 requête)
        catch(err){ await computeSetValue(b.dataset.calc); }    // repli Scryfall si prices.db absent
        vBrowse(app);
      });
    };
    renderList('');
    const sf = app.querySelector('#setfilter');
    if(sf) sf.oninput = () => renderList(sf.value);
    // à l'arrivée sur la page : calcule toutes les valeurs en arrière-plan (1 requête /api/setvalues, rapide)
    const calcAllBtn = app.querySelector('#calcAll');
    if(calcAllBtn) calcAllBtn.textContent = '💰 chargement…';
    fetchAllSetValues()
      .then(() => { if(calcAllBtn) calcAllBtn.textContent = '💰 Tout calculer'; renderList(setFilterVal); })
      .catch(() => { if(calcAllBtn) calcAllBtn.textContent = '💰 Tout calculer'; });
    // bouton "Tout calculer" : valeur totale de toutes les extensions (cache 30 jours, calcul à la demande)
    const calcAll = app.querySelector('#calcAll');
    if(calcAll) calcAll.onclick = async () => {
      calcAll.disabled = true;
      try{
        calcAll.textContent = '💰 chargement…';
        await fetchAllSetValues();   // 1 seule requête serveur : toutes les extensions d'un coup (prices.db)
        renderList(setFilterVal);
      }catch(err){
        // repli lent : set par set via l'API Scryfall (file série ~9 req/s)
        if(!confirm(`prices.db indisponible : calculer via Scryfall les ${sets.length} extensions une par une ?\nLent : plusieurs minutes.`)){
          calcAll.disabled = false; calcAll.textContent = '💰 Tout calculer'; return;
        }
        let i = 0;
        for(const s of sets){
          i++;
          calcAll.textContent = `💰 calcul… ${i}/${sets.length}`;
          try{ await computeSetValue(s.code); }catch(e){ /* on continue */ }
        }
        renderList(setFilterVal);
      }
      calcAll.disabled = false;
      calcAll.textContent = '💰 Tout calculer';
    };
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
/* Valeurs totales de TOUTES les extensions en UNE requête serveur (/api/setvalues, depuis prices.db).
   Résultat fusionné dans le cache local 30 jours. Lève une erreur si prices.db est absent (repli Scryfall). */
let setValsAll = null;
async function fetchAllSetValues(){
  if(setValsAll) return setValsAll;
  const r = await fetch('/api/setvalues');
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  setValsAll = j.values || {};
  const cache = getSetValCache();
  const now = Date.now();
  for(const [code, v] of Object.entries(setValsAll)) cache[code] = { v, date: now };
  store.set('mtg_setval', cache);
  return setValsAll;
}
/* détail d'une extension : mêmes filtres et tris que la recherche avancée,
   plus un menu déroulant pour passer d'une extension à l'autre */
async function vSetDetail(app){
  app.innerHTML = `<div class="panel">
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn ghost" id="back">← Toutes les extensions</button>
      <select id="setjump" style="min-width:280px" title="Changer d'extension"></select>
      <h3 id="settitle" style="margin:0"></h3>
    </div>
    ${advFilterBarHTML(false)}
    <div id="searchres"></div>
  </div>`;
  app.querySelector('#back').onclick = () => { browseSet=null; browseMode='sets'; browsePage=1; vBrowse(app); };
  // menu déroulant : sauter d'une extension à l'autre sans repasser par la liste
  try{
    const sets = (await sfSets()).filter(s => !s.digital)
      .sort((a,b) => (a.name||'').localeCompare(b.name||''));
    const sel = app.querySelector('#setjump');
    sel.innerHTML = sets.map(s => `<option value="${s.code}" ${s.code===browseSet?'selected':''}>${esc(s.name)} (${s.code.toUpperCase()})</option>`).join('');
    sel.onchange = e => { browseSet = e.target.value; browsePage = 1; vBrowse(app); };
    const cur = sets.find(s => s.code === browseSet);
    app.querySelector('#settitle').textContent = cur ? cur.name : browseSet.toUpperCase();
  }catch(e){}
  wireAdvFilters(app);
  doSearch(app);   // la requête est scoping set:browseSet (buildAdvQuery donne la priorité à browseSet)
}
/* ---- tri des résultats de la recherche avancée ---- */
const ADV_SORTS = [
  ['','Par défaut (Scryfall)'],
  ['name-asc','Nom A → Z'], ['name-desc','Nom Z → A'],
  ['date-asc',"Date d'impression ↑"], ['date-desc',"Date d'impression ↓"],
  ['set-asc',"Nom d'édition A → Z"], ['set-desc',"Nom d'édition Z → A"],
  ['price-asc','Prix croissant'], ['price-desc','Prix décroissant'],
  ['val-asc','Valeur dans la collection ↑'], ['val-desc','Valeur dans la collection ↓'],
  ['type','Type de carte'],
  ['cmc-asc','Coût de mana ↑'], ['cmc-desc','Coût de mana ↓'],
];
const advCardPrice = c => { const v = parseFloat(c.prices?.eur || c.prices?.eur_foil || ''); return isNaN(v) ? null : v; };
const advCardVal = (c, ownMap) => {   // valeur totale possédée de cette carte dans cette édition (× prix de l'impression)
  const p = advCardPrice(c); if(p == null) return null;
  return p * (ownMap.get(norm(c.name)+'|'+(c.set||'')) || 0);
};
function sortCards(cards, mode, ownMap){
  if(!mode) return cards;
  ownMap = ownMap || ownedQtyMap();
  const dir = mode.endsWith('-desc') ? -1 : 1;
  const base = mode.replace(/-(asc|desc)$/, '');
  const keyFns = {
    name: c => (c.name||'').toLowerCase(),
    date: c => c.released_at || null,
    set:  c => (c.set_name||'').toLowerCase(),
    price: advCardPrice,
    val:  c => advCardVal(c, ownMap),
    type: c => (c.type_line||'').toLowerCase(),
    cmc:  c => (c.cmc ?? null),
  };
  const kf = keyFns[base] || keyFns.name;
  return cards.slice().sort((a,b) => {
    const ka = kf(a), kb = kf(b);
    if(ka == null && kb == null) return 0;
    if(ka == null) return 1;     // valeurs inconnues toujours en dernier
    if(kb == null) return -1;
    const r = (typeof ka === 'number') ? ka - kb : String(ka).localeCompare(String(kb));
    if(r !== 0) return r * dir;
    return String(a.name).localeCompare(String(b.name));   // départage par nom
  });
}
async function doSearch(app){
  const box = app.querySelector('#searchres');
  let q = buildAdvQuery();
  // requête libre sans opérateur Scryfall : si l'autocomplétion anglaise ne trouve rien,
  // on résout un éventuel nom localisé (ex: Foudre, Blitzschlag -> nom anglais) et on
  // recherche alors toutes les impressions de la carte, comme avec le nom anglais
  const raw = browseQuery.trim();
  if(raw && !/[:()"<>=\-]/.test(raw)){
    try{
      const ja = await sfFetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(raw)}`);
      if(ja.data && ja.data.length){
        // hit anglais -> on garde la requête telle quelle (comportement Scryfall standard)
      } else {
        // pas de hit anglais -> nom localisé : correspondance exacte du nom imprimé,
        // toutes langues (Foudre -> Lightning Bolt), en préférant le nom exact non split
        let names = [];
        const j = await sfFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent('!"'+raw+'"')}&unique=prints&include_extras=true`);
        if(j.data && j.data.length) names = [...new Set(j.data.map(c=>c.name))];
        if(!names.length) names = await sfAutocomplete(raw);   // repli : lang:fr/de/… !"raw"
        if(names.length){
          const exact = names.find(n => norm(n) === norm(raw)) || names.find(n => !n.includes('//')) || names[0];
          const alias = store.get('mtg_name_alias', {}); alias[norm(raw)] = exact; store.set('mtg_name_alias', alias);
          q = buildAdvQuery(exact);
        }
      }
    }catch(e){}
  }
  if(!q) q = '*';   // aucun filtre -> toutes les cartes
  // "Dans ma collection" : la clause est intégrée À LA REQUÊTE Scryfall (OR sur les noms
  // possédés) -> le filtrage est global (toutes les pages), les tris Scryfall restent corrects.
  advOwnedLocal = false;
  if(advF.owned){
    // un terme par (carte, édition) possédée : !"nom" set:code  -> Black Lotus Alpha uniquement, pas les autres éditions
    const terms = [...new Set(entries.filter(e => e.qty > 0).map(e => {
      const n = `!"${String(e.name).replace(/"/g,'')}"`;
      return e.set ? `${n} set:${e.set}` : n;   // entrée sans édition -> nom seul
    }))];
    if(!terms.length){
      box.innerHTML = '<p class="hint">Votre collection est vide : aucun résultat possible avec « Dans ma collection ».</p>';
      return;
    }
    if(terms.length > 200){ advOwnedLocal = true; }   // repli : filtre local par page (URL trop longue)
    else {
      const oc = '(' + terms.join(' or ') + ')';
      q = (q === '*') ? oc : `(${q}) ${oc}`;
    }
  }
  box.innerHTML = '<p class="hint">Recherche…</p>';
  try{
    // une seule page (175 résultats) par requête : rapide, et le tri éventuel est
    // délégué à Scryfall (order=/dir=) donc correct sur TOUTES les pages
    const j = await sfSearch(q, browsePage, advSortOrder());
    advLast = {data: j.data || [], total: j.total_cards || 0, q};
    refreshPriceBounds(q);   // resserre la jauge de prix sur les résultats de cette requête
    renderAdvResults(app);
  }catch(e){ box.innerHTML = `<p class="hint">Aucun résultat ou erreur (vérifiez la requête : "${esc(q)}").</p>`; }
}
/* tri délégué à Scryfall (globalement correct entre les pages) quand le mode le permet ;
   type / valeur-collection n'existent pas côté Scryfall -> tri local de la page */
/* bornes de prix de la requête courante : 2 appels Scryfall (order=eur asc/desc, page 1)
   -> la jauge de prix se resserre sur les cartes qui correspondent déjà aux filtres */
async function refreshPriceBounds(q){
  try{
    const pOf = c => { const v = parseFloat(c.prices?.eur || c.prices?.eur_foil || ''); return isNaN(v) ? null : v; };
    const qB = q.replace(/\s*eur:\[[^\]]*\]/g, '').replace(/\s*eur(?:>=|<=)[\d.]+/g, '').replace(/\s+/g, ' ').trim() || '*';   // bornes SANS le filtre prix (sinon auto-filtrage)
    const jmax = await sfSearch(qB, 1, {order:'eur', dir:'desc'});
    const jmin = await sfSearch(qB, 1, {order:'eur', dir:'asc'});
    const mx = (jmax.data||[]).map(pOf).find(v => v != null);
    const mn = (jmin.data||[]).map(pOf).find(v => v != null);
    if(mx != null) setPriceBounds(mn != null ? mn : 0.01, mx);
  }catch(e){}
}

function advSortOrder(){
  if(!advSort) return null;
  const dir = advSort.endsWith('-desc') ? 'desc' : 'asc';
  const base = advSort.replace(/-(asc|desc)$/, '');
  const map = {name:'name', date:'released', set:'set', price:'eur', cmc:'cmc'};
  return map[base] ? {order: map[base], dir} : null;
}
/* affiche la page courante : filtre "collection" local + tri local si mode non Scryfall + pager */
function renderAdvResults(app){
  const box = app.querySelector('#searchres');
  if(!box || !advLast) return;
  const ownMap = ownedQtyMap();
  let cards = advLast.data.slice();
  if(advF.owned && advOwnedLocal) cards = cards.filter(c => (ownMap.get(norm(c.name)+'|'+(c.set||'')) || 0) > 0);   // repli si >200 cartes
  const serverSorted = !!advSortOrder();
  if(advSort && !serverSorted) cards = sortCards(cards, advSort, ownMap);   // type / valeur collection : tri local page
  renderCardGrid(box, cards);
  const totalPages = Math.max(1, Math.ceil(advLast.total / 175));
  const localSort = advSort && !serverSorted;
  const qShown = advLast.q.length > 120 ? advLast.q.slice(0, 120) + '…' : advLast.q;
  box.insertAdjacentHTML('afterbegin',
    `<p class="hint">${advLast.total} résultat${advLast.total>1?'s':''} au total — page ${browsePage} / ${totalPages}` +
    (advF.owned ? (advOwnedLocal ? ' · dans ma collection (filtre local)' : ' · dans ma collection (filtré dans la requête)') : '') +
    ` · requête : "${esc(qShown)}"` +
    (localSort ? ' · tri local à cette page (type/valeur collection)' : '') + '</p>');
  const pager = document.createElement('div'); pager.className='row'; pager.style.marginTop='12px';
  pager.innerHTML = `<button class="btn ghost" id="advfirst" ${browsePage>1?'':'disabled'}>«</button>
    <button class="btn ghost" id="advprev" ${browsePage>1?'':'disabled'}>← Précédent</button>
    <span class="hint">Page ${browsePage} / ${totalPages} — ${advLast.total} résultats</span>
    <button class="btn ghost" id="advnext" ${browsePage<totalPages?'':'disabled'}>Suivant →</button>
    <button class="btn ghost" id="advlast" ${browsePage<totalPages?'':'disabled'}>»</button>`;
  box.appendChild(pager);
  pager.querySelector('#advfirst').onclick = () => { browsePage = 1; doSearch(app); };
  pager.querySelector('#advprev').onclick  = () => { browsePage--; doSearch(app); };
  pager.querySelector('#advnext').onclick  = () => { browsePage++; doSearch(app); };
  pager.querySelector('#advlast').onclick  = () => { browsePage = totalPages; doSearch(app); };
}
/* langues réellement disponibles par édition (agrégées sur les résultats : une édition = souvent plusieurs langues) */
function cardLangsOf(cards){
  const m = {};
  cards.forEach(c => { const k2 = c.set+'|'+norm(c.name); (m[k2] = m[k2] || new Set()).add(c.lang); });
  return m;
}
function cardTileHTML(c, cardLangs, ownMap){
  const img = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '';
  const k = norm(c.name);
  // quantité possédée pour cette carte dans CETTE édition (toutes langues / états / n° confondus)
  const q = (ownMap || ownedQtyMap()).get(k+'|'+(c.set||'')) || 0;
  const price = c.prices?.eur || c.prices?.eur_foil;
  const langs = [...(cardLangs[c.set+'|'+k] || [c.lang])].map(l=>(l||'en').toUpperCase()).join('/');
  return `<div class="cardtile" data-name="${esc(c.name)}" data-set="${esc(c.set||'')}" data-cn="${esc(c.collector_number||'')}" style="cursor:pointer" title="Cliquez pour ajouter à la collection (langue, état…)">
    ${q?`<span class="qtyb">×${q}</span>`:''}
    <img src="${img}" loading="lazy" alt="${esc(c.name)}" data-zoom="${c.image_uris?.large || img}">
    <div class="info">
      <div class="name">${esc(c.name)}</div>
      <div class="pill">${esc(c.set?.toUpperCase()||'')} · ${c.released_at?.slice(0,4)||''} · ${c.rarity||''} · ${langs}</div>
      <div class="price">${price?eur(price):''}</div>
    </div>
  </div>`;
}
function renderCardGrid(box, cards){
  const cardLangs = cardLangsOf(cards);
  const ownMap = ownedQtyMap();
  box.innerHTML = `<div class="cardgrid">${cards.map(c => cardTileHTML(c, cardLangs, ownMap)).join('')}</div>`;
  // clic sur une carte -> popup d'ajout pour CETTE impression (édition fixée, langue selon l'édition, état)
  box.querySelectorAll('.cardtile').forEach(tl => tl.onclick = () =>
    R.openAddPopup(tl.dataset.name, {set: tl.dataset.set, cn: tl.dataset.cn}));
}
const wrapSets = a => { browseMode='sets'; browseSet=null; vBrowse(a); };
const wrapSearch = a => { browseMode='search'; browseSet=null; browsePage=1; vBrowse(a); };
R.views.advsearch = wrapSearch; R.views['browse-sets'] = wrapSets; R.views.browse = vBrowse; R.vBrowse = vBrowse;
R.gotoAdvSearch = name => { browseQuery = `!"${name}"`; browseMode='search'; browseSet=null; browsePage=1; R.setView('advsearch'); };
R.gotoSets = code => { browseMode='sets'; browseSet=code; browsePage=1; R.setView('browse'); };

export { getSetValCache, vBrowse, buildAdvQuery, loadSets, computeSetValue, vSetDetail, ownedQtyMap, sortCards, doSearch, advSortOrder, renderAdvResults, cardLangsOf, cardTileHTML, renderCardGrid, browseMode, advF, advSort, setValCache, ADV_SORTS, advCardPrice, advCardVal };
