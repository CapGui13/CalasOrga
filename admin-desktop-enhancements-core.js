(() => {
'use strict';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const ROLE_LABEL={accueil:'Accueil',tpe:'TPE',mep:'MEP',arbitrage:'Arbitrage',present:'Disponible'};
const CORE_ROLES=['accueil','tpe','mep','arbitrage'];
const finePointer=()=>window.matchMedia?.('(hover: hover) and (pointer: fine)').matches===true;
const desktop=()=>document.documentElement.classList.contains('ui-desktop')||document.body.classList.contains('ui-desktop')||finePointer();
const overlay=()=>$('#adminCorrectionOverlay');
const editorOpen=()=>overlay()&&!overlay().classList.contains('hidden');
const currentDate=()=>String($('#dayEditorDate')?.value||'');

let assignedDrag=null;
let dropHandled=false;
let queued=false;
let cellWasOpen=false;
let pendingCellSync=null;

<<<<<<< HEAD
=======
function hideHistory(){
  const link=$('.admin-tabs [data-admin-page="history"]');
  if(link){
    link.classList.add('hidden');
    link.hidden=true;
    link.setAttribute('aria-hidden','true');
    link.tabIndex=-1;
  }
  const page=$('[data-admin-view="history"]');
  if(page){
    page.classList.add('hidden');
    page.setAttribute('aria-hidden','true');
  }
  if(/^\/admin\/historique\/?$/.test(location.pathname)){
    history.replaceState({},'', '/admin');
    setTimeout(()=>$('.admin-tabs [data-admin-page="calendar"]')?.click(),0);
  }
}

>>>>>>> e0506927d53ade50b6a8c3d1def3237aa5a80dcf
function normalizeRenewButton(){
  const button=$('#memberManageRotateAll');
  if(button&&!button.disabled&&button.textContent.trim()!=='Renouveler')button.textContent='Renouveler';
  const confirm=$('#confirmOverlay');
  if(confirm&&!confirm.classList.contains('hidden')){
    const accept=$('#confirmAccept');
    if(accept&&/^Renouveler les liens$/i.test(accept.textContent.trim()))accept.textContent='Renouveler';
  }
}

function removePlanningChipThroughExistingEditor(chip,button){
  const cell=chip?.closest('#adminScheduleBody td[data-date][data-role]');
  const memberId=String(chip?.dataset.memberId||'');
  const role=String(cell?.dataset.role||'');
  if(!cell||!memberId||!role)return;

  button.disabled=true;
  cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window,detail:2}));

  requestAnimationFrame(()=>{
    const cellOverlay=$('#adminCellOverlay');
    if(!cellOverlay||cellOverlay.classList.contains('hidden')){
      button.disabled=false;
      return;
    }

    if(role==='present'){
      const input=$$('#adminCellAvailableChoices input[type="checkbox"]')
        .find(x=>String(x.value)===memberId);
      if(!input){
        $('#adminCellClose')?.click();
        button.disabled=false;
        return;
      }
      input.checked=false;
      const form=$('#adminCellForm');
      if(form?.requestSubmit)form.requestSubmit();
      else $('#adminCellActions button[type="submit"]')?.click();
      return;
    }

    const empty=$('#adminCellRoleChoices .single-choice-item.empty-choice');
    if(empty){
      empty.click();
    }else{
      $('#adminCellClose')?.click();
      button.disabled=false;
    }
  });
}

function decoratePlanningRemoveButtons(){
  if(!desktop())return;
  for(const chip of $$('#adminScheduleBody td[data-date][data-role] .role-chip[data-member-id]')){
    if(chip.dataset.adminQuickRemove==='1')continue;
    chip.dataset.adminQuickRemove='1';

    const name=chip.textContent.trim()||'ce membre';
    const button=document.createElement('button');
    button.type='button';
    button.className='day-assignment-remove';
    button.textContent='×';
    button.draggable=false;
    button.title=`Retirer ${name} de ${ROLE_LABEL[String(chip.closest('td[data-role]')?.dataset.role||'')]||'cette case'}`;
    button.setAttribute('aria-label',button.title);
    button.addEventListener('pointerdown',e=>e.stopPropagation());
    button.addEventListener('dragstart',e=>{e.preventDefault();e.stopPropagation()});
    button.addEventListener('click',e=>{
      e.preventDefault();
      e.stopPropagation();
      removePlanningChipThroughExistingEditor(chip,button);
    });
    chip.append(button);
  }
}

