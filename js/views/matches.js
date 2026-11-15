import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

/* ============================================================
   VUE MATCHS (saisie — points 7 & 11)
   ============================================================ */
// Brouillon du formulaire de match : conservé entre les re-rendus pour que
// rien ne s'efface (ajout/suppression de manche, changement de format, type,
// toss...). null = formulaire jamais ouvert de la session.
let matchDraft = null;
let mullRows = [{won:false, mull:0}, {won:false, mull:0}];
let editingId = null;   // id du match en cours de modification (null = nouveau)

function defaultMatchDraft(){
  return {date: new Date().toISOString().slice(0,10), type:'amical',
          format: store.get('mtg_last_fmt', null) || Object.keys(FMT_NAMES)[0] || '', toss:'1',
          myDeck:'', myArch:'', oppName:'', oppArch:''};
}
// Copie l'état actuel du formulaire vers le brouillon (appelé à chaque saisie)
function syncMatchDraft(app){
  matchDraft = {
    date:    app.querySelector('#m-date')?.value    ?? matchDraft?.date,
    type:    app.querySelector('#m-type')?.value    ?? matchDraft?.type,
    format:  app.querySelector('#m-fmt')?.value     ?? matchDraft?.format,
    toss:    app.querySelector('#m-toss')?.value    ?? matchDraft?.toss,
    myDeck:  app.querySelector('#m-mydeck')?.value  ?? matchDraft?.myDeck,
    myArch:  app.querySelector('#m-myarch')?.value  ?? matchDraft?.myArch,
    oppName: app.querySelector('#m-oppname')?.value ?? matchDraft?.oppName,
    oppArch: app.querySelector('#m-opparch')?.value ?? matchDraft?.oppArch,
  };
  const rows = [...app.querySelectorAll('#mullrows .grow')];
  if (rows.length) mullRows = rows.map(r => ({
    won: r.querySelector('[data-g="won"]').checked,
    mull: +r.querySelector('[data-g="mull"]').value || 0,
  }));
}
function resetMatchForm(){
  matchDraft = null; editingId = null;
  mullRows = [{won:false, mull:0}, {won:false, mull:0}];
}
function vMatches(app){
  if (!matchDraft) matchDraft = defaultMatchDraft();
  const d = matchDraft;
  // suggestions d'autocomplétion : decks perso + historique des matchs
  const deckOpts  = [...new Set([...myDecks.map(x=>x.name), ...matches.map(m=>m.myDeck)].filter(Boolean))].sort();
  const archOpts  = [...new Set(matches.flatMap(m=>[m.myArch, m.oppArch]).filter(Boolean))].sort();
  const oppOpts   = [...new Set(matches.map(m=>m.oppName).filter(Boolean))].sort();
  const oppDkOpts = [...new Set(matches.map(m=>m.oppArch).filter(Boolean))].sort();
  app.innerHTML = `
  <div class="panel" id="matchform">
    <h3 style="margin-bottom:12px">${editingId ? 'Modifier le match' : 'Nouveau match'}</h3>
    <div class="row">
      <input type="date" id="m-date" value="${esc(d.date)}">
      <select id="m-type">${['amical','tournoi'].map(t=>`<option value="${t}" ${d.type===t?'selected':''}>${t==='amical'?'Match amical':'Tournoi'}</option>`).join('')}</select>
      <select id="m-fmt">${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}" ${d.format===k?'selected':''}>${v}</option>`).join('')}</select>
      <span class="hint">Toss gagné :</span>
      <select id="m-toss"><option value="1" ${d.toss==='1'?'selected':''}>Oui</option><option value="0" ${d.toss==='0'?'selected':''}>Non</option></select>
    </div>
    <div class="row" style="margin-top:10px">
      <input type="text" id="m-mydeck" list="decklist" value="${esc(d.myDeck)}" placeholder="Mon deck (nom libre)" style="min-width:220px">
      <input type="text" id="m-myarch" list="archlist" value="${esc(d.myArch)}" placeholder="Mon archétype" style="min-width:160px">
      <input type="text" id="m-oppname" list="opplist" value="${esc(d.oppName)}" placeholder="Adversaire (ami)" style="min-width:160px">
      <input type="text" id="m-opparch" list="oppdecklist" value="${esc(d.oppArch)}" placeholder="Deck adverse" style="min-width:160px">
      <datalist id="decklist">${deckOpts.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="archlist">${archOpts.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="opplist">${oppOpts.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="oppdecklist">${oppDkOpts.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
    </div>
    <h4 class="sub">Manches du match (résultat + mulligans)</h4>
    <div id="mullrows">${mullRows.map((g,i)=>gameRow(i,g)).join('')}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost" id="addgame">+ Manche</button>
      <button class="btn" id="savematch">${editingId ? 'Enregistrer les modifications' : 'Enregistrer le match'}</button>
      ${editingId ? '<button class="btn ghost" id="cancel-edit">Annuler</button>' : ''}
    </div>
  </div>
  <div class="panel">
    <h3 style="margin-bottom:10px">Historique (${matches.length} matchs)</h3>
    ${matches.length ? matches.slice().reverse().map(m => `
      <div class="matchline" data-id="${m.id}">
        <span class="badge ${m.result==='V'?'b-ok':m.result==='N'?'b-null':'b-warn'}">${m.result==='V'?'VICTOIRE':m.result==='N'?'MATCH NUL':'DÉFAITE'} ${m.score}</span>
        <span class="fmt">${fmtName(m.format)}</span>
        <b>${esc(m.myDeck||m.myArch)}</b> vs <b>${esc(m.oppArch||'?')}</b>
        <span class="hint">${esc(m.oppName||'adversaire')}</span>
        <span class="hint">${esc(m.date)} · ${m.type==='tournoi'?'tournoi':'amical'} · toss ${m.toss==1?'gagné':'perdu'} · mulligans [${(m.mull||[]).join(', ')}]</span>
        <button class="btn ghost" data-a="edit" title="Modifier ce match" style="padding:4px 10px">✎</button>
        <button class="btn ghost" data-a="del" title="Supprimer ce match" style="margin-left:auto;padding:4px 10px">✕</button>
      </div>`).join('') : '<p class="hint">Aucun match enregistré.</p>'}
  </div>`;
  // le brouillon suit chaque saisie : aucun re-rendu ne fait perdre les champs
  const form = app.querySelector('#matchform');
  form.addEventListener('input',  () => syncMatchDraft(app));
  form.addEventListener('change', () => syncMatchDraft(app));
  app.querySelector('#addgame').onclick = () => { syncMatchDraft(app); mullRows.push({won:false, mull:0}); vMatches(app); };
  app.querySelectorAll('[data-a="rmg"]').forEach(b => b.onclick = () => {
    syncMatchDraft(app); mullRows.splice(+b.dataset.i, 1); vMatches(app);
  });
  app.querySelectorAll('[data-a="edit"]').forEach(b => b.onclick = () => {
    const m = matches.find(x => x.id === +b.closest('[data-id]').dataset.id);
    if (!m) return;
    editingId = m.id;
    matchDraft = {date:m.date||'', type:m.type||'amical', format:m.format||'', toss:String(m.toss ?? 1),
                  myDeck:m.myDeck||'', myArch:m.myArch||'', oppName:m.oppName||'', oppArch:m.oppArch||''};
    const gs = (m.games && m.games.length) ? m.games : (m.mull||[]).map(x=>({won:false, mull:x}));
    mullRows = gs.map(g=>({won:!!g.won, mull:+g.mull||0}));
    if (!mullRows.length) mullRows = [{won:false, mull:0}, {won:false, mull:0}];
    vMatches(app);
    window.scrollTo({top:0, behavior:'smooth'});
  });
  app.querySelectorAll('[data-a="del"]').forEach(b => b.onclick = () => {
    setMatches(matches.filter(m => m.id !== +b.closest('[data-id]').dataset.id));
    saveMatches(); vMatches(app);
  });
  const cancelBtn = app.querySelector('#cancel-edit');
  if (cancelBtn) cancelBtn.onclick = () => { resetMatchForm(); vMatches(app); };
  app.querySelector('#savematch').onclick = () => {
    syncMatchDraft(app);
    const games = mullRows.map(g => ({won:!!g.won, mull:+g.mull||0}));
    if(!games.length){ alert('Ajoutez au moins une manche.'); return; }
    const won = games.filter(g=>g.won).length, lost = games.length - won;
    const rec = {
      id: editingId || Date.now(),
      date: matchDraft.date,
      type: matchDraft.type,
      format: matchDraft.format,
      myDeck: matchDraft.myDeck.trim(),
      myArch: matchDraft.myArch.trim(),
      oppName: matchDraft.oppName.trim(),
      oppArch: matchDraft.oppArch.trim(),
      toss: +matchDraft.toss,
      result: won > lost ? 'V' : (won < lost ? 'D' : 'N'),
      score: `${won}-${lost}`,
      mull: games.map(g=>g.mull),
      games,
    };
    if (editingId){
      const i = matches.findIndex(m => m.id === editingId);
      if (i >= 0) matches[i] = rec; else matches.push(rec);
    } else {
      matches.push(rec);
    }
    store.set('mtg_last_fmt', matchDraft.format);   // le prochain match reprend ce format
    saveMatches(); resetMatchForm(); vMatches(app);
  };
}
function gameRow(i, g){
  return `<div class="row grow" style="margin-top:6px">
    <span class="hint">Manche ${i+1} :</span>
    <label class="hint"><input type="checkbox" data-g="won" ${g.won?'checked':''}> gagnée</label>
    <label class="hint">mulligans <input type="number" min="0" max="7" value="${g.mull}" data-g="mull" style="width:64px"></label>
    <button class="btn ghost" data-a="rmg" data-i="${i}" style="padding:2px 8px">✕</button>
  </div>`;
}

R.views.matches = vMatches;

export { defaultMatchDraft, syncMatchDraft, resetMatchForm, vMatches, gameRow, matchDraft, mullRows, editingId };
