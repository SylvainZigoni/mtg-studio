"use strict";
/* ============================================================
   MTG Studio — point d'entrée (js/main.js)
   Collection + Decks MTGTop8 2026 + Matchs + Stats + Tags
   Version 2026-11-16i (phase 2 : serveur Node zéro-dep dans server/, client en modules ES) */

import { $, esc, norm } from './core/util.js';
import { pullState, myDecks } from './core/model.js';
import { DECKS, loadData } from './core/decks.js';
import { sfAutocomplete } from './core/scryfall.js';
import { R, S } from './core/registry.js';
import './views/collection.js';
import './views/browse.js';
import './views/decks.js';
import './views/matches.js';
import './views/stats.js';
import './views/cardinfo.js';
import './views/mydecks.js';
import './views/market.js';
import './views/statscoll.js';
import './views/settings.js';

/* ---------------- garde-fou de démarrage ----------------
   Si index.html et js/main.js ne sont pas de la même version (ou si une erreur
   précoce survient), on l'affiche dans le loader au lieu de tourner dans le vide. */
window.addEventListener('error', e => {
  const m = document.getElementById('loadmsg');
  if(m) m.textContent = '⚠ Erreur au chargement : ' + (e.message || e.type) +
    ' — vérifiez que index.html et js/ sont de la même version (retéléchargez-les ensemble).';
  const p = document.getElementById('pickbtn');
  if(p) p.style.display = 'block';
});

/* ============================================================
   ROUTAGE (menu burger latéral)
   ============================================================ */
function setView(v){
  S.view = v;
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
/* la sidebar fixed démarre sous la topbar : on mesure la hauteur réelle de la topbar
   (elle wrap sur les fenêtres étroites) pour éviter tout chevauchement */
const syncTopbarH = () => {
  const tb = $('#topbar');
  if(tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
};
syncTopbarH();
window.addEventListener('resize', syncTopbarH);
if(window.ResizeObserver && $('#topbar')) new ResizeObserver(syncTopbarH).observe($('#topbar'));
function render(){
  const app = $('#app');
  document.querySelectorAll('.side-link').forEach(b => b.classList.toggle('active', !b.dataset.grp && b.dataset.view === S.view));
  (R.views[S.view] || R.views.collection)(app);
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
    if(it.dataset.kind === 'card'){
      // résultat carte -> onglet Recherche avancée, toutes les impressions de la carte
      R.gotoAdvSearch(it.dataset.id);
    }
    else if(it.dataset.kind === 't8deck') R.showDeck(+it.dataset.id);
    else if(it.dataset.kind === 'mydeck'){ R.setView('mydecks'); R.openMyDeck(it.dataset.id); }
  });
}
if(!$('#sidebar') || !$('#burger')){
  const m = document.getElementById('loadmsg');
  if(m) m.textContent = '⚠ index.html et js/main.js ne sont pas de la même version : retéléchargez les deux derniers fichiers publiés et remplacez-les ensemble.';
}


R.setView = setView;
window.__booted = true;

pullState().then(loadData);
// mise à jour quotidienne des prix (AllPricesToday → prices.db), 1×/jour côté serveur
fetch('/api/price/today', {method:'POST'}).catch(() => {});