function memberIdByName(name){
  const wanted=String(name||'').trim();
  if(!wanted)return'';
  for(const item of $$('#dayMemberPool .day-member-source-item')){
    if($('strong',item)?.textContent?.trim()===wanted&&item.dataset.memberId)return String(item.dataset.memberId);
  }
  return'';
}

function roleZone(role){
  return $(`#adminCorrectionOverlay .day-role-dropzone[data-day-role="${CSS.escape(String(role||''))}"]`);
}

function zoneMemberIds(role){
  const zone=roleZone(role);
  if(!zone)return[];
  if(role!=='present'){
    const id=String(zone.dataset.selectedId||'');
    return id?[id]:[];
  }
  return $$('.day-available-chip',zone)
    .map(chip=>String(chip.dataset.memberId||memberIdByName($('span',chip)?.textContent)))
    .filter(Boolean);
}

function selectPoolMember(memberId){
  const id=String(memberId||'');
  if(!id)return false;
  const item=$(`#dayMemberPool .day-member-source-item[data-member-id="${CSS.escape(id)}"]`);
  if(!item)return false;
  if(item.getAttribute('aria-pressed')!=='true')item.click();
  return true;
}

function assignThroughEditor(memberId,role){
  if(!selectPoolMember(memberId))return false;
  roleZone(role)?.click();
  return true;
}

function removeThroughEditor(role,memberId=''){
  const zone=roleZone(role);
  if(!zone)return false;
  if(role!=='present'){
    const btn=$('.day-assignment-chip .day-assignment-remove',zone);
    if(!btn)return false;
    btn.click();
    return true;
  }
  const wanted=String(memberId||'');
  for(const chip of $$('.day-available-chip',zone)){
    const id=String(chip.dataset.memberId||memberIdByName($('span',chip)?.textContent));
    if(!wanted||id===wanted){
      const btn=$('.day-assignment-remove',chip);
      if(btn){btn.click();return true;}
    }
  }
  return false;
}

function clearDropClasses(){
  for(const zone of $$('#adminCorrectionOverlay .day-role-dropzone')){
    zone.classList.remove('admin-drop-target','admin-drop-swap','admin-drop-copy','admin-drop-invalid','drag-over','drop-denied');
  }
}

function confirmReplacement(targetRole,targetIds,memberId){
  if(targetRole==='present')return true;
  const replaced=targetIds.filter(id=>id!==memberId);
  if(!replaced.length)return true;
  const names=replaced.map(id=>$(`#dayMemberPool .day-member-source-item[data-member-id="${CSS.escape(id)}"] strong`)?.textContent?.trim()||'ce membre').join(', ');
  const sourceName=$(`#dayMemberPool .day-member-source-item[data-member-id="${CSS.escape(memberId)}"] strong`)?.textContent?.trim()||'Le membre';
  return window.confirm(`${ROLE_LABEL[targetRole]||targetRole} contient déjà ${names}. ${sourceName} le remplacera. Continuer ?`);
}

function performAssignedDrop(targetRole){
  if(!assignedDrag)return;
  const sourceRole=String(assignedDrag.sourceRole||'');
  const memberId=String(assignedDrag.memberId||'');
  if(!sourceRole||!memberId||sourceRole===targetRole)return;

  const targetIds=zoneMemberIds(targetRole);
  const canSwap=CORE_ROLES.includes(sourceRole)&&CORE_ROLES.includes(targetRole)&&targetIds.length===1&&targetIds[0]!==memberId;
  const displacedId=canSwap?targetIds[0]:'';

  if(!canSwap&&!confirmReplacement(targetRole,targetIds,memberId))return;

  removeThroughEditor(sourceRole,memberId);
  assignThroughEditor(memberId,targetRole);
  if(displacedId)assignThroughEditor(displacedId,sourceRole);
}

