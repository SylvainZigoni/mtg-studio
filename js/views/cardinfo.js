import { $, $$, esc, norm, eur, CONDS, LANGS, frDate } from '../core/util.js';
import { addEntry, setTags, tags, entries, collection, saveColl, saveTags, ownedQtyMap } from '../core/model.js';
import { sfAutocomplete, sfCardByName, sfPrints, sfSetPrints, sfSearch, sfCache } from '../core/scryfall.js';
import { dbPrices, dbFoil, lastPoint } from '../core/pricedb.js';
import { deriveTags, getCustomTags, addCustomTag, removeCustomTag, similarQuery, similarityLabels } from '../core/cards.js';
import { openModal, closeModal } from '../ui.js';
import { R } from '../core/registry.js';

/* ============================================================
   FICHE CARTE — popup unique ouverte à chaque clic sur une carte
   (remplace l'ancienne fiche showCardInfo inline et la popup
   d'ajout openAddPopup : édition, prix, ajout collection, sparkline,
   métadonnées, oracle, cartes similaires)
   ============================================================ */
async function vCardInfo(app){ vCardSearch(app); }
function vCardSearch(app){

  app.innerHTML = `
  <div class="panel">
    <h3 style="margin-bottom:10px">🧠 Fiche carte : métadonnées &amp; cartes similaires</h3>
    <div class="suggbox">
      <input type="text" id="cisearch" placeholder="Nom d'une carte, ex : Llanowar Elves…" autocomplete="off" style="width:100%">
      <div class="suggestions" id="cisugg" style="display:none"></div>
    </div>
    <p class="hint" style="margin-top:8px">Sélectionnez une carte : sa fiche s'ouvre en popup (édition, prix, ajout à la collection, cartes similaires). Les tags (one drop, creature, manadork, couleur…) sont déduits automatiquement des données de règles Scryfall ; ajoutez vos propres tags dans la popup.</p>
  </div>
  <div id="cibody"></div>`;
  const input = app.querySelector('#cisearch'), sugg = app.querySelector('#cisugg');
  let t=null, items=[];
  input.oninput = () => {

    clearTimeout(t); const q = input.value.trim();
    if(q.length<2){ sugg.style.display='none'; return; }
    t = setTimeout(async () => {

      items = await sfAutocomplete(q);
      sugg.innerHTML = items.slice(0,8).map((n,i)=>`<div data-i="${i}">${esc(n)}</div>`).join('');
      sugg.style.display = items.length?'block':'none';
      sugg.querySelectorAll('div').forEach(el => el.onclick = () => {

        sugg.style.display='none';
        R.showCardInfo(items[el.dataset.i]);
      });
    }, 260);
  };
}

