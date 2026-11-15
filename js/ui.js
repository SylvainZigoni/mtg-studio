import { $ } from './core/util.js';
function openModal(html){
  $('#modal').innerHTML = html;
  $('#modalbg').classList.add('open');
  $('#modalbg').onclick = e => { if(e.target.id==='modalbg') e.target.classList.remove('open'); };
}
function closeModal(){ $('#modalbg').classList.remove('open'); }

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
export { openModal, closeModal };
