import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS, TYPES_LIST } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, setEntries, setTags, setMatches, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks, ownedQtyMap } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal, priceRangeHTML, wirePriceRange, setPriceBounds } from '../ui.js';
import { R, S } from '../core/registry.js';

/* ============================================================
   VUE COLLECTION
   ============================================================ */
/* état de la vue collection */
let collF = {q:'', tags:[], colors:[], types:[], cmc:'', pmin:'', pmax:'', set:'', artist:'', reserved:false, foil:false, signed:false};
let collSort = '', collView = 'list', collChecked = new Set(), collPending = false;
function setCollSort(v){ collSort = v; }

/* mêmes tris que la recherche avancée (cf. ADV_SORTS dans browse.js), adaptés aux groupes de la collection */
const COLL_SORTS = [
  ['','Par défaut (nom A → Z)'],
  ['name-asc','Nom A → Z'], ['name-desc','Nom Z → A'],
  ['date-asc',"Date d'impression ↑"], ['date-desc',"Date d'impression ↓"],
  ['set-asc',"Nom d'édition A → Z"], ['set-desc',"Nom d'édition Z → A"],
  ['price-asc','Prix croissant'], ['price-desc','Prix décroissant'],
  ['val-asc','Valeur dans la collection ↑'], ['val-desc','Valeur dans la collection ↓'],
  ['type','Type de carte'],
  ['cmc-asc','Coût de mana ↑'], ['cmc-desc','Coût de mana ↓'],
];

const RAR_COLORS = { mythic:'#B94421', rare:'#CCB473', uncommon:'#CECECE', common:'#2B2728' };
function rarityDotHTML(p){
  const rar = (p && p.rarity) || '';
  const isToken = rar === 'token' || /token/i.test((p && p.type_line) || '');
  if(isToken) return `<span class="rarity-dot rarity-token" title="Token">T</span>`;
  if(RAR_COLORS[rar]) return `<span class="rarity-dot" style="background:${RAR_COLORS[rar]};border-color:${RAR_COLORS[rar]}" title="${esc(rar)}"></span>`;
  return '';
}

function collFilterAndSort(){
  let list = entries.slice();
  const F = collF;
  const q = norm(F.q);
  const base = collSort.replace(/-(asc|desc)$/, '');
  const dir = /-desc$/.test(collSort) ? -1 : 1;

  // filtres nécessitant les métadonnées (print data) — inconnu => à charger
  const needMeta = F.colors.length || F.types.length || F.cmc !== '' || F.pmin !== '' || F.pmax !== '' ||
    !!F.artist.trim() || F.reserved || ['cmc','price','date','type','set','val'].includes(base);
  const unknown = [];

  list = list.filter(e => {
    const p = entryPrintSync(e);
    if((needMeta || q) && !p) unknown.push(e);
    // nom recherché dans TOUTES les langues : nom anglais + noms imprimés (printed_name) des éditions connues
    if(q && !norm(e.name).includes(q)){
      const pr = getPrintCache()[e.norm] || [];
      if(!pr.some(x => x.printed_name && norm(x.printed_name).includes(q))) return false;
    }
    if(F.tags.length && !F.tags.every(t => (e.tags||[]).includes(t))) return false;
    if(F.set && e.set !== F.set) return false;
    if(F.foil && !e.foil) return false;
    if(F.signed && !e.signed) return false;
    if(!needMeta) return true;
    if(!p) return false;
    if(F.colors.length && !F.colors.some(c => (p.colors||[]).includes(c))) return false;
    if(F.types.length && !F.types.some(t => (p.type_line||'').toLowerCase().includes(t.toLowerCase()))) return false;
    if(F.cmc !== ''){ const mv = p.mv ?? 0;
      if(F.cmc === '7+' ? mv < 7 : mv !== +F.cmc) return false; }
    if(F.artist && !(p.artist||'').toLowerCase().includes(F.artist.trim().toLowerCase())) return false;
    if(F.reserved && !p.reserved) return false;
    const pr = entryPrice(e, p);
    if(F.pmin !== '' && (pr == null || pr < +F.pmin)) return false;
    if(F.pmax !== '' && (pr == null || pr > +F.pmax)) return false;
    return true;
  });
  const val = e => entryPrice(e, entryPrintSync(e)) ?? -1;
  list.sort((a,b) => {
    let r = 0;
    switch(base){
      case 'name': r = norm(a.name).localeCompare(norm(b.name)); break;
      case 'type': r = (entryPrintSync(a)?.type_line || 'zzz').localeCompare(entryPrintSync(b)?.type_line || 'zzz'); break;
      case 'cmc': r = (entryPrintSync(a)?.mv ?? 99) - (entryPrintSync(b)?.mv ?? 99); break;
      case 'date': r = (entryPrintSync(a)?.released_at || '').localeCompare(entryPrintSync(b)?.released_at || ''); break;
      case 'set': r = (entryPrintSync(a)?.set_name || '').localeCompare(entryPrintSync(b)?.set_name || ''); break;
      case 'price': r = val(a) - val(b); break;
      case 'val': r = val(a) * a.qty - val(b) * b.qty; break;
    }
    return r * dir || norm(a.name).localeCompare(norm(b.name));
  });
  return {list, unknown, needMeta};
}


