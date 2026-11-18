import { esc, eur, TYPES_LIST } from '../core/util.js';
import { store } from '../core/store.js';
import { sfSets } from '../core/scryfall.js';
import { R } from '../core/registry.js';
import { loadPriceDays, mountPriceTimeline, priceDays, frOfDay } from '../core/pricedb.js';

/* ============================================================
   VUE MARCHÉ — évolutions de prix Cardmarket depuis prices.db
   Vue "cartes" : filtres + jauge de dates + récap (KPI/histo/indice)
   + table triable globalement (serveur) + sparklines + pagination.
   Vue "éditions" : à venir.
   ============================================================ */
let mk = Object.assign({
  mode: 'cartes', name: '', artist: '', colors: [], type: '', cmc: '', set: '',
  reserved: false, coll: false, sort: 'pct', dir: 'desc', page: 1, limit: 25,
}, store.get('mtg_market', {}));
const saveMk = () => store.set('mtg_market', mk);
const RARITY_FR = { common: 'Commune', uncommon: 'Peu commune', rare: 'Rare', mythic: 'Mythique', special: 'Spéciale', bonus: 'Bonus' };
const CMC_OPTS = ['', '0', '1', '2', '3', '4', '5', '6', '7', '7+'];

const imgCache = store.get('mtg_mk_imgs', {}) || {};
async function fetchImages(sfids){
  const todo = [...new Set(sfids.filter(id => id && !imgCache[id]))];
  for(let i = 0; i < todo.length; i += 75){
    try{
      const r = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: todo.slice(i, i + 75).map(id => ({ id })) }),
      });
      const j = await r.json();
      (j.data || []).forEach(c => { imgCache[c.id] = (c.image_uris && c.image_uris.small) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.small) || null; });
      todo.slice(i, i + 75).forEach(id => { if (!(id in imgCache)) imgCache[id] = null; });
    }catch(e){}
  }
  const keys = Object.keys(imgCache);
  if(keys.length > 6000){ keys.slice(0, keys.length - 3000).forEach(k => delete imgCache[k]); }
  store.set('mtg_mk_imgs', imgCache);
}

