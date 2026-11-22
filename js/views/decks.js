import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, frDate, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { ordOf, isoOf } from '../core/pricedb.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

/* ============================================================
   VUE TOURNOIS MTGTop8 — recherche de tournois (dev-top8_tournament)
   - filtres haut de page : formats (menu déroulant multi-checkbox,
     aucun coché = tous), nombre de joueurs (choix unique : +19/+49/
     +99/+199 = "plus de N" ; tournois sans nb de joueurs toujours
     visibles), recherche tournoi (bouton Go intégré au champ,
     nom + lieu, insensible casse/accents), champs joueur/carte
     présents mais inactifs, jauge de dates à 2 curseurs
     (défaut = pleine plage des events)
   - KPI + panneau Archétype calculés sur TOUS les decks filtrés
   - tableau des tournois : colonnes Date 12% / Format 6% / Nom 45% /
     Lieu 25% (sans retour à la ligne) / Nb joueurs 10% / flèche 2%,
     tri par en-têtes cliquables (défaut date décroissante), hauteur
     fixe avec scroll interne (plus de pagination), lignes
     multi-dépliables, contenu du déplié généré au premier clic
   - déplié : decks du tournoi triés rang croissant, égalité de rang
     -> ordre alphabétique du nom du deck ; clic ligne -> showDeck
   ============================================================ */
const T8_BUCKETS = [['ALL','Nombre de joueur'],['gt19','+19 joueurs'],['gt49','+49 joueurs'],['gt99','+99 joueurs'],['gt199','+199 joueurs']];
const T8_COLS = [['date','Date'],['fmt','Format'],['name','Nom du tournoi'],['place','Lieu'],['players','Joueurs']];
const T8_COLW = [10, 8, 45, 25, 10, 2];   // % : date, format, nom, lieu, nb joueurs, flèche
const T8_PCOLS = [['player','Nom'],['date','Date'],['fmt','Format'],['evname','Nom du tournoi'],['deck','Deck joué'],['rank','Rang'],['players','Joueurs']];
const T8_PCOLW = [14, 12, 8, 30, 20, 6, 10];   // % : nom, date, format, tournoi, deck, rang, joueurs
const FMT_SHORT = {MO:'MOD', LE:'LEG', VI:'VIN', PAU:'PAU', PEA:'PEA', PREM:'PRE', EDH:'DC'};
let t8 = { mode:'ev', fmts:[], players:'ALL', q:'', dateFrom:null, dateTo:null, sortCol:'date', sortDir:'desc', open:new Set(), _rt:null };
let FMT_META = null;    // [{code,name}] via /api/decks/meta (noms complets des formats)
let t8Bounds = null;    // bornes (ordinaux de jours) des dates d'events
let ddCloseBound = false;

const fmtLabel = c => (FMT_META && FMT_META.find(f => f.code===c)?.name) || FMT_NAMES[c] || c;
const fmtShort = c => FMT_SHORT[c] || String(c||'').slice(0,3).toUpperCase();

async function loadFmtMeta(){
  if(FMT_META !== null) return;
  try{ const j = await (await fetch('/api/decks/meta')).json(); if(j.ok && j.formats) FMT_META = j.formats; }catch(e){}
  if(!FMT_META) FMT_META = [];
}

function t8dateBounds(){
  if(t8Bounds) return t8Bounds;
  let mn = Infinity, mx = -Infinity;
  for(const e of EVENTS){ if(!e.date) continue; const o = ordOf(e.date); if(o<mn) mn=o; if(o>mx) mx=o; }
  t8Bounds = (mn<=mx) ? {min:mn, max:mx} : {min:0, max:0};
  return t8Bounds;
}

function t8playersOk(e){
  if(t8.players==='ALL') return true;
  const p = e.players;
  if(p==null || p===0) return true;          // nb de joueurs inconnu : toujours visible
  if(t8.players==='gt19')  return p>19;
  if(t8.players==='gt49')  return p>49;
  if(t8.players==='gt99')  return p>99;
  if(t8.players==='gt199') return p>199;
  return true;
}

function t8filteredDecks(){
  const q = norm(t8.q);
  const out = [];
  for(let i=0;i<DECKS.length;i++){
    const d = DECKS[i];
    if(t8.fmts.length && !t8.fmts.includes(d[1])) continue;
    if(!t8playersOk({players:d[12]})) continue;
    if(d[8] && (ordOf(d[8])<t8.dateFrom || ordOf(d[8])>t8.dateTo)) continue;
    if(q && !norm(d[5]||'').includes(q)) continue;
    out.push(i);
  }
  return out;
}

