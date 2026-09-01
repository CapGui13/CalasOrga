(() => {
'use strict';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const isDesktop=()=>document.documentElement.classList.contains('ui-desktop')||document.body.classList.contains('ui-desktop');
const dayOverlay=()=>$('#adminCorrectionOverlay');
const dayOpen=()=>dayOverlay()&&!dayOverlay().classList.contains('hidden');
const currentDay=()=>String($('#dayEditorDate')?.value||'');
let drag=null;
let dropHandled=false;
let enhanceQueued=false;
let cellWasOpen=false;
let cellSyncPending=null;

function injectStyle(){
  if($('#desktopDayEditorEnhancementStyle'))return;
  const style=document.createElement('style');
  style.id='desktopDayEditorEnhancementStyle';
  style.textContent=`
    .ui-desktop #adminCorrectionOverlay .day-assignment-chip,
    .ui-desktop #adminCorrectionOverlay .day-available-chip{cursor:grab}
    .ui-desktop #adminCorrectionOverlay .day-assignment-chip.dragging,
    .ui-desktop #adminCorrectionOverlay .day-available-chip.dragging{opacity:.45;cursor:grabbing}
    .ui-desktop.day-editor-external-drop #adminCorrectionOverlay .admin-correction-dialog{outline:2px dashed rgba(151,52,52,.24);outline-offset:-8px}
  `;
  document.head.append(style)
}

function hideHistory(){
  const link=$('.admin-tabs [data-admin-page="history"]');
  if(link){
    if(!link.classList.contains('hidden'))link.classList.add('hidden');
    if(!link.hidden)link.hidden=true;
    if(link.getAttribute('aria-hidden')!=='true')link.setAttribute('aria-hidden','true');
    if(link.tabIndex!==-1)link.tabIndex=-1
  }
  const page=$('[data-admin-view="history"]');
  if(page){
    if(!page.classList.contains('hidden'))page.classList.add('hidden');
    if(page.getAttribute('aria-hidden')!=='true')page.setAttribute('aria-hidden','true')
  }
  if(location.pathname==='/admin/historique'||location.pathname==='/admin/historique/'){
    history.replaceState({},'', '/admin');
    const calendar=$('.admin-tabs [data-admin-page="calendar"]');
    if(calendar)queueMicrotask(()=>calendar.click())
  }
}

function normalizeRenewLabels(){
  const main=$('#memberManageRotateAll');
  if(main&&!main.disabled&&main.textContent.trim()!=='Renouveler')main.textContent='Renouveler';
  const confirm=$('#confirmOverlay');
  if(confirm&&!confirm.classList.contains('hidden')){
    const title=$('#confirmTitle');
    const accept=$('#confirmAccept');
    if(title&&/^Renouveler (tous )?les liens$/i.test(title.textContent.trim()))title.textContent='Renouveler';
    if(accept&&/^Renouveler les liens$/i.test(accept.textContent.trim()))accept.textContent='Renouveler'
  }
}

function memberIdByName(name){
  const wanted=String(name||'').trim();
  if(!wanted)return'';
  for(const item of $$('#dayMemberPool .day-member-source-item')){
    const n=$('strong',item)?.textContent?.trim();
    if(n===wanted&&item.dataset.memberId)return String(item.dataset.memberId)
  }
  for(const row of $$('#membersTable tr[data-member-id]')){
    const n=row.querySelector('td')?.textContent?.trim();
    if(n===wanted)return String(row.dataset.memberId||'')
  }
  return''
}

function roleZone(role){return $(`#adminCorrectionOverlay .day-role-dropzone[data-day-role="${CSS.escape(role)}"]`)}

function assignViaExistingUi(memberId,role){
  const id=String(memberId||'');
  if(!id)return;
  const item=$(`#dayMemberPool .day-member-source-item[data-member-id="${CSS.escape(id)}"]`);
  if(!item)return;
  item.click();
  const zone=roleZone(role);
  if(zone)zone.click()
}

function removeCurrentRole(role,memberId=''){
  const zone=roleZone(role);
  if(!zone)return;
  if(role==='present'){
    const id=String(memberId||'');
    for(const chip of $$('.day-available-chip',zone)){
      const chipId=chip.dataset.memberId||memberIdByName($('span',chip)?.textContent);
      if(!id||String(chipId)===id){$('.day-assignment-remove',chip)?.click();if(id)break}
    }
  }else{
    $('.day-assignment-chip .day-assignment-remove',zone)?.click()
  }
}

function decorateChip(chip,role){
  if(!isDesktop()||chip.dataset.desktopDndWired==='1')return;
  let memberId='';
  if(role==='present')memberId=memberIdByName($('span',chip)?.textContent);
  else memberId=String(chip.closest('.day-role-dropzone')?.dataset.selectedId||'');
  if(!memberId)return;
  chip.dataset.desktopDndWired='1';
  chip.dataset.memberId=memberId;
  chip.draggable=true;
  const remove=$('.day-assignment-remove',chip);
  chip.title=`Glisser pour déplacer ${$('span',chip)?.textContent?.trim()||'ce membre'} · déposer hors du tableau pour retirer`;
  chip.addEventListener('dragstart',e=>{
    drag={memberId,sourceRole:role,removeButton:remove};
    dropHandled=false;
    chip.classList.add('dragging');
    document.body.classList.add('day-editor-external-drop');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',memberId)
  });
  chip.addEventListener('dragend',()=>{
    chip.classList.remove('dragging');
    document.body.classList.remove('day-editor-external-drop');
    drag=null;dropHandled=false
  })
}

function wrapDropzone(zone){
  if(!isDesktop())return;
  const original=zone.ondrop;
  if(typeof original!=='function'||original.__calasDesktopWrapped)return;
  const wrapped=function(e){
    if(!drag)return original.call(zone,e);
    const targetRole=String(zone.dataset.dayRole||'');
    const sourceRole=drag.sourceRole;
    const sourceId=drag.memberId;
    if(sourceRole===targetRole){dropHandled=true;return original.call(zone,e)}

    const displacedId=targetRole!=='present'?String(zone.dataset.selectedId||''):'';
    const canSwap=sourceRole!=='present'&&targetRole!=='present'&&displacedId&&displacedId!==sourceId;

    dropHandled=true;
    if(sourceRole)drag.removeButton?.click();
    const result=original.call(zone,e);

    if(canSwap)queueMicrotask(()=>assignViaExistingUi(displacedId,sourceRole));
    return result
  };
  wrapped.__calasDesktopWrapped=true;
  wrapped.__calasDesktopOriginal=original;
  zone.ondrop=wrapped
}

function wireDoubleClick(zone){
  if(!isDesktop()||zone.dataset.desktopDblWired==='1')return;
  zone.dataset.desktopDblWired='1';
  zone.addEventListener('dblclick',e=>{
    if(!isDesktop())return;
    if(e.target instanceof Element&&e.target.closest('button'))return;
    e.preventDefault();e.stopPropagation();
    const date=currentDay(),role=String(zone.dataset.dayRole||'');
    if(!date||!role)return;
    const cell=$(`#adminScheduleBody td[data-date="${CSS.escape(date)}"][data-role="${CSS.escape(role)}"]`);
    if(!cell)return;
    cellSyncPending={date,role};
    cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window,detail:2}))
  })
}