function filtersHTML(){
  return `
  <div class="panel" style="padding:10px 12px">
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <input id="mk-name" placeholder="Nom de carte…" value="${esc(mk.name)}" style="min-width:180px">
      <input id="mk-artist" placeholder="Artiste, ex: Rebecca Guay" value="${esc(mk.artist)}" style="min-width:180px">
      <span class="row" style="gap:4px" id="mk-colors">${['W','U','B','R','G'].map(c => `<button class="pill ${mk.colors.includes(c)?'active':''}" data-c="${c}" style="width:30px;padding:2px 0;text-align:center">${c}</button>`).join('')}</span>
      <select id="mk-type"><option value="">Type : tous</option>${TYPES_LIST.map(t => `<option ${mk.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <select id="mk-cmc"><option value="">Coût : tous</option>${CMC_OPTS.map(c => `<option value="${c}" ${mk.cmc===c?'selected':''}>${c===''?'tous':c}</option>`).join('')}</select>
    </div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
      <select id="mk-set"><option value="">Extension : toutes</option></select>
      <label class="row" style="gap:6px"><input type="checkbox" id="mk-reserved" ${mk.reserved?'checked':''}> Reserved List</label>
      <label class="row" style="gap:6px"><input type="checkbox" id="mk-coll" ${mk.coll?'checked':''}> Dans ma collection</label>
      <button class="btn" id="mk-go">Rechercher</button>
      <button class="btn ghost" id="mk-reset">Réinitialiser</button>
    </div>
  </div>`;
}

/* jauge de dates à 2 curseurs, calée sur les jours historisés de prices.db */
function wireDateGauge(app){
  const D = priceDays(); if(!D) return;
  const days = D.days;                 // ordinals triés (jours avec >= 1 prix)
  const n = days.length;
  const box = app.querySelector('#daterange'); if(!box) return;
  const i0 = Math.max(0, days.indexOf(mk.from ?? D.from));
  const i1 = Math.min(n - 1, Math.max(i0, days.indexOf(mk.to ?? D.to)));
  const rmin = box.querySelector('#dtmin'), rmax = box.querySelector('#dtmax');
  const fill = box.querySelector('#dtfill'), lmin = box.querySelector('#dtminlab'), lmax = box.querySelector('#dtmaxlab');
  rmin.max = rmax.max = String(n - 1);
  rmin.value = String(i0); rmax.value = String(i1);
  const paint = () => {
    const a = +rmin.value, b = +rmax.value;
    fill.style.left = (a / (n - 1) * 100) + '%';
    fill.style.width = Math.max(0, (b - a) / (n - 1) * 100) + '%';
    lmin.textContent = frOfDay(days[a]);
    lmax.textContent = frOfDay(days[b]);
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

function gaugeHTML(){
  return `<div class="row" style="align-items:flex-end;gap:10px;margin:10px 0 4px">
    <span class="hint" style="white-space:nowrap">Période :</span>
    <div class="pricerange daterange" id="daterange" style="flex:1;min-width:0;width:auto">
      <div class="pr-track"><div class="pr-fill" id="dtfill"></div></div>
      <input type="range" id="dtmin" min="0" max="100" step="1" value="0">
      <input type="range" id="dtmax" min="0" max="100" step="1" value="100">
      <div class="pr-labs"><span id="dtminlab"></span><span id="dtmaxlab"></span></div>
    </div>
  </div>`;
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

/* sparkline d'une ligne : pts = [[iso, prix]] ; survol -> date + prix */
function drawSpark(cv, pts){
  const W = 110, H = 30;
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const paint = hov => {
    ctx.clearRect(0, 0, W, H);
    if(!pts.length) return;
    const vals = pts.map(p => p[1]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(1e-9, hi - lo);
    const X = i => 2 + (W - 4) * i / (pts.length - 1 || 1);
    const Y = v => H - 4 - (H - 8) * (v - lo) / span;
    ctx.strokeStyle = 'var(--accent)'; ctx.lineWidth = 1.5; ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    if(hov != null){
      const p = pts[Math.max(0, Math.min(pts.length - 1, hov))];
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(hov), Y(p[1]), 2.5, 0, 7); ctx.fill();
      const label = `${p[0]} · ${eur(p[1])}`;
      ctx.font = 'bold 10px sans-serif';
      const tw = ctx.measureText(label).width + 8;
      const bx = Math.min(Math.max(X(hov) - tw / 2, 0), W - tw);
      ctx.fillStyle = 'rgba(20,22,30,.92)'; ctx.fillRect(bx, 0, tw, 13);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(label, bx + 4, 10);
    }
  };
  paint(null);
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - 2) / (r.width - 4) * (pts.length - 1 || 0));
    paint(Math.max(0, Math.min(pts.length - 1, i)));
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
  if(mk.type) qs.set('types', mk.type);
  if(mk.cmc !== '') qs.set('cmc', mk.cmc);
  if(mk.set) qs.set('set', mk.set);
  if(mk.reserved) qs.set('reserved', '1');
  if(mk.coll) qs.set('scope', 'collection');
  return qs.toString();
}

function tableHTML(j){
  const th = (k, label, w) => `<th data-s="${k}" style="${w?`width:${w};`:''}cursor:pointer;user-select:none">${label}${mk.sort===k?(mk.dir==='asc'?' ▲':' ▼'):''}</th>`;
  return `<table id="mk-table"><thead><tr>
    <th></th>${th('name','Nom')}${th('set','Extension',70)}${th('rarity','Rareté',90)}${th('was','Avant',90)}${th('now','Maintenant',100)}${th('pct','Évolution',100)}<th style="width:120px">Tendance</th>
  </tr></thead><tbody id="mk-body">
  ${j.rows.map(r => `<tr data-sf="${r.sfid||''}" data-nm="${esc(r.name)}">
    <td><img class="mkimg" data-sf="${r.sfid||''}" src="${imgCache[r.sfid]||''}" alt="" style="width:36px;border-radius:5px;background:#000;min-height:50px"></td>
    <td><span class="link" data-nm="${esc(r.name)}">${esc(r.name)}</span></td>
    <td class="hint">${esc((r.set||'').toUpperCase())}${r.cn?` · ${esc(String(r.cn))}`:''}</td>
    <td class="hint">${RARITY_FR[r.rarity]||r.rarity||'—'}</td>
    <td class="p">${r.was!=null?eur(r.was):'—'}</td>
    <td class="p">${r.now!=null?eur(r.now):'—'}</td>
    <td class="p" style="color:${r.pct==null?'var(--muted)':(r.pct>=0?'var(--ok)':'var(--bad)')};font-weight:700">${r.pct==null?'—':((r.pct>=0?'+':'')+(r.pct*100).toFixed(1)+'%')}</td>
    <td><canvas class="spark" data-spark="${esc(JSON.stringify(r.spark))}"></canvas></td>
  </tr>`).join('')}
  </tbody></table>`;
}

async function mkLoad(app){
  const res = app.querySelector('#mkres'); if(!res) return;
  const D = priceDays();
  if(!D){ res.innerHTML = '<p class="hint">prices.db indisponible : lancez une mise à jour (Paramètres).</p>'; return; }
  if(mk.from == null){ mk.from = D.from; mk.to = D.to; }
  res.innerHTML = '<p class="hint">Calcul des évolutions…</p>';
  let j = null;
  try{ j = await (await fetch('/api/market/cards?' + mkQuery())).json(); }catch(e){}
  if(!j || !j.ok){ res.innerHTML = `<p class="hint">⚠ ${esc((j && j.error) || 'serveur injoignable')}</p>`; return; }
  // KPI
  const k = j.kpi;
  const pctUp = k.n ? Math.round(100 * k.up / Math.max(1, k.up + k.down)) : 0;
  app.querySelector('#mk-kpi').innerHTML = `
    <span class="pill">${k.n.toLocaleString('fr-FR')} cartes</span>
    <span class="pill" style="color:var(--ok)">▲ ${k.up.toLocaleString('fr-FR')} (${pctUp}%)</span>
    <span class="pill" style="color:var(--bad)">▼ ${k.down.toLocaleString('fr-FR')}</span>
    <span class="pill">médiane ${k.median==null?'—':(k.median>=0?'+':'')+k.median+'%'}</span>
    <span class="pill">moyenne ${k.avg==null?'—':(k.avg>=0?'+':'')+k.avg+'%'}</span>
    <span class="pill hint">${j.from} → ${j.to}</span>`;
  drawHist(app.querySelector('#mk-hist'), j.hist);
  drawIndex(app.querySelector('#mk-index'), j.index);
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
  res.querySelectorAll('#mk-body .link').forEach(el => el.onclick = () => R.showCardInfo(el.dataset.nm));
  res.querySelectorAll('canvas.spark').forEach(cv => drawSpark(cv, JSON.parse(cv.dataset.spark || '[]')));
  fetchImages(j.rows.map(r => r.sfid)).then(() => {
    res.querySelectorAll('img.mkimg').forEach(im => { const u = imgCache[im.dataset.sf]; if(u) im.src = u; });
  });
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
      <div id="priceline" style="margin-top:8px"></div>
      ${gaugeHTML()}
      <div class="row" id="mk-kpi" style="gap:8px;flex-wrap:wrap;margin:10px 0 4px"></div>
      <div class="row" style="gap:18px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:280px"><h4 class="sub">Indice du marché (base 100 au début)</h4><canvas id="mk-index" style="width:100%"></canvas></div>
        <div style="flex:1;min-width:280px"><h4 class="sub">Répartition des évolutions</h4><canvas id="mk-hist" style="width:100%"></canvas></div>
      </div>
      <div id="mkres" style="margin-top:10px"><p class="hint">Chargement…</p></div>
    `}
  </div>`;
  app.querySelectorAll('[data-mode]').forEach(el => el.onclick = () => { mk.mode = el.dataset.mode; saveMk(); vMarket(app); });
  if(mk.mode !== 'cartes') return;
  // filtres
  const nameIn = app.querySelector('#mk-name'), artistIn = app.querySelector('#mk-artist');
  nameIn.oninput = () => { mk.name = nameIn.value; };
  artistIn.oninput = () => { mk.artist = artistIn.value; };
  app.querySelectorAll('#mk-colors .pill').forEach(b => b.onclick = () => {
    const c = b.dataset.c;
    mk.colors = mk.colors.includes(c) ? mk.colors.filter(x => x !== c) : [...mk.colors, c];
    b.classList.toggle('active');
  });
  app.querySelector('#mk-type').onchange = e => { mk.type = e.target.value; };
  app.querySelector('#mk-cmc').onchange = e => { mk.cmc = e.target.value; };
  app.querySelector('#mk-reserved').onchange = e => { mk.reserved = e.target.checked; };
  app.querySelector('#mk-coll').onchange = e => { mk.coll = e.target.checked; };
  const setSel = app.querySelector('#mk-set');
  sfSets().then(list => {
    setSel.innerHTML = '<option value="">Extension : toutes</option>' + list.filter(s => !s.digital).slice().sort((a,b) => (b.released_at||'').localeCompare(a.released_at||'')).map(s => `<option value="${s.code}" ${mk.set===s.code?'selected':''}>${esc(s.name)} (${s.code.toUpperCase()})</option>`).join('');
  }).catch(() => {});
  setSel.onchange = e => { mk.set = e.target.value; };
  const go = () => { mk.page = 1; saveMk(); mkLoad(app); };
  app.querySelector('#mk-go').onclick = go;
  nameIn.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); go(); } });
  artistIn.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); go(); } });
  app.querySelector('#mk-reset').onclick = () => {
    Object.assign(mk, { name:'', artist:'', colors:[], type:'', cmc:'', set:'', reserved:false, coll:false, page:1 });
    saveMk(); vMarket(app);
  };
  loadPriceDays().then(() => {
    mountPriceTimeline(app.querySelector('#priceline'));
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
  const lg = all.reduce((a, s) => a + s.label.length, 0);
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
  const first = series.flatMap(s => s.pts)[0], lastN = j.normal[j.normal.length-1], lastF = j.foil && j.foil[j.foil.length-1];
  box.innerHTML = `
    <canvas class="chart" id="pricecv" style="width:100%;height:220px"></canvas>
    <p class="hint">${j.normal.length+j.foil.length} points · dernier prix : ${eur(lastN?lastN[1]:lastF[1])} (${lastN?lastN[0]:lastF[0]})
      ${lastF?` · foil ${eur(lastF[1])}`:''}</p>`;
  drawPriceChart(box.querySelector('#pricecv'), series);
}

R.views.market = vMarket; R.loadPriceChart = loadPriceChart; R.drawPriceChart = drawPriceChart;

export { vMarket, drawPriceChart, loadPriceChart };
