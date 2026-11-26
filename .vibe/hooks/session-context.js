// session_start hook : injecte le résumé des règles absolues dans le contexte de la session.
let s = '';
process.stdin.on('data', c => { s += c; }).on('end', () => {
  process.stdout.write(JSON.stringify({
    hook_specific_output: {
      additional_context: [
        'MTG Studio — règles absolues (détail dans AGENTS.md, lu avant toute tâche : gotchas.md + API.md §0/§3 + skills/) :',
        '- LF partout, jamais de CRLF ; prix = prices.db uniquement (jamais Scryfall pour les prix) ; *.db jamais servis en HTTP ; .env jamais lus',
        '- grepper avant d\'écrire (jamais de parallèle), lire avant d\'éditer, diff minimal',
        '- index.html + js/ toujours modifiés ensemble ; tester sur un port neuf, jamais tuer le process du port 3000 ; jamais de redirection vers nul',
        '- git : base developpement, branche dev-<sujet>, PR + CI verte (skill git-workflow) ; docs à jour dans le même commit (skill docs-update)',
      ].join('\n'),
    },
  }));
  process.exit(0);
});