function syncRoleFromPlanning(date,role){
  if(!dayOpen()||currentDay()!==String(date))return;
  const cell=$(`#adminScheduleBody td[data-date="${CSS.escape(date)}"][data-role="${CSS.escape(role)}"]`);
  if(!cell)return;
  const ids=$$('[data-member-id]',cell).map(el=>String(el.dataset.memberId||'')).filter(Boolean);
  if(role==='present'){
    const zone=roleZone('present');
    if(zone)for(const btn of $$('.day-available-chip .day-assignment-remove',zone))btn.click();
    for(const id of [...new Set(ids)])assignViaExistingUi(id,'present')
  }else{
    removeCurrentRole(role);
    if(ids[0])assignViaExistingUi(ids[0],role)
  }
}

function enhanceDayEditor(){
  enhanceQueued=false;
  hideHistory();normalizeRenewLabels();injectStyle();
  if(!isDesktop()||!dayOpen())return;
  for(const zone of $$('#adminCorrectionOverlay .day-role-dropzone')){
    wrapDropzone(zone);wireDoubleClick(zone)
  }
  for(const zone of $$('#adminCorrectionOverlay .day-role-dropzone[data-day-role]:not([data-day-role="present"])')){
    const chip=$('.day-assignment-chip',zone);if(chip)decorateChip(chip,String(zone.dataset.dayRole||''))
  }
  const available=roleZone('present');
  if(available)for(const chip of $$('.day-available-chip',available))decorateChip(chip,'present')
}

function queueEnhance(){
  if(enhanceQueued)return;
  enhanceQueued=true;
  requestAnimationFrame(enhanceDayEditor)
}

// Comme dans le planning principal : déposer une affectation hors du tableau la retire.
document.addEventListener('dragover',e=>{
  if(!drag||!isDesktop())return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('#adminCorrectionOverlay .day-editor-columns'))return;
  e.preventDefault();
  if(e.dataTransfer)e.dataTransfer.dropEffect='move'
});
document.addEventListener('drop',e=>{
  if(!drag||dropHandled||!isDesktop())return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('#adminCorrectionOverlay .day-editor-columns'))return;
  e.preventDefault();dropHandled=true;
  drag.removeButton?.click()
});

const observer=new MutationObserver(()=>{
  const cell=$('#adminCellOverlay');
  const open=cell&&!cell.classList.contains('hidden');
  if(cellWasOpen&&!open&&cellSyncPending){
    const pending=cellSyncPending;cellSyncPending=null;
    setTimeout(()=>syncRoleFromPlanning(pending.date,pending.role),0)
  }
  cellWasOpen=!!open;
  queueEnhance()
});
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});

window.addEventListener('popstate',hideHistory);
queueEnhance();
})();
