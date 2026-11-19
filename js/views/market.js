import { esc, eur, norm, TYPES_LIST } from '../core/util.js';

import { store } from '../core/store.js';

import { sfSets, sfFetch, sfAutocomplete, sfArtists } from '../core/scryfall.js';

import { R } from '../core/registry.js';

import { loadPriceDays, mountPriceTimeline, priceDays, frOfDay } from '../core/pricedb.js';

/* ============================================================
   VUE MARCHÉ — évolutions de prix Cardmarket depuis prices.db
   Vue "cartes" : filtres (mêmes contrôles que la recherche avancée, sans jauge de prix)
   + jauge de dates à 2 curseurs directement sur la timeline (priceline) + récap
   (KPI/histo/indice) + table triable globalement (serveur, format liste collection).
   Vue "éditions" : à venir.
   ============================================================ */
let mk = Object.assign({
  mode: 'cartes', name: '', artist: '', colors: [], types: [], cmc: '', set: '',
  reserved: false, coll: false, foil: '', sort: 'pct', dir: 'desc', page: 1, limit: 25,
}, store.get('mtg_market', {}));
// migration : l'ancien filtre "type" (select unique) devient "types" (cases à cocher multiples)
if (!Array.isArray(mk.types)) mk.types = mk.type ? [mk.type] : [];
if (typeof mk.foil === 'boolean') mk.foil = mk.foil ? '1' : '';   // migration ancienne checkbox
delete mk.type;

const saveMk = () => store.set('mtg_market', mk);

const RARITY_FR = { common: 'Commune', uncommon: 'Peu commune', rare: 'Rare', mythic: 'Mythique', special: 'Spéciale', bonus: 'Bonus' };
let setNameMap = {};   // code d'extension -> nom (rempli depuis sfSets)
{ const cached = store.get('mtg_sf_sets'); if (Array.isArray(cached)) setNameMap = Object.fromEntries(cached.filter(x => x.code && x.name).map(x => [x.code.toLowerCase(), x.name])); }
const RAR_COLORS = { mythic: '#B94421', rare: '#CCB473', uncommon: '#CECECE', common: '#2B2728' };
const COLOR_CSS = { W: '#f4e8a6', U: '#6db3f2', B: '#b5a6f4', R: '#f26a6a', G: '#7ec97e' };

function rarityDotHTML(rarity){
  if (RAR_COLORS[rarity]) return `<span class="rarity-dot" style="background:${RAR_COLORS[rarity]};border-color:${RAR_COLORS[rarity]}" title="${esc(rarity)}"></span>`;
  return '';
}
const pctColor = v => v == null ? 'var(--muted)' : (v >= 0 ? 'var(--ok)' : 'var(--bad)');
const isoFr = iso => { const m = /^(\d+)-(\d+)-(\d+)/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || ''); };   // YYYY-MM-DD -> jj/mm/aaaa

/* les visuels viennent directement du résultat Scryfall renvoyé par le serveur (r.img / r.img_lg) */

/* barre de filtres : mêmes contrôles que la page "Recherche avancée" (browse.js),
   sans la jauge de prix — la période se règle avec les 2 curseurs de la priceline */
function filtersHTML(){
  return `
  <div class="filterbar">
    <div class="suggbox" style="flex:1;min-width:260px">
      <input type="text" id="mk-name" placeholder="Nom de carte (Foudre, bolt, Lightning Bolt…)" autocomplete="off" value="${esc(mk.name)}" style="width:100%">
      <div class="suggestions" id="mk-namesugg" style="display:none"></div>
    </div>
    <div class="suggbox" style="min-width:170px">
      <input type="text" id="mk-artist" placeholder="Artiste, ex: Rebecca Guay" value="${esc(mk.artist)}" autocomplete="off" style="width:100%">
      <div class="suggestions" id="mk-artistsugg" style="display:none"></div>
    </div>
    <span class="colorpick" id="mk-colors">
      ${['W','U','B','R','G'].map(c => `<span data-c="${c}" class="${mk.colors.includes(c)?'on':''}" style="color:${COLOR_CSS[c]}">${c}</span>`).join('')}
    </span>
    <div class="multisel" id="mk-types">
      <button class="btn ghost" style="padding:6px 10px">Type : ${mk.types.length||'tous'} ▾</button>
      <div class="opts">${TYPES_LIST.map(t => `<label><input type="checkbox" value="${t}" ${mk.types.includes(t)?'checked':''}> ${t}</label>`).join('')}</div>
    </div>
    <select id="mk-cmc">
      <option value="">Coût : tous</option>
      ${[0,1,2,3,4,5,6,'7+'].map(v => `<option value="${v}" ${String(mk.cmc)===String(v)?'selected':''}>CMC ${v}${v==='7+'?'+':''}</option>`).join('')}
    </select>
    <select id="mk-set"><option value="">Extension : toutes</option></select>
    <label class="row" style="gap:6px" title="Ne rechercher que les cartes de la Reserved List">
      <input type="checkbox" id="mk-reserved" ${mk.reserved?'checked':''}> Reserved List
    </label>
    <label class="row" style="gap:6px" title="Ne rechercher que les cartes de ma collection">
      <input type="checkbox" id="mk-coll" ${mk.coll?'checked':''}> Dans ma collection
    </label>
        <select id="mk-foil" title="Finition foil">
      <option value="0" ${mk.foil==='0'?'selected':''}>Non foil</option>
      <option value="1" ${mk.foil==='1'?'selected':''}>Foil seulement</option>
      <option value="" ${mk.foil===''?'selected':''}>Foil et non foil</option>
    </select>
    <button class="btn" id="mk-go">Rechercher</button>
    <button class="btn ghost" id="mk-reset">Réinitialiser</button>
  </div>`;
}

