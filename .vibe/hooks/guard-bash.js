// pre_tool guard : bloque les commandes bash dangereuses (voir AGENTS.md « Règles absolues »).
// Lit le payload hook JSON sur stdin ; répond {"decision":"deny","reason":...} pour bloquer.
let s = '';
process.stdin.on('data', c => { s += c; }).on('end', () => {
  let p;
  try { p = JSON.parse(s); } catch { process.exit(0); }
  const cmd = String((p.tool_input && p.tool_input.command) || '');
  if (!cmd) process.exit(0);
  const bad = [
    [/\bpkill\b/i, "pkill n'existe pas en Git Bash — tuer ciblé par PID (netstat -ano | findstr :PORT + taskkill //PID <pid> //F)"],
    [/\d?>+\s*nul\b/i, "redirection vers 'nul' interdite (crée un fichier littéral nul indexable par git)"],
    [/\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/|~\s*$|C:[\/\\]\s*$)/i, "rm -rf sur la racine/home interdit"],
    [/\b(del|rd)\s+\/s\s+\/q\s+(\/|~|C:[\/\\])/i, "del/rd /s /q sur la racine interdit"],
    [/git\s+push\b[^\n]*(\bmain\b|\bdeveloppement\b)/i, "push direct vers main/developpement interdit — branche dev-<sujet> + PR (skill git-workflow)"],
    [/git\s+push\s+(--force|-f)\b/i, "force push interdit sur ce projet"],
    [/python\s+-m\s+http\.server/i, "python -m http.server interdit (pas de POST) — lancer node server/server.js"],
  ];
  for (const [re, why] of bad) {
    if (re.test(cmd)) {
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: why + ' — commande : ' + cmd.slice(0, 200) }));
      process.exit(0);
    }
  }
  process.exit(0);
});