function vCollection(app){
  const {list, unknown, needMeta} = collFilterAndSort();
  const totalQty = list.reduce((a,e) => a + e.qty, 0);
  const checked = list.filter(e => collChecked.has(e.id));
  const tagCounts = {};
  entries.forEach(e => (e.tags||[]).forEach(t => tagCounts[t] = (tagCounts[t]||0) + e.qty));

  app.innerHTML = `
  <div class="panel">
    <div class="row" style="justify-content:space-between;margin-bottom:6px">
      <h3>Ma collection — ${list.length} groupes · ${totalQty} exemplaires</h3>
      <div class="row">
        <button class="btn ghost" id="viewbtn">${collView==='list'?'▦ Vue vignettes':'☰ Vue liste'}</button>
        <button class="btn ghost" id="expbtn">Exporter</button>
        <button class="btn ghost" id="impbtn">Importer</button>
        <input type="file" id="impfile" accept=".json" style="display:none">
      </div>
    </div>

    <div class="filterbar">
      <div class="suggbox" style="flex:1;min-width:260px">
        <input type="text" id="fq" placeholder="Nom de carte, toutes langues (Lord of Atlantis, Seigneur de l'Atlantide…)" autocomplete="off" value="${esc(collF.q)}" style="width:100%">
        <div class="suggestions" id="fqsugg" style="display:none"></div>
      </div>
      <div class="suggbox" style="min-width:170px">
        <input type="text" id="fartist" placeholder="Artiste, ex: Rebecca Guay" value="${esc(collF.artist)}" autocomplete="off" style="width:100%">
        <div class="suggestions" id="fartistsugg" style="display:none"></div>
      </div>
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
      ${priceRangeHTML()}
      <select id="fset"><option value="">Extension : toutes</option>${collF.set?`<option value="${esc(collF.set)}" selected>${esc(collF.set.toUpperCase())}</option>`:''}</select>
      <select id="fsort" title="Trier la collection">
        ${COLL_SORTS.map(([v,l]) => `<option value="${v}" ${collSort===v?'selected':''}>Tri : ${l}</option>`).join('')}
      </select>
      <label class="row" style="gap:6px" title="Ne garder que les cartes de la Reserved List">
        <input type="checkbox" id="freserved" ${collF.reserved?'checked':''}> Reserved List
      </label>
      <label class="row" style="gap:6px" title="Ne garder que les exemplaires foil">
        <input type="checkbox" id="ffoil" ${collF.foil?'checked':''}> Foil
      </label>
      <label class="row" style="gap:6px" title="Ne garder que les exemplaires signés">
        <input type="checkbox" id="fsigned" ${collF.signed?'checked':''}> Signée
      </label>
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
      <button class="btn ghost" id="bulkedit">✏ Modifier</button>
      <button class="btn danger" id="bulkrm">Supprimer de la collection</button>
      ${checked.length === 1 ? (() => { const e = checked[0]; return `
      <span class="hint">·</span>
      <select id="eb-set" title="Édition"></select>
      <select id="eb-lang" title="Langue"></select>
      <select id="eb-cond" title="État">${CONDS.map(([v,l])=>`<option value="${v}" ${v===(e.cond||'NM')?'selected':''}>${v} — ${l}</option>`).join('')}</select>
      <label class="row" style="gap:4px" title="Foil"><input type="checkbox" id="eb-foil" ${e.foil?'checked':''}> Foil</label>
      <label class="row" style="gap:4px" title="Signée"><input type="checkbox" id="eb-signed" ${e.signed?'checked':''}> Signée</label>
      <select id="eb-tags" multiple size="3" style="min-width:130px" title="Tags">${tags.map(t=>`<option ${((e.tags||[]).includes(t))?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <button class="btn" id="eb-save" title="Enregistrer les modifications sur cette carte">💾 Enregistrer</button>`; })() : ''}
    </div>` : ''}

    <div class="row" style="margin:6px 0">
      <label class="row" style="gap:6px;cursor:pointer" title="Cocher toutes les cartes affichées">
        <input type="checkbox" id="selallchk" ${list.length && checked.length===list.length ? 'checked' : ''}> Sélectionner tout (${list.length} affiché${list.length>1?'s':''})
      </label>
    </div>

    ${unknown.length ? `<p class="hint" id="metawait">Chargement des métadonnées des cartes (${unknown.length})…</p>` : ''}
    ${collView === 'grid' ? collGridHTML(list) : collTableHTML(list)}

    <p class="hint" style="margin-top:10px" id="collvalue">Valeur des cartes affichées : calcul…</p>
  </div>`;
  bindCollection(app, {list, unknown, needMeta, checked});
  hydrateColl(list, app, unknown);
}