function decorateAssignedChip(chip,role,memberId){
  if(!desktop()||!chip||!memberId)return;

<<<<<<< HEAD
=======
  /* Réutilise le contrat visuel/cursor du planning au lieu d'un style inline.
     La CSP reste donc totalement respectée. */
>>>>>>> e0506927d53ade50b6a8c3d1def3237aa5a80dcf
  chip.classList.add('admin-role-editable');
  chip.dataset.memberId=String(memberId);
  chip.draggable=true;

  if(chip.dataset.desktopPlanningDrag==='1')return;
  chip.dataset.desktopPlanningDrag='1';
  const remove=$('.day-assignment-remove',chip);
  const name=$('span',chip)?.textContent?.trim()||'ce membre';
  chip.title=`Glisser ${name} vers une autre case · déposer hors du tableau pour retirer`;

  chip.addEventListener('dragstart',e=>{
    assignedDrag={memberId:String(memberId),sourceRole:String(role),removeButton:remove,chip};
    dropHandled=false;
    chip.classList.add('dragging');
    document.body.classList.add('day-editor-external-drop');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',String(memberId));
  });

  chip.addEventListener('dragend',()=>{
    chip.classList.remove('dragging');
    document.body.classList.remove('day-editor-external-drop');
    clearDropClasses();
    assignedDrag=null;
    dropHandled=false;
  });
}

function decorateAssignedChips(){
  if(!desktop()||!editorOpen())return;
  for(const role of CORE_ROLES){
    const zone=roleZone(role);
    const chip=$('.day-assignment-chip',zone);
    const id=String(zone?.dataset.selectedId||'');
    if(chip&&id)decorateAssignedChip(chip,role,id);
  }
  const available=roleZone('present');
  if(available){
    for(const chip of $$('.day-available-chip',available)){
      const id=String(chip.dataset.memberId||memberIdByName($('span',chip)?.textContent));
      if(id)decorateAssignedChip(chip,'present',id);
    }
  }
}

function installZone(zone){
  if(!desktop()||!zone)return;

<<<<<<< HEAD
=======
  /* C'est exactement la classe utilisée par les cellules du planning principal :
     même main pointer, même hover et même focus. */
>>>>>>> e0506927d53ade50b6a8c3d1def3237aa5a80dcf
  zone.classList.add('admin-role-editable');
  for(const placeholder of $$('.day-drop-placeholder',zone))placeholder.classList.add('admin-role-editable');

  if(zone.dataset.desktopPlanningDbl!=='1'){
    zone.dataset.desktopPlanningDbl='1';
    zone.addEventListener('dblclick',e=>{
      if(!desktop())return;
      if(e.target instanceof Element&&e.target.closest('button'))return;
      e.preventDefault();
      e.stopPropagation();
      const date=currentDate();
      const role=String(zone.dataset.dayRole||'');
      const cell=$(`#adminScheduleBody td[data-date="${CSS.escape(date)}"][data-role="${CSS.escape(role)}"]`);
      if(!cell)return;
      pendingCellSync={date,role};
      cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window,detail:2}));
    });
  }

  const currentOver=zone.ondragover;
  if(currentOver&&currentOver!==zone.__desktopParityOver){
    zone.__desktopParityBaseOver=currentOver;
    const wrappedOver=function(e){
      if(!assignedDrag)return zone.__desktopParityBaseOver?.call(zone,e);
      e.preventDefault();
      clearDropClasses();
      const targetRole=String(zone.dataset.dayRole||'');
      if(assignedDrag.sourceRole===targetRole){
        e.dataTransfer.dropEffect='none';
        return;
      }
      e.dataTransfer.dropEffect='move';
      const targetIds=zoneMemberIds(targetRole);
      const swap=CORE_ROLES.includes(assignedDrag.sourceRole)&&CORE_ROLES.includes(targetRole)&&targetIds.length===1&&targetIds[0]!==assignedDrag.memberId;
      zone.classList.add(swap?'admin-drop-swap':'admin-drop-target');
    };
    zone.__desktopParityOver=wrappedOver;
    zone.ondragover=wrappedOver;
  }

  const currentDrop=zone.ondrop;
  if(currentDrop&&currentDrop!==zone.__desktopParityDrop){
    zone.__desktopParityBaseDrop=currentDrop;
    const wrappedDrop=function(e){
      const targetRole=String(zone.dataset.dayRole||'');
      if(!assignedDrag){
        const id=String(e.dataTransfer?.getData('text/plain')||'');
        const targetIds=zoneMemberIds(targetRole);
        if(id&&targetRole!=='present'&&targetIds.some(x=>x!==id)&&!confirmReplacement(targetRole,targetIds,id)){
          e.preventDefault();
          clearDropClasses();
          return;
        }
        return zone.__desktopParityBaseDrop?.call(zone,e);
      }
      e.preventDefault();
      e.stopPropagation();
      dropHandled=true;
      clearDropClasses();
      performAssignedDrop(targetRole);
    };
    zone.__desktopParityDrop=wrappedDrop;
    zone.ondrop=wrappedDrop;
  }
}

