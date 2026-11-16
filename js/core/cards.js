import { store } from './store.js';
import { norm } from './util.js';
/* ---------------- moteur de tags (point 12) ---------------- */
function deriveTags(c){
  if(!c) return [];
  const t = [];
  const mv = c.mv ?? 0;
  if(mv <= 1) t.push('one drop'); else if(mv == 2) t.push('two drop'); else if(mv == 3) t.push('three drop');
  else if(mv >= 6) t.push('grosse bombe');
  const tl = (c.type_line||'').toLowerCase();
  if(tl.includes('creature')) t.push('creature');
  if(tl.includes('instant')) t.push('instant');
  if(tl.includes('sorcery')) t.push('ritual');
  if(tl.includes('artifact')) t.push('artifact');
  if(tl.includes('enchantment')) t.push('enchantment');
  if(tl.includes('land')) t.push('land');
  if(tl.includes('planeswalker')) t.push('planeswalker');
  if(tl.includes('token')) t.push('token');
  (c.colors||[]).forEach(col => t.push({W:'blanc',U:'bleu',B:'noir',R:'rouge',G:'vert',C:'incolore'}[col]||col));
  const o = (c.oracle||'').toLowerCase();
  if(/add \{|add one mana|add \d mana|mana of any (one )?color/.test(o)) t.push('manadork');
  if(/deals .{0,30}damage to any target/.test(o)) t.push('direct damage');
  if(/deals .{0,30}damage (to|to any|target).{0,20}(player|opponent|any target)/.test(o)) t.push('player direct damage');
  if(/(destroy|exile) target/.test(o)) t.push('removal');
  if(/deals .{0,20}damage to (each|all) (creature|permanent)/.test(o) || /destroy all /.test(o)) t.push('board wipe');
  if(/counter target/.test(o)) t.push('counter');
  if(/search(es)? (your|this) library/.test(o)) t.push('tutor');
  if(/draw(s)? (a|one|two|\d) card/.test(o)) t.push('cantrip');
  if(/you gain|gains?\s\d+\s*life|lifelink/.test(o)) t.push('gain de vie');
  if(/target (player|opponent) (discards|discard)/.test(o) || /discard(s)? .{0,20}card/.test(o)) t.push('discard');
  if(/create .{0,30}token/.test(o)) t.push('génération de token');
  if(/return target .{0,30}card from your graveyard/.test(o)) t.push('réanimation');
  if(/sacrifice/.test(o)) t.push('sacrifice');
  if(/flying/.test(o)) t.push('vol');
  if(/trample/.test(o)) t.push('piétinement');
  if(/haste/.test(o)) t.push('célérité');
  if(/first strike/.test(o)) t.push('initiative');
  if(/deathtouch/.test(o)) t.push('contact mortel');
  if(/lifelink/.test(o)) t.push('lien de vie');
  if(/hexproof/.test(o)) t.push('protection');
  if(/vigilance/.test(o)) t.push('vigilance');
  if(/prowess/.test(o)) t.push('prowess');
  if(/flash/.test(o) && !tl.includes('land')) t.push('flash');
  return [...new Set(t)];
}
const CUSTOM_TAGS = 'mtg_custom_tags';
function getCustomTags(name){ return (store.get(CUSTOM_TAGS, {})[norm(name)] || []); }
function addCustomTag(name, tag){
  const all = store.get(CUSTOM_TAGS, {}); const k = norm(name);
  all[k] = [...new Set([...(all[k]||[]), tag])];
  store.set(CUSTOM_TAGS, all);
}
function removeCustomTag(name, tag){
  const all = store.get(CUSTOM_TAGS, {}); const k = norm(name);
  all[k] = (all[k]||[]).filter(t => t !== tag);
  store.set(CUSTOM_TAGS, all);
}
function allTags(name, c){ return [...deriveTags(c), ...getCustomTags(name)]; }

/* ---------------- moteur de similarité fonctionnelle (inspiré mtgsimilarcards) ----
   On décrit ce que FAIT la carte à partir de son oracle : chaque signature
   regex devient une "capacité", avec une requête Scryfall associée. Les
   cartes similaires partagent les capacités principales, même si le type,
   le coût ou la couleur diffèrent. */
const SIGS = [
  {id:'burn_any',    rx:/deals? .{0,25}damage to any target/,          label:'dégâts directs (n\'importe quelle cible)', q:'o:/deals .+damage to any target/'},
  {id:'burn_player', rx:/deals? .{0,25}damage to (a )?(target )?(player|opponent)/, label:'dégâts au joueur', q:'o:/deals .+damage to (target )?(player|opponent)/'},
  {id:'burn_crea',   rx:/deals? .{0,25}damage to target creature/,     label:'dégâts à une créature', q:'o:/deals .+damage to target creature/'},
  {id:'ping',        rx:/(it|this) (deals|deals? .{0,15}damage)/,      label:'inflige des dégâts', q:'o:/deals .+damage/'},
  {id:'counter',     rx:/counter target (spell|ability)/,              label:'contre un sort', q:'o:/counter target (spell|ability)/'},
  {id:'removal',     rx:/(destroy|exile) target (creature|artifact|enchantment|nonland|permanent)/, label:'destruction/exil ciblé', q:'o:/(destroy|exile) target/'},
  {id:'exile',       rx:/exile/,                                       label:'exil', q:'o:/exile/'},
  {id:'wipe',        rx:/(destroy|exile) (all|each)/,                  label:'nettoie le plateau', q:'o:/(destroy|exile) (all|each)/'},
  {id:'mass_damage', rx:/deals? .{0,20}damage to (each|all)/,          label:'dégâts de masse', q:'o:/deals .+damage to (each|all)/'},
  {id:'draw',        rx:/draw(s)? (a|one|two|three|\d+) card/,         label:'pioche', q:'o:/draw/'},
  {id:'draw_many',   rx:/draw(s)? (two|three|four|\d)[^,.;]*cards?/,   label:'pioche multiple', q:'o:/draw/ +2 cards/'},
  {id:'discard',     rx:/(target (player|opponent) (discards)|discard(s)?)/, label:'fait défausser', q:'o:/discard/'},
  {id:'tutor',       rx:/search(es)? (your|this) library/,             label:'tutor ( Cherchez dans votre bibliothèque )', q:'o:/search(es)? (your|this) library/'},
  {id:'ramp',        rx:/add \{|add one mana|add \d mana/,             label:'accélération de mana', q:'o:/add .+mana/'},
  {id:'token',       rx:/create(s)? .{0,35}token/,                     label:'crée des jetons', q:'o:/create/'},
  {id:'lifegain',    rx:/(you gain|gains?) .{0,10}life|lifelink/,      label:'gain de vie', q:'o:/gain .+life/'},
  {id:'reanimate',   rx:/return .{0,50}(from your graveyard|to the battlefield)/, label:'récupère depuis le cimetière', q:'o:/return .+graveyard/'},
  {id:'bounce',      rx:/return(s)? .{0,40}to (its owner|hand)/,       label:'renvoie en main', q:'o:/return .+(hand|owner)/'},
  {id:'sac',         rx:/sacrifice/,                                   label:'sacrifice', q:'o:/sacrifice/'},
  {id:'pump',        rx:/gets? \+[0-9x]/,                              label:'boost de créature', q:'o:/gets? \+/'},
  {id:'evasion',     rx:/can't be blocked/,                            label:'imblocable', q:'o:/can\'t be blocked/'},
  {id:'flying',      rx:/flying/,                                      label:'vol', q:'o:/flying/'},
  {id:'flash',       rx:/flash/,                                       label:'flash', q:'o:/flash/'},
  {id:'tapdown',     rx:/(doesn't untap|tap target|tap that)/,         label:'engage/bloque une créature', q:'o:/(doesn.t untap|tap target)/'},
  {id:'fights',      rx:/(fights|deals damage equal)/,                label:'combat forcé', q:'o:/fights/'},
  {id:'copy',        rx:/copy (of|that|target)/,                       label:'copie', q:'o:/copy/'},
  {id:'scry',        rx:/scry \d/,                                     label:'scry', q:'o:/scry/'},
  {id:'mill',        rx:/mill(ed)? \d/,                                label:'mill', q:'o:/mill/'},
  {id:'pw_abilities',rx:/loyalty/,                                     label:'planeswalker', q:null},
];
function functionalProfile(c){
  const o = (c.oracle||'').toLowerCase();
  return SIGS.filter(s => s.rx.test(o)).map(s => s);
}
/* requête Scryfall : combine les capacités principales en OR, affine par type. */
function similarQuery(c){
  const sigs = functionalProfile(c);
  const usable = sigs.filter(s => s.q);
  const tl = (c.type_line||'').toLowerCase();
  const parts = [];
  // les 3 capacités les plus discriminantes en OR
  const ors = usable.slice(0,3).map(s => `(${s.q})`);
  if(ors.length) parts.push(`(${ors.join(' or ')})`);
  else parts.push('(o:/draw/ or o:/deals/ or o:/destroy/ or o:/counter/)');   // repli générique
  const types = ['creature','instant','sorcery','artifact','enchantment','land','planeswalker'].filter(x => tl.includes(x));
  if(types.length) parts.push(`(t:${types[0]} or t:${types[1] || types[0]})`);
  if(c.mv != null) parts.push(`mv>=${Math.max(0, c.mv-2)} mv<=${c.mv+2}`);
  return parts.join(' ') + ` -oracle_id:"${c.oracle_id || c.name}"`;
}
function similarityLabels(c){ return functionalProfile(c).slice(0,4).map(s => s.label); }

export { deriveTags, getCustomTags, addCustomTag, removeCustomTag, allTags, functionalProfile, similarQuery, similarityLabels, CUSTOM_TAGS, SIGS };