function collTableHTML(list){
  if(!list.length) return `<p class="hint">Aucune carte ne correspond aux filtres. Collection vide ? Ajoutez des cartes depuis une tuile (recherche avancée, extensions…).</p>`;
  return `<table class="coll-list"><thead><tr>
    <th style="width:3%"></th><th style="width:8%"></th><th style="width:25%">Carte</th><th style="width:12%">Édition</th>
    <th style="width:8%">Qté</th><th style="width:9%">Prix</th><th style="width:9%">Valeur</th><th style="width:17%">Tags</th><th style="width:9%"></th>
  </tr></thead><tbody id="collbody">
  ${list.map(e => {
    const p = entryPrintSync(e);
    const pr = p ? entryPrice(e, p) : null;
    const rdot = rarityDotHTML(p);
    return `<tr class="entryrow" data-id="${e.id}">
      <td><input type="checkbox" class="rowchk" ${collChecked.has(e.id)?'checked':''}></td>
      <td>${p?.image ? `<img class="collthumb cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}" src="${p.image}" data-zoom="${p.image_lg || p.image}" alt="">` : '<span class="hint">…</span>'}</td>
      <td><div class="cellname">${rdot}<span class="link cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}">${esc(e.name)}</span></div><div class="pillrow"><span class="pill infopill" title="Langue : ${LANGS[e.lang]||e.lang||'Anglais'}">${(e.lang||'en').toUpperCase()}</span><span class="pill infopill cond-${e.cond||'NM'}" title="État : ${COND_LABEL[e.cond]||e.cond||'NM'}">${e.cond||'NM'}</span>${e.foil?'<span class="pill infopill icpill" title="Foil"><i class="ic ic-foil"></i></span>':''}${e.signed?'<span class="pill infopill icpill" title="Signée"><i class="ic ic-signed"></i></span>':''}${p?.reserved?'<span class="rl-badge" title="Reserved List">RL</span>':''}</div></td>
      <td class="hint">${p ? `${esc(p.set_name||'')} <b>(${p.set?.toUpperCase()})</b> <span class="pill">${p.released_at?.slice(0,4)||''}</span>` : '…'}</td>
      <td><div class="qty-ctl"><button data-a="dec">−</button><b>${e.qty}</b><button data-a="inc">+</button></div></td>
      <td class="p">${pr!=null?eur(pr):'…'}</td>
      <td class="p" style="font-weight:600">${pr!=null?eur(pr*e.qty):'…'}</td>
      <td style="max-width:150px">${(e.tags||[]).map(t=>`<span class="tagchip filled" data-tag="${esc(t)}">${esc(t)} <span class="x" data-xtag="${esc(t)}" data-xid="${e.id}">✕</span></span>`).join('')||'<span class="hint">—</span>'}
        <button class="btn ghost" data-addtagid="${e.id}" style="padding:0 6px;font-size:12px">+</button></td>
      <td><span class="editic" data-edite="${e.id}" title="Modifier (édition, langue, état, foil, signée, tags)" style="margin-right:14px;margin-bottom:14px"></span><span class="trash" title="Retirer tout ce groupe de la collection"></span></td>
    </tr>`;}).join('')}
  </tbody></table>`;
}
function collGridHTML(list){
  if(!list.length) return `<p class="hint">Aucune carte ne correspond aux filtres.</p>`;
  return `<div class="collgrid">${list.map(e => {
    const p = entryPrintSync(e);
    const rdot = rarityDotHTML(p);
    return `<div class="colltile" data-id="${e.id}">
      <span class="qtyb">×${e.qty}${e.foil?' ✦':''}</span>
      <label class="chkb"><input type="checkbox" class="rowchk" ${collChecked.has(e.id)?'checked':''}></label>
      ${p?.image ? `<img class="gridthumb cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}" src="${p.image}" data-zoom="${p.image_lg || p.image}" loading="lazy" alt="">` : '<div style="padding:20px" class="hint">chargement…</div>'}
      <div class="info">
        <div class="name cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}">${rdot}${esc(e.name)}</div>
        <div class="pill">${p ? p.set?.toUpperCase() : ''} ${p && entryPrice(e,p)!=null ? eur(entryPrice(e,p)) : ''}</div>
        <div><span class="pill infopill" title="Langue : ${LANGS[e.lang]||e.lang||'Anglais'}">${(e.lang||'en').toUpperCase()}</span><span class="pill infopill cond-${e.cond||'NM'}" title="État : ${COND_LABEL[e.cond]||e.cond||'NM'}">${e.cond||'NM'}</span>${e.foil?'<span class="pill infopill icpill" title="Foil"><i class="ic ic-foil"></i></span>':''}${e.signed?'<span class="pill infopill icpill" title="Signée"><i class="ic ic-signed"></i></span>':''}${p?.reserved?'<span class="rl-badge">RL</span>':''}</div>
        <div>${(e.tags||[]).map(t=>`<span class="tagchip filled" data-tag="${esc(t)}">${esc(t)}</span>`).join('')}</div>
        <div class="qty-ctl"><button data-a="dec">−</button><b>${e.qty}</b><button data-a="inc">+</button></div>
      </div>
    </div>`;}).join('')}</div>`;
}

/* hydratation progressive : prints manquants + prix + valeur affichée */
async function hydrateColl(list, app, extra){
  const todo = list.concat(extra || []).filter(e => !getPrintCache()[e.norm]);
  for(const e of todo){ try{ await sfPrints(e.name); }catch(err){} }
  if(todo.length){ if(S.view === 'collection') vCollection(app); return; }
  let sum = 0, known = 0;
  list.forEach(e => { const p = entryPrintSync(e); const pr = p ? entryPrice(e,p) : null; if(pr!=null){ sum += pr * e.qty; known++; } });
  const el = document.getElementById('collvalue');
  if(el) el.textContent = `Valeur des cartes affichées : ${eur(sum)}${known < list.length ? ` (${list.length - known} carte(s) sans prix connu)` : ''}`;
}

