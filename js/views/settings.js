import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';
import { THEMES, applyTheme, currentTheme } from '../core/themes.js';

/* ============================================================
   VUE PARAMÈTRES (Cardmarket)
   ============================================================ */
function vSettings(app){
  app.innerHTML = `
    <div class="panel"><h3>Thème de l'interface</h3>
  <p class="hint">Choisissez l'ambiance visuelle de l'application : le thème est appliqué immédiatement et mémorisé pour vos prochaines visites.</p>
  <div class="row" style="margin-top:8px">
    <label style="min-width:280px;flex:1;max-width:420px">Thème
      <select id="s-theme" style="width:100%"></select>
    </label>
    <span class="row" id="s-theme-swatches" style="gap:6px"></span>
  </div>
  </div>
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
  /* --- Sélecteur de thème --- */
  const sel = app.querySelector('#s-theme');
  THEMES.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o); });
  sel.value = currentTheme();
  const paintSwatches = () => {
    const sw = app.querySelector('#s-theme-swatches'); sw.innerHTML = '';
    THEMES.forEach(t => {
      const d = document.createElement('span');
      d.title = t.name;
      d.style.cssText = 'width:18px;height:18px;border-radius:50%;background:' + t.swatch + ';border:2px solid ' + (t.id === currentTheme() ? 'var(--accent)' : 'var(--border)') + ';cursor:pointer';
      d.onclick = () => { sel.value = t.id; sel.onchange(); };
      sw.appendChild(d);
    });
  };
  sel.onchange = () => { applyTheme(sel.value); paintSwatches(); st('Thème appliqué ✔'); };
  paintSwatches();
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

R.views.settings = vSettings;

export { vSettings, setVacation };
