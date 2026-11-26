import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';

import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

/* ============================================================
   VUE STATS (point 9) + canvas charts maison
   ============================================================ */
let statScope = {tab:'global', fmt:'ALL', arch:'', friend:''};
function chartDonut(cv, vals, labels, colors){
  const ctx = cv.getContext('2d');
  const W = cv.width = 320, H = cv.height = 200;
  const total = vals.reduce((a,b)=>a+b,0) || 1;
  let ang = -Math.PI/2;
  vals.forEach((v,i) => {
    const a2 = ang + v/total*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(W/2,H/2); ctx.arc(W/2,H/2,70,ang,a2); ctx.closePath();
    ctx.fillStyle = colors[i]; ctx.fill();
    ang = a2;
  });
  ctx.fillStyle = '#232838'; ctx.beginPath(); ctx.arc(W/2,H/2,44,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#e8eaf0'; ctx.font='bold 22px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const pct = total ? Math.round(vals[0]/total*100) : 0;
  ctx.fillText(pct+'%', W/2, H/2-6);
  ctx.font='11px system-ui'; ctx.fillStyle='#9aa1b5'; ctx.fillText(labels[0], W/2, H/2+16);
}
function chartBars(cv, labels, vals, colors){
  const ctx = cv.getContext('2d');
  const W = cv.width = 560, H = cv.height = 220;
  const max = Math.max(...vals, 1);
  const bw = (W-40)/vals.length;
  ctx.font='11px system-ui'; ctx.fillStyle='#9aa1b5'; ctx.textAlign='center';
  vals.forEach((v,i) => {
    const h = v/max*(H-70);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(20+i*bw+bw*0.15, H-40-h, bw*0.7, h);
    ctx.fillStyle = '#9aa1b5';
    ctx.fillText(labels[i], 20+i*bw+bw/2, H-24);
    ctx.fillStyle='#e8eaf0';
    ctx.fillText(v, 20+i*bw+bw/2, H-46-h);
  });
}
function vStats(app){
  app.innerHTML = `
  <div class="panel">
    <div class="tabs">
      <button class="${statScope.tab==='global'?'active':''}" data-t="global">Global</button>
      <button class="${statScope.tab==='format'?'active':''}" data-t="format">Par format</button>
      <button class="${statScope.tab==='archetype'?'active':''}" data-t="archetype">Par archétype</button>
      <button class="${statScope.tab==='friends'?'active':''}" data-t="friends">Contre mes amis</button>
    </div>
    <div class="row" id="scopeselect"></div>
  </div>
  <div id="statbody"></div>`;
  app.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { statScope.tab = b.dataset.t; vStats(app); });
  const sel = app.querySelector('#scopeselect');
  const body = app.querySelector('#statbody');
  const scopeMatches = () => {
    let ms = matches;
    if(statScope.tab==='format' && statScope.fmt!=='ALL') ms = ms.filter(m=>m.format===statScope.fmt);
    if(statScope.tab==='archetype' && statScope.arch) ms = ms.filter(m=>m.myArch===statScope.arch);
    if(statScope.tab==='friends' && statScope.friend) ms = ms.filter(m=>m.oppName===statScope.friend);
    return ms;
  };
  if(statScope.tab==='format'){
    sel.innerHTML = `<select id="s-fmt"><option value="ALL">Tous</option>${Object.entries(FMT_NAMES).map(([k,v])=>`<option ${statScope.fmt===k?'selected':''} value="${k}">${v}</option>`).join('')}</select>`;
    sel.querySelector('#s-fmt').onchange = e => { statScope.fmt = e.target.value; vStats(app); };
  } else if(statScope.tab==='archetype'){
    const archs = [...new Set(matches.map(m=>m.myArch).filter(Boolean))].sort();
    sel.innerHTML = `<select id="s-arch"><option value="">— choisir —option>${archs.map(a=>`<option ${statScope.arch===a?'selected':''}>${esc(a)}</option>`).join('')}</select>`;
    sel.querySelector('#s-arch').onchange = e => { statScope.arch = e.target.value; vStats(app); };
  } else if(statScope.tab==='friends'){
    const friends = [...new Set(matches.map(m=>m.oppName).filter(Boolean))].sort();
    sel.innerHTML = `<select id="s-friend"><option value="">— choisir —option>${friends.map(f=>`<option ${statScope.friend===f?'selected':''}>${esc(f)}</option>`).join('')}</select>`;
    sel.querySelector('#s-friend').onchange = e => { statScope.friend = e.target.value; vStats(app); };
  }
  renderStatsBody(body, scopeMatches(), statScope.tab);
}
function renderStatsBody(body, ms, tab){
  const games = ms.flatMap(m => m.games || []);
  const wins = ms.filter(m=>m.result==='V').length;
  const draws = ms.filter(m=>m.result==='N').length;
  const losses = ms.length - wins - draws;
  const wr = ms.length ? Math.round(wins/ms.length*100) : 0;
  const totMull = games.reduce((a,g)=>a+(g.mull||0),0);
  const gamesNoMull = games.filter(g=>!g.mull), gamesMull = games.filter(g=>!!g.mull);
  const wrm = arr => { const w = arr.filter(g=>g.won).length; return arr.length ? Math.round(w/arr.length*100) : null; };
  const toss = ms.filter(m=>m.toss==1);
  body.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="v">${ms.length}</div><div class="l">matchs</div></div>
    <div class="kpi"><div class="v">${games.length}</div><div class="l">manches</div></div>
    <div class="kpi"><div class="v">${wr}%</div><div class="l">winrate match</div></div>
    <div class="kpi"><div class="v">${wins} / ${draws} / ${losses}</div><div class="l">V / N / D</div></div>
    <div class="kpi"><div class="v">${totMull}</div><div class="l">mulligans totaux</div></div>
  </div>
  ${ms.length<2 ? '<p class="hint">Enregistrez des matchs (onglet ⚔️) pour voir les statistiques se construire.</p>' : `
  <div class="statgrid">
    <div class="panel"><h4 class="sub">Winrate global</h4><canvas class="chart" id="donut"></canvas>
      <div class="hint" style="text-align:center"><span style="color:#3ecf6f">victoires</span> · <span style="color:#9aa1b5">nuls</span> · <span style="color:#ff5b6a">défaites</span></div></div>
    <div class="panel"><h4 class="sub">Impact des mulligans (winrate par manche)</h4>
      <table><tr><td>Manche sans mulligan</td><td><b>${wrm(gamesNoMull)??'—'}%</b> (${gamesNoMull.length})</td></tr>
      <tr><td>Manche avec mulligan(s)</td><td><b>${wrm(gamesMull)??'—'}%</b> (${gamesMull.length})</td></tr></table></div>
    <div class="panel"><h4 class="sub">Winrate selon le toss (matchs)</h4>
      <table><tr><td>Toss gagné</td><td><b>${toss.length?Math.round(toss.filter(m=>m.result==='V').length/toss.length*100):'—'}%</b> (${toss.length})</td></tr>
      <tr><td>Toss perdu</td><td><b>${(ms.length-toss.length)?Math.round(ms.filter(m=>m.toss!=1&&m.result==='V').length/(ms.length-toss.length)*100):'—'}%</b> (${ms.length-toss.length})</td></tr></table></div>
    <div class="panel"><h4 class="sub">Matchs par mois</h4><canvas class="chart" id="months"></canvas></div>
  </div>`}`;
  if(ms.length>=2){
    chartDonut($('#donut'), [wins, draws, losses], ['victoires','nuls','défaites'], ['#3ecf6f','#9aa1b5','#ff5b6a']);
    const byMonth = new Map();
    ms.forEach(m => { const k = (m.date||'').slice(0,7); byMonth.set(k, (byMonth.get(k)||0)+1); });
    const months = [...byMonth.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-12);
    chartBars($('#months'), months.map(x=>x[0].slice(2)), months.map(x=>x[1]), ['#5b8cff']);
  }
}

/* ============================================================
   VUE MATCHUPS — matrice par format (point 10)
   ============================================================ */
let muFmt = 'MO';
function vMatchups(app){
  const ms = matches.filter(m=>m.format===muFmt && m.myArch && m.oppArch);
  const agg = new Map(); // myArch|oppArch -> {w, n}
  ms.forEach(m => {
    const k = m.myArch + '|' + m.oppArch;
    const c = agg.get(k) || {w:0,n:0};
    c.n++; if(m.result==='V') c.w++;
    agg.set(k, c);
  });
  const myArchs = [...new Set(ms.map(m=>m.myArch))].sort();
  const oppArchs = [...new Set(ms.map(m=>m.oppArch))].sort();
  app.innerHTML = `
  <div class="panel">
    <div class="row">
      <select id="mu-fmt">${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}" ${k===muFmt?'selected':''}>${v}</option>`).join('')}</select>
      <span class="hint">${ms.length} matchs exploitables (il faut l'archétype des deux decks)</span>
    </div>
  </div>
  ${!ms.length ? '<div class="panel"><p class="hint">Pas encore de matchs complets sur ce format. Enregistrez vos matchs avec les archétypes remplis pour construire la matrice.</p></div>' : `
  <div class="panel"><div style="overflow:auto">
    <table class="matrix"><thead><tr><th>Mon archétype ↓ / Adversaire →</th>
      ${oppArchs.map(a=>`<th>${esc(a)}</th>`).join('')}</tr></thead><tbody>
    ${myArchs.map(ma => `<tr><th>${esc(ma)}</th>
      ${oppArchs.map(oa => {
        const c = agg.get(ma+'|'+oa);
        if(!c) return '<td class="heat" style="opacity:.25">·</td>';
        const wr = Math.round(c.w/c.n*100);
        const col = wr>=60 ? 'var(--ok)' : wr>=40 ? 'var(--warn)' : 'var(--bad)';
        return `<td class="heat"><b style="color:${col}">${wr}%</b><br><span class="pill">${c.n} m.</span></td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div></div>`}`;
  app.querySelector('#mu-fmt').onchange = e => { muFmt = e.target.value; vMatchups(app); };
}

R.views.stats = vStats; R.views.matchups = vMatchups;

export { chartDonut, chartBars, vStats, renderStatsBody, vMatchups, statScope, muFmt };
