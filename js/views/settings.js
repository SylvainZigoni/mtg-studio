import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';
import { loadLastPrices, loadPriceDays, mountPriceTimeline, refreshPriceTimelines } from '../core/pricedb.js';
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
  </div>
  <div class="panel"><h3>Mise à jour MTGTop8 (scraping)</h3>
  <p class="hint">Lance <code>scraper.py phase1</code> (nouveaux tournois 2026) puis <code>crawl.py</code> (decks + cartes) en arrière-plan ; résultat dans <code>mtgtop8.sqlite</code>, journal dans <code>scrape.log</code> — l'appli lit les decks directement dans cette base via <code>GET /api/decks</code>. Relancer est sans danger : tournois et decks déjà présents ne sont pas doublés (clés primaires + <code>INSERT OR IGNORE</code>).</p>
  <div class="row" style="margin-top:10px;flex-wrap:wrap">
    <label>Durée max du crawl (s)<input id="s-scrape-secs" type="number" value="3600" min="60" step="60" style="width:110px"></label>
    <button class="btn" id="s-scrape">🕷️ Lancer le scraping</button>
    <span id="s-scrape-status" class="hint"></span>
  </div>
  <p class="hint" id="s-scrape-info" style="margin-top:8px"></p>
  <div id="s-scrape-grid"></div>
  </div>
  <div class="panel"><h3>Mise à jour des prix (prices.db ← MTGJSON)</h3>
  <p class="hint">Les prix affichés dans l'app viennent <b>uniquement</b> de <code>prices.db</code> (historique Cardmarket lu dans MTGJSON par <code>price_seed.py</code>). Mise à jour auto au chargement de l'app (prix du jour) et hebdo (fusion). Boutons pour forcer : journal dans <code>price_seed.log</code>.</p>
  <div class="row" style="margin-top:10px;flex-wrap:wrap">
    <button class="btn" id="p-today">💶 Prix du jour (today)</button>
    <button class="btn ghost" id="p-weekly">🗓️ Fusion hebdomadaire (weekly)</button>
    <span id="p-status" class="hint"></span>
  </div>
  <p class="hint" id="p-info" style="margin-top:8px"></p>
  <div class="row" style="margin-top:6px"><div id="priceline" style="flex:1"></div></div>
  </div>
