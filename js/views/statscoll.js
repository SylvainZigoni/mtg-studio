import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

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
  app.querySelectorAll('[data-set]').forEach(el => el.onclick = () => { R.gotoSets(el.dataset.set); });
  app.querySelectorAll('[data-nm]').forEach(el => el.onclick = () => R.showCardInfo(el.dataset.nm));
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
    box.querySelectorAll('[data-nm]').forEach(el => el.onclick = () => R.showCardInfo(el.dataset.nm));
  };
  app.querySelector('#sc-fmt').onchange = e => { scF.fmt = e.target.value; runOwned(); };
  app.querySelector('#sc-from').onchange = e => { scF.from = e.target.value; runOwned(); };
  app.querySelector('#sc-to').onchange = e => { scF.to = e.target.value; runOwned(); };
  app.querySelector('#sc-clear').onclick = () => { scF.from = scF.to = ''; vStatsColl(app); };
  runOwned();
}

R.views.statscoll = vStatsColl;

export { vStatsColl, scF };
