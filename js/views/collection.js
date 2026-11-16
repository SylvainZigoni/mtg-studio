import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS, TYPES_LIST } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks, ownedQtyMap } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

/* ============================================================
   VUE COLLECTION
   ============================================================ */
/* état de la vue collection */
let collF = {q:'', tags:[], colors:[], types:[], cmc:'', pmin:'', pmax:'', set:''};
let collSort = 'name', collDir = 1, collView = 'list', collChecked = new Set(), collPending = false;

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
      <select id="addlang" title="Langue de l'exemplaire ajouté (anglais par défaut)">${Object.entries(LANGS).map(([v,l])=>`<option value="${v}" ${v==='en'?'selected':''}>${l}</option>`).join('')}</select>
      <select id="addcond" title="État de l'exemplaire ajouté (Near Mint par défaut)">${CONDS.map(([v,l])=>`<option value="${v}" ${v==='NM'?'selected':''}>${v} — ${l}</option>`).join('')}</select>
      <button class="btn" id="addbtn">Ajouter</button>
    </div>
    <p class="hint" style="margin-top:8px">Saisissez en anglais, français, allemand, espagnol, italien ou portugais — l'affichage reste en anglais.
    Collez une liste (« 4 Lightning Bolt », une carte par ligne) pour un import rapide. Cliquez sur une suggestion pour choisir l'édition, la langue (uniquement celles existant dans cette édition), l'état, le foil et les tags.</p>
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
      <td>${p?.image ? `<img class="collthumb cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}" src="${p.image}" data-zoom="${p.image_lg || p.image}" alt="">` : '<span class="hint">…</span>'}</td>
      <td><span class="link cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}">${esc(e.name)}</span>${e.foil?' <span class="foil-badge" title="Foil">FOIL</span>':''}${e.signed?' <span class="pill" title="Signée">✍</span>':''}<span class="pill pillbtn" data-edite="${e.id}" title="État : ${COND_LABEL[e.cond]||e.cond||'NM'} — cliquez pour modifier">${e.cond||'NM'}</span><span class="pill pillbtn" data-edite="${e.id}" title="Langue : ${LANGS[e.lang]||e.lang||'Anglais'} — cliquez pour modifier">${(e.lang||'en').toUpperCase()}</span>${p?.reserved?' <span class="rl-badge" title="Reserved List">RL</span>':''}</td>
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
      ${p?.image ? `<img class="gridthumb cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}" src="${p.image}" data-zoom="${p.image_lg || p.image}" loading="lazy" alt="">` : '<div style="padding:20px" class="hint">chargement…</div>'}
      <div class="info">
        <div class="name cinfo" data-name="${esc(e.name)}" data-set="${esc(e.set||'')}" data-cn="${esc(e.cn??'')}">${esc(e.name)}</div>
        <div class="pill">${p ? p.set?.toUpperCase() : ''} ${p && entryPrice(e,p)!=null ? eur(entryPrice(e,p)) : ''}</div>
        <div><span class="pill pillbtn" data-edite="${e.id}" title="État : ${COND_LABEL[e.cond]||e.cond||'NM'} — cliquez pour modifier">${e.cond||'NM'}</span><span class="pill pillbtn" data-edite="${e.id}" title="Langue : ${LANGS[e.lang]||e.lang||'Anglais'} — cliquez pour modifier">${(e.lang||'en').toUpperCase()}</span>${e.signed?'<span class="pill">✍</span>':''}${p?.reserved?'<span class="rl-badge">RL</span>':''}</div>
        <div>${(e.tags||[]).map(t=>`<span class="tagchip filled" data-tag="${esc(t)}">${esc(t)}</span>`).join('')}</div>
        <div class="qty-ctl"><button data-a="dec">−</button><b>${e.qty}</b><button data-a="inc">+</button></div>
      </div>
    </div>`;}).join('')}</div>`;
}