function syncDraftRoleFromPlanning(date,role){
  if(!editorOpen()||currentDate()!==String(date))return;
  const cell=$(`#adminScheduleBody td[data-date="${CSS.escape(String(date))}"][data-role="${CSS.escape(String(role))}"]`);
  if(!cell)return;
  const ids=$$('[data-member-id]',cell).map(el=>String(el.dataset.memberId||'')).filter(Boolean);
  if(role==='present'){
    for(const old of [...zoneMemberIds('present')])removeThroughEditor('present',old);
    for(const id of [...new Set(ids)])assignThroughEditor(id,'present');
  }else{
    removeThroughEditor(role);
    if(ids[0])assignThroughEditor(ids[0],role);
  }
}

function enhance(){
  queued=false;
<<<<<<< HEAD
=======
  hideHistory();
>>>>>>> e0506927d53ade50b6a8c3d1def3237aa5a80dcf
  normalizeRenewButton();
  if(!desktop())return;
  decoratePlanningRemoveButtons();
  if(!editorOpen())return;
  for(const zone of $$('#adminCorrectionOverlay .day-role-dropzone'))installZone(zone);
  decorateAssignedChips();
}

function queueEnhance(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(enhance);
}

$('#dayMemberPool')?.addEventListener('dragover',e=>{
  if(!assignedDrag||!desktop())return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
});
$('#dayMemberPool')?.addEventListener('drop',e=>{
  if(!assignedDrag||dropHandled||!desktop())return;
  e.preventDefault();
  e.stopPropagation();
  dropHandled=true;
  removeThroughEditor(assignedDrag.sourceRole,assignedDrag.memberId);
});

document.addEventListener('dragover',e=>{
  if(!assignedDrag||!desktop())return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('#adminCorrectionOverlay .day-editor-columns'))return;
  e.preventDefault();
  if(e.dataTransfer)e.dataTransfer.dropEffect='move';
});
document.addEventListener('drop',e=>{
  if(!assignedDrag||dropHandled||!desktop())return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('#adminCorrectionOverlay .day-editor-columns'))return;
  e.preventDefault();
  e.stopPropagation();
  dropHandled=true;
  removeThroughEditor(assignedDrag.sourceRole,assignedDrag.memberId);
});

const editor=overlay();
if(editor){
  new MutationObserver(queueEnhance).observe(editor,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
}

const planningBody=$('#adminScheduleBody');
if(planningBody){
  new MutationObserver(queueEnhance).observe(planningBody,{subtree:true,childList:true});
}

const cellOverlay=$('#adminCellOverlay');
if(cellOverlay){
  cellWasOpen=!cellOverlay.classList.contains('hidden');
  new MutationObserver(()=>{
    const open=!cellOverlay.classList.contains('hidden');
    if(cellWasOpen&&!open&&pendingCellSync){
      const pending=pendingCellSync;
      pendingCellSync=null;
      setTimeout(()=>syncDraftRoleFromPlanning(pending.date,pending.role),60);
    }
    cellWasOpen=open;
  }).observe(cellOverlay,{attributes:true,attributeFilter:['class']});
}

const confirmOverlay=$('#confirmOverlay');
if(confirmOverlay){
  new MutationObserver(normalizeRenewButton).observe(confirmOverlay,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
}

<<<<<<< HEAD
normalizeRenewButton();
queueEnhance();
})();
=======
window.addEventListener('popstate',hideHistory);
hideHistory();
normalizeRenewButton();
queueEnhance();
})();
>>>>>>> e0506927d53ade50b6a8c3d1def3237aa5a80dcf