function t8filtered(){
  if(t8.mode==='pl') return t8filteredDecks();
  const q = norm(t8.q);
  return EVENTS.filter(e =>
    (t8.fmts.length===0 || t8.fmts.includes(e.fmt)) &&
    t8playersOk(e) &&
    (!q || norm((e.name||'')+' '+(e.place||'')).includes(q)) &&
    (!e.date || (ordOf(e.date)>=t8.dateFrom && ordOf(e.date)<=t8.dateTo)));
}

function t8sorted(list){
  const c = t8.sortCol, d = t8.sortDir==='desc' ? -1 : 1;
  const val = e => c==='players' ? (e.players==null ? null : +e.players)
    : c==='date' ? (e.date||'')
    : c==='fmt' ? fmtShort(e.fmt)
    : c==='name' ? norm(e.name||'') : norm(e.place||'');
  return [...list].sort((a,b) => {
    const va = val(a), vb = val(b);
    if(c==='players' && (va==null || vb==null)) return va==null ? 1 : -1;   // nb joueurs inconnu : toujours en dernier
    const r = c==='players' ? va-vb : (va<vb ? -1 : va>vb ? 1 : 0);
    return (r || (b.date||'').localeCompare(a.date||'')) * d;
  });
}

function t8decksOf(e){
  if(!e._sd) e._sd = e.decks.slice().sort((a,b) =>
    (DECKS[a][2]-DECKS[b][2]) || norm(DECKS[a][3]||'').localeCompare(norm(DECKS[b][3]||'')));
  return e._sd;
}

function t8deckSubHTML(e){
  const dks = t8decksOf(e).map(i => {
    const d = DECKS[i];
    return `<tr class="dkrow" data-i="${i}"><td>#${d[2]}</td><td>${esc(d[3]||'')}</td><td class="arch" data-arch="${esc(d[4]||'')}">${esc(d[4]||'—')}</td><td>${esc(d[5]||'')}</td></tr>`;
  }).join('');
  return `<table class="decksub"><thead><tr><th>#</th><th>Deck</th><th>Archétype</th><th>Joueur</th></tr></thead><tbody>${dks || '<tr><td colspan="4" class="hint">Aucun deck référencé.</td></tr>'}</tbody></table>`;
}

const t8fmtBtnLabel = () => t8.fmts.length ? `Format · ${t8.fmts.length} coché${t8.fmts.length>1?'s':''} ▾` : 'Format ▾';

