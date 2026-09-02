(() => {
'use strict';

<<<<<<< HEAD
/* Améliorations desktop uniquement. L'envoi email reste dans client.js : un seul handler. */
import('/admin-desktop-enhancements-core.js?v=1548-stabilized-core')
  .catch(err=>console.error('CalasOrga desktop enhancements:',err));
})();
=======
/* Charge les améliorations desktop historiques sans les modifier. */
import('./admin-desktop-enhancements-core.js?v=1548-desktop-admin-core')
  .catch(err=>console.error('CalasOrga desktop enhancements:',err));

function cookie(name){
  const match=document.cookie.match(new RegExp('(?:^|; )'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'=([^;]*)'));
  return match?decodeURIComponent(match[1]):'';
}

function mailMemberId(button){
  if(button.id==='memberQuickSend')return String(document.querySelector('#memberQuickPanel')?.dataset.memberId||'');
  return String(button.closest('tr[data-member-id]')?.dataset.memberId||'');
}

function setMailState(mode,text){
  const state=document.querySelector('#adminSaveState');
  if(!state)return;
  state.className=`admin-save-state ${mode||''}`;
  state.textContent=text||'';
  state.classList.toggle('hidden',!text);
}

async function sendLinkDirect(button){
  const memberId=mailMemberId(button);
  if(!memberId)return;

  button.disabled=true;
  button.classList.add('is-busy');
  button.setAttribute('aria-busy','true');
  setMailState('saving','Envoi…');

  try{
    const response=await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/send-link`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-CSRF-Token':cookie('club_admin_csrf')
      },
      body:'{}',
      cache:'no-store'
    });
    let payload={};
    try{payload=await response.json()}catch{}
    if(!response.ok||payload.sent!==true)throw new Error(payload.error||'Envoi Gmail impossible.');

    setMailState('saved','Lien envoyé ✓');
    setTimeout(()=>document.querySelector('#adminSaveState')?.classList.add('hidden'),1600);
  }catch(error){
    const message=String(error?.message||error||'Envoi Gmail impossible.');
    setMailState('error','Échec de l’envoi');
    const notice=document.querySelector('#adminError');
    if(notice){notice.textContent=message;notice.classList.remove('hidden')}
    setTimeout(()=>document.querySelector('#adminSaveState')?.classList.add('hidden'),3000);
  }finally{
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    button.disabled=false;
  }
}

/* Capture volontaire : pour l'action mail uniquement, on empêche l'ancien
   handler client.js d'appeler beginAdminSave()/endAdminSave(). L'appel HTTP
   reste exactement la même route sécurisée /send-link. */
document.addEventListener('click',event=>{
  const target=event.target instanceof Element
    ?event.target.closest('.member-link-send,#memberQuickSend')
    :null;
  if(!target||target.disabled)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void sendLinkDirect(target);
},true);
})();
>>>>>>> e0506927d53ade50b6a8c3d1def3237aa5a80dcf
