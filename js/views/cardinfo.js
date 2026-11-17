import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { dbPrices, lastPoint } from '../core/pricedb.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

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
async function showCardInfo(name, box, ctx){
  box = box || $('#modal');
  if(!box.classList || !box.classList.contains('modal')) openModal('');
  if(box === $('#modal')) openModal('<p class="hint">Chargement…</p>');
  let c = null;
  // ctx = {set, cn} : affiche l'édition cliquée (ex. depuis la collection), pas la 1re impression
  if(ctx && ctx.set){
    try{
      const prints = await sfPrints(name);
      c = prints.find(p => p.set === ctx.set && (!ctx.cn || String(p.cn) === String(ctx.cn)))
        || prints.find(p => p.set === ctx.set) || null;
    }catch(e){}
  }
  if(!c){ try{ c = sfCache[norm(name)] || await sfCardByName(name); }catch(e){} }
  if(!c){ box.innerHTML = `<p class="hint">Carte introuvable sur Scryfall.</p>`; return; }
  const cp = c.id ? dbPrices(c.id) : null;   // prix prices.db du print affiché
  const cpN = cp ? (cp[0] ?? cp[1]) : null, cpF = cp ? cp[1] : null;
  const auto = deriveTags(c), custom = getCustomTags(name);
  const have = collection[norm(name)]?.qty || 0;
  const mine = entries.filter(e => e.norm === norm(name));
  box.innerHTML = `
    <button class="close" id="mclose">✕</button>
    <div class="row" style="align-items:flex-start;gap:20px">
      <img src="${c.image||''}" style="width:230px;border-radius:12px;background:#000">
      <div style="flex:1">
        <h2>${esc(c.name)}</h2>
        <p class="hint">${esc(c.type_line||'')} · mv ${c.mv} · ${esc(c.set_name||'')} (${esc((c.set||'').toUpperCase())}, ${esc(c.released_at||'')})${c.cn?` · n° ${esc(String(c.cn))}`:''}${c.lang?` · <b>${LANGS[c.lang]||c.lang}</b> (${c.lang.toUpperCase()})`:''}</p>
        <p style="margin:8px 0"><span class="price" style="color:var(--warn);font-weight:700">${cpN!=null?eur(cpN):'—'}</span>
        ${cpF!=null?`<span class="hint"> · foil ${eur(cpF)}</span>`:''} <span class="pill">(prix Cardmarket via prices.db${lastPoint()?` au ${lastPoint()}`:''})</span></p>
        <div class="qty-ctl"><button id="ci-dec">−</button><b id="ci-q">${have}</b><button id="ci-inc">+</button> <span class="hint">dans ma collection</span></div>
        ${mine.length ? `<p class="hint" style="margin-top:2px">Possédées : ${mine.map(e=>`${e.qty}× ${e.set?esc(e.set.toUpperCase()):'?'} · ${(e.lang||'en').toUpperCase()} · ${e.cond||'NM'}${e.foil?' · ✦':''}${e.signed?' · ✍':''}`).join(' ; ')}</p>` : ''}
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
    if(mine.length){ const e = mine[mine.length-1]; e.qty--; if(e.qty<=0) setEntries(entries.filter(x=>x.id!==e.id)); saveColl(); }
    modal.querySelector('#ci-q').textContent = collection[k]?.qty || 0;
  };
  modal.querySelector('#newtag').onkeydown = e => {
    if(e.key==='Enter' && e.target.value.trim()){ addCustomTag(name, e.target.value.trim()); showCardInfo(name, box); }
  };
  modal.querySelectorAll('[data-ct]').forEach(el => el.onclick = () => {
    removeCustomTag(name, el.dataset.ct); showCardInfo(name, box);
  });
  R.loadPriceChart(c, modal);
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
R.views.cardinfo = vCardInfo; R.showCardInfo = showCardInfo;

export { vCardInfo, vCardSearch, showCardInfo };