/* jauge de dates à 2 curseurs, superposée directement sur la timeline de #priceline
   (calée sur les jours historisés de prices.db) ; les 2 dates choisies s'affichent dessous */
function wireDateGauge(app){
  const D = priceDays(); if(!D) return;
  const days = D.days;                 // ordinals triés (jours avec >= 1 prix)
  const n = days.length;
  const box = app.querySelector('#priceline'); if(!box) return;
  const i0 = Math.max(0, days.indexOf(mk.from ?? D.from));
  const i1 = Math.min(n - 1, Math.max(i0, days.indexOf(mk.to ?? D.to)));
  const rmin = box.querySelector('#dtmin'), rmax = box.querySelector('#dtmax');
  const lmin = app.querySelector('#dtminlab'), lmax = app.querySelector('#dtmaxlab');
  rmin.max = rmax.max = String(n - 1);
  rmin.value = String(i0); rmax.value = String(i1);
  const paint = () => {
    const a = +rmin.value, b = +rmax.value;
    lmin.textContent = frOfDay(days[Math.min(a, b)]);
    lmax.textContent = frOfDay(days[Math.max(a, b)]);
    rmin.style.zIndex = a > b - 2 ? 5 : 3;
  };
  const apply = () => {
    let a = +rmin.value, b = +rmax.value;
    if(a > b){ const t = a; a = b; b = t; }
    mk.from = days[a]; mk.to = days[b]; mk.page = 1; saveMk(); paint();
    mkLoad(app);
  };
  rmin.addEventListener('input', paint);
  rmax.addEventListener('input', paint);
  rmin.addEventListener('change', apply);
  rmax.addEventListener('change', apply);
  paint();
}

/* ---------- petits graphiques (histogramme, indice, sparkline) ---------- */
function setupCv(cv, h){
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth || 400;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: h };
}
function drawHist(cv, hist){
  const { ctx, w, h } = setupCv(cv, 110);
  ctx.clearRect(0, 0, w, h);
  if(!hist.length) return;
  const maxN = Math.max(...hist.map(b => b.n), 1);
  const bw = w / hist.length;
  const zeroX = hist[0].lo < 0 && hist[hist.length-1].hi > 0 ? w * (-hist[0].lo) / (hist[hist.length-1].hi - hist[0].lo) : null;
  hist.forEach((b, i) => {
    const bh = (b.n / maxN) * (h - 24);
    ctx.fillStyle = (b.lo + b.hi) / 2 >= 0 ? 'var(--ok)' : 'var(--bad)';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i * bw + 1, h - 14 - bh, Math.max(1, bw - 2), bh);
  });
  ctx.globalAlpha = 1;
  if(zeroX != null){ ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.moveTo(zeroX, 4); ctx.lineTo(zeroX, h - 14); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText((hist[0].lo*100).toFixed(0) + '%', 2, h - 2);
  ctx.textAlign = 'right';
  ctx.fillText('+' + (hist[hist.length-1].hi*100).toFixed(0) + '%', w - 2, h - 2);
}

function drawIndex(cv, index){
  const H = 110;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth || 400;
  cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const paint = hov => {
    ctx.clearRect(0, 0, w, H);
    if(!index.length) return;
    const vals = index.map(p => p[1]);
    const lo = Math.min(...vals, 100), hi = Math.max(...vals, 100);
    const span = Math.max(1e-9, hi - lo);
    const X = i => 4 + (w - 8) * i / (index.length - 1 || 1);
    const Y = v => H - 16 - (H - 24) * (v - lo) / span;
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, Y(100)); ctx.lineTo(w, Y(100)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'var(--accent)'; ctx.lineWidth = 2; ctx.beginPath();
    index.forEach((p, i) => { const x = X(i), y = Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(index[0][0], 4, 10);
    ctx.textAlign = 'right'; ctx.fillText(index[index.length-1][0] + ' · ' + index[index.length-1][1], w - 4, 10);
    if(hov != null){
      const p = index[Math.max(0, Math.min(index.length - 1, hov))];
      const x = X(hov), y = Y(p[1]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      const label = `${p[0]} · ${p[1]}`;
      ctx.font = 'bold 11px sans-serif';
      const tw = ctx.measureText(label).width + 10;
      const bx = Math.min(Math.max(x - tw / 2, 2), w - tw - 2);
      ctx.fillStyle = 'rgba(20,22,30,.92)'; ctx.fillRect(bx, 14, tw, 16);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.strokeRect(bx + 0.5, 14.5, tw - 1, 15);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(label, bx + 5, 26);
    }
  };
  paint(null);
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - 4) / (r.width - 8) * (index.length - 1 || 0));
    paint(Math.max(0, Math.min(index.length - 1, i)));
  };
  cv.onmouseleave = () => paint(null);
}

