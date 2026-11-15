"use strict";
/* ============================================================
   MTG Studio — app.js
   Collection + Decks MTGTop8 2026 + Matchs + Stats + Tags
   Version 2026-11-16a (phase 1 : client découpé en modules ES) */

/* ---------------- utilitaires ---------------- */
const FMT_NAMES = {MO:"Modern", LE:"Legacy", VI:"Vintage", PAU:"Pauper", PREM:"Premodern", EDH:"Duel Commander"};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => s.toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'').replace(/ \/\/.*/,'').trim();
const eur = v => v==null ? '—' : parseFloat(v).toFixed(2).replace('.',',') + ' €';
const fmtName = f => FMT_NAMES[f] || f;

const CONDS = [['MT','Mint'],['NM','Near Mint'],['EX','Excellent'],['GD','Good'],['LP','Light Played'],['PL','Played'],['PO','Poor']];
const COND_LABEL = Object.fromEntries(CONDS);
const LANGS = {en:'Anglais', fr:'Français', de:'Allemand', es:'Espagnol', it:'Italien', pt:'Portugais', ja:'Japonais', ko:'Coréen', ru:'Russe', 'zhs':'Chinois (simplifié)', 'zht':'Chinois (traditionnel)', ph:'Phyrexian', cs:'Tchèque'};

export { FMT_NAMES, $, $$, esc, norm, eur, fmtName, CONDS, COND_LABEL, LANGS };