/* sparkline compacte 2 courbes (normal/foil) — couleurs en dur : un canvas ne résout pas var(--…) */
function drawSpark(cv, series){

  const all = (series||[]).filter(s => s.pts.length);
  if(!all.length){ cv.parentElement.innerHTML = '<p class="hint">Aucun historique de prix pour cette impression (prices.db).</p>'; return; }
  const dpr = window.devicePixelRatio||1;
  const w = cv.clientWidth || 600, h = 90;
  cv.width = w*dpr; cv.height = h*dpr;
  cv.style.height = h+'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const pts = all.flatMap(s => s.pts);
  const t0 = Math.min(...pts.map(p=>p[0])), t1 = Math.max(...pts.map(p=>p[0]));
  const v0 = Math.min(...pts.map(p=>p[1])), v1 = Math.max(...pts.map(p=>p[1]));
  const spanT = Math.max(1, t1-t0), spanV = Math.max(1e-9, v1-v0);
  const X = t => 6 + (w-12) * (t-t0) / spanT;
  const Y = v => h-18 - (h-28) * (v-v0) / spanV;
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  for(let g=0; g<=3; g++){ const y = 6 + (h-28)*g/3; ctx.beginPath(); ctx.moveTo(6,y); ctx.lineTo(w-6,y); ctx.stroke(); }
  for(const s of all){
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.pts.forEach((p,i) => { const x=X(p[0]), y=Y(p[1]); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); });
    ctx.stroke();
  }
  ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  let ly = 14;
  for(const s of all){ ctx.fillStyle = s.color; ctx.fillText(s.label, w-8, ly); ly += 14; }
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'left'; ctx.font = '10px sans-serif';
  ctx.fillText(new Date(t0).toISOString().slice(0,10) + ' → ' + new Date(t1).toISOString().slice(0,10), 6, h-5);
}
async function loadSpark(c){

  const box = document.querySelector('#cp-sparkbox'); if(!box) return;
  if(!c.id){ box.innerHTML = '<p class="hint">Historique indisponible.</p>'; return; }
  let j = null;
  try{ j = await (await fetch('/api/price?sfid='+encodeURIComponent(c.id))).json(); }catch(e){}
  if(!j || !j.ok){ box.innerHTML = `<p class="hint">⚠ ${esc((j&&j.error)||'prices.db absent : exécutez price_seed.py pour activer le marché.')}</p>`; return; }
  const series = [];
  if(j.normal && j.normal.length) series.push({label:'Normal', color:'#5b8cff', pts:j.normal.map(p => [new Date(p[0]).getTime(), p[1]])});
  if(j.foil && j.foil.length) series.push({label:'Foil', color:'#e0b84d', pts:j.foil.map(p => [new Date(p[0]).getTime(), p[1]])});
  box.innerHTML = '<canvas id="cp-sparkcv" style="width:100%"></canvas>';
  drawSpark(box.querySelector('#cp-sparkcv'), series);
}

/* popup unique fiche + ajout. ctx = {set, cn} : édition cliquée (sinon 1re impression).
   Le 2e param est conservé pour compatibilité mais la popup s'ouvre toujours en modale. */