function bindCollection(app, ctx){
  app.querySelector('#viewbtn').onclick = () => { collView = collView==='list'?'grid':'list'; vCollection(app); };

  // ---- filtres ----
  const upd = () => { collChecked = new Set(); vCollection(app); };
  const fq = app.querySelector('#fq');
  const fsugg = app.querySelector('#fqsugg');
  let fitems = [];
  const applyQ = () => { collF.q = fq.value; collChecked = new Set(); vCollection(app); };
  fq.oninput = () => {
    clearTimeout(fq._t); clearTimeout(fq._s);
    const v = fq.value.trim();
    if(v.length >= 2){
      fq._s = setTimeout(async () => {   // autocomplétion multilingue (anglais puis FR/DE/ES/IT/PT)
        try{ fitems = await sfAutocomplete(v); }catch(e){ fitems = []; }
        if(!fitems.length){ fsugg.style.display='none'; return; }
        fsugg.innerHTML = fitems.slice(0,8).map((n,i)=>`<div data-i="${i}">🃏 ${esc(n)}</div>`).join('');
        fsugg.style.display='block';
        fsugg.querySelectorAll('div').forEach(el => el.onmousedown = ev => {
          ev.preventDefault(); fq.value = fitems[el.dataset.i]; fsugg.style.display='none'; applyQ();
        });
      }, 280);
    } else fsugg.style.display='none';
    fq._t = setTimeout(applyQ, 240);
  };
  fq.onkeydown = e => { if(e.key==='Enter'){ e.preventDefault(); fsugg.style.display='none'; applyQ(); } };
  fq.addEventListener('blur', () => setTimeout(() => fsugg.style.display='none', 150));
  // filtre artiste (autocomplétion catalogue Scryfall + application à la saisie)
  const ainp = app.querySelector('#fartist'), asugg = app.querySelector('#fartistsugg');
  ainp.oninput = () => {
    collF.artist = ainp.value;
    clearTimeout(ainp._t); clearTimeout(ainp._s);
    const v = ainp.value.trim().toLowerCase();
    if(v.length >= 2){
      ainp._s = setTimeout(async () => {
        const list = await sfArtists();
        const hits = list.filter(a => a.toLowerCase().includes(v)).slice(0,10);
        if(!hits.length){ asugg.style.display='none'; return; }
        asugg.innerHTML = hits.map((a,i)=>`<div data-i="${i}">🎨 ${esc(a)}</div>`).join('');
        asugg.style.display='block';
        asugg.querySelectorAll('div').forEach(el => el.onmousedown = ev => {
          ev.preventDefault(); ainp.value = hits[el.dataset.i]; collF.artist = ainp.value; asugg.style.display='none'; upd();
        });
      }, 250);
    } else asugg.style.display='none';
    ainp._t = setTimeout(upd, 400);
  };
  ainp.onkeydown = e => { if(e.key==='Enter'){ e.preventDefault(); asugg.style.display='none'; upd(); } };
  ainp.addEventListener('blur', () => setTimeout(() => asugg.style.display='none', 150));
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
  // resserre la jauge sur les prix de la liste filtrée (floor/top), même si le cache de bornes est froid
  let pmn = null, pmx = null;
  for(const e of ctx.list){ const p = entryPrintSync(e); const pr = p ? entryPrice(e, p) : null;
    if(pr != null){ if(pmn==null || pr<pmn) pmn=pr; if(pmx==null || pr>pmx) pmx=pr; } }
  wirePriceRange(app, collF, upd, (pmx != null && pmx > 0) ? [pmn || 0, pmx] : null);
  { const sel = app.querySelector('#fset');   // uniquement les extensions possédées dans la collection
    const owned = [...new Set(entries.map(e => e.set).filter(Boolean))];
    const nameOf = code => { const en = entries.find(x => x.set === code);
      const pr = en ? (getPrintCache()[en.norm]||[]).find(x => x.set === code) : null;
      return (pr && pr.set_name) || code.toUpperCase(); };
    const sorted = owned.map(code => ({code, name:nameOf(code)})).sort((a,b) => a.name.localeCompare(b.name, 'fr', {sensitivity:'base'}));
    sel.innerHTML = `<option value="">Extension : toutes</option>` +
      sorted.map(s => `<option value="${s.code}" ${collF.set===s.code?'selected':''}>${esc(s.name)}</option>`).join('');
  }
  app.querySelector('#fset').onchange = e => { collF.set = e.target.value; upd(); };
  app.querySelector('#fsort').onchange = e => { collSort = e.target.value; vCollection(app); };
  app.querySelector('#freserved').onchange = e => { collF.reserved = e.target.checked; upd(); };
  app.querySelector('#ffoil').onchange = e => { collF.foil = e.target.checked; upd(); };
  app.querySelector('#fsigned').onchange = e => { collF.signed = e.target.checked; upd(); };
  app.querySelector('#freset').onclick = () => { collF = {q:'', tags:[], colors:[], types:[], cmc:'', pmin:'', pmax:'', set:'', artist:'', reserved:false, foil:false, signed:false}; upd(); };

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
    setTags(tags.filter(y => y !== t));
    entries.forEach(en => en.tags = (en.tags||[]).filter(y => y !== t));
    saveTags(); saveColl(); collF.tags = collF.tags.filter(y=>y!==t); vCollection(app);
  });
  app.querySelector('#newtag').onclick = () => {
    const n = prompt('Nom du tag ? (ex: a vendre, staple commander)'); if(!n) return;
    setTags([...new Set([...tags, n.trim()])]); saveTags(); vCollection(app);
  };

  // ---- actions ligne : quantités, tags, suppression ----
  app.querySelectorAll('.qty-ctl button').forEach(b => b.onclick = () => {
    const host = b.closest('[data-id]'); const e = entries.find(x=>x.id===host.dataset.id); if(!e) return;
    if(b.dataset.a==='inc') e.qty++;
    else { e.qty--; if(e.qty<=0){ setEntries(entries.filter(x=>x.id!==e.id)); collChecked.delete(e.id); } }
    saveColl(); vCollection(app);
  });
  app.querySelectorAll('.trash').forEach(tr => tr.onclick = () => {
    const e = entries.find(x=>x.id===tr.closest('[data-id]').dataset.id); if(!e) return;
    if(!confirm(`Retirer les ${e.qty} × ${e.name} de la collection ?`)) return;
    setEntries(entries.filter(x=>x.id!==e.id)); collChecked.delete(e.id); saveColl(); vCollection(app);
  });
  app.querySelectorAll('[data-xtag]').forEach(x => x.onclick = () => {
    const e = entries.find(en=>en.id===x.dataset.xid); if(!e) return;
    e.tags = (e.tags||[]).filter(t => t !== x.dataset.xtag); saveColl(); vCollection(app);
  });
  app.querySelectorAll('[data-addtagid]').forEach(bt => bt.onclick = () => {
    const e = entries.find(en=>en.id===bt.dataset.addtagid); if(!e) return;
    promptTagsFor(e);
  });
  app.querySelectorAll('.cinfo').forEach(el => el.onclick = () =>
    R.showCardInfo(el.dataset.name, undefined, el.dataset.set ? {set: el.dataset.set, cn: el.dataset.cn} : null));
  app.querySelectorAll('.editic[data-edite]').forEach(el => el.onclick = () => {
    const e = entries.find(x=>x.id===el.dataset.edite); if(e) openEntryEditor(e);
  });

  // ---- checkboxes & actions en masse ----
  app.querySelectorAll('.rowchk').forEach(cb => cb.onchange = () => {
    const id = cb.closest('[data-id]').dataset.id;
    cb.checked ? collChecked.add(id) : collChecked.delete(id);
    const lbl = app.querySelector('.bulkbar b');
    if(!lbl || collChecked.size === 0) vCollection(app);
    else lbl.textContent = `${collChecked.size} sélectionné(s)`;
  });
  const selallchk = app.querySelector('#selallchk');
  if(selallchk) selallchk.onchange = () => {
    if(selallchk.checked) ctx.list.forEach(e => collChecked.add(e.id));
    else ctx.list.forEach(e => collChecked.delete(e.id));
    vCollection(app);
  };
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
  const bulkEdit = app.querySelector('#bulkedit');
  if(bulkEdit) bulkEdit.onclick = () => openBulkEditor(ctx.list.filter(e => collChecked.has(e.id)));
  const ebSave = app.querySelector('#eb-save');
  if(ebSave && ctx.checked && ctx.checked.length === 1){
    const e = entries.find(x => x.id === ctx.checked[0].id);
    if(e){
      let pool = null;
      (async () => {
        let prints = getPrintCache()[e.norm] || [];
        if(!prints.length){ try{ prints = await sfPrints(e.name); }catch(err){} }
        pool = prints;
        const setSel = app.querySelector('#eb-set');
        const pairs = [...new Map(prints.map(p=>[p.set, p.set_name||p.set])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
        setSel.innerHTML = '<option value="">Ne pas changer</option>' + pairs.map(([c,n])=>`<option value="${esc(c)}" ${c===(e.set||null)?'selected':''}>${esc(n)} (${esc(c.toUpperCase())})</option>`).join('');
        const fillLangs = async () => {
          const s = setSel.value || e.set;
          if(s){ try{ const sp = await sfSetPrints(e.name, s); if(sp.length) pool = sp; }catch(err){} }
          if(s && !pool.some(x=>x.set===s)) pool = prints.filter(x=>x.set===s);
          let list = [...new Set((pool||prints).map(x=>x.lang).filter(Boolean))];
          if(!list.length) list = ['en'];
          const langSel = app.querySelector('#eb-lang');
          langSel.innerHTML = list.map(lg=>`<option value="${lg}" ${lg===(e.lang||'en')?'selected':''}>${LANGS[lg]||lg}</option>`).join('');
        };
        setSel.onchange = fillLangs;
        fillLangs();
      })();
      ebSave.onclick = () => {
        const setSel = app.querySelector('#eb-set');
        if(setSel.value) e.set = setSel.value;
        e.lang = app.querySelector('#eb-lang').value || 'en';
        e.cond = app.querySelector('#eb-cond').value;
        e.foil = app.querySelector('#eb-foil').checked;
        e.signed = app.querySelector('#eb-signed').checked;
        e.tags = [...app.querySelector('#eb-tags').selectedOptions].map(o=>o.value);
        const pr = pool || getPrintCache()[e.norm] || [];
        const alt = pr.find(p => p.set === e.set && p.lang === e.lang) || pr.find(p => p.set === e.set);
        if(alt) e.cn = alt.cn;
        const same = entries.find(x => x.id !== e.id && x.norm === e.norm && (x.set||null)===(e.set||null)
          && (x.cn||null)===(e.cn||null) && !!x.foil===!!e.foil && !!x.signed===!!e.signed
          && (x.cond||'NM')===e.cond && (x.lang||'en')===e.lang
          && JSON.stringify([...(x.tags||[])].sort())===JSON.stringify([...(e.tags||[])].sort()));
        if(same){ same.qty += e.qty; setEntries(entries.filter(x=>x.id!==e.id)); collChecked.delete(e.id); }
        saveColl(); vCollection(app);
      };
    }
  }
  const bulkRm = app.querySelector('#bulkrm');
  if(bulkRm) bulkRm.onclick = () => {
    if(!confirm(`Supprimer ${collChecked.size} groupe(s) de cartes de la collection ?`)) return;
    setEntries(entries.filter(e => !collChecked.has(e.id))); collChecked = new Set(); saveColl(); vCollection(app);
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
      if(j.entries){ setEntries(j.entries.map(x=>({foil:false, signed:false, cond:'NM', lang:'en', tags:[], cn:null, set:null, ...x}))); saveColl(); }
      else if(j.collection){ store.set('mtg_collection', j.collection); setEntries(loadEntries()); saveColl(); }  // import v1
      if(j.tags){ setTags([...new Set(j.tags)]); saveTags(); }
      else if(j.binders){ setTags([...new Set(j.binders.map(b=>b.name))]); saveTags(); }
      if(j.matches){ setMatches(j.matches); saveMatches(); }
      alert('Import réussi'); vCollection(app);
    }catch(err){ alert('Fichier invalide'); } };
    rd.readAsText(e.target.files[0]);
  };
}

