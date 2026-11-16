/* ============================================================
   Thèmes de l'interface — js/core/themes.js
   Le choix est stocké en localStorage (clé mtg_theme) et posé
   sur <html data-theme="..."> ; les palettes vivent dans css/themes.css.
   ============================================================ */

const THEME_KEY = 'mtg_theme';

const THEMES = [
  { id: 'darkmode',           name: 'Dark mode (défaut)',      dark: true,  swatch: '#5b8cff' },
  { id: 'refreshing-summer',  name: 'Refreshing Summer fun',   dark: false, swatch: '#fb8500' },
  { id: 'black-gold',         name: 'Black & Gold elegance',   dark: true,  swatch: '#fca311' },
  { id: 'summer-dream',       name: 'Summer Dream',            dark: false, swatch: '#0081a7' },
  { id: 'summer-sunset',      name: 'Summer sunset',           dark: false, swatch: '#ff6b35' },
  { id: 'oceanic-cactus',     name: 'Oceanic cactus',          dark: false, swatch: '#4ecdc4' },
  { id: 'deep-sea',           name: 'Deep Sea',                dark: true,  swatch: '#748cab' },
  { id: 'nameless',           name: 'Nameless',                dark: false, swatch: '#ff7a41' },
  { id: 'theone',             name: 'TheOne',                  dark: false, swatch: '#08b2e3' },
];

function currentTheme(){
  try { return JSON.parse(localStorage.getItem(THEME_KEY)) || 'darkmode'; }
  catch(e){ return 'darkmode'; }
}

function applyTheme(id){
  if(!THEMES.some(t => t.id === id)) id = 'darkmode';
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(THEME_KEY, JSON.stringify(id)); } catch(e){}
  return id;
}

export { THEMES, THEME_KEY, currentTheme, applyTheme };
