import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks, setMyDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { analyzeList, gatherMeta, deckViewHTML, bindDeckView, drawDeckCharts, hydrateImage, dvTab } from './decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

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
    setMyDecks(myDecks.filter(d => d.id !== el.dataset.del)); saveDecks(); vMyDecks(app);
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
    body.querySelectorAll('[data-ci]').forEach(el => el.onclick = () => R.showCardInfo(el.dataset.ci));
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

R.views.mydecks = vMyDecks; R.openMyDeck = openMyDeck;

export { vMyDecks, logDeck, openMyDeck, curMyDeck };