/* modal : modifier une entrée de la collection (édition, langue, état, foil, signée) */
async function openEntryEditor(e){
  let prints = getPrintCache()[e.norm] || [];
  if(!prints.length){ try{ prints = await sfPrints(e.name); }catch(err){} }
  if(!prints.length){ alert('Métadonnées indisponibles pour cette carte.'); return; }
  // éditions disponibles (set -> set_name), triées par nom d'édition
  const sets = [...new Map(prints.map(p => [p.set, p.set_name || p.set])).entries()]
    .sort((a,b) => String(a[1]).localeCompare(String(b[1])));
  let curSet = e.set || (prints.find(p => p.lang === (e.lang||'en')) || prints[0]).set;
  let langVal = e.lang || 'en';
  let pool = prints;   // printings de l'édition courante, TOUTES langues (sfSetPrints interroge chaque langue explicitement)
  const foilOk = p => (p.finishes||[]).includes('foil') || !!p.eur_foil;
  const curPrint = () => pool.find(p => p.set === curSet && p.lang === langVal)
    || pool.find(p => p.set === curSet) || prints[0];
  openModal(`
  <button class="close" id="mclose">✕</button>
  <h3 style="margin-bottom:4px">${esc(e.name)} — ${e.qty} ex.</h3>
  <p class="hint">Choisissez l'édition, la langue (limitée à celles existant dans cette édition), l'état, le foil et la signature.</p>
  <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:10px">
    <label class="row" style="gap:6px"><b>Édition :</b>
      <select id="ec-set">
        ${sets.map(([code,name]) => `<option value="${esc(code)}" ${code===curSet?'selected':''}>${esc(name)} (${esc(code.toUpperCase())})</option>`).join('')}
      </select></label>
    <label class="row" style="gap:6px"><b>Langue :</b>
      <select id="ec-lang" title="Langues disponibles pour cette carte dans l'édition sélectionnée"></select></label>
    <label class="row" style="gap:6px"><b>État :</b>
      <select id="ec-cond">${CONDS.map(([v,l]) => `<option value="${v}" ${v===(e.cond||'NM')?'selected':''}>${v} — ${l}</option>`).join('')}</select>
    </label>
    <label class="row" id="ec-foilwrap" style="gap:6px"><input type="checkbox" id="ec-foil" ${e.foil?'checked':''}> Foil</label>
    <label class="row" style="gap:6px"><input type="checkbox" id="ec-signed" ${e.signed?'checked':''}> Signée</label>
    <label class="row" style="gap:6px"><b>Tags :</b>
      <select id="ec-tags" multiple size="${Math.min(6, Math.max(3, tags.length))}" style="min-width:160px">
        ${tags.map(t=>`<option ${((e.tags||[]).includes(t))?'selected':''}>${esc(t)}</option>`).join('')}
      </select></label>
    <button class="btn ghost" id="ec-newtag">+ tag</button>
    <button class="btn" id="ec-ok">Enregistrer</button>
  </div>`);
  $('#mclose').onclick = closeModal;
  const langSel = $('#ec-lang');
  const refreshLangs = async () => {
    try{ const sp = await sfSetPrints(e.name, curSet); if(sp.length) pool = sp; }catch(err){}
    if(!pool.some(x => x.set === curSet)) pool = prints.filter(x => x.set === curSet);
    let list = [...new Set(pool.map(x => x.lang).filter(Boolean))];
    if(!list.length) list = [...new Set(prints.map(x => x.lang).filter(Boolean))];
    if(!list.length) list = ['en'];
    if(!list.includes(langVal)) langVal = list.includes('en') ? 'en' : (list[0] || 'en');
    langSel.innerHTML = list.map(lg => `<option value="${lg}" ${lg===langVal?'selected':''}>${LANGS[lg]||lg}</option>`).join('');
    langSel.value = langVal;
    const ok = foilOk(curPrint());
    const cb = $('#ec-foil');
    cb.disabled = !ok; if(!ok) cb.checked = false;
    $('#ec-foilwrap').style.opacity = ok ? 1 : .45;
    $('#ec-foilwrap').title = ok ? 'Cette impression existe en foil' : 'Cette impression n\'existe pas en foil';
  };
  $('#ec-set').onchange = ev => { curSet = ev.target.value; refreshLangs(); };
  langSel.onchange = () => { langVal = langSel.value; refreshLangs(); };
  $('#ec-newtag').onclick = () => { const n = prompt('Nom du tag ?');
    if(n && n.trim()){ const t = n.trim(); setTags([...new Set([...tags, t])]); saveTags();
      $('#ec-tags').innerHTML += `<option selected>${esc(t)}</option>`; } };
  refreshLangs();
  $('#ec-ok').onclick = () => {
    e.set = curSet; e.lang = langVal; e.cond = $('#ec-cond').value;
    e.foil = !$('#ec-foil').disabled && $('#ec-foil').checked;
    e.signed = $('#ec-signed').checked;
    e.tags = [...$('#ec-tags').selectedOptions].map(o=>o.value);
    const alt = pool.find(p => p.set === curSet && p.lang === langVal) || prints.find(p => p.set === curSet && p.lang === langVal);
    if(alt) e.cn = alt.cn;   // le n° collecteur suit l'édition/langue choisie
    // fusion avec un groupe identique s'il existe (même édition/foil/signé/état/langue/tags)
    const same = entries.find(x => x.id !== e.id && x.norm === e.norm && (x.set||null)===(e.set||null)
      && (x.cn||null)===(e.cn||null) && !!x.foil===!!e.foil && !!x.signed===!!e.signed
      && (x.cond||'NM')===e.cond && (x.lang||'en')===e.lang
      && JSON.stringify([...(x.tags||[])].sort())===JSON.stringify([...(e.tags||[])].sort()));
    if(same){ same.qty += e.qty; setEntries(entries.filter(x=>x.id!==e.id)); collChecked.delete(e.id); }
    saveColl(); closeModal(); vCollection($('#app'));
  };
}