async function vDecks(app){
  await loadFmtMeta();
  if(!EVENTS.length){ app.innerHTML = '<div class="panel"><p class="hint">Chargement des decks MTGTop8…</p></div>'; return; }
  const b = t8dateBounds();
  if(t8.dateFrom===null){ t8.dateFrom = b.min; t8.dateTo = b.max; }
  const fmts = [...new Set(EVENTS.map(e => e.fmt))].sort((x,y) => fmtLabel(x).localeCompare(fmtLabel(y)));
  app.innerHTML = `
  <div class="panel">
    <div class="row t8f">
      <div class="dd" id="fmtdd">
        <button type="button" class="btn ghost" id="fmtbtn">${t8fmtBtnLabel()}</button>
        <div class="ddmenu" id="fmtmenu">
          <label><input type="checkbox" id="fmtall" ${t8.fmts.length===0?'checked':''}> Tous les formats</label>
          ${fmts.map(f => `<label><input type="checkbox" class="fmtchk" value="${esc(f)}" ${t8.fmts.includes(f)?'checked':''}> ${esc(fmtLabel(f))}</label>`).join('')}
        </div>
      </div>
      <select id="t8players">${T8_BUCKETS.map(([v,l]) => `<option value="${v}" ${t8.players===v?'selected':''}>${l}</option>`).join('')}</select>
      ${[['ev','Rechercher un tournoi'],['pl','Rechercher un joueur'],['cd','Rechercher une carte']].map(([m,ph]) => {
        const active = t8.mode===m, goOn = active && m!=='cd';
        return `<span class="gosearch-wrap"><input type="radio" name="t8mode" value="${m}" class="t8radio" ${active?'checked':''} title="Recherche : ${ph.replace('Rechercher un ','')}"><span class="gosearch"><input type="text" id="t8q-${m}" placeholder="${ph}" value="${m==='ev'?esc(t8.q):''}"${active?'':' disabled'}><button type="button" class="btn${goOn?'':' ghost'}" id="t8go-${m}"${goOn?'':' disabled'} title="${goOn?'Lancer la recherche':'Bientôt disponible'}">Go</button></span></span>`;
      }).join('')}
    </div>
    <div class="row" style="margin-top:12px">
      <span class="hint">Date :</span>
      <div class="evrange">
        <div class="ev-track"><div class="ev-fill" id="evfill"></div></div>
        <input type="range" id="evmin" min="${b.min}" max="${b.max}" step="1" value="${t8.dateFrom}">
        <input type="range" id="evmax" min="${b.min}" max="${b.max}" step="1" value="${t8.dateTo}">
        <div class="ev-labs"><span id="evlabmin">${frDate(isoOf(t8.dateFrom))}</span><span id="evlabmax">${frDate(isoOf(t8.dateTo))}</span></div>
      </div>
    </div>
  </div>
  <div class="t8grid">
    <div>
      <div class="panel t8kpi" id="t8kpi"></div>
      <div class="panel"><h3 class="sub" style="margin-top:0">Archétype</h3><div class="archlist" id="t8arch"></div></div>
    </div>
    <div class="panel"><h3 class="sub" style="margin-top:0">Liste des tournois</h3><div id="t8results"></div></div>
  </div>`;
  if(!ddCloseBound){
    ddCloseBound = true;
    document.addEventListener('click', e => { if(!e.target.closest('.dd')) $$('.dd.open').forEach(d => d.classList.remove('open')); });
  }
  const dd = app.querySelector('#fmtdd');
  app.querySelector('#fmtbtn').onclick = () => dd.classList.toggle('open');
  const fmtall = app.querySelector('#fmtall');
  const syncFmt = () => { fmtall.checked = t8.fmts.length===0; app.querySelector('#fmtbtn').textContent = t8fmtBtnLabel(); };
  fmtall.onchange = () => {
    if(!fmtall.checked) return;
    t8.fmts = [];
    app.querySelectorAll('.fmtchk').forEach(c => c.checked = false);
    syncFmt(); renderT8Results(app);
  };
  app.querySelectorAll('.fmtchk').forEach(c => c.onchange = () => {
    t8.fmts = [...app.querySelectorAll('.fmtchk:checked')].map(x => x.value);
    syncFmt(); renderT8Results(app);
  });
  app.querySelector('#t8players').onchange = e => { t8.players = e.target.value; renderT8Results(app); };
  app.querySelectorAll('.t8radio').forEach(r => r.onchange = () => { t8.mode = r.value; t8.q = ''; vDecks(app); });
  ['ev','pl'].forEach(m => {
    const inp = app.querySelector('#t8q-'+m), go = app.querySelector('#t8go-'+m);
    if(!inp || !go) return;
    const doQ = () => { t8.q = inp.value.trim(); renderT8Results(app); };
    go.onclick = doQ;
    inp.onkeydown = e => { if(e.key==='Enter') doQ(); };
  });
  const evmin = app.querySelector('#evmin'), evmax = app.querySelector('#evmax');
  const labs = () => {
    app.querySelector('#evlabmin').textContent = frDate(isoOf(+evmin.value));
    app.querySelector('#evlabmax').textContent = frDate(isoOf(+evmax.value));
    const f = app.querySelector('#evfill'), mn = +evmin.min, mx = +evmax.max;
    f.style.left  = ((+evmin.value - mn) / (mx - mn) * 100) + '%';
    f.style.right = (100 - (+evmax.value - mn) / (mx - mn) * 100) + '%';
  };
  const onrange = () => {
    evmin.max = evmax.value; evmax.min = evmin.value;
    labs();
    clearTimeout(t8._rt);
    t8._rt = setTimeout(() => { t8.dateFrom = +evmin.value; t8.dateTo = +evmax.value; renderT8Results(app); }, 250);
  };
  evmin.oninput = onrange; evmax.oninput = onrange;
  labs();
  renderT8Results(app);
}

