import { $, eur } from './core/util.js';
function openModal(html){
  $('#modal').innerHTML = html;
  $('#modalbg').classList.add('open');
  $('#modalbg').onclick = e => { if(e.target.id==='modalbg') e.target.classList.remove('open'); };
}
function closeModal(){ $('#modalbg').classList.remove('open'); }

/* ---- jauge de prix à deux poignées (échelle logarithmique) ----
   Bornes initiales : /api/pricerange (min/max de prices.db), repli 0,01 €..1000 €.
   setPriceBounds(min,max) resserre ensuite la jauge sur les résultats du filtre courant.
   F.pmin / F.pmax : '' = pas de borne (poignée à l'extrémité). */
let priceRangeCache = null;
async function fetchPriceRange(){
  if(priceRangeCache) return priceRangeCache;
  try{
    const r = await fetch('/api/pricerange');
    const j = await r.json();
    if(r.ok && j.ok) priceRangeCache = { min: Math.max(0.01, +j.min || 0.01), max: Math.max(1, +j.max || 1) };
  }catch(e){}
  return priceRangeCache || { min: 0.01, max: 1000 };
}
function priceRangeHTML(){
  return `<div class="pricerange" id="pricerange" title="Fourchette de prix (échelle logarithmique)">
    <div class="pr-track"><div class="pr-fill" id="prfill"></div></div>
    <input type="range" id="prmin" min="0" max="1000" step="1" value="0">
    <input type="range" id="prmax" min="0" max="1000" step="1" value="1000">
    <div class="pr-labs"><span id="prminlab"></span><span id="prmaxlab"></span></div>
  </div>`;
}
let activeGauge = null;
/* branche la jauge sur F.pmin/F.pmax ; onSearch appelé au relâchement d'une poignée.
   Synchrone si le cache de bornes est chaud (pour que setPriceBounds juste après fonctionne). */
function wirePriceRange(app, F, onSearch, bounds){
  const box = app.querySelector('#pricerange'); if(!box) return;
  const wire = range => {
    const g = { F, floor: range.min, top: range.max };
    if(bounds && bounds[0] >= 0 && bounds[1] > bounds[0]){ g.floor = Math.max(0.01, bounds[0]); g.top = bounds[1]; }   // resserrage initial (ex : liste filtrée)
    g.toT = v => Math.max(0, Math.min(1000, Math.round(1000 * Math.log(Math.max(v, g.floor) / g.floor) / Math.log(g.top / g.floor))));
    g.toV = t => g.floor * Math.pow(g.top / g.floor, t / 1000);
    g.rmin = box.querySelector('#prmin'); g.rmax = box.querySelector('#prmax');
    g.fill = box.querySelector('#prfill'); g.lmin = box.querySelector('#prminlab'); g.lmax = box.querySelector('#prmaxlab');
    g.rmin.value = F.pmin !== '' ? g.toT(+F.pmin) : 0;
    g.rmax.value = F.pmax !== '' ? g.toT(+F.pmax) : 1000;
    g.paint = () => {
      const a = +g.rmin.value, b = +g.rmax.value;
      g.fill.style.left = (a / 10) + '%';
      g.fill.style.width = Math.max(0, (b - a) / 10) + '%';
      g.lmin.textContent = a === 0 ? '0 €' : eur(g.toV(a));
      g.lmax.textContent = b >= 1000 ? eur(g.top) : eur(g.toV(b));
      g.rmin.style.zIndex = a > b - 15 ? 5 : 3;   // poignée du dessus quand elles se croisent
    };
    g.apply = () => {
      const a = +g.rmin.value, b = +g.rmax.value;
      F.pmin = a === 0 ? '' : String(Math.round(g.toV(a) * 100) / 100);
      F.pmax = b >= 1000 ? '' : String(Math.round(g.toV(b) * 100) / 100);
      g.paint();
    };
    g.rmin.addEventListener('input', () => { if(+g.rmin.value > +g.rmax.value) g.rmin.value = g.rmax.value; g.apply(); });
    g.rmax.addEventListener('input', () => { if(+g.rmax.value < +g.rmin.value) g.rmax.value = g.rmin.value; g.apply(); });
    g.rmin.addEventListener('change', () => onSearch && onSearch());
    g.rmax.addEventListener('change', () => onSearch && onSearch());
    activeGauge = g;
    g.paint();
  };
  if(priceRangeCache) wire(priceRangeCache);
  else fetchPriceRange().then(wire);
}
/* resserre la jauge active sur [mn, mx] (ex : prix min/max des cartes correspondant aux filtres actifs) */
function setPriceBounds(mn, mx){
  const g = activeGauge; if(!g) return;
  if(!(mx > 0) || !(mn >= 0) || mn >= mx) return;
  g.floor = Math.max(0.01, mn);
  g.top = mx;
  g.rmin.value = g.F.pmin !== '' ? g.toT(+g.F.pmin) : 0;
  g.rmax.value = g.F.pmax !== '' ? g.toT(+g.F.pmax) : 1000;
  if(+g.rmin.value > +g.rmax.value) g.rmin.value = g.rmax.value;   // poignées jamais croisées
  g.paint();
}

/* ---- zoom au survol des visuels (délégation globale, une seule fois) ---- */
if(!window.__zoomInit){
  window.__zoomInit = true;
  const z = () => document.getElementById('zoomer');
  document.addEventListener('mouseover', e => {
    const im = e.target;
    if(im && im.tagName === 'IMG' && im.dataset.zoom){
      const el = z(); el.querySelector('img').src = im.dataset.zoom; el.style.display = 'block';
    }
  });
  document.addEventListener('mouseout', e => {
    if(e.target && e.target.tagName === 'IMG' && e.target.dataset.zoom){ const el = z(); if(el) el.style.display = 'none'; }
  });
  document.addEventListener('mousemove', e => {
    const el = z(); if(!el || el.style.display !== 'block') return;
    const w = 300, h = 420;
    let x = e.clientX + 18, y = e.clientY - h/2;
    if(x + w > innerWidth) x = e.clientX - w - 18;
    y = Math.max(8, Math.min(innerHeight - h - 8, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  });
}

window.__booted = true;
export { openModal, closeModal, priceRangeHTML, wirePriceRange, fetchPriceRange, setPriceBounds };