function promptTagsFor(e){
  const t = prompt(`Tags pour ${e.qty} × ${e.name} (séparez par des virgules).\nTags existants : ${tags.join(', ')}\nVide = retirer tous les tags`, (e.tags||[]).join(', '));
  if(t === null) return;
  const chosen = t.split(',').map(s=>s.trim()).filter(Boolean);
  chosen.forEach(c => { if(!tags.includes(c)) tags.push(c); }); saveTags();
  e.tags = [...new Set(chosen)]; saveColl(); vCollection($('#app'));
}

/* modale : modifier en masse les entrées cochées (édition/langue/état/foil/signée).
   1 seule entrée -> openEntryEditor (édition complète, tags inclus). */
async function openBulkEditor(sel){
  if(!sel.length) return;
  if(sel.length === 1){ openEntryEditor(sel[0]); return; }
  // prints des cartes sélectionnées (pour resynchroniser le n° collecteur après changement d'édition/langue)
  for(const e of sel){ if(!getPrintCache()[e.norm]){ try{ await sfPrints(e.name); }catch(err){} } }
  const setsPairs = [...new Map(sel.flatMap(e => (getPrintCache()[e.norm]||[]).map(p => [p.set, p.set_name||p.set]))).entries()]
    .sort((a,b) => String(a[1]).localeCompare(String(b[1])));
  const langs = [...new Set(sel.flatMap(e => (getPrintCache()[e.norm]||[]).map(p => p.lang).filter(Boolean)))].sort();
  openModal(`
  <button class="close" id="mclose">✕</button>
  <h3 style="margin-bottom:4px">Modifier ${sel.length} groupe(s)</h3>
  <p class="hint">« Ne pas changer » laisse le champ tel quel. Édition/langue resynchronisent le n° collecteur de chaque carte. Les tags se gèrent avec les boutons + tag / − tag de la barre de sélection.</p>
  <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:10px">
    <label class="row" style="gap:6px"><b>Édition :</b>
      <select id="be-set"><option value="">Ne pas changer</option>${setsPairs.map(([c,n])=>`<option value="${esc(c)}">${esc(n)} (${esc(c.toUpperCase())})</option>`).join('')}</select></label>
    <label class="row" style="gap:6px"><b>Langue :</b>
      <select id="be-lang"><option value="">Ne pas changer</option>${langs.map(l=>`<option value="${l}">${LANGS[l]||l}</option>`).join('')}</select></label>
    <label class="row" style="gap:6px"><b>État :</b>
      <select id="be-cond"><option value="">Ne pas changer</option>${CONDS.map(([v,l])=>`<option value="${v}">${v} — ${l}</option>`).join('')}</select></label>
    <label class="row" style="gap:6px"><b>Foil :</b>
      <select id="be-foil"><option value="">Ne pas changer</option><option value="1">Foil</option><option value="0">Non foil</option></select></label>
    <label class="row" style="gap:6px"><b>Signée :</b>
      <select id="be-signed"><option value="">Ne pas changer</option><option value="1">Signée</option><option value="0">Non signée</option></select></label>
    <button class="btn" id="be-ok">Enregistrer</button>
  </div>`);
  $('#mclose').onclick = closeModal;
  $('#be-ok').onclick = () => {
    const set = $('#be-set').value, lang = $('#be-lang').value, cond = $('#be-cond').value;
    const foil = $('#be-foil').value, signed = $('#be-signed').value;
    sel.forEach(e => {
      if(set) e.set = set;
      if(lang) e.lang = lang;
      if(set || lang){
        const prints = getPrintCache()[e.norm] || [];
        const alt = prints.find(p => p.set === e.set && p.lang === (e.lang||'en')) || prints.find(p => p.set === e.set);
        if(alt) e.cn = alt.cn;
      }
      if(cond) e.cond = cond;
      if(foil !== '') e.foil = foil === '1';
      if(signed !== '') e.signed = signed === '1';
    });
    // fusion des doublons créés par l'édition en masse
    const map = new Map();
    for(const e of entries){
      const key = [e.norm, e.set||'', e.cn||'', !!e.foil, !!e.signed, e.cond||'NM', e.lang||'en', JSON.stringify([...(e.tags||[])].sort())].join('|');
      if(map.has(key)) map.get(key).qty += e.qty; else map.set(key, e);
    }
    setEntries([...map.values()]); collChecked = new Set(); saveColl(); closeModal(); vCollection($('#app'));
  };
}

