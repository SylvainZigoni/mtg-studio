import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';

/* ============================================================
   VUE TOURNOIS & DECKS
   ============================================================ */
let deckFmt = 'MO', deckQuery = '', dqTimer = null, deckEvent = null;
function vDecks(app){
  if(deckEvent !== null) return vEventDetail(app);
  const evs = EVENTS.filter(e => e.fmt===deckFmt && (!deckQuery || (e.name+' '+e.place).toLowerCase().includes(deckQuery.toLowerCase())));
  app.innerHTML = `
  <div class="panel">
    <div class="row">
      <select id="dfmt">${Object.entries(FMT_NAMES).map(([k,v])=>`<option value="${k}" ${k===deckFmt?'selected':''}>${v}</option>`).join('')}</select>
      <input type="text" id="dq" placeholder="Rechercher un tournoi…" value="${esc(deckQuery)}">
      <span class="hint">${evs.length} tournois en 2026</span>
    </div>
  </div>
  <div class="deck-list">${evs.slice(0,100).map(e => `
    <div class="deck" data-e="${e.eid}">
      <h3>${esc(e.name)}</h3>
      <div class="meta">
        <span class="fmt">${fmtName(e.fmt)}</span> ${esc(e.place||'')}<br>${esc(e.date||'')}
      </div>
      <div class="hint">${e.decks.length} decks référencés</div>
    </div>`).join('')}</div>
  ${evs.length>100?'<p class="hint" style="margin-top:10px">100 premiers résultats.</p>':''}`;
  app.querySelector('#dfmt').onchange = e => { deckFmt = e.target.value; vDecks(app); };
  app.querySelector('#dq').oninput = e => { deckQuery = e.target.value; clearTimeout(dqTimer); dqTimer = setTimeout(()=>vDecks(app), 300); };
  app.querySelectorAll('[data-e]').forEach(el => el.onclick = () => { deckEvent = +el.dataset.e; vDecks(app); });
}
function vEventDetail(app){
  const ev = EVENTS.find(e => e.eid === deckEvent);
  app.innerHTML = `
  <div class="panel">
    <button class="btn ghost" id="back">← Tournois ${fmtName(ev.fmt)}</button>
    <h3 style="margin-top:10px">${esc(ev.name)}</h3>
    <p class="hint">${esc(ev.place||'')} · ${esc(ev.date||'')} · ${ev.decks.length} decks référencés</p>
  </div>
  <div class="deck-list">${ev.decks.map(i => {
    const d = DECKS[i], a = analyze(i, false), pct = Math.round(a.pct*100);
    return `<div class="deck" data-i="${i}">
      <h3>#${d[2]} ${esc(d[3])}</h3>
      <div class="meta">${esc(d[4]||'')} · ${esc(d[5]||'')}</div>
      <div class="bar"><div style="width:${pct}%;background:${pct>=95?'var(--ok)':pct>=70?'var(--warn)':'var(--bad)'}"></div></div>
      <div class="row" style="justify-content:space-between"><b style="color:${pct>=95?'var(--ok)':'var(--accent)'}">${pct}% possédé</b>
      <span class="missing">${a.missingQty} manquantes</span></div>
    </div>`; }).join('')}</div>`;
  app.querySelector('#back').onclick = () => { deckEvent=null; vDecks(app); };
  app.querySelectorAll('[data-i]').forEach(el => el.onclick = () => showDeck(+el.dataset.i));
}

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

R.views.decks = vDecks; R.views.playable = vPlayable; R.views.archetypes = vArchetypes; R.showDeck = showDeck;

export { vDecks, vEventDetail, analyzeList, gatherMeta, metaOf, typeBucket, groupCards, manaCurve, costColors, landProduces, deckLegalities, deckViewHTML, drawDeckCharts, bindDeckView, showDeck, hydrateImage, deckTagDistribution, vPlayable, runPlayable, vArchetypes, vArchetypeAnalysis, deckFmt, dvGroup, TYPE_ORDER, LEGAL_FMTS, pf, ar, archSide };
