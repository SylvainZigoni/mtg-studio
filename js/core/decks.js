import { $, norm } from './util.js';
import { collection } from './model.js';
/* ---------------- données decks ---------------- */
let DECKS = [];
let EVENTS = [];   // [{eid, fmt, name, place, date, players}] triés par date desc
let PDECKS = null;
function parseDeck(i){
  if(PDECKS && PDECKS[i]) return PDECKS[i];
  if(!PDECKS) PDECKS = {};
  const d = DECKS[i];
  const parse = s => (s ? s.split('||').map(x => {const m = x.match(/^(\d+)x (.+)$/); return m ? [m[2], +m[1]] : [x,1];}) : []);
  return PDECKS[i] = {main: parse(d[10]), side: parse(d[11])};
}
function buildEvents(){
  const map = new Map();
  DECKS.forEach((d,i) => {
    if(!map.has(d[9])) map.set(d[9], {eid:d[9], fmt:d[1], name:d[6], place:d[7], date:d[8], players:d[9]===null?null:null, decks:[]});
    const e = map.get(d[9]);
    if(!e.players && d[12]) e.players = d[12];
    e.decks.push(i);
  });
  EVENTS = [...map.values()].sort((a,b) => (b.date||'').localeCompare(a.date||''));
}

async function loadData(){
  let txt = null;
  try{
    const r = await fetch('decks.json.gz');
    if(r.ok){
      const blob = await r.blob();
      txt = 'DecompressionStream' in window
        ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await r.text();
    }
  }catch(e){}
  if(!txt){ try{ const r2 = await fetch('decks.json'); if(r2.ok) txt = await r2.text(); }catch(e){} }
  if(txt){
    DECKS = JSON.parse(txt);
    buildEvents();
    $('#loader').style.display='none';
    render();
    return;
  }
  $('#loadmsg').textContent = 'Impossible de charger decks.json (page ouverte hors serveur ?). Lancez "python3 -m http.server" dans le dossier, ou choisissez le fichier.';
  $('#pickbtn').style.display='block';
  $('#pickbtn').onclick = () => $('#filepick').click();
  $('#filepick').onchange = e => {
    const rd = new FileReader();
    rd.onload = () => { DECKS = JSON.parse(rd.result); buildEvents();
      $('#loader').style.display='none'; render(); };
    rd.readAsText(e.target.files[0]);
  };
}

/* ---------------- analyse collection ↔ decks ---------------- */
function analyze(i, withSide){
  const {main, side} = parseDeck(i);
  const need = new Map();
  const add = (name, qty) => {
    const k = norm(name);
    const cur = need.get(k) || [name, 0, Math.min(collection[k]?.qty||0, qty)];
    cur[1] += qty;
    cur[2] = Math.min(collection[k]?.qty||0, cur[1]);
    need.set(k, cur);
  };
  main.forEach(([n,q]) => add(n,q));
  if(withSide) side.forEach(([n,q]) => add(n,q));
  let tot=0, own=0;
  need.forEach(v => {tot += v[1]; own += v[2];});
  return {need, pct: tot ? own/tot : 1, missingQty: tot-own};
}

export { parseDeck, buildEvents, loadData, analyze, DECKS, EVENTS, PDECKS };
