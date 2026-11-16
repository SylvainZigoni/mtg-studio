import { $, eur } from './core/util.js';
function openModal(html){
  $('#modal').innerHTML = html;
  $('#modalbg').classList.add('open');
  $('#modalbg').onclick = e => { if(e.target.id==='modalbg') e.target.classList.remove('open'); };
}
function closeModal(){ $('#modalbg').classList.remove('open'); }

/* ---- jauge de prix à deux poignées (échelle logarithmique) ----
   Bornes servies par /api/pricerange (min/max de prices.db) ; repli 0,01 €..1000 €.
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
async function wirePriceRange(app, F, onSearch){
  const box = app.querySelector('#pricerange'); if(!box) return;
  const range = await fetchPriceRange();
  const floor = range.min, top = range.max;
  const toT = v => Math.max(0, Math.min(1000, Math.round(1000 * Math.log(Math.max(v, floor) / floor) / Math.log(top / floor))));
  const toV = t => floor * Math.pow(top / floor, t / 1000);
  const rmin = box.querySelector('#prmin'), rmax = box.querySelector('#prmax');
  const fill = box.querySelector('#prfill'), lmin = box.querySelector('#prminlab'), lmax = box.querySelector('#prmaxlab');
  rmin.value = F.pmin !== '' ? toT(+F.pmin) : 0;
  rmax.value = F.pmax !== '' ? toT(+F.pmax) : 1000;
  const paint = () => {
    const a = +rmin.value, b = +rmax.value;
    fill.style.left = (a / 10) + '%';
    fill.style.width = Math.max(0, (b - a) / 10) + '%';
    lmin.textContent = a === 0 ? '0 €' : eur(toV(a));
    lmax.textContent = b >= 1000 ? eur(top) : eur(toV(b));
    rmin.style.zIndex = a > b - 15 ? 5 : 3;   // poignée du dessus quand elles se croisent
  };
  const apply = () => {
    const a = +rmin.value, b = +rmax.value;
    F.pmin = a === 0 ? '' : String(Math.round(toV(a) * 100) / 100);
    F.pmax = b >= 1000 ? '' : String(Math.round(toV(b) * 100) / 100);
    paint();
  };
  rmin.addEventListener('input', () => { if(+rmin.value > +rmax.value) rmin.value = rmax.value; apply(); });
  rmax.addEventListener('input', () => { if(+rmax.value < +rmin.value) rmax.value = rmin.value; apply(); });
  rmin.addEventListener('change', () => onSearch && onSearch());
  rmax.addEventListener('change', () => onSearch && onSearch());
  paint();
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
export { openModal, closeModal, priceRangeHTML, wirePriceRange, fetchPriceRange };
