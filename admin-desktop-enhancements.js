(() => {
'use strict';

/* Charge les améliorations desktop historiques sans les modifier. */
import('./admin-desktop-enhancements-core.js?v=1548-desktop-admin-core')
  .catch(err=>console.error('CalasOrga desktop enhancements:',err));

/* L'envoi d'un lien n'est pas un enregistrement du planning.
   Ce listener s'exécute en phase bubble, donc APRÈS le handler du bouton :
   il ne bloque ni ne modifie jamais la requête d'envoi. Il ne fait que
   remplacer le texte de l'indicateur global pendant/après l'opération. */
document.addEventListener('click',event=>{
  const target=event.target instanceof Element
    ? event.target.closest('.member-link-send,#memberQuickSend')
    : null;
  if(!target||target.disabled)return;

  queueMicrotask(()=>{
    if(!target.classList.contains('is-busy'))return;
    const state=document.querySelector('#adminSaveState');
    if(!state)return;

    state.className='admin-save-state saving';
    state.textContent='Envoi…';
    state.classList.remove('hidden');

    const started=Date.now();
    const timer=setInterval(()=>{
      if(target.classList.contains('is-busy')&&Date.now()-started<20000){
        if(state.textContent!=='Envoi…'){
          state.className='admin-save-state saving';
          state.textContent='Envoi…';
          state.classList.remove('hidden');
        }
        return;
      }

      clearInterval(timer);

      /* Si une autre sauvegarde admin est encore en cours, on la laisse
         reprendre la main sur l'indicateur global. */
      if(state.classList.contains('saving'))return;

      const failed=state.classList.contains('error');
      state.className=`admin-save-state ${failed?'error':'saved'}`;
      state.textContent=failed?'Échec de l’envoi':'Lien envoyé ✓';
      state.classList.remove('hidden');
      setTimeout(()=>state.classList.add('hidden'),failed?2800:1400);
    },50);
  });
});
})();