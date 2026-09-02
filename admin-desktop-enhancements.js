(() => {
'use strict';

/* Améliorations desktop uniquement. L'envoi email reste dans client.js : un seul handler. */
import('./admin-desktop-enhancements-core.js?v=15473-github-pages-core')
  .catch(err=>console.error('CalasOrga desktop enhancements:',err));
})();