/* popup d'ajout rapide depuis une tuile (recherche avancée / détail d'extension) :
   l'édition est fixée à l'impression cliquée — pas de grille de choix d'édition */
async function openAddPopup(name, preset){
  preset = preset || {};
  let prints = [];
  try{ prints = await sfPrints(name); }catch(e){}
  if(!prints.length){ addEntry({name, qty:1, tags:[]}); return; }
  // printings de CETTE édition, toutes langues (requête set:<code> !"nom" — source fiable)
  let pool = prints;
  if(preset.set){
    try{ const sp = await sfSetPrints(name, preset.set); if(sp.length) pool = sp; }catch(e){}
  }
  let cur = (preset.set && pool.find(x => x.set===preset.set && (!preset.cn || String(x.cn)===String(preset.cn))))
         || (preset.set && pool.find(x => x.set===preset.set)) || pool[0] || prints[0];
  // langues disponibles pour cette carte DANS cette édition (champ lang des printings Scryfall)
  let langList = [...new Set(pool.filter(x => x.set===cur.set).map(x => x.lang).filter(Boolean))];
  if(!langList.length) langList = [...new Set(pool.map(x => x.lang).filter(Boolean))];
  if(!langList.length) langList = [...new Set(prints.map(x => x.lang).filter(Boolean))];
  if(!langList.length) langList.push('en');
  let langVal = langList.includes('en') ? 'en' : (cur.lang || langList[0]);   // anglais par défaut si dispo
  const foilOk = p => (p.finishes||[]).includes('foil') || !!p.eur_foil;        // imprimée en foil ou non
  openModal(`
  <button class="close" id="mclose">✕</button>
  <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
    <img id="apimg" src="${cur.image||''}" style="width:150px;border-radius:10px;background:#000" alt="">
    <div style="flex:1;min-width:260px">
      <h3 style="margin-bottom:2px">${esc(cur.name)}${cur.printed_name && cur.printed_name!==cur.name?` <span class="hint">(${esc(cur.printed_name)})</span>`:''}</h3>
      <p class="hint" id="apsetline">Édition : <b>${esc(cur.set_name)}</b> <span class="pill">${cur.set.toUpperCase()} · n° ${esc(String(cur.cn))} · ${cur.released_at?.slice(0,4)||''}</span> <span class="pill" id="aplangpill">${(cur.lang||'en').toUpperCase()}</span></p>
      <p id="apprice" style="color:var(--warn);font-weight:700;margin:4px 0">${eur(cur.eur)}${cur.eur_foil?` / ✦ ${eur(cur.eur_foil)}`:''}</p>
      <div class="row" style="flex-wrap:wrap;gap:10px">
        <label class="row" style="gap:6px"><b>Langue :</b>
          <select id="aplang" title="Langues disponibles pour cette carte dans cette édition">
            ${langList.map(lg => `<option value="${lg}" ${lg===langVal?'selected':''}>${LANGS[lg]||lg}</option>`).join('')}
          </select></label>
        <label class="row" style="gap:6px"><b>État :</b>
          <select id="apcond">${CONDS.map(([v,l]) => `<option value="${v}" ${v==='NM'?'selected':''}>${v} — ${l}</option>`).join('')}</select></label>
        <label class="row" id="apfoilwrap" style="gap:6px" title="${foilOk(cur)?'Cette impression existe en foil':'Cette impression n\'existe pas en foil'}"><input type="checkbox" id="apfoil" ${foilOk(cur)?'':'disabled'}> Foil</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="apsigned"> Signée</label>
        <label class="row" style="gap:6px"><b>Qté :</b> <input type="number" id="apqty" value="1" min="1" max="99" style="width:70px"></label>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:10px;margin-top:10px">
        <select id="aptags" multiple size="${Math.min(6, Math.max(3, tags.length))}" style="min-width:180px">
          ${tags.map(t=>`<option>${esc(t)}</option>`).join('')}
        </select>
        <button class="btn ghost" id="apnewtag">+ tag</button>
        <button class="btn" id="apok">Ajouter à la collection</button>
      </div>
    </div>
  </div>`);
  $('#mclose').onclick = closeModal;
  // changer de langue = changer de printing dans la même édition (visuel, n°, prix, foil mis à jour)
  $('#aplang').onchange = e => {
    langVal = e.target.value;
    const alt = pool.find(x => x.set===cur.set && x.lang===langVal);
    if(alt && alt !== cur){
      cur = alt;
      $('#apimg').src = cur.image || '';
      $('#apsetline').innerHTML = `Édition : <b>${esc(cur.set_name)}</b> <span class="pill">${cur.set.toUpperCase()} · n° ${esc(String(cur.cn))} · ${cur.released_at?.slice(0,4)||''}</span> <span class="pill" id="aplangpill">${(cur.lang||'en').toUpperCase()}</span>`;
      $('#apprice').textContent = `${eur(cur.eur)}${cur.eur_foil?` / ✦ ${eur(cur.eur_foil)}`:''}`;
      const ok = foilOk(cur), cb = $('#apfoil');
      cb.disabled = !ok; if(!ok) cb.checked = false;
      $('#apfoilwrap').style.opacity = ok ? 1 : .45;
      $('#apfoilwrap').title = ok ? 'Cette impression existe en foil' : 'Cette impression n\'existe pas en foil';
    }
  };
  $('#apnewtag').onclick = () => { const n = prompt('Nom du tag ?');
    if(n){ setTags([...new Set([...tags, n])]); saveTags();
      $('#aptags').innerHTML += `<option selected>${esc(n)}</option>`; } };
  $('#apok').onclick = () => {
    const chosen = [...$('#aptags').selectedOptions].map(o=>o.value);
    const foil = !$('#apfoil').disabled && $('#apfoil').checked;
    addEntry({name:cur.name, set:cur.set, cn:cur.cn, foil, signed:$('#apsigned').checked,
      qty:+$('#apqty').value||1, cond:$('#apcond').value, lang:langVal, tags:chosen});
    closeModal();
    refreshTileOwned(cur.name, cur.set);   // met à jour le badge ×N sans relancer la recherche
  };
}
/* met à jour le badge ×N des tuiles d'une carte+édition (toutes langues/états confondus) */
function refreshTileOwned(name, set){
  const s = set || '';
  const k = norm(name);
  const q = ownedQtyMap().get(k+'|'+s) || 0;
  document.querySelectorAll('.cardtile').forEach(tl => {
    if(tl.dataset.set !== s || norm(tl.dataset.name) !== k) return;
    let b = tl.querySelector('.qtyb');
    if(q>0){ if(!b){ b = document.createElement('span'); b.className='qtyb'; tl.prepend(b); } b.textContent = '×'+q; }
    else if(b) b.remove();
  });
}
R.views.collection = vCollection; R.vCollection = vCollection;
R.openAddPopup = openAddPopup; R.openEntryEditor = openEntryEditor;

export { collFilterAndSort, vCollection, collTableHTML, collGridHTML, hydrateColl, bindCollection, openEntryEditor, openBulkEditor, promptTagsFor, openAddPopup, refreshTileOwned, collF, collSort, setCollSort, TYPES_LIST };
