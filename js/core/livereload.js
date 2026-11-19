/* Live reload dev — autonome, chargé avant main.js dans index.html.
   Se connecte au flux SSE du serveur Node (/api/dev/livereload) et recharge
   la page dès qu'un fichier de index.html / js/ / css/ est modifié.
   Le serveur renvoyant bootId + version à chaque (re)connexion, un changement
   survenu pendant une déconnexion est aussi détecté -> reload.
   Si l'endpoint n'existe pas (livereload désactivé), le script ne fait rien. */
(() => {
  let bootId = null;
  let version = -1;
  let es;
  try {
    es = new EventSource('/api/dev/livereload');
  } catch {
    return;
  }
  const check = (d) => {
    if (!d || typeof d.version !== 'number') return;
    if (bootId === null) {           // premier hello : on mémorise l'état courant
      bootId = d.bootId;
      version = d.version;
      return;
    }
    if (d.bootId !== bootId || d.version !== version) {
      location.reload();             // le serveur a changé (redémarrage) ou un fichier a été modifié
    }
  };
  es.addEventListener('hello', (e) => { try { check(JSON.parse(e.data)); } catch {} });
  es.addEventListener('change', (e) => { try { check(JSON.parse(e.data)); } catch {} });
  // onerror : EventSource se reconnecte automatiquement ; le prochain hello tranchera.
})();
