/* prices.db — derniers prix connus par scryfall_id : SOURCE UNIQUE des prix affichés dans l'app.
   GET /api/prices/last -> { ok, lastPoint, n, map: { sfid: [last_norm, last_foil] } } */
let MAP = null;          // null = pas encore chargé
let LAST_POINT = null;
export async function loadLastPrices(){
  try{
    const r = await fetch('/api/prices/last');
    const j = await r.json();
    if(j && j.ok){ MAP = j.map || {}; LAST_POINT = j.lastPoint || null; }
  }catch(e){}
  if(MAP === null) MAP = {};
  return MAP;
}
export function pricesReady(){ return MAP !== null; }
export function lastPoint(){ return LAST_POINT; }
export function dbPrices(sfid){ return (sfid && MAP) ? (MAP[sfid] || null) : null; }
export function dbPrice(sfid, foil){
  const p = dbPrices(sfid);
  if(!p) return null;
  const v = foil ? (p[1] ?? p[0]) : (p[0] ?? p[1]);
  return v == null ? null : v;
}
export function dbFoil(sfid){ const p = dbPrices(sfid); return p ? p[1] : null; }

/* ---------- timeline des jours historisés : vert = au moins 1 prix ce jour, rouge = aucun ---------- */
let DAYS = null;   // { from: ordinal, to: ordinal, set: Set<ordinal> }
const timelines = new Map();   // el -> { hover, draw }
const ordOf = iso => { const p = iso.split('-').map(Number); return Math.floor(Date.UTC(p[0], p[1]-1, p[2]) / 86400000) + 719163; };
const isoOf = o => new Date((o - 719163) * 86400000).toISOString().slice(0, 10);
const frOf  = o => { const p = isoOf(o).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
export async function loadPriceDays(){
  try{
    const r = await fetch('/api/prices/days');
    const j = await r.json();
    if(j && j.ok) DAYS = { from: ordOf(j.from), to: ordOf(j.to), days: [...j.days].sort((a, b) => a - b), set: new Set(j.days) };
  }catch(e){}
  return DAYS;
}
export function priceDays(){ return DAYS; }
export function mountPriceTimeline(el){
  if(!el) return;
  let t = timelines.get(el);
  if(!t){
    t = { hover: null, draw: null };
    timelines.set(el, t);
    const H = 36, padL = 8, padR = 8, lineY = 22;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'width:100%;height:' + H + 'px;display:block;cursor:crosshair';
    el.innerHTML = ''; el.appendChild(cv);
    cv.addEventListener('mousemove', e => {
      const D = DAYS; if(!D) return;
      const n = D.to - D.from + 1;
      const r = cv.getBoundingClientRect();
      const seg = (r.width - padL - padR) / n;
      const i = Math.floor((e.clientX - r.left - padL) / seg);
      t.hover = (i >= 0 && i < n) ? D.from + i : null;
      t.draw(t.hover);
    });
    cv.addEventListener('mouseleave', () => { t.hover = null; if(t.draw) t.draw(null); });
    window.addEventListener('resize', () => { if(t.draw) t.draw(t.hover); });
    t.draw = hover => {
      const D = DAYS; if(!D) return;
      const n = D.to - D.from + 1;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth || 600;
      cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);   // dessin en pixels device : coordonnees entieres identiques pour toutes les cases
      const cs = getComputedStyle(document.documentElement);
      const green = cs.getPropertyValue('--ok').trim() || '#3fbf6f';
      const red = cs.getPropertyValue('--bad').trim() || '#e05252';
      const seg = (w - padL - padR) / n;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const y0 = Math.round(lineY * dpr), bh = Math.round(10 * dpr);
      for(let i = 0; i < n; i++){
        const x0 = Math.round((padL + i * seg) * dpr);
        const x1 = Math.max(x0 + 1, Math.round((padL + (i + 1) * seg) * dpr));
        ctx.fillStyle = D.set.has(D.from + i) ? green : red;
        ctx.fillRect(x0, y0, x1 - x0, bh);
      }
      if(hover != null){
        const i = Math.min(n - 1, Math.max(0, hover - D.from));
        const x = Math.round((padL + i * seg + seg / 2) * dpr) + 0.5;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
        ctx.beginPath(); ctx.moveTo(x, Math.round(6 * dpr)); ctx.lineTo(x, Math.round((lineY + 12) * dpr)); ctx.stroke();
        const label = frOf(hover);
        ctx.font = 'bold ' + Math.round(11 * dpr) + 'px sans-serif';
        const tw = Math.ceil(ctx.measureText(label).width) + Math.round(10 * dpr);
        const lh = Math.round(16 * dpr);
        let bx = Math.round((padL + i * seg + seg / 2 - tw / (2 * dpr)) * dpr);
        bx = Math.min(Math.max(bx, Math.round(2 * dpr)), cv.width - tw - Math.round(2 * dpr));
        ctx.fillStyle = 'rgba(20,22,30,.92)';
        ctx.fillRect(bx, 0, tw, lh);
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.strokeRect(bx + 0.5, 0.5, tw - 1, lh - 1);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
        ctx.fillText(label, bx + Math.round(5 * dpr), Math.round(12 * dpr));
      }
    };
  }
  t.draw(t.hover);
}
export function refreshPriceTimelines(){
  if(!DAYS) return;
  for(const t of timelines.values()) if(t.draw) t.draw(t.hover);
}
export { ordOf, isoOf, frOf as frOfDay };
