// pre_tool guard : bloque tout accès à un fichier .env (clés API, secrets).
let s = '';
process.stdin.on('data', c => { s += c; }).on('end', () => {
  let p;
  try { p = JSON.parse(s); } catch { process.exit(0); }
  const ti = p.tool_input || {};
  const target = String(ti.file_path || ti.path || ti.command || '');
  if (/\.env([\/\\.]|$)/.test(target)) {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: "accès à un fichier .env interdit — l'utilisateur édite ses clés lui-même" }));
    process.exit(0);
  }
  process.exit(0);
});
