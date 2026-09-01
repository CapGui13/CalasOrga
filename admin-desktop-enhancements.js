(() => {
'use strict';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const ROLE_LABEL={accueil:'Accueil',tpe:'TPE',mep:'MEP',arbitrage:'Arbitrage',present:'Disponible'};
const isDesktop=()=>document.documentElement.classList.contains('ui-desktop')||document.body.classList.contains('ui-desktop');
const overlay=()=>$('#adminCorrectionOverlay');
const editorOpen=()=>overlay()&&!overlay().classList.contains('hidden');
const currentDate=()=>String($('#dayEditorDate')?.value||'');

let assignedDrag=null;
let dropHandled=false;
let enhanceQueued=false;
let cellWasOpen=false;
let pendingCellSync=null;

function injectStyle(){
  if($('#desktopDayEditorParityStyle'))return;
  const style=document.createElement('style');
  style.id='desktopDayEditorParityStyle';
  style.textContent=`
    .ui-desktop #adminCorrectionOverlay .day-role-dropzone{cursor:pointer}
    .ui-desktop #adminCorrectionOverlay .day-assignment-chip,
    .ui-desktop #adminCorrectionOverlay .day-available-chip{cursor:grab;user-select:none}
    .ui-desktop #adminCorrectionOverlay .day-assignment-chip.dragging,
    .ui-desktop #adminCorrectionOverlay .day-available-chip.dragging{opacity:.42;cursor:grabbing}
    .ui-desktop #adminCorrectionOverlay .day-role-dropzone.admin-drop-target{outline:2px solid rgba(33,108,74,.42);outline-offset:-2px}
    .ui-desktop #adminCorrectionOverlay .day-role-dropzone.admin-drop-swap{outline:2px solid rgba(38,89,142,.48);outline-offset:-2px}
    .ui-desktop #adminCorrectionOverlay .day-role-dropzone.admin-drop-replace{outline:2px solid rgba(166,101,32,.48);outline-offset:-2px}
    .ui-desktop.day-editor-external-drop #adminCorrectionOverlay .admin-correction-dialog{outline:2px dashed rgba(151,52,52,.30);outline-offset:-8px}
  `;
  document.head.append(style)
}

function hideHistory(){
  const link=$('.admin-tabs [data-admin-page="history"]');
  if(link){
    link.classList.add('hidden');
    link.hidden=true;
    link.setAttribute('aria-hidden','true');
    link.tabIndex=-1
  }
  const page=$('[data-admin-view="history"]');
  if(page){
    page.classList.add('hidden');
    page.setAttribute('aria-hidden','true')
  }
  if(/^\/admin\/historique\/?$/.test(location.pathname)){
    history.replaceState({},'', '/admin');
    setTimeout(()=>$('.admin-tabs [data-admin-page="calendar"]')?.click(),0)
  }
}

function normalizeRenewButton(){
  const button=$('#memberManageRotateAll');
  if(button&&!button.disabled&&button.textContent.trim()!=='Renouveler')button.textContent='Renouveler';
  const confirm=$('#confirmOverlay');
  if(confirm&&!confirm.classList.contains('hidden')){
    const accept=$('#confirmAccept');
    if(accept&&/^Renouveler les liens$/i.test(accept.textContent.trim()))accept.textContent='Renouveler'
  }
}

function memberIdByName(name){
  const wanted=String(name||'').trim();
  if(!wanted)return'';
  for(const item of $$('#dayMemberPool .day-member-source-item')){
    if($('strong',item)?.textContent?.trim()===wanted&&item.dataset.memberId)return String(item.dataset.memberId)
  }
  return''
}

function roleZone(role){
  return $(`#adminCorrectionOverlay .day-role-dropzone[data-day-role="${CSS.escape(String(role||''))}"]`)
}

function zoneMemberIds(role){
  const zone=roleZone(role);
  if(!zone)return[];
  if(role!=='present'){
    const id=String(zone.dataset.selectedId||'');
    return id?[id]:[]
  }
  return $$('.day-available-chip',zone)
    .map(chip=>String(chip.dataset.memberId||memberIdByName($('span',chip)?.textContent)))
    .filter(Boolean)
}

function selectPoolMember(memberId){
  const id=String(memberId||'');
  if(!id)return false;
  const item=$(`#dayMemberPool .day-member-source-item[data-member-id="${CSS.escape(id)}"]`);
  if(!item)return false;
  if(item.getAttribute('aria-pressed')!=='true')item.click();
  return true
}

function assignThroughEditor(memberId,role){
  if(!selectPoolMember(memberId))return false;
  roleZone(role)?.click();
  return true
}

function removeThroughEditor(role,memberId=''){
  const zone=roleZone(role);
  if(!zone)return false;
  if(role!=='present'){
    const btn=$('.day-assignment-chip .day-assignment-remove',zone);
    if(!btn)return false;
    btn.click();
    return true
  }
  const wanted=String(memberId||'');
  for(const chip of $$('.day-available-chip',zone)){
    const id=String(chip.dataset.memberId||memberIdByName($('span',chip)?.textContent));
    if(!wanted||id===wanted){
      const btn=$('.day-assignment-remove',chip);
      if(btn){btn.click();return true}
    }
  }
  return false
}

function clearDropClasses(){
  for(const zone of $$('#adminCorrectionOverlay .day-role-dropzone')){
    zone.classList.remove('admin-drop-target','admin-drop-swap','admin-drop-replace','drag-over','drop-denied')
  }
}

function decorateAssignedChip(chip,role,memberId){
  if(!isDesktop()||!memberId||chip.dataset.desktopPlanningParity==='1')return;
  chip.dataset.desktopPlanningParity='1';
  chip.dataset.memberId=String(memberId);
  chip.draggable=true;
  const remove=$('.day-assignment-remove',chip);
  const name=$('span',chip)?.textContent?.trim()||'ce membre';
  chip.title=`Glisser ${name} vers une autre case · déposer hors du tableau pour retirer`;
  chip.addEventListener('dragstart',e=>{
    assignedDrag={
      memberId:String(memberId),
      sourceRole:String(role),
      removeButton:remove,
      chip
    };
    dropHandled=false;
    chip.classList.add('dragging');
    document.body.classList.add('day-editor-external-drop');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',String(memberId))
  });
  chip.addEventListener('dragend',()=>{
    chip.classList.remove('dragging');
    document.body.classList.remove('day-editor-external-drop');
    clearDropClasses();
    assignedDrag=null;
    dropHandled=false
  })
}

function decorateAssignedChips(){
  if(!isDesktop()||!editorOpen())return;
  for(const role of ['accueil','tpe','mep','arbitrage']){
    const zone=roleZone(role);
    const chip=$('.day-assignment-chip',zone);
    const id=String(zone?.dataset.selectedId||'');
    if(chip&&id)decorateAssignedChip(chip,role,id)
  }
  const available=roleZone('present');
  if(available){
    for(const chip of $$('.day-available-chip',available)){
      const id=String(chip.dataset.memberId||memberIdByName($('span',chip)?.textContent));
      if(id)decorateAssignedChip(chip,'present',id)
    }
  }
}

function dropVisual(zone,targetRole){
  clearDropClasses();
  if(!assignedDrag)return;
  const sourceRole=assignedDrag.sourceRole;
  const sourceId=assignedDrag.memberId;
  if(sourceRole===targetRole)return;
  const targetIds=zoneMemberIds(targetRole);
  const swap=
    sourceRole!=='present'&&targetRole!=='present'&&
    targetIds.length===1&&targetIds[0]!==sourceId;
  const replace=!swap&&targetRole!=='present'&&targetIds.some(id=>id!==sourceId);
  zone.classList.add(swap?'admin-drop-swap':replace?'admin-drop-replace':'admin-drop-target')
}

function confirmReplacement(targetRole,targetIds,memberId){
  if(targetRole==='present')return true;
  const replaced=targetIds.filter(id=>id!==memberId);
  if(!replaced.length)return true;
  const names=replaced.map(id=>{
    const item=$(`#dayMemberPool .day-member-source-item[data-member-id="${CSS.escape(id)}"] strong`);
    return item?.textContent?.trim()||'ce membre'
  }).join(', ');
  const sourceName=$(`#dayMemberPool .day-member-source-item[data-member-id="${CSS.escape(memberId)}"] strong`)?.textContent?.trim()||'Le membre';
  return window.confirm(`${ROLE_LABEL[targetRole]||targetRole} contient déjà ${names}. ${sourceName} le remplacera. Continuer ?`)
}

function performAssignedDrop(targetRole){
  if(!assignedDrag)return;
  const sourceRole=String(assignedDrag.sourceRole);
  const memberId=String(assignedDrag.memberId);
  if(!sourceRole||!memberId||sourceRole===targetRole)return;

  const targetIds=zoneMemberIds(targetRole);
  const canSwap=
    sourceRole!=='present'&&targetRole!=='present'&&
    targetIds.length===1&&targetIds[0]!==memberId;
  const displacedId=canSwap?targetIds[0]:'';

  if(!canSwap&&!confirmReplacement(targetRole,targetIds,memberId))return;

  // Même logique que le planning global : move, ou swap entre deux postes simples.
  removeThroughEditor(sourceRole,memberId);
  assignThroughEditor(memberId,targetRole);
  if(displacedId)assignThroughEditor(displacedId,sourceRole)
}

function installZoneDnD(zone){
  if(!isDesktop()||!zone)return;

  const currentOver=zone.ondragover;
  if(currentOver&&currentOver!==zone.__desktopParityOver){
    zone.__desktopParityBaseOver=currentOver;
    const wrappedOver=function(e){
      if(!assignedDrag)return zone.__desktopParityBaseOver?.call(zone,e);
      e.preventDefault();
      const targetRole=String(zone.dataset.dayRole||'');
      if(assignedDrag.sourceRole===targetRole){
        e.dataTransfer.dropEffect='none';
        clearDropClasses();
        return
      }
      e.dataTransfer.dropEffect='move';
      dropVisual(zone,targetRole)
    };
    zone.__desktopParityOver=wrappedOver;
    zone.ondragover=wrappedOver
  }

  const currentDrop=zone.ondrop;
  if(currentDrop&&currentDrop!==zone.__desktopParityDrop){
    zone.__desktopParityBaseDrop=currentDrop;
    const wrappedDrop=function(e){
      const targetRole=String(zone.dataset.dayRole||'');
      if(!assignedDrag){
        // Un membre venant de la colonne Membres garde le comportement existant,
        // mais un remplacement de poste reçoit la même confirmation que le planning.
        const id=String(e.dataTransfer?.getData('text/plain')||'');
        const targetIds=zoneMemberIds(targetRole);
        if(id&&targetRole!=='present'&&targetIds.some(x=>x!==id)){
          if(!confirmReplacement(targetRole,targetIds,id)){
            e.preventDefault();
            clearDropClasses();
            return
          }
        }
        return zone.__desktopParityBaseDrop?.call(zone,e)
      }
      e.preventDefault();
      e.stopPropagation();
      dropHandled=true;
      clearDropClasses();
      performAssignedDrop(targetRole)
    };
    zone.__desktopParityDrop=wrappedDrop;
    zone.ondrop=wrappedDrop
  }
}

function openSameCellEditor(role){
  const date=currentDate();
  if(!date||!role)return;
  const cell=$(`#adminScheduleBody td[data-date="${CSS.escape(date)}"][data-role="${CSS.escape(role)}"]`);
  if(!cell)return;
  pendingCellSync={date,role};
  cell.dispatchEvent(new MouseEvent('dblclick',{
    bubbles:true,cancelable:true,view:window,detail:2
  }))
}

function installDoubleClick(zone){
  if(!isDesktop()||!zone||zone.dataset.desktopPlanningDbl==='1')return;
  zone.dataset.desktopPlanningDbl='1';
  zone.addEventListener('dblclick',e=>{
    if(!isDesktop())return;
    if(e.target instanceof Element&&e.target.closest('button'))return;
    e.preventDefault();
    e.stopPropagation();
    openSameCellEditor(String(zone.dataset.dayRole||''))
  })
}

function syncDraftRoleFromPlanning(date,role){
  if(!editorOpen()||currentDate()!==String(date))return;
  const cell=$(`#adminScheduleBody td[data-date="${CSS.escape(String(date))}"][data-role="${CSS.escape(String(role))}"]`);
  if(!cell)return;
  const ids=$$('[data-member-id]',cell).map(el=>String(el.dataset.memberId||'')).filter(Boolean);
  if(role==='present'){
    for(const old of [...zoneMemberIds('present')])removeThroughEditor('present',old);
    for(const id of [...new Set(ids)])assignThroughEditor(id,'present')
  }else{
    removeThroughEditor(role);
    if(ids[0])assignThroughEditor(ids[0],role)
  }
}

function enhanceEditor(){
  enhanceQueued=false;
  injectStyle();
  hideHistory();
  normalizeRenewButton();
  if(!isDesktop()||!editorOpen())return;
  for(const zone of $$('#adminCorrectionOverlay .day-role-dropzone')){
    installZoneDnD(zone);
    installDoubleClick(zone)
  }
  decorateAssignedChips()
}

function queueEnhance(){
  if(enhanceQueued)return;
  enhanceQueued=true;
  requestAnimationFrame(enhanceEditor)
}

// Déposer une affectation sur la colonne Membres = la retirer du poste.
$('#dayMemberPool')?.addEventListener('dragover',e=>{
  if(!assignedDrag||!isDesktop())return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move'
});
$('#dayMemberPool')?.addEventListener('drop',e=>{
  if(!assignedDrag||dropHandled||!isDesktop())return;
  e.preventDefault();
  e.stopPropagation();
  dropHandled=true;
  removeThroughEditor(assignedDrag.sourceRole,assignedDrag.memberId)
});

// Comme dans le planning global : un drop hors du tableau retire l'affectation.
document.addEventListener('dragover',e=>{
  if(!assignedDrag||!isDesktop())return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('#adminCorrectionOverlay .day-editor-columns'))return;
  e.preventDefault();
  if(e.dataTransfer)e.dataTransfer.dropEffect='move'
});
document.addEventListener('drop',e=>{
  if(!assignedDrag||dropHandled||!isDesktop())return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('#adminCorrectionOverlay .day-editor-columns'))return;
  e.preventDefault();
  e.stopPropagation();
  dropHandled=true;
  removeThroughEditor(assignedDrag.sourceRole,assignedDrag.memberId)
});

const editor=overlay();
if(editor){
  new MutationObserver(queueEnhance).observe(editor,{
    subtree:true,childList:true,attributes:true,attributeFilter:['class']
  })
}

const cellOverlay=$('#adminCellOverlay');
if(cellOverlay){
  cellWasOpen=!cellOverlay.classList.contains('hidden');
  new MutationObserver(()=>{
    const open=!cellOverlay.classList.contains('hidden');
    if(cellWasOpen&&!open&&pendingCellSync){
      const pending=pendingCellSync;
      pendingCellSync=null;
      // Le planning global applique son snapshot optimiste immédiatement ;
      // un petit délai laisse son rendu se terminer avant de recopier la case.
      setTimeout(()=>syncDraftRoleFromPlanning(pending.date,pending.role),60)
    }
    cellWasOpen=open
  }).observe(cellOverlay,{attributes:true,attributeFilter:['class']})
}

const confirmOverlay=$('#confirmOverlay');
if(confirmOverlay){
  new MutationObserver(normalizeRenewButton).observe(confirmOverlay,{subtree:true,childList:true,attributes:true,attributeFilter:['class']})
}

window.addEventListener('popstate',hideHistory);
hideHistory();
normalizeRenewButton();
queueEnhance();
})();