/* grosse sparkline de la valorisation TOTALE des cartes filtrees : pts = [[iso, EUR]] ;
   survol -> fenetre sous le pointeur avec date jj/mm/aaaa + montant */
function drawTotal(cv, pts){
  const H = 120;
  const dpr = window.devicePixelRatio || 1;
  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#5b8cff';   // canvas ne résout pas var(--accent)
  const w = cv.clientWidth || cv.parentElement.clientWidth || 400;
  cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const paint = (hov, mx, my) => {
    ctx.clearRect(0, 0, w, H);
    if(!pts || !pts.length){
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('Aucun prix historise sur la periode.', 4, H / 2); return;
    }
    const vals = pts.map(p => p[1]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(1e-9, hi - lo);
    const X = i => 4 + (w - 8) * i / (pts.length - 1 || 1);
    const Y = v => H - 18 - (H - 32) * (v - lo) / span;
    ctx.beginPath(); ctx.moveTo(X(0), H - 14);
    pts.forEach((p, i) => ctx.lineTo(X(i), Y(p[1])));
    ctx.lineTo(X(pts.length - 1), H - 14); ctx.closePath();
    ctx.fillStyle = 'rgba(91,140,255,.10)'; ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(isoFr(pts[0][0]) + ' - ' + eur(lo), 4, 12);
    ctx.fillText(isoFr(pts[0][0]), 4, H - 4);
    ctx.textAlign = 'right'; ctx.fillText(isoFr(pts[pts.length - 1][0]) + ' - ' + eur(pts[pts.length - 1][1]), w - 4, H - 4);
    if(hov != null){
      const p = pts[Math.max(0, Math.min(pts.length - 1, hov))];
      const x = X(hov), y = Y(p[1]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      const label = `${isoFr(p[0])} . ${eur(p[1])}`;
      ctx.font = 'bold 11px sans-serif';
      const tw = ctx.measureText(label).width + 10;
      const bx = Math.min(Math.max((mx != null ? mx : x) - tw / 2, 2), w - tw - 2);
      const by = my != null ? Math.min(my + 12, H - 18) : 14;
      ctx.fillStyle = 'rgba(20,22,30,.92)'; ctx.fillRect(bx, by, tw, 16);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 15);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(label, bx + 5, by + 12);
    }
  };
  paint(null);
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - 4) / (r.width - 8) * (pts.length - 1 || 0));
    paint(Math.max(0, Math.min(pts.length - 1, i)), e.clientX - r.left, e.clientY - r.top);
  };
  cv.onmouseleave = () => paint(null);
}

/* sparkline d'une ligne : pts = [[iso, prix]] ; survol -> date + prix */
function drawSpark(cv, pts){
  const W = 110, H = 30;
  const dpr = window.devicePixelRatio || 1;
  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#5b8cff';
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const paint = (hov, mx, my) => {
    ctx.clearRect(0, 0, W, H);
    if(!pts.length) return;
    const vals = pts.map(p => p[1]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(1e-9, hi - lo);
    const X = i => 2 + (W - 4) * i / (pts.length - 1 || 1);
    const Y = v => H - 4 - (H - 8) * (v - lo) / span;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    if(hov != null){
      const p = pts[Math.max(0, Math.min(pts.length - 1, hov))];
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(hov), Y(p[1]), 2.5, 0, 7); ctx.fill();
      const label = `${isoFr(p[0])} · ${eur(p[1])}`;   // date jj/mm/aaaa
      ctx.font = 'bold 10px sans-serif';
      const tw = ctx.measureText(label).width + 8;
      const bx = Math.min(Math.max((mx != null ? mx : X(hov)) - tw / 2, 0), W - tw);
      const by = my != null ? Math.min(my + 12, H - 14) : 0;   // fenêtre de hover SOUS le pointeur
      ctx.fillStyle = 'rgba(20,22,30,.92)'; ctx.fillRect(bx, by, tw, 13);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(label, bx + 4, by + 10);
    }
  };
  paint(null);
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - 2) / (r.width - 4) * (pts.length - 1 || 0));
    paint(Math.max(0, Math.min(pts.length - 1, i)), e.clientX - r.left, e.clientY - r.top);
  };
  cv.onmouseleave = () => paint(null);
}