async function showCardInfo(name, _box, ctx){

  ctx = ctx || {};
  openModal('<p class="hint">Chargement…</p>');
  $('#modal').classList.add('wide');

  let prints = [];
  try{ prints = await sfPrints(name); }catch(e){}
  let cur = null;
  if(ctx.set){

    cur = prints.find(p => p.set === ctx.set && (!ctx.cn || String(p.cn) === String(ctx.cn)))
       || prints.find(p => p.set === ctx.set) || null;
  }
  if(!cur && prints.length) cur = prints[0];
  if(!cur){ try{ cur = sfCache[norm(name)] || await sfCardByName(name); }catch(e){} }
  if(!cur){

    $('#modal').innerHTML = `<button class="close" id="mclose">✕</button><p class="hint">Carte introuvable sur Scryfall.</p>`;
    $('#mclose').onclick = closeModal;
    return;
  }
  if(!prints.length) prints = [{name:cur.name, set:cur.set, set_name:cur.set_name, released_at:cur.released_at, lang:cur.lang}];

  /* état du formulaire d'ajout, conservé quand on change d'édition */
  const st = { form:{lang:null, cond:'NM', foil:false, signed:false, qty:1, tags:[]}, simPage:1 };

  async function render(){

    /* printings de l'édition courante, toutes langues (requête par langue, source fiable) */
    let pool = prints.filter(p => p.set === cur.set);
    try{ const sp = await sfSetPrints(name, cur.set); if(sp.length) pool = sp; }catch(e){}
    let langList = [...new Set(pool.filter(x => x.set===cur.set).map(x => x.lang).filter(Boolean))];
    if(!langList.length) langList = [...new Set(pool.map(x => x.lang).filter(Boolean))];
    if(!langList.length) langList = [...new Set(prints.map(x => x.lang).filter(Boolean))];
    if(!langList.length) langList = ['en'];
    /* langue conservée si dispo dans cette édition, sinon EN, sinon la 1re */
    st.form.lang = langList.includes(st.form.lang) ? st.form.lang : (langList.includes('en') ? 'en' : langList[0]);
    /* changer de langue = changer de printing dans la même édition (visuel, n°, prix) */
    const alt = pool.find(x => x.set===cur.set && x.lang===st.form.lang);
    if(alt) cur = alt;

    const k = norm(name);
    const cp = cur.id ? dbPrices(cur.id) : null;   // prix prices.db du print affiché (jamais Scryfall)
    const cpN = cp ? (cp[0] ?? cp[1]) : null, cpF = cp ? cp[1] : null;
    const foilOk = (cur.finishes||[]).includes('foil') || dbFoil(cur.id) != null;
    const qSet = ownedQtyMap().get(k+'|'+(cur.set||'')) || 0;   // qté dans CETTE édition (foil + non foil)
    const qAll = collection[k]?.qty || 0;                       // qté TOUTES éditions confondues
    const mine = entries.filter(e => e.norm===k && (e.set||'')===(cur.set||''));   // entrées de l'édition courante
    const auto = deriveTags(cur), custom = getCustomTags(name);

    $('#modal').innerHTML = `
    <button class="close" id="mclose">✕</button>
    <div class="cp-top">
      <div class="cp-left">
        <div class="cp-imgwrap">
          <img id="cp-img" src="${cur.image||''}" data-zoom="${cur.image_lg || cur.image || ''}" alt="${esc(cur.name)}">
          <span class="qtyb cp-qset" title="Quantité possédée dans cette édition (foil + non foil confondues)">×${qSet}</span>
          <span class="qtyb cp-qall" title="Quantité possédée au total, toutes éditions (foil + non foil)">×${qAll}</span>
        </div>
        <select id="cp-set" class="cp-set" title="Toutes les éditions où cette carte a été imprimée">
          ${prints.map(p => `<option value="${esc(p.set)}" ${p.set===cur.set?'selected':''}>${esc(p.set_name||p.set)} — ${esc((p.set||'').toUpperCase())}${p.released_at?' · '+esc(p.released_at):''}</option>`).join('')}
        </select>
      </div>
      <div class="cp-right">
        <h2 style="margin-bottom:2px">${esc(cur.name)}${cur.printed_name && cur.printed_name!==cur.name?` <span class="hint">(${esc(cur.printed_name)})</span>`:''}</h2>
        <p class="hint">Édition : <b>${esc(cur.set_name||'')}</b> <span class="pill">${esc((cur.set||'').toUpperCase())}</span>${cur.released_at?` <span class="pill">sortie : ${frDate(cur.released_at)}</span>`:''}${cur.cn!=null?` <span class="pill">n° ${esc(String(cur.cn))}</span>`:''} <span class="pill">${esc((cur.lang||'en').toUpperCase())}</span></p>
        <p style="margin:6px 0"><b>Prix :</b> <span class="price" style="color:var(--warn);font-weight:700">${cpN!=null?eur(cpN):'—'}</span>${cpF!=null?` · foil <b style="color:var(--warn)">${eur(cpF)}</b>`:` · <span class="hint">pas de prix foil</span>`} <span class="pill">Cardmarket via prices.db${lastPoint()?` au ${lastPoint()}`:''}</span></p>
        <p class="hint">Langues dispo : ${langList.map(l=>`<span class="pill">${esc(l.toUpperCase())}</span>`).join(' ')}</p>
        <p class="hint">Dans collection (${esc((cur.set||'').toUpperCase())}) : ${mine.length ? mine.map(e=>`${e.qty}× ${(e.lang||'en').toUpperCase()}${e.foil?' · Foil':''}${e.signed?' · Signée':''} - ${e.cond||'NM'}`).join(' ; ') : '—'}</p>
        <div class="cp-add">
          <h4 class="sub" style="margin-top:0">Ajouter à ma collection</h4>
          <div class="row" style="flex-wrap:wrap;gap:10px">
            <label class="row" style="gap:6px"><b>Langue :</b>
              <select id="cp-lang" title="Langues disponibles pour cette carte dans cette édition">
                ${langList.map(lg => `<option value="${lg}" ${lg===st.form.lang?'selected':''}>${LANGS[lg]||lg}</option>`).join('')}
              </select></label>
            <label class="row" style="gap:6px"><b>État :</b>
              <select id="cp-cond">${CONDS.map(([v,l]) => `<option value="${v}" ${v===st.form.cond?'selected':''}>${v} — ${l}</option>`).join('')}</select></label>
            <label class="row" id="cp-foilwrap" style="gap:6px" title="${foilOk?'Cette impression existe en foil':'Cette impression n\'existe pas en foil'}"><input type="checkbox" id="cp-foil" ${foilOk?'':'disabled'} ${st.form.foil?'checked':''}> Foil</label>
            <label class="row" style="gap:6px"><input type="checkbox" id="cp-signed" ${st.form.signed?'checked':''}> Signée</label>
            <label class="row" style="gap:6px"><b>Qté :</b> <input type="number" id="cp-qty" value="${st.form.qty}" min="1" max="99" style="width:70px"></label>
          </div>
          <div class="row" style="flex-wrap:wrap;gap:10px;margin-top:10px;align-items:flex-start">
            <label><b>Sélection tag :</b><br>
              <select id="cp-tags" multiple size="${Math.min(6, Math.max(3, tags.length))}" style="min-width:180px">
                ${tags.map(t=>`<option ${st.form.tags.includes(t)?'selected':''}>${esc(t)}</option>`).join('')}
              </select></label>
            <button class="btn ghost" id="cp-newtag">+ tag</button>
            <button class="btn" id="cp-addbtn">Ajouter</button>
          </div>
        </div>
      </div>
    </div>
    <div class="cp-spark"><b class="hint">Sparkline d'évolution des prix de la carte (édition ${esc((cur.set||'').toUpperCase())})</b><div id="cp-sparkbox" style="margin-top:4px"><p class="hint">Chargement…</p></div></div>
    <div class="cp-mid">
      <div>
        <h4 class="sub">Métadonnées de la carte</h4>
        <p class="hint">${esc(cur.type_line||'')} · mv ${cur.mv ?? '—'} · ${esc(cur.rarity||'')}${cur.artist?` · ${esc(cur.artist)}`:''}${cur.reserved?' · <b>Reserve List</b>':''}</p>
        <div>${auto.map(t=>`<span class="tag auto">${esc(t)}</span>`).join('')||'<span class="hint">—</span>'}</div>
        <div>${custom.map(t=>`<span class="tag custom" data-ct="${esc(t)}">${esc(t)} ✕</span>`).join('')}
          <input type="text" id="newtag" placeholder="+ tag perso…" style="min-width:120px;padding:4px 8px">
        </div>
      </div>
      <div>
        <h4 class="sub">Texte oracle</h4>
        <p class="hint" style="white-space:pre-wrap">${esc(cur.oracle||'')}</p>
        ${cur.scryfall_uri?`<p style="margin-top:6px"><a href="${cur.scryfall_uri}" target="_blank" style="color:var(--accent)">Lien Scryfall ↗</a></p>`:''}
      </div>
    </div>
    <h4 class="sub">Cartes ressemblantes</h4>
    <div id="simcards"><p class="hint">Recherche en cours…</p></div>
    <div style="margin-top:8px"><button class="btn ghost" id="simmore" style="display:none">Charger plus</button></div>`;

    /* ---- bindings ---- */
    $('#mclose').onclick = closeModal;
    /* changer d'édition = recharger toutes les infos liées à la nouvelle édition */
    $('#cp-set').onchange = async e => {

      const p = prints.find(x => x.set === e.target.value);
      if(p){ cur = p; await render(); }
    };
    $('#cp-lang').onchange = e => { st.form.lang = e.target.value; render(); };
    $('#cp-cond').onchange = e => { st.form.cond = e.target.value; };
    $('#cp-foil').onchange = e => { st.form.foil = e.target.checked; };
    $('#cp-signed').onchange = e => { st.form.signed = e.target.checked; };
    $('#cp-qty').onchange = e => { st.form.qty = +e.target.value || 1; };
    $('#cp-tags').onchange = e => { st.form.tags = [...e.target.selectedOptions].map(o=>o.value); };
    $('#cp-newtag').onclick = () => {

      const n = prompt('Nom du tag ?');
      if(n){ setTags([...new Set([...tags, n])]); saveTags(); $('#cp-tags').innerHTML += `<option selected>${esc(n)}</option>`; }
    };
    $('#cp-addbtn').onclick = () => {

      const chosen = [...$('#cp-tags').selectedOptions].map(o=>o.value);
      const foil = !$('#cp-foil').disabled && $('#cp-foil').checked;
      addEntry({name:cur.name, set:cur.set, cn:cur.cn, foil, signed:$('#cp-signed').checked,
        qty:+$('#cp-qty').value||1, cond:$('#cp-cond').value, lang:st.form.lang, tags:chosen});
      closeModal();
      if(R.refreshTileOwned) R.refreshTileOwned(cur.name, cur.set);   // badge ×N des tuiles sans relancer la recherche
    };
    $('#newtag').onkeydown = e => {

      if(e.key==='Enter' && e.target.value.trim()){ addCustomTag(name, e.target.value.trim()); render(); }
    };
    $$('#modal [data-ct]').forEach(el => el.onclick = () => { removeCustomTag(name, el.dataset.ct); render(); });
    $('#simmore').onclick = () => loadSims(true);
    await loadSpark(cur);
    await loadSims(false);
  }

  /* cartes similaires paginées (bouton « Charger plus ») — vignettes cliquables vers la même popup */
  async function loadSims(append){

    const box = $('#simcards'); if(!box) return;
    if(!append) st.simPage = 1;
    try{

      const j = await sfSearch(similarQuery(cur), st.simPage);
      const sims = (j.data||[]).filter(x => norm(x.name)!==norm(name));
      if(!append){

        const why = similarityLabels(cur);
        box.innerHTML = (why.length ? `<p class="hint">Critères : ${why.map(w=>`<span class="tag auto">${esc(w)}</span>`).join('')}</p>` : '') + '<div class="row" id="simgrid" style="flex-wrap:wrap;gap:10px"></div>';
      }
      const grid = box.querySelector('#simgrid'); if(!grid) return;
      sims.slice(0,10).forEach(x => {

        const img = x.image_uris?.normal || x.card_faces?.[0]?.image_uris?.normal || '';
        const lg = x.image_uris?.large || img;
        const d = document.createElement('div');
        d.className = 'cardtile'; d.style.width='110px'; d.style.cursor='pointer';
        d.dataset.sn = x.name; d.dataset.set = x.set || '';
        d.innerHTML = `<img src="${img}" loading="lazy" data-zoom="${lg}" style="width:100%;aspect-ratio:488/680;object-fit:cover"><div class="info" style="font-size:11px">${esc(x.name)}</div>`;
        d.onclick = () => showCardInfo(d.dataset.sn, undefined, d.dataset.set ? {set: d.dataset.set} : null);
        grid.appendChild(d);
      });
      st.simPage++;
      const more = $('#simmore'); if(more) more.style.display = j.has_more ? 'inline-block' : 'none';
    }catch(e){

      if(!append) box.innerHTML = '<p class="hint">Recherche indisponible.</p>';
    }
  }

  await render();
}
R.views.cardinfo = vCardInfo; R.showCardInfo = showCardInfo;

export { vCardInfo, vCardSearch, showCardInfo };