function renderT8Results(app){
  if(t8.mode==='pl') return renderT8Player(app);
  const kpi = app.querySelector('#t8kpi'), arch = app.querySelector('#t8arch'), box = app.querySelector('#t8results');
  if(!box) return;
  const evs = t8sorted(t8filtered());
  let totDecks = 0;
  for(const e of evs) totDecks += e.decks.length;
  kpi.innerHTML = `<div class="big">${evs.length} tournoi${evs.length>1?'s trouvés':' trouvé'}</div><div class="big2">${totDecks} decks</div>`;
  const am = new Map();
  for(const e of evs) for(const i of e.decks){
    const a = DECKS[i][4] || '(sans archétype)';
    am.set(a, (am.get(a)||0)+1);
  }
  const al = [...am.entries()].sort((x,y) => y[1]-x[1] || norm(x[0]).localeCompare(norm(y[0])));
  arch.innerHTML = al.length
    ? al.map(([a,n]) => `<div class="arch-item" data-arch="${esc(a)}"><span>${esc(a)}</span><span class="hint">${n} deck${n>1?'s':''} · ${totDecks ? Math.round(n/totDecks*100) : 0}%</span></div>`).join('')
    : '<p class="hint">Aucun deck dans les tournois filtrés.</p>';
  const th = c => `<th data-col="${c}" class="c-${c}">${T8_COLS.find(x => x[0]===c)[1]}${t8.sortCol===c ? `<span class="arr">${t8.sortDir==='desc'?'▼':'▲'}</span>` : ''}</th>`;
  const rows = evs.map(e => {
    const open = t8.open.has(e.eid);
    return `<tr class="evrow${open?' open':''}" data-eid="${e.eid}"><td class="c-date">${frDate(e.date)}</td><td class="c-fmt"><span class="fmt">${esc(fmtShort(e.fmt))}</span></td><td class="c-name">${esc(e.name||'')}</td><td class="c-place" title="${esc(e.place||'')}">${esc(e.place||'—')}</td><td class="c-players">${e.players==null?'—':e.players}</td><td class="c-chev"><span class="chev">▸</span></td></tr>` +
      `<tr class="evdetail" data-eid="${e.eid}"${open?'':' style="display:none"'}><td colspan="6">${open ? t8deckSubHTML(e) : ''}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="evscroll"><table class="evtable"><colgroup>${T8_COLW.map(w => `<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${T8_COLS.map(([c]) => th(c)).join('')}<th class="c-chev"></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hint">Aucun tournoi ne correspond aux filtres.</td></tr>'}</tbody></table></div>`;
  box.querySelectorAll('th[data-col]').forEach(h => h.onclick = () => {
    const c = h.dataset.col;
    if(t8.sortCol===c) t8.sortDir = t8.sortDir==='desc' ? 'asc' : 'desc';
    else { t8.sortCol = c; t8.sortDir = c==='date' ? 'desc' : 'asc'; }
    renderT8Results(app);
  });
  const bindDetail = td => {
    td.querySelectorAll('tr.dkrow').forEach(r => r.onclick = () => showDeck(+r.dataset.i));
    td.querySelectorAll('tr.dkrow .arch').forEach(a => a.onclick = e => { e.stopPropagation(); /* action archétype : à définir avec Sylvain */ });
  };
  box.querySelectorAll('tr.evdetail').forEach(det => { if(det.firstElementChild.innerHTML) bindDetail(det.firstElementChild); });
  box.querySelectorAll('tr.evrow').forEach(r => r.onclick = () => {
    const eid = +r.dataset.eid, det = box.querySelector(`tr.evdetail[data-eid="${eid}"]`);
    const open = r.classList.toggle('open');
    if(open){
      t8.open.add(eid);
      if(det && !det.firstElementChild.innerHTML){
        det.firstElementChild.innerHTML = t8deckSubHTML(EVENTS.find(x => x.eid===eid));
        bindDetail(det.firstElementChild);
      }
    } else t8.open.delete(eid);
    if(det) det.style.display = open ? '' : 'none';
  });
}


function t8sortedDecks(idxs){
  const c = t8.sortCol, d = t8.sortDir==='desc' ? -1 : 1;
  const val = i => { const dk = DECKS[i];
    return c==='player' ? norm(dk[5]||'')
      : c==='date' ? (dk[8]||'')
      : c==='fmt' ? fmtShort(dk[1])
      : c==='evname' ? norm(dk[6]||'')
      : c==='deck' ? norm(dk[3]||'')
      : c==='rank' ? dk[2]
      : (dk[12]==null ? null : +dk[12]); };
  return [...idxs].sort((a,b) => {
    const va = val(a), vb = val(b);
    if(c==='players' && (va==null || vb==null)) return va==null ? 1 : -1;
    const r = c==='players' ? va-vb : (va<vb ? -1 : va>vb ? 1 : 0);
    return (r || (DECKS[b][8]||'').localeCompare(DECKS[a][8]||'')) * d;
  });
}

/* mode 'pl' : tableau des decks du joueur + archétypes groupés par format + KPI decks/tournois */
function renderT8Player(app){
  const kpi = app.querySelector('#t8kpi'), arch = app.querySelector('#t8arch'), box = app.querySelector('#t8results');
  if(!box) return;
  const idxs = t8sortedDecks(t8filtered());
  const evSet = new Set();
  for(const i of idxs) evSet.add(DECKS[i][9]);
  kpi.innerHTML = `<div class="big">${idxs.length} deck${idxs.length>1?'s trouvés':' trouvé'}</div><div class="big2">${evSet.size} tournoi${evSet.size>1?'s':''}</div>`;
  const byFmt = new Map();
  for(const i of idxs){
    const d = DECKS[i], f = fmtShort(d[1]), a = d[4] || '(sans archétype)';
    if(!byFmt.has(f)) byFmt.set(f, new Map());
    const m = byFmt.get(f);
    m.set(a, (m.get(a)||0)+1);
  }
  const fmts = [...byFmt.keys()].sort();
  let ahtml = '';
  for(const f of fmts){
    const m = byFmt.get(f);
    const items = [...m.entries()].sort((x,y) => y[1]-x[1] || norm(x[0]).localeCompare(norm(y[0])));
    ahtml += `<div class="arch-fmt">${esc(f)}</div>` + items.map(([a,n]) =>
      `<div class="arch-item" data-arch="${esc(a)}" data-fmt="${esc(f)}"><span>${esc(a)}</span><span class="hint">${n} deck${n>1?'s':''} · ${idxs.length ? Math.round(n/idxs.length*100) : 0}%</span></div>`).join('');
  }
  arch.innerHTML = ahtml || '<p class="hint">Aucun deck ne correspond aux filtres.</p>';
  const th = c => `<th data-col="${c}" class="c-${c}">${T8_PCOLS.find(x => x[0]===c)[1]}${t8.sortCol===c ? `<span class="arr">${t8.sortDir==='desc'?'▼':'▲'}</span>` : ''}</th>`;
  const rows = idxs.map(i => {
    const d = DECKS[i];
    return `<tr class="dkrow2" data-i="${i}"><td class="c-player">${esc(d[5]||'')}</td><td class="c-date">${frDate(d[8])}</td><td class="c-fmt"><span class="fmt">${esc(fmtShort(d[1]))}</span></td><td class="c-evname">${esc(d[6]||'')}</td><td class="c-deck">${esc(d[3]||'')}</td><td class="c-rank">#${d[2]}</td><td class="c-players">${d[12]==null?'—':d[12]}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="evscroll"><table class="evtable"><colgroup>${T8_PCOLW.map(w => `<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${T8_PCOLS.map(([c]) => th(c)).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="7" class="hint">Aucun deck ne correspond aux filtres.</td></tr>'}</tbody></table></div>`;
  box.querySelectorAll('th[data-col]').forEach(h => h.onclick = () => {
    const c = h.dataset.col;
    if(t8.sortCol===c) t8.sortDir = t8.sortDir==='desc' ? 'asc' : 'desc';
    else { t8.sortCol = c; t8.sortDir = c==='date' ? 'desc' : 'asc'; }
    renderT8Results(app);
  });
  box.querySelectorAll('tr.dkrow2').forEach(r => r.onclick = () => openDeckPage(+r.dataset.i));
}

function openDeckPage(i){
  // TODO : page dédiée "deck joué par un joueur" (à coder plus tard).
  // En attendant, le clic ouvre le visualiseur de deck existant.
  showDeck(i);
}
R.openDeckPage = openDeckPage;   // hook exposé pour la future page

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
  app.querySelectorAll('.cinfo').forEach(td => td.onclick = () => R.showCardInfo(td.textContent));
}

R.views.decks = vDecks;   // le burger rouvre la liste des tournois (état des filtres conservé)
R.views.playable = vPlayable;
R.views.archetypes = a => { ar.arch = null; vArchetypes(a); };
R.showDeck = showDeck;

export { vDecks, analyzeList, gatherMeta, metaOf, typeBucket, groupCards, manaCurve, costColors, landProduces, deckLegalities, deckViewHTML, drawDeckCharts, bindDeckView, showDeck, hydrateImage, deckTagDistribution, vPlayable, runPlayable, vArchetypes, vArchetypeAnalysis, dvGroup, TYPE_ORDER, LEGAL_FMTS, pf, ar, archSide };