function mkQuery(){
  const D = priceDays();
  const qs = new URLSearchParams();
  qs.set('from', String(mk.from ?? (D && D.from) ?? ''));
  qs.set('to', String(mk.to ?? (D && D.to) ?? ''));
  qs.set('sort', mk.sort); qs.set('dir', mk.dir);
  qs.set('page', String(mk.page)); qs.set('limit', String(mk.limit));
  if(mk.name.trim()) qs.set('name', mk.name.trim());
  if(mk.artist.trim()) qs.set('artist', mk.artist.trim());
  if(mk.colors.length) qs.set('colors', mk.colors.join(','));
  if(mk.types.length) qs.set('types', mk.types.join(','));
  if(mk.cmc !== '') qs.set('cmc', mk.cmc);
  if(mk.set) qs.set('set', mk.set);
  if(mk.reserved) qs.set('reserved', '1');
  if(mk.coll) qs.set('scope', 'collection');
  if(mk.foil === '1' || mk.foil === '0') qs.set('foil', mk.foil);   // '' = foil et non foil
  return qs.toString();
}

/* tableau des résultats : format liste de la collection (vignette 70x95, pastille de rareté,
   qté possédée) + 2 colonnes d'évolution (% et montant €) + impact collection (flat x qté) */
function tableHTML(j){
  const th = (k, label, w) => `<th data-s="${k}" style="${w?`width:${w};`:''}cursor:pointer;user-select:none">${label}${mk.sort===k?(mk.dir==='asc'?' ▲':' ▼'):''}</th>`;
  return `<table id="mk-table"><thead><tr>
    <th style="width:86px"></th>${th('name','Carte')}${th('set','Extension',80)}${th('qty','Coll.',55)}${th('was','Avant',80)}${th('now','Maintenant',95)}${th('pct','Évol. %',85)}${th('flat','Évol. €',85)}${th('impact','Impact coll.',100)}<th style="width:120px">Tendance</th>
  </tr></thead><tbody id="mk-body">
  ${j.rows.map(r => { const setLabel = esc(r.set_name || setNameMap[(r.set||'').toLowerCase()] || (r.set||'').toUpperCase());
    return `<tr data-sf="${r.sfid||''}" data-nm="${esc(r.name)}">
    <td><img class="collthumb mkimg cinfo" data-name="${esc(r.name)}" data-set="${esc(r.set||'')}" data-cn="${esc(r.cn??'')}" data-sf="${r.sfid||''}" data-zoom="${r.img_lg||r.img||''}" src="${r.img||''}" alt=""></td>
    <td><div class="cellname">${rarityDotHTML(r.rarity)}<span class="link cinfo" data-name="${esc(r.name)}" data-set="${esc(r.set||'')}" data-cn="${esc(r.cn??'')}">${esc(r.name)}</span></div>
        <div class="pillrow">${r.foil?'<span class="pill infopill icpill" title="Foil"><i class="ic ic-foil"></i></span>':''}</div></td>
    <td><div>${setLabel}</div>${r.cn?`<div class="hint">n°${esc(String(r.cn))}</div>`:''}</td>
    <td>${r.qty>0?`<span class="pill infopill" title="Exemplaires dans ma collection">×${r.qty}</span>`:'<span class="hint">—</span>'}</td>
    <td class="p">${r.was!=null?eur(r.was):'—'}</td>
    <td class="p">${r.now!=null?eur(r.now):'—'}</td>
    <td class="p" style="color:${pctColor(r.pct)};font-weight:700">${r.pct==null?'—':((r.pct>=0?'+':'')+(r.pct*100).toFixed(1)+'%')}</td>
    <td class="p" style="color:${pctColor(r.flat)};font-weight:700">${r.flat==null?'—':((r.flat>=0?'+':'')+eur(r.flat))}</td>
    <td class="p" style="color:${pctColor(r.impact)};font-weight:700" title="Évolution € × qté possédée">${r.impact==null?'—':((r.impact>=0?'+':'')+eur(r.impact))}</td>
    <td><canvas class="spark" data-spark="${esc(JSON.stringify(r.spark))}"></canvas></td>
  </tr>`;}).join('')}
  </tbody></table>`;
}

/* ---------- blocs KPI (3 blocs en haut de la vue Marche) ---------- */
const fmtPct = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%';
const fmtSignedEur = v => v == null ? '—' : (v >= 0 ? '+' : '') + eur(v);