/* hydratation progressive : prints manquants + prix + valeur affichée */
async function hydrateColl(list, app){
  const todo = list.filter(e => !getPrintCache()[e.norm]);
  for(const e of todo){ try{ await sfPrints(e.name); }catch(err){} }
  if(todo.length){ if(S.view === 'collection') vCollection(app); return; }
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
    const lang = app.querySelector('#addlang').value, cond = app.querySelector('#addcond').value;
    const lines = raw.split(/\n|;/).map(s=>s.trim()).filter(Boolean);
    lines.forEach(l => { const m = l.match(/^(\d+)\s*x?\s+(.+)$/i);
      addEntry(m ? {name:m[2], qty:+m[1], tags:[], lang, cond} : {name:l, qty:+app.querySelector('#cardqty').value||1, tags:[], lang, cond}); });
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
  app.querySelectorAll('[data-edite]').forEach(el => el.onclick = () => {
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
  let sel = 0;
  if(preset.set){
    const iCn = prints.findIndex(p => p.set === preset.set && (!preset.cn || String(p.cn) === String(preset.cn)));
    sel = iCn >= 0 ? iCn : Math.max(0, prints.findIndex(p => p.set === preset.set));
  }
  const html = `
  <button class="close" id="mclose">✕</button>
  <h3 style="margin-bottom:4px">${esc(prints[0].name)}</h3>
  <p class="hint">Choisissez l'édition que vous possédez — le visuel, le symbole et le prix suivront cette édition.
  La langue proposée est limitée aux langues existant pour cette carte dans l'édition choisie (anglais par défaut) ; l'état est Near Mint par défaut.</p>
  <div id="ppgrid" class="collgrid" style="margin:10px 0">
    ${prints.map((p,i) => `<div class="colltile" data-i="${i}" style="cursor:pointer;${i===sel?'outline:2px solid var(--accent)':''}">
      ${p.image?`<img src="${p.image}" loading="lazy" style="width:100%;aspect-ratio:488/680;object-fit:cover;background:#000">`:''}
      <div class="info"><b>${esc(p.set_name)}</b> <span class="pill">${p.set.toUpperCase()} · ${esc(p.cn)} · ${p.released_at?.slice(0,4)}</span>
      <div class="price">${eur(p.eur)}${p.eur_foil?` / ✦ ${eur(p.eur_foil)}`:''}</div></div>
    </div>`).join('')}
  </div>
  <div class="row" style="flex-wrap:wrap;gap:10px">
    <label class="row" id="ppfoilwrap" style="gap:6px"><input type="checkbox" id="ppfoil"> Foil</label>
    <label class="row" style="gap:6px"><input type="checkbox" id="ppsigned"> Signée</label>
    <select id="ppcond">
      ${CONDS.map(([v,l]) => `<option value="${v}" ${v==='NM'?'selected':''}>${l}</option>`).join('')}
    </select>
    <label class="row" style="gap:6px"><b>Langue :</b>
      <select id="pplang" title="Langues disponibles pour cette carte dans l'édition sélectionnée"></select>
    </label>
    <input type="number" id="ppqty" value="1" min="1" max="99" style="width:80px">
    <select id="pptags" multiple size="${Math.min(6, Math.max(3, tags.length))}" style="min-width:180px">
      ${tags.map(t=>`<option>${esc(t)}</option>`).join('')}
    </select>
    <button class="btn ghost" id="ppnewtag">+ tag</button>
    <button class="btn" id="ppok">Ajouter à la collection</button>
  </div>`;
  openModal(html);
  $('#mclose').onclick = closeModal;
  $('#ppfoil').checked = !!preset.foil;
  if(preset.cond) $('#ppcond').value = preset.cond;
  // langues proposées : uniquement celles existant pour cette carte DANS l'édition
  // sélectionnée (champ "lang" de chaque printing renvoyé par l'API Scryfall)
  const langSel = $('#pplang');
  let langVal = preset.lang || 'en';
  let setPool = prints;   // printings de l'édition sélectionnée (requête set:<code> fiable)
  async function refreshForSel(){
    const p = prints[sel];
    try{ const sp = await sfSetPrints(prints[0].name, p.set); if(sp.length) setPool = sp; }catch(e){}
    if(!setPool.some(x => x.set === p.set)) setPool = prints.filter(x => x.set === p.set);
    let list = [...new Set(setPool.map(x => x.lang).filter(Boolean))];
    if(!list.length) list = [...new Set(prints.map(x => x.lang).filter(Boolean))];
    if(!list.length) list.push('en');
    langSel.innerHTML = list.map(lg => `<option value="${lg}">${LANGS[lg]||lg}</option>`).join('');
    langSel.value = list.includes(langVal) ? langVal : (list.includes('en') ? 'en' : (p.lang || list[0]));
    langVal = langSel.value;
    // foil uniquement si l'impression sélectionnée existe en foil (finishes Scryfall)
    const ok = (p.finishes||[]).includes('foil') || !!p.eur_foil;
    const cb = $('#ppfoil');
    cb.disabled = !ok; if(!ok) cb.checked = false;
    $('#ppfoilwrap').style.opacity = ok ? 1 : .45;
    $('#ppfoilwrap').title = ok ? 'Cette impression existe en foil' : 'Cette impression n\'existe pas en foil';
  }
  async function selectTile(i){
    sel = i;
    $('#ppgrid').querySelectorAll('.colltile').forEach(x => x.style.outline = '');
    const tl = $('#ppgrid').querySelector(`.colltile[data-i="${i}"]`);
    if(tl) tl.style.outline = '2px solid var(--accent)';
    await refreshForSel();
  }
  $('#ppgrid').querySelectorAll('.colltile').forEach(tl => tl.onclick = () => selectTile(+tl.dataset.i));
  refreshForSel();
  langSel.onchange = () => {
    langVal = langSel.value;
    // si cette édition existe dans la langue choisie, on sélectionne ce printing (n° collecteur adapté)
    const alt = prints.findIndex(p => p.set === prints[sel].set && p.lang === langVal);
    if(alt >= 0 && alt !== sel) selectTile(alt);
  };
  $('#ppnewtag').onclick = () => { const n = prompt('Nom du tag ?');
    if(n){ setTags([...new Set([...tags, n])]); saveTags();
      openPrintPicker(name, {set:prints[sel].set, foil:$('#ppfoil').checked, cond:$('#ppcond').value, lang:langVal}); } };
  $('#ppok').onclick = () => {
    const p = prints[sel];
    const chosen = [...$('#pptags').selectedOptions].map(o=>o.value);
    addEntry({name:prints[0].name, set:p.set, cn:p.cn, foil:$('#ppfoil').checked && !$('#ppfoil').disabled, qty:+$('#ppqty').value||1,
      cond:$('#ppcond').value, lang:langVal, signed:$('#ppsigned').checked, tags:chosen});
    closeModal(); vCollection($('#app')); hydrateColl(entries, $('#app'));
  };
}
/* modal : modifier la langue et/ou l'état d'un groupe existant de la collection */
async function openEntryEditor(e){
  let prints = getPrintCache()[e.norm] || [];
  if(!prints.length){ try{ prints = await sfPrints(e.name); }catch(err){} }
  let pool = prints;
  if(e.set){ try{ const sp = await sfSetPrints(e.name, e.set); if(sp.length) pool = sp; }catch(err){} }
  const inSet = [...new Set(pool.filter(p => p.set === e.set).map(p => p.lang).filter(Boolean))];
  const all = [...new Set(pool.map(p => p.lang).filter(Boolean))];
  let langList = inSet.length ? inSet : all;
  const cur = e.lang || 'en';
  if(!langList.includes(cur)) langList = [cur, ...langList];
  if(!langList.length) langList = ['en'];
  openModal(`
  <button class="close" id="mclose">✕</button>
  <h3 style="margin-bottom:4px">${esc(e.name)} — ${e.qty} ex.</h3>
  <p class="hint">${e.set ? `Édition : <b>${esc(e.set.toUpperCase())}</b>${e.cn ? ` · n° ${esc(String(e.cn))}` : ''}` : 'Édition inconnue'}${e.foil ? ' · FOIL' : ''}${e.signed ? ' · signée' : ''}</p>
  <div class="row" style="margin-top:12px">
    <label class="row" style="gap:6px"><b>Langue :</b>
      <select id="ec-lang" title="Langues disponibles pour cette carte dans cette édition">
        ${langList.map(lg => `<option value="${lg}" ${lg===cur?'selected':''}>${LANGS[lg]||lg}</option>`).join('')}
      </select></label>
    <label class="row" style="gap:6px"><b>État :</b>
      <select id="ec-cond">${CONDS.map(([v,l]) => `<option value="${v}" ${v===(e.cond||'NM')?'selected':''}>${v} — ${l}</option>`).join('')}</select>
    </label>
    <button class="btn" id="ec-ok">Enregistrer</button>
  </div>`);
  $('#mclose').onclick = closeModal;
  $('#ec-ok').onclick = () => {
    e.cond = $('#ec-cond').value; e.lang = $('#ec-lang').value;
    const alt = pool.find(p => p.set === e.set && p.lang === e.lang);
    if(alt) e.cn = alt.cn;   // le n° collecteur suit la langue choisie
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
R.openPrintPicker = openPrintPicker; R.openAddPopup = openAddPopup; R.openEntryEditor = openEntryEditor;

export { collFilterAndSort, vCollection, collTableHTML, collGridHTML, hydrateColl, bindCollection, openPrintPicker, openEntryEditor, promptTagsFor, openAddPopup, refreshTileOwned, collF, collSort, TYPES_LIST };