`;
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
  /* --- Mise à jour MTGTop8 (scraping) --- */
  const scrapeInfo = app.querySelector('#s-scrape-info');
  const scrapeSt = app.querySelector('#s-scrape-status');
  const say = m => { scrapeSt.textContent = m; };
  let scrapeTimer = null;
  const refreshScrape = async () => {
    try {
      const r = await fetch('/api/scrape/status');
      const j = await r.json();
      if (!j.ok) { say('Statut indisponible : ' + (j.error || r.status)); return false; }
      say(j.running ? `en cours — ${j.phase || ''}` : (j.ended ? `dernier run : ${j.phase} (${j.ended})` : 'jamais lancé'));
      if (j.stats) {
        const s = j.stats;
        const per = s.formats.length ? ' — ' + s.formats.map(f => `${f.name} ${f.decksFetched}/${f.decks}`).join(', ') : '';
        scrapeInfo.textContent = `Base mtgtop8.sqlite : ${s.eventsFetched}/${s.events} tournois · ${s.decksFetched}/${s.decks} decks · ${s.cards} lignes de cartes${per}`;
      } else {
        scrapeInfo.textContent = 'Base de scraping pas encore créée (elle le sera au premier lancement).';
      }
      if (j.error) scrapeInfo.textContent += ' — erreur : ' + j.error;
      return !!j.running;
    } catch (e) { say('Serveur injoignable.'); return false; }
  };
  const gridEl = app.querySelector('#s-scrape-grid');
  const loadGrid = async () => {
    const cy = new Date().getFullYear();
    const years = []; for (let y = cy; y >= cy - 4; y--) years.push(y);  // en 2027, la colonne 2027 apparait toute seule
    let grid = {};
    try { const r = await fetch('/api/scrape/grid'); const j = await r.json(); if (j.ok) grid = j.grid || {}; } catch (e) {}
    const secs = () => Math.max(60, Math.floor(Number(app.querySelector('#s-scrape-secs').value) || 3600));
    let html = `<table class="scrape-grid"><thead><tr><th>Format / année</th>${years.map(y => `<th>${y}</th>`).join('')}</tr></thead><tbody>`;
    for (const [code, name] of Object.entries(FMT_NAMES)) {
      html += `<tr><td>${esc(name)}</td>`;
      for (const y of years) {
        const cell = (grid[code] || {})[String(y)] || { total: 0, fetched: 0 };
        html += cell.fetched > 0
          ? `<td><button class="grid-ok" data-fmt="${code}" data-year="${y}" title="${cell.fetched}/${cell.total} decks scrapés pour ${esc(name)} ${y} — cliquer relance en mode recheck (complete sans doublon)">${cell.fetched}</button></td>`
          : `<td><button class="grid-todo" data-fmt="${code}" data-year="${y}" title="Aucun deck scrapé pour ${esc(name)} ${y}">Lancer le scraping</button></td>`;
      }
      html += '</tr>';
    }
    gridEl.innerHTML = html + '</tbody></table>';
    gridEl.querySelectorAll('button').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await fetch('/api/scrape/one', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year: +b.dataset.year, format: b.dataset.fmt, seconds: secs(), recheck: true }) });
          const j = await r.json();
          say(j.ok ? `Scraping ${b.dataset.fmt} ${b.dataset.year} lancé ✔` : `Erreur : ${j.error || r.status}`);
        } catch (e) { say('Serveur injoignable.'); }
        if (scrapeTimer) clearTimeout(scrapeTimer);
        pollScrape();
      };
    });
  };
  const pollScrape = async () => {
    scrapeTimer = null;
    const running = await refreshScrape();
    await loadGrid();
    if (running) scrapeTimer = setTimeout(pollScrape, 5000);
  };
  app.querySelector('#s-scrape').onclick = async () => {
    const secs = Math.max(60, Math.floor(Number(app.querySelector('#s-scrape-secs').value) || 3600));
    say('Lancement…');
    try {
      const r = await fetch('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seconds: secs }) });
      const j = await r.json();
      say(j.ok ? `Scraping lancé (crawl ${secs}s max) ✔` : `Erreur : ${j.error || r.status}`);
    } catch (e) { say('Serveur injoignable.'); }
    if (scrapeTimer) clearTimeout(scrapeTimer);
    pollScrape();
  };
  pollScrape();
  /* --- Mise à jour des prix (prices.db via MTGJSON) --- */
  const pInfo = app.querySelector('#p-info');
  const pSt = app.querySelector('#p-status');
  const psay = m => { pSt.textContent = m; };
  let pTimer = null;
  const refreshPrices = async () => {
    try {
      const r = await fetch('/api/price/status');
      const j = await r.json();
      if (!j.ok) { psay('Statut indisponible : ' + (j.error || r.status)); return false; }
      psay(j.run ? `en cours — ${j.run}` : (j.todayDone ? `dernier point intégré : ${j.todayDone}` : 'jamais lancé'));
      pInfo.textContent = `prices.db : ${j.cards} cartes · ${j.series} séries · dernier point ${j.lastPoint || '—'} · today_done=${j.todayDone || '—'} · last_weekly=${j.lastWeekly || '—'} · fichier modifié le ${j.mtime}`;
      if (!j.run) { try { await loadLastPrices(); await loadPriceDays(); refreshPriceTimelines(); } catch(e){} }   // met à jour la map des prix affichés + la timeline
      return !!j.run;
    } catch (e) { psay('Serveur injoignable.'); return false; }
  };
  const pollPrices = async () => {
    pTimer = null;
    if (await refreshPrices()) pTimer = setTimeout(pollPrices, 3000);
  };
  const seedPrices = async mode => {
    psay(`Lancement de price_seed.py ${mode}…`);
    try {
      const r = await fetch('/api/price/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const j = await r.json();
      psay(j.ok ? `Mise à jour lancée (${mode}) ✔` : `Erreur : ${j.error || r.status}`);
    } catch (e) { psay('Serveur injoignable.'); }
    if (pTimer) clearTimeout(pTimer);
    pollPrices();
  };
  app.querySelector('#p-today').onclick = () => seedPrices('today');
  app.querySelector('#p-weekly').onclick = () => seedPrices('weekly');
  loadPriceDays().then(() => mountPriceTimeline(app.querySelector('#priceline')));
  pollPrices();
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