/* podium Top/Flop 3 facon schema : rang 1 au centre et sureleve, 2 et 3 de part et d'autre */
function podiumHTML(list, red){
  if(!list || !list.length) return '<div class="hint">—</div>';
  const order = list.length >= 3 ? [list[1], list[0], list[2]] : list;   // affichage 2, 1, 3
  return `<div class="podium ${red ? 'red' : ''}">` + order.map(r => {
    const rank = list.indexOf(r) + 1;
    const setCode = String(r.set || '').toUpperCase();
    return `<div class="pslot r${rank}">
      <div class="pcard" data-name="${esc(r.name)}" data-set="${esc(r.set || '')}" data-cn="${esc(r.cn ?? '')}"
           title="${esc(r.name)} (${setCode})${r.cn ? ' n°' + esc(String(r.cn)) : ''}${r.foil ? ' . foil' : ''} - cliquer pour la fiche carte"><b>${esc(r.name)}</b> (${setCode})${r.foil ? ' ✦' : ''}<br>${r.was != null ? eur(r.was) : '—'} → ${r.now != null ? eur(r.now) : '—'}</div>
      <div class="pbox">${rank}</div>
    </div>`;
  }).join('') + `</div>`;
}

function kpiHTML(j){
  const k = j.kpi || {};
  const tot = k.tot || {}, coll = k.coll || {};
  return `
  <div class="kpi-box kpi-mid" style="flex:1.6;min-width:380px">
    <div class="kpi-mid-left">
      <div class="hint" style="font-weight:700">Evolution totale</div>
      <div class="kpi-big" style="color:${pctColor(tot.flat)}">${fmtSignedEur(tot.flat)} <span style="font-size:15px">/ ${fmtPct(tot.pct)}</span></div>
      <div class="kpi-line" style="color:var(--ok)">▲ ${fmtSignedEur(k.upSum)} <span class="hint" style="font-weight:400">${(k.up || 0).toLocaleString('fr-FR')} cartes en hausse</span></div>
      <div class="kpi-line" style="color:var(--bad)">▼ ${fmtSignedEur(k.downSum)} <span class="hint" style="font-weight:400">${(k.down || 0).toLocaleString('fr-FR')} cartes en baisse</span></div>
      <div class="hint" style="margin-top:5px">médiane ${fmtPct(k.median)} · moyenne ${fmtPct(k.avg)} · fenêtre ${isoFr(j.from)} → ${isoFr(j.to)}</div>
    </div>
    <div class="kpi-mid-right">
      <div><div class="hint" style="text-align:center;font-weight:700;color:var(--ok)">Top 3</div>${podiumHTML(k.top3, false)}</div>
      <div><div class="hint" style="text-align:center;font-weight:700;color:var(--bad)">Flop 3</div>${podiumHTML(k.flop3, true)}</div>
    </div>
  </div>
  <div class="kpi-box" style="flex:1;min-width:250px">
    <h4 class="sub">Impact sur ma collection</h4>
    <div class="kpi-line" style="font-weight:400"><b>${isoFr(j.from)}</b> : <b>${eur(coll.was)}</b></div>
    <div class="kpi-line" style="font-weight:400"><b>${isoFr(j.to)}</b> : <b>${eur(coll.now)}</b></div>
    <div class="kpi-big" style="color:${pctColor(coll.flat)};margin-top:6px">${fmtSignedEur(coll.flat)} <span style="font-size:15px">/ ${fmtPct(coll.pct)}</span></div>
    <div class="hint" style="margin-top:5px">${(coll.n || 0).toLocaleString('fr-FR')} lignes de collection concernees</div>
  </div>
  <div class="kpi-box" style="flex:1 1 100%;min-width:260px">
    <h4 class="sub">Valorisation totale — ${(k.n || 0).toLocaleString('fr-FR')} cartes</h4>
    <canvas id="mk-total" style="width:100%"></canvas>
  </div>`;
}

