import { $ } from './util.js';
/* ---------------- stockage local ---------------- */
const store = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){
    // quota dépassé : vider le cache scryfall
    localStorage.removeItem('mtg_sf_cache'); localStorage.setItem(k, JSON.stringify(v));
  }
    if(window.__booted && SYNC_KEYS.includes(k)) pushState();
  },
};
/* ---------------- synchronisation BDD (serveur Node server/ + SQLite) ----------------
   Toutes les saisies sont poussées vers la base SQLite du serveur
   (mtg_data.db) avec un léger délai de regroupement. localStorage reste
   un cache de repli si la page est ouverte hors serveur (file://). */
const SYNC_KEYS = ['mtg_collection','mtg_binders','mtg_matches','mtg_custom_tags','mtg_decks'];
let syncTimer = null;
export const syncState = { ok: null };
function pushState(){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try{
      const body = {};
      SYNC_KEYS.forEach(k => { const raw = localStorage.getItem(k); if(raw != null) body[k] = raw; });
      const r = await fetch('/api/state', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
      syncState.ok = r.ok; setSyncBadge(true);
    }catch(e){ syncState.ok = false; setSyncBadge(false); }
  }, 700);
}
function setSyncBadge(up){
  const el = document.getElementById('syncdot');
  if(!el) return;
  el.textContent = up ? '✔ sauvegardé dans la BDD' : '⚠ hors serveur — saisies seulement dans le navigateur';
  el.className = 'syncdot ' + (up ? 'ok' : 'off');
}
export { pushState, setSyncBadge, store, SYNC_KEYS, syncTimer };
