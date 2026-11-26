// pre_tool guard : bloque toute écriture (write_file/edit) contenant un retour chariot.
// Le projet est 100 % LF (.gitattributes eol=lf) — un hook pre-commit git bloque aussi les \r stagés.
let s = '';
process.stdin.on('data', c => { s += c; }).on('end', () => {
  let p;
  try { p = JSON.parse(s); } catch { process.exit(0); }
  const ti = p.tool_input || {};
  const content = String(ti.content ?? ti.new_string ?? '');
  if (/\r/.test(content)) {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'CRLF interdit (projet 100 % LF) — réécrire le contenu en LF' }));
    process.exit(0);
  }
  process.exit(0);
});