async function mkLoad(app){
  const res = app.querySelector('#mkres'); if(!res) return;
  const D = priceDays();
  if(!D){ res.innerHTML = '<p class="hint">prices.db indisponible : lancez une mise à jour (Paramètres).</p>'; return; }
  if(mk.from == null){ mk.from = D.from; mk.to = D.to; }
  // spinner centré au milieu de la page pendant la requête (+ progression Scryfall)
  res.innerHTML = `<div class="mkloading"><div class="spin" style="width:48px;height:48px;border-width:4px"></div><p class="hint" id="mkloadmsg">Recherche en cours…</p></div>`;
  const poll = setInterval(async () => {
    try{
      const s = await (await fetch('/api/market/cards/status')).json();
      const el = res.querySelector('#mkloadmsg');
      if(el && s.running){
        el.textContent = s.phase === 'scryfall'
          ? `Recherche Scryfall… page ${s.page} (${(s.cards||0).toLocaleString('fr-FR')} cartes)`
          : s.phase === 'prices' ? `Lecture des prix dans prices.db… (${(s.cards||0).toLocaleString('fr-FR')} cartes)` : 'Recherche en cours…';
      }
    }catch(e){}
  }, 600);
  let j = null;
  try{ j = await (await fetch('/api/market/cards?' + mkQuery())).json(); }catch(e){}
  clearInterval(poll);
  if(!j || !j.ok){ res.innerHTML = `<p class="hint">⚠ ${esc((j && j.error) || 'serveur injoignable')}</p>`; return; }
  // KPI : 3 blocs - valorisation totale (sparkline), evolution totale + top/flop 3, impact collection
  app.querySelector('#mk-kpi').innerHTML = kpiHTML(j);
  drawTotal(app.querySelector('#mk-total'), j.totalSeries || []);
  app.querySelectorAll('#mk-kpi .pcard').forEach(el => el.onclick = () =>
    R.showCardInfo(el.dataset.name, undefined, el.dataset.set ? {set: el.dataset.set, cn: el.dataset.cn} : null));
  // table + pagination
  res.innerHTML = `<p class="hint">${j.total.toLocaleString('fr-FR')} résultats — page ${j.page} / ${j.pages}</p>` + tableHTML(j) + `
    <div class="row" style="gap:10px;margin-top:10px">
      <button class="btn ghost" id="mk-prev" ${j.page<=1?'disabled':''}>← Précédent</button>
      <span class="hint">Page ${j.page} / ${j.pages}</span>
      <button class="btn ghost" id="mk-next" ${j.page>=j.pages?'disabled':''}>Suivant →</button>
    </div>`;
  res.querySelector('#mk-prev').onclick = () => { mk.page = Math.max(1, j.page - 1); saveMk(); mkLoad(app); };
  res.querySelector('#mk-next').onclick = () => { mk.page = Math.min(j.pages, j.page + 1); saveMk(); mkLoad(app); };
  res.querySelectorAll('#mk-table th[data-s]').forEach(th => th.onclick = () => {
    const s = th.dataset.s;
    if(mk.sort === s) mk.dir = mk.dir === 'asc' ? 'desc' : 'asc';
    else { mk.sort = s; mk.dir = (s === 'name' || s === 'set' || s === 'rarity') ? 'asc' : 'desc'; }
    mk.page = 1; saveMk(); mkLoad(app);
  });
  res.querySelectorAll('#mk-body .cinfo').forEach(el => el.onclick = () =>
    R.showCardInfo(el.dataset.name, undefined, el.dataset.set ? {set: el.dataset.set, cn: el.dataset.cn} : null));
  res.querySelectorAll('canvas.spark').forEach(cv => drawSpark(cv, JSON.parse(cv.dataset.spark || '[]')));
}

