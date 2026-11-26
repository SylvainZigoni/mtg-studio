"use strict";
/* ============================================================
   MTG Studio — app.js
   Collection + Decks MTGTop8 2026 + Matchs + Stats + Tags
   Version 2026-11-16b (phase 1 : client découpé en modules ES) */

/* ---------------- utilitaires ---------------- */
const FMT_NAMES = {MO:"Modern", LE:"Legacy", VI:"Vintage", PAU:"Pauper", PREM:"Premodern", EDH:"Duel Commander"};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => s.toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'').replace(/ \/\/.*/,'').trim();
const eur = v => v==null ? '—' : parseFloat(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',') + ' €';
const fmtName = f => FMT_NAMES[f] || f;

const CONDS = [['MT','Mint'],['NM','Near Mint'],['EX','Excellent'],['GD','Good'],['LP','Light Played'],['PL','Played'],['PO','Poor']];
const COND_LABEL = Object.fromEntries(CONDS);
const LANGS = {en:'Anglais', fr:'Français', de:'Allemand', es:'Espagnol', it:'Italien', pt:'Portugais', ja:'Japonais', ko:'Coréen', ru:'Russe', 'zhs':'Chinois (simplifié)', 'zht':'Chinois (traditionnel)', ph:'Phyrexian', cs:'Tchèque'};
const TYPES_LIST = ['Creature','Instant','Sorcery','Artifact','Enchantment','Land','Planeswalker','Battle'];
/* date ISO 'YYYY-MM-DD' -> 'JJ/MM/AAAA' (affichage à la française) */
const frDate = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ? String(iso) : '—');
};

/* petit drapeau d'une langue (SVG /assets/icons/flags/<code>.svg) ; alt = code si image absente */
const langFlagHTML = code => {
  const c = String(code || 'en').toLowerCase();
  return `<img class="langflag" src="/assets/icons/flags/${c}.svg" alt="${esc(c.toUpperCase())}" title="${esc(LANGS[c] || c)}">`;
};

export { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS, TYPES_LIST, frDate, langFlagHTML };
