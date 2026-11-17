import { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS } from '../core/util.js';
import { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer } from '../core/store.js';
import { loadEntries, rebuildIndex, addEntry, pullState, OLD_BINDERS, tags, entries, collection, myDecks, matches, saveColl, saveTags, saveMatches, saveDecks } from '../core/model.js';
import { sfFetch, sfPump, sfCardByName, sfAutocomplete, getPrintCache, sfPrints, sfSetPrints, printFor, entryPrice, setIcon, sfSearchUrl, sfSearch, sfSets, sfArtists, entryPrintSync, sfCache, saveCache, sfQueue, PRINT_CACHE_KEY, ALL_LANGS_Q, SET_ICONS } from '../core/scryfall.js';
import { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS } from '../core/decks.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R, S } from '../core/registry.js';
import { loadPriceDays, mountPriceTimeline } from '../core/pricedb.js';

/* ============================================================
   VUE MARCHÉ (historique MTGJSON via /api/market)
   ============================================================ */
const MARKET_LABELS = {['1w']:'1 semaine',['1m']:'1 mois',['1y']:'1 an',['3y']:'3 ans',['5y']:'5 ans',['10y']:'10 ans',['rel']:'depuis la sortie'};
let mkF = {w:'1m', scope:'all'};
function vMarket(app){
  app.innerHTML = `
  <div class="panel">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Marché — évolutions de prix Cardmarket</h3>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="mk-w">${Object.entries(MARKET_LABELS).map(([k,l]) => `<option value="${k}" ${mkF.w===k?'selected':''}>${l}</option>`).join('')}</select>
        <span class="binderchip ${mkF.scope==='all'?'active':''}" data-sc="all">Toutes cartes</span>
        <span class="binderchip ${mkF.scope==='collection'?'active':''}" data-sc="collection">Ma collection</span>
      </div>
    </div>
    <p class="hint" style="margin:6px 0 2px">Source : prix retail Cardmarket (EUR) via MTGJSON, accumulés dans <code>prices.db</code> (exécutez <code>price_seed.py prices</code> puis <code>price_seed.py cards</code> une fois ; les prix du jour s'ajoutent automatiquement à chaque ouverture de l'app). MTGJSON ne fournit qu'environ 3 mois de recul initial : les fenêtres plus larges comparent au plus ancien prix connu, et l'historique s'allonge au fil des jours.</p>
    <div class="row" style="align-items:center;gap:8px;margin:8px 0 2px"><span class="hint">Jours historisés :</span><div id="priceline" style="flex:1"></div></div>
    <div id="mkres"><p class="hint">Chargement…</p></div>
  </div>`;
  loadPriceDays().then(() => mountPriceTimeline(app.querySelector('#priceline')));
  const run = () => {
    const box = app.querySelector('#mkres');
    box.innerHTML = '<p class="hint">Chargement…</p>';
    fetch(`/api/market?w=${mkF.w}&scope=${mkF.scope}&limit=15`).then(r => r.json()).then(j => {
      if(!j.ok){ box.innerHTML = `<p class="hint">⚠ ${esc(j.error||'indisponible')}</p>`; return; }
      const tbl = (title, rows, cls) => !rows.length ? '' : `
        <h4 class="sub" style="margin-top:14px">${title}</h4>
        <table><thead><tr><th>#</th><th>Carte</th><th>Extension</th><th>Avant</th><th>Maintenant</th><th>Évolution</th></tr></thead><tbody>
        ${rows.map((r,i) => `<tr>
          <td class="hint">${i+1}</td>
          <td><span class="link" data-sf="${r.sfid||''}" data-nm="${esc(r.name)}">${esc(r.name)}</span>${r.foil?' <span class="foil-badge">FOIL</span>':''}${r.qty>1?` <span class="hint">×${r.qty}</span>`:''}</td>
          <td class="hint">${(r.set||'').toUpperCase()}</td>
          <td class="p">${eur(r.was)}</td><td class="p">${eur(r.now)}</td>
          <td style="color:${r.pct>=0?'var(--ok)':'var(--bad)'};font-weight:700">${r.pct>=0?'+':''}${(r.pct*100).toFixed(1)}%</td>
        </tr>`).join('')}</tbody></table>`;
      box.innerHTML = `
        <p class="hint">${j.n} cartes comparées sur la période${j.scope==='collection'?' (celles de votre collection reconnues dans prices.db)':''}.</p>
        ${tbl('📈 Top hausses', j.top)}${tbl('📉 Top baisses', j.flop)}`;
      box.querySelectorAll('[data-nm]').forEach(el => el.onclick = () => el.dataset.sf ? R.showCardInfo(el.dataset.nm) : R.showCardInfo(el.dataset.nm));
    }).catch(e => { box.innerHTML = `<p class="hint">Serveur injoignable (${e})</p>`; });
  };
  app.querySelector('#mk-w').onchange = e => { mkF.w = e.target.value; run(); };
  app.querySelectorAll('[data-sc]').forEach(el => el.onclick = () => { mkF.scope = el.dataset.sc; vMarket(app); });
  run();
}

/* courbe de prix : une ou deux lignes (normal, foil) */
function drawPriceChart(cv, series){
  const all = series.filter(s => s.pts.length);
  if(!all.length) return false;
  const ctx = cv.getContext('2d');
  const W = cv.width = cv.clientWidth * (window.devicePixelRatio||1), H = cv.height = 220 * (window.devicePixelRatio||1);
  ctx.scale(1,1);
  const pad = {l:46*(window.devicePixelRatio||1), r:10, t:14, b:26*(window.devicePixelRatio||1)};
  const dpr = window.devicePixelRatio||1;
  const xs = all.flatMap(s => s.pts.map(p => p[0]));
  const ys = all.flatMap(s => s.pts.map(p => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = 0, y1 = Math.max(...ys)*1.08;
  const X = v => pad.l + (v-x0)/(x1-x0||1)*(W-pad.l-pad.r);
  const Y = v => H-pad.b - v/(y1||1)*(H-pad.t-pad.b);
  ctx.clearRect(0,0,W,H);
  ctx.font = `${11*dpr}px sans-serif`;
  // grille horizontale (prix)
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.fillStyle = 'rgba(255,255,255,.45)';
  for(let g=0; g<=4; g++){
    const yv = y1*g/4, y = Y(yv);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke();
    ctx.fillText(yv.toFixed(yv<10?2:0)+'€', 4*dpr, y+4*dpr);
  }
  // dates min/max
  ctx.fillText(new Date(x0).toLocaleDateString('fr-FR'), pad.l, H-8*dpr);
  const lab = new Date(x1).toLocaleDateString('fr-FR');
  ctx.fillText(lab, W-pad.r-ctx.measureText(lab).width, H-8*dpr);
  // lignes
  for(const s of all){
    ctx.strokeStyle = s.color; ctx.lineWidth = 2*dpr; ctx.beginPath();
    s.pts.forEach((p,i) => { const x = X(p[0]), y = Y(p[1]); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); });
    ctx.stroke();
  }
  // légende
  let lx = pad.l;
  for(const s of all){
    if(!s.pts.length) continue;
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 2*dpr, 10*dpr, 3*dpr);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(s.label, lx+14*dpr, 8*dpr);
    lx += 24*dpr + ctx.measureText(s.label).width + 24*dpr;
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

export { vMarket, drawPriceChart, loadPriceChart, MARKET_LABELS, mkF };