/* ---------- vue principale ---------- */
function vMarket(app){
  app.innerHTML = `
  <div class="panel">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Marché — évolutions de prix Cardmarket</h3>
      <div class="row" style="gap:6px">
        <span class="binderchip ${mk.mode==='cartes'?'active':''}" data-mode="cartes">Cartes</span>
        <span class="binderchip ${mk.mode==='editions'?'active':''}" data-mode="editions">Éditions</span>
      </div>
    </div>
    <p class="hint" style="margin:6px 0 2px">Source : prix retail Cardmarket (EUR) accumulés dans <code>prices.db</code> (MTGJSON via <code>price_seed.py</code>). Les prix affichés dans toute l'app viennent exclusivement de cette base.</p>
    ${mk.mode==='editions' ? `
      <p class="hint" style="margin-top:14px">Vue <b>Éditions</b> — en construction. Revenez bientôt : valorisation et évolution par extension.</p>
    ` : `
      ${filtersHTML()}
      <div id="priceline" class="daterange" style="margin-top:10px"></div>
      <div class="row" style="justify-content:space-between;margin-top:2px">
        <span class="hint" id="dtminlab" style="font-weight:600"></span>
        <span class="hint" id="dtmaxlab" style="font-weight:600"></span>
      </div>
      <div class="row" id="mk-kpi" style="gap:12px;flex-wrap:wrap;margin:10px 0 4px;align-items:stretch"></div>
      <div id="mkres" style="margin-top:10px"><p class="hint">Chargement…</p></div>
    `}
  </div>`;
  app.querySelectorAll('[data-mode]').forEach(el => el.onclick = () => { mk.mode = el.dataset.mode; saveMk(); vMarket(app); });
  if(mk.mode !== 'cartes') return;

  const go = async () => {
    const raw = mk.name.trim();
    // nom localisé (Foudre…) -> nom anglais, comme la Recherche Avancée ; si la saisie a déjà
    // des hits en autocomplete anglais, on la garde telle quelle (recherche partielle)
    if(raw && !/[:()"<>=\-]/.test(raw)){
      try{
        const ja = await sfFetch('https://api.scryfall.com/cards/autocomplete?q=' + encodeURIComponent(raw));
        if(!ja.data || !ja.data.length){
          const names = await sfAutocomplete(raw);
          if(names.length){
            const exact = names.find(n => norm(n) === norm(raw)) || names.find(n => !n.includes('//')) || names[0];
            if(norm(exact) !== norm(raw)){ mk.name = exact; const ni = app.querySelector('#mk-name'); if(ni) ni.value = exact; }
          }
        }
      }catch(e){}
    }
    mk.page = 1; saveMk(); mkLoad(app);
  };

  // nom de carte + autocomplétion multilingue (comme la recherche avancée)
  const nameIn = app.querySelector('#mk-name'), nsugg = app.querySelector('#mk-namesugg');
  let nitems = [];
  nameIn.oninput = () => {
    mk.name = nameIn.value;
    clearTimeout(nameIn._t); clearTimeout(nameIn._s);
    const v = nameIn.value.trim();
    if(v.length >= 2){
      nameIn._s = setTimeout(async () => {
        try{ nitems = await sfAutocomplete(v); }catch(e){ nitems = []; }
        if(!nitems.length){ nsugg.style.display='none'; return; }
        nsugg.innerHTML = nitems.slice(0,8).map((n,i)=>`<div data-i="${i}">🃏 ${esc(n)}</div>`).join('');
        nsugg.style.display='block';
        nsugg.querySelectorAll('div').forEach(el => el.onmousedown = ev => {
          ev.preventDefault(); nameIn.value = nitems[el.dataset.i]; mk.name = nameIn.value; nsugg.style.display='none'; go();
        });
      }, 280);
    } else nsugg.style.display='none';
  };
  nameIn.onkeydown = e => { if(e.key==='Enter'){ e.preventDefault(); nsugg.style.display='none'; go(); } };
  nameIn.addEventListener('blur', () => setTimeout(() => nsugg.style.display='none', 150));

  // artiste + autocomplétion (catalogue Scryfall mis en cache)
  const artistIn = app.querySelector('#mk-artist'), asugg = app.querySelector('#mk-artistsugg');
  artistIn.oninput = () => {
    mk.artist = artistIn.value;
    clearTimeout(artistIn._t); clearTimeout(artistIn._s);
    const v = artistIn.value.trim().toLowerCase();
    if(v.length >= 2){
      artistIn._s = setTimeout(async () => {
        try{
          const list = await sfArtists();
          const hits = list.filter(a => a.toLowerCase().includes(v)).slice(0,10);
          if(!hits.length){ asugg.style.display='none'; return; }
          asugg.innerHTML = hits.map((a,i)=>`<div data-i="${i}">🎨 ${esc(a)}</div>`).join('');
          asugg.style.display='block';
          asugg.querySelectorAll('div').forEach(el => el.onmousedown = ev => {
            ev.preventDefault(); artistIn.value = hits[el.dataset.i]; mk.artist = artistIn.value; asugg.style.display='none'; go();
          });
        }catch(e){ asugg.style.display='none'; }
      }, 250);
    } else asugg.style.display='none';
  };
  artistIn.onkeydown = e => { if(e.key==='Enter'){ e.preventDefault(); asugg.style.display='none'; go(); } };
  artistIn.addEventListener('blur', () => setTimeout(() => asugg.style.display='none', 150));

  // couleurs : mêmes pastilles que la recherche avancée (clic = cocher/décocher)
  app.querySelectorAll('#mk-colors span').forEach(s => s.onclick = () => {
    s.classList.toggle('on');
    mk.colors = [...app.querySelectorAll('#mk-colors span.on')].map(x => x.dataset.c);
  });

  // types (multi-sélection, comme la recherche avancée)
  const ms = app.querySelector('#mk-types');
  ms.querySelector('button').onclick = e => { e.stopPropagation(); ms.classList.toggle('open'); };
  ms.querySelectorAll('.opts input').forEach(cb => cb.onchange = () => {
    mk.types = [...ms.querySelectorAll('.opts input:checked')].map(x => x.value);
    ms.querySelector('button').textContent = `Type : ${mk.types.length||'tous'} ▾`;
  });
  document.body.addEventListener('click', ev => { if(!ms.contains(ev.target)) ms.classList.remove('open'); });

  app.querySelector('#mk-cmc').onchange = e => { mk.cmc = e.target.value; };
  app.querySelector('#mk-reserved').onchange = e => { mk.reserved = e.target.checked; go(); };
  app.querySelector('#mk-coll').onchange = e => { mk.coll = e.target.checked; go(); };
  app.querySelector('#mk-foil').onchange = e => { mk.foil = e.target.value; go(); };

  const setSel = app.querySelector('#mk-set');
  const setsReady = sfSets().then(list => {
    const sorted = list.filter(s => !s.digital).slice().sort((a,b) => (a.name||'').localeCompare(b.name||''));
    setNameMap = Object.fromEntries(sorted.map(s => [s.code.toLowerCase(), s.name]));
    setSel.innerHTML = '<option value="">Extension : toutes</option>' + sorted.map(s => `<option value="${s.code}" ${mk.set===s.code?'selected':''}>${esc(s.name)} (${s.code.toUpperCase()})</option>`).join('');
  }).catch(() => {});
  setSel.onchange = e => { mk.set = e.target.value; };

  app.querySelector('#mk-go').onclick = go;
  app.querySelector('#mk-reset').onclick = () => {
    Object.assign(mk, { name:'', artist:'', colors:[], types:[], cmc:'', set:'', reserved:false, coll:false, foil:'', page:1 });
    saveMk(); vMarket(app);
  };

  Promise.all([loadPriceDays(), setsReady]).then(() => {
    const pl = app.querySelector('#priceline');
    mountPriceTimeline(pl);   // timeline vert/rouge dans la priceline
    // les 2 boules déplaçables directement sur la priceline
    pl.insertAdjacentHTML('beforeend',
      '<input type="range" id="dtmin" min="0" max="100" step="1" value="0">' +
      '<input type="range" id="dtmax" min="0" max="100" step="1" value="100">');
    wireDateGauge(app);
    mkLoad(app);
  });
}

/* ---------- courbe de prix plein écran (fiche carte, réutilisée par cardinfo) ---------- */
function drawPriceChart(cv, series){
  const all = series.filter(s => s.pts.length);
  if(!all.length) return false;
  const ctx = cv.getContext('2d');
  const W = cv.width = cv.clientWidth * (window.devicePixelRatio||1), H = cv.height = 220 * (window.devicePixelRatio||1);
  ctx.setTransform(window.devicePixelRatio||1, 0, 0, window.devicePixelRatio||1, 0, 0);
  const w = cv.clientWidth, h = 220;
  const pts = all.flatMap(s => s.pts);
  const t0 = Math.min(...pts.map(p => p[0])), t1 = Math.max(...pts.map(p => p[0]));
  const v0 = Math.min(...pts.map(p => p[1])), v1 = Math.max(...pts.map(p => p[1]));
  const spanT = Math.max(1, t1 - t0), spanV = Math.max(1e-9, v1 - v0);
  const X = t => 8 + (w - 16) * (t - t0) / spanT;
  const Y = v => h - 20 - (h - 34) * (v - v0) / spanV;
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  for(let g = 0; g <= 4; g++){ const y = 10 + (h - 34) * g / 4; ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(w - 8, y); ctx.stroke(); }
  for(const s of all){
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'left'; ctx.fillText(new Date(t0).toISOString().slice(0,10), 8, h - 6);
  ctx.textAlign = 'right'; ctx.fillText(new Date(t1).toISOString().slice(0,10), w - 8, h - 6);
  let lx = 8;
  ctx.textAlign = 'left';
  for(const s of all){
    if(!s.pts.length) continue;
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 2, 10, 3);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(s.label, lx + 14, 8);
    lx += 24 + ctx.measureText(s.label).width + 24;
  }
  return true;
}
async function loadPriceChart(c, modal){
  const box = modal.querySelector('#pricehist');
  if(!box) return;
  if(!c.id){ box.innerHTML = '<p class="hint">Historique indisponible.</p>'; return; }
  let j = null;
  try{ j = await (await fetch(`/api/price?sfid=${c.id}`)).json(); }catch(e){}
  if(!j || !j.ok){ box.innerHTML = `<p class="hint">⚠ ${esc((j&&j.error)||'prices.db absent : exécutez price_seed.py pour activer le marché.')}</p>`; return; }
  const series = [];
  if(j.normal.length) series.push({label:'Normal', color:'#5b8cff', pts:j.normal.map(p => [new Date(p[0]).getTime(), p[1]])});
  if(j.foil && j.foil.length) series.push({label:'Foil', color:'#e0b84d', pts:j.foil.map(p => [new Date(p[0]).getTime(), p[1]])});
  if(series.every(s => !s.pts.length)){ box.innerHTML = '<p class="hint">Aucun historique pour cette carte.</p>'; return; }
  const lastN = j.normal[j.normal.length-1], lastF = j.foil && j.foil[j.foil.length-1];
  box.innerHTML = `
    <canvas class="chart" id="pricecv" style="width:100%;height:220px"></canvas>
    <p class="hint">${j.normal.length+j.foil.length} points · dernier prix : ${eur(lastN?lastN[1]:lastF[1])} (${lastN?lastN[0]:lastF[0]})
      ${lastF?` · foil ${eur(lastF[1])}`:''}</p>`;
  drawPriceChart(box.querySelector('#pricecv'), series);
}

R.views.market = vMarket; R.loadPriceChart = loadPriceChart; R.drawPriceChart = drawPriceChart;

export { vMarket, drawPriceChart, loadPriceChart };
