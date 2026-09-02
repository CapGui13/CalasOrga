(() => {
'use strict';
const GITHUB_PAGES = location.hostname.endsWith('github.io');
const LOCAL = location.protocol === 'file:' || new URLSearchParams(location.search).get('local') === '1';
const GITHUB_HOME = 'https://capgui13.github.io/CalasOrga/';
const PROD_ORIGIN = 'https://calasorga.vercel.app';
const PROD_ADMIN_URL = 'https://capgui13.github.io/CalasOrga/Admin/';
const DEVICE_MARKER_KEY = 'calasorga-member-device-v1';
const STORAGE_KEY = 'club-presences-complete-v14';
const LOCAL_ROSTER_VERSION='demo-v2';
const INITIAL_MEMBERS=Array.from({length:10},(_,i)=>({
  name:`Membre démo ${i+1}`,
  email:`membre${i+1}@example.invalid`
}));
const CORE_ROLE_KEYS=['accueil','tpe','mep','arbitrage'];
const ROLE_KEYS=[...CORE_ROLE_KEYS,'present'];
const ROLE_LABELS={accueil:'Accueil',tpe:'TPE',mep:'Mise en place',arbitrage:'Arbitrage',present:'Disponible'};
const MEMBER_COLLATOR=new Intl.Collator('fr-FR',{sensitivity:'base',numeric:true,ignorePunctuation:true});
function memberDisplayName(m){return String(m?.name??m?.displayName??'').trim()}
function sortMembersAlpha(list){
  return [...(list||[])].sort((a,b)=>{
    const c=MEMBER_COLLATOR.compare(memberDisplayName(a),memberDisplayName(b));
    return c||String(a?.id||'').localeCompare(String(b?.id||''))
  })
}
function memberNameFromLookup(lookup,id){
  const v=lookup?.[id];
  return typeof v==='string'?v:String(v?.name??v?.displayName??'')
}
function sortMemberIds(ids,lookup){
  return [...new Set((ids||[]).map(String))].sort((a,b)=>{
    const c=MEMBER_COLLATOR.compare(memberNameFromLookup(lookup,a),memberNameFromLookup(lookup,b));
    return c||a.localeCompare(b)
  })
}
function sortNamesAlpha(names){
  return [...(names||[])].sort((a,b)=>MEMBER_COLLATOR.compare(String(a),String(b)))
}

const q = (s) => document.querySelector(s);

/* =========================================================
   UI MODE CONTRACT — exactly three display families
   desktop : precise/non-touch device
   tablet  : touch-capable device, short side >= 600 CSS px
   mobile  : touch-capable device, short side < 600 CSS px

   The short side is orientation-independent, so a tablet remains
   a tablet in both portrait and landscape. CSS consumes only the
   ui-desktop / ui-tablet / ui-mobile classes below. ?ui=desktop|tablet|mobile persists an override; ?ui=auto clears it.
   ========================================================= */
const UI_MODE_CLASSES=['ui-desktop','ui-tablet','ui-mobile'];
const UI_MODE_OVERRIDE_KEY='calasorga-ui-mode-v1';
let currentUiMode='desktop';
let uiModeOverride='';
function uiShortSide(){
  const sw=Number(globalThis.screen?.width||0),sh=Number(globalThis.screen?.height||0);
  if(sw>0&&sh>0)return Math.min(sw,sh);
  const vw=Number(globalThis.visualViewport?.width||globalThis.innerWidth||document.documentElement.clientWidth||0);
  const vh=Number(globalThis.visualViewport?.height||globalThis.innerHeight||document.documentElement.clientHeight||0);
  return Math.min(vw||9999,vh||9999)
}
function uiTouchCapable(){
  return Number(navigator.maxTouchPoints||0)>0
    || window.matchMedia?.('(pointer: coarse)').matches===true
    || window.matchMedia?.('(any-pointer: coarse)').matches===true
}
function uiPrecisePointerActive(){
  return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches===true
}
function uiDesktopPlatformHint(){
  const platform=String(navigator.userAgentData?.platform||navigator.platform||'');
  return /windows|win32|win64/i.test(platform)
}
function readUiModeOverride(){
  const valid=new Set(['desktop','tablet','mobile']);
  let query='';
  try{query=new URLSearchParams(location.search).get('ui')||''}catch{}
  if(query==='auto'){
    try{localStorage.removeItem(UI_MODE_OVERRIDE_KEY)}catch{}
    return''
  }
  if(valid.has(query)){
    try{localStorage.setItem(UI_MODE_OVERRIDE_KEY,query)}catch{}
    return query
  }
  try{
    const saved=localStorage.getItem(UI_MODE_OVERRIDE_KEY)||'';
    return valid.has(saved)?saved:''
  }catch{return''}
}
uiModeOverride=readUiModeOverride();
function detectUiMode(){
  if(uiModeOverride)return uiModeOverride;
  const shortSide=uiShortSide();
  if(!uiTouchCapable())return'desktop';
  /* Un grand appareil hybride (Surface/PC tactile) piloté par une vraie
     souris/trackpad reste desktop. Un téléphone/tablette tactile sans
     pointeur précis conserve mobile/tablette. */
  if(shortSide>=800&&(uiPrecisePointerActive()||uiDesktopPlatformHint()))return'desktop';
  return shortSide<600?'mobile':'tablet'
}
function applyUiMode(){
  const next=detectUiMode();
  currentUiMode=next;
  for(const root of [document.documentElement,document.body]){
    if(!root)continue;
    root.classList.remove(...UI_MODE_CLASSES);
    root.classList.add(`ui-${next}`);
    root.dataset.uiMode=next;
    root.dataset.uiModeSource=uiModeOverride?'override':'auto';
    root.dataset.uiInputProfile=uiPrecisePointerActive()?'fine':'touch'
  }
  queueMicrotask(()=>wireHorizontalScrollAffordances?.());
  return next
}
function setUiModeOverride(mode='auto'){
  const next=String(mode||'auto').toLowerCase();
  if(next==='auto'){
    uiModeOverride='';
    try{localStorage.removeItem(UI_MODE_OVERRIDE_KEY)}catch{}
  }else if(UI_MODE_CLASSES.includes(`ui-${next}`)){
    uiModeOverride=next;
    try{localStorage.setItem(UI_MODE_OVERRIDE_KEY,next)}catch{}
  }else return currentUiMode;
  return applyUiMode()
}
globalThis.CalasOrgaUiMode={get:()=>currentUiMode,set:setUiModeOverride,clear:()=>setUiModeOverride('auto')};
applyUiMode();
let uiModeRefreshTimer=0;
function scheduleUiModeRefresh(){
  clearTimeout(uiModeRefreshTimer);
  uiModeRefreshTimer=setTimeout(applyUiMode,100)
}
window.addEventListener('resize',scheduleUiModeRefresh,{passive:true});
globalThis.visualViewport?.addEventListener?.('resize',scheduleUiModeRefresh,{passive:true});
function isTouchUi(){return currentUiMode!=='desktop'}
function usesSingleActivation(event){
  if(event?.detail===0)return true; // clavier / activation assistive
  const pointerType=String(event?.pointerType||'').toLowerCase();
  if(pointerType)return pointerType==='touch'||pointerType==='pen';
  return isTouchUi()
}
function memberStateActionTitle(active,name=''){
  return `${active?'Désactiver':'Activer'} ${name||'ce membre'} : un tap tactile, Entrée/Espace, ou double-clic à la souris`
}

const pad = (n) => String(n).padStart(2,'0');
const clone = (v) => JSON.parse(JSON.stringify(v));
const localRoot = q('#appRoot');
if (LOCAL) { document.body.classList.add('mode-local'); q('#localBanner').classList.remove('hidden'); }
let localState = null, currentLocalMemberId = '', memberData = null, adminData = null, adminSessionContext = null, memberMonth = '', memberCalendarMode = 'auto', adminMonth = '', adminCalendarMode = 'auto', currentAdminPage = 'calendar', adminSavePending = 0, adminSaveTimer = 0, adminReconcileTimer = 0, memberBusy = false, latestPersonalUrl = '';
let viewSwitchTarget='member';
let viewSwitchEpoch=0;
let adminSwitchRefreshPromise=null;
let memberSwitchRefreshPromise=null;
let memberStatusBatchTimer=0,memberStatusBatchInFlight=false,memberStatusSaveOpen=false,memberStatusCycleOk=true;
let memberStatusInFlightBatch=[];
let memberSaveTimer=0;
const memberStatusPending=new Map();
function animateMemberCalendarIfNeeded(){}
function animateAdminCalendarIfNeeded(){}
let uiTransitionBusy=false;
let adminTabTransitionBusy=false;
let pendingAdminPageTransition=null;
function motionReduced(){
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
}
const UI_FADE_TOTAL_MS=375;
const UI_FADE_OUT_MS=105;
const UI_FADE_IN_MS=270;
function animFinished(animation){
  return animation?.finished?.catch(()=>{})||Promise.resolve()
}
function setMicroOpacity(elements,value){
  for(const el of elements)if(el)el.style.opacity=String(value)
}
function clearMicroOpacity(elements){
  for(const el of elements)if(el)el.style.removeProperty('opacity')
}
function calendarChangingElements(label,body,mobile){
  return [
    label,
    ...Array.from(body?.children||[]),
    ...Array.from(mobile?.children||[])
  ].filter(Boolean)
}
async function microCalendarTransition({label,body,mobile,swapFn,outMs=UI_FADE_OUT_MS,inMs=UI_FADE_IN_MS}){
  if(typeof swapFn!=='function')return;
  if(uiTransitionBusy)return;
  if(motionReduced()){
    swapFn();
    return
  }
  uiTransitionBusy=true;
  try{
    const outgoing=calendarChangingElements(label,body,mobile);
    const outAnimations=outgoing.map(el=>el.animate(
      [{opacity:1},{opacity:.06}],
      {duration:outMs,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'}
    ));
    await Promise.all(outAnimations.map(animFinished));

    /* Le contenu fixe (cadre, flèches, titres, en-tête du tableau) ne bouge pas.
       Seuls le libellé et les lignes/cartes sont remplacés ici. */
    swapFn();

    const incoming=calendarChangingElements(label,body,mobile);
    setMicroOpacity(incoming,.06);
    outAnimations.forEach(a=>{try{a.cancel()}catch{}});
    await new Promise(requestAnimationFrame);

    const inAnimations=incoming.map(el=>el.animate(
      [{opacity:.06},{opacity:1}],
      {duration:inMs,easing:'cubic-bezier(0,0,.2,1)',fill:'both'}
    ));
    await Promise.all(inAnimations.map(animFinished));
    inAnimations.forEach(a=>{try{a.cancel()}catch{}});
    clearMicroOpacity(incoming)
  }finally{
    uiTransitionBusy=false
  }
}
function adminPageSurface(page){
  const view=document.querySelector(`[data-admin-view="${page}"]`);
  return view?.querySelector('section.card')||view?.firstElementChild||view
}
async function microAdminPageTransition(page,{push=false,scroll=false,preservedScrollY=window.scrollY}={}){
  if(!['calendar','members'].includes(page))page='calendar';

  /* Pendant une transition, on ne perd plus les clics :
     seule la dernière intention est conservée. */
  if(adminTabTransitionBusy){
    pendingAdminPageTransition={page,push,scroll,preservedScrollY:window.scrollY};
    return
  }

  const restoreAdminScroll=()=>{
    if(scroll)return;
    window.scrollTo({top:preservedScrollY,behavior:'instant'})
  };

  if(page===currentAdminPage){
    showAdminPage(page,{push,scroll:false});
    restoreAdminScroll();
    return
  }

  if(motionReduced()){
    showAdminPage(page,{push,scroll:false});
    restoreAdminScroll();
    return
  }

  const fromSurface=adminPageSurface(currentAdminPage);
  if(!fromSurface){
    showAdminPage(page,{push,scroll:false});
    restoreAdminScroll();
    return
  }

  adminTabTransitionBusy=true;
  try{
    const out=fromSurface.animate(
      [{opacity:1},{opacity:.06}],
      {duration:UI_FADE_OUT_MS,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'}
    );
    await animFinished(out);

    /* Si un autre onglet a été demandé pendant le fade-out,
       on cible directement le dernier demandé au lieu d'afficher
       inutilement l'onglet intermédiaire. */
    let targetPage=page;
    let targetPush=push;
    let targetScroll=scroll;
    let targetScrollY=preservedScrollY;

    if(pendingAdminPageTransition){
      targetPage=pendingAdminPageTransition.page;
      targetPush=pendingAdminPageTransition.push;
      targetScroll=pendingAdminPageTransition.scroll;
      targetScrollY=pendingAdminPageTransition.preservedScrollY;
      pendingAdminPageTransition=null
    }

    const restoreTargetScroll=()=>{
      if(targetScroll)return;
      window.scrollTo({top:targetScrollY,behavior:'instant'})
    };

    showAdminPage(targetPage,{push:targetPush,scroll:false});
    restoreTargetScroll();

    const toSurface=adminPageSurface(targetPage);
    if(!toSurface){
      try{out.cancel()}catch{}
      return
    }

    toSurface.style.opacity='.06';
    try{out.cancel()}catch{}
    await new Promise(requestAnimationFrame);
    restoreTargetScroll();

    const inn=toSurface.animate(
      [{opacity:.06},{opacity:1}],
      {duration:UI_FADE_IN_MS,easing:'cubic-bezier(0,0,.2,1)',fill:'both'}
    );
    await animFinished(inn);
    try{inn.cancel()}catch{}
    toSurface.style.removeProperty('opacity');
    restoreTargetScroll()
  }finally{
    adminTabTransitionBusy=false;

    /* Un clic peut encore arriver pendant le fade-in.
       On traite alors immédiatement la dernière demande restante. */
    const pending=pendingAdminPageTransition;
    pendingAdminPageTransition=null;
    if(pending&&pending.page!==currentAdminPage){
      queueMicrotask(()=>microAdminPageTransition(pending.page,pending))
    }else if(pending&&pending.page===currentAdminPage){
      if(pending.push)showAdminPage(pending.page,{push:true,scroll:false});
      if(!pending.scroll)window.scrollTo({top:pending.preservedScrollY,behavior:'instant'})
    }
  }
}
function updateDayEditorListHeight(memberCount){
  const dialog=q('#adminCorrectionOverlay .admin-correction-dialog');
  if(!dialog)return;
  const rows=Math.max(Number(memberCount||0)+1,1);
  const contentNeeded=48+(rows*31)+(Math.max(rows-1,0)*4);
  const viewportCap=Math.max(360,window.innerHeight-205);
  const target=Math.max(410,Math.min(contentNeeded,viewportCap));
  dialog.style.setProperty('--day-editor-list-height',`${target}px`)
}
function parisToday(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value;return `${g('year')}-${g('month')}-${g('day')}`}
function addDays(s,n){const[y,m,d]=s.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d+n));return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`}
function monthKey(s){return s.slice(0,7)}
function shiftMonth(k,d){let[y,m]=k.split('-').map(Number);m+=d;while(m<1){m+=12;y--}while(m>12){m-=12;y++}return `${y}-${pad(m)}`}
function daysInMonth(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
function iso(y,m,d){return `${y}-${pad(m)}-${pad(d)}`}
function planningHorizonEnd(today=parisToday()){
  const endMonth=shiftMonth(monthKey(today),2);
  const[y,m]=endMonth.split('-').map(Number);
  return iso(y,m,daysInMonth(y,m))
}
function weekday(s){const[y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).getUTCDay()}
function defaultOpen(s){return [1,2,4].includes(weekday(s))}
function effectiveOpen(data,s){const ex=data.scheduleExceptions?.[s];return typeof ex?.isOpen==='boolean'?ex.isOpen:defaultOpen(s)}
function assignmentCoverage(data,s){const a=data.assignments?.[s]||{};const filled=CORE_ROLE_KEYS.filter(role=>(a[role]||[]).length>0),missing=CORE_ROLE_KEYS.filter(role=>(a[role]||[]).length===0);return{covered:missing.length===0,filled:filled.length,missing}}
function dayLabel(s,longYear=false){const[y,m,d]=s.split('-').map(Number);return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',...(longYear?{year:'numeric'}:{}),timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)))}
function shortDayLabel(s){const[y,m,d]=s.split('-').map(Number);return new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)))}
function monthLabel(k){const[y,m]=k.split('-').map(Number);return new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)))}
function initials(n){return String(n).split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function nowIso(){return new Date().toISOString()}
let activeRootView='';
function showOnly(id){
  activeRootView=id;
  for(const x of ['chooserView','joinView','memberRoot','adminRoot'])q('#'+x).classList.toggle('hidden',x!==id)
}
function adminPageFromPath(path=location.pathname){
  if(path==='/admin/membres')return'members';
  return'calendar'
}
function adminPathForPage(page){
  return page==='members'?'/admin/membres':'/admin'
}
function showAdminPage(page,{push=false,scroll=true}={}){
  if(!['calendar','members'].includes(page))page='calendar';
  currentAdminPage=page;
  for(const view of document.querySelectorAll('[data-admin-view]')){
    const active=view.dataset.adminView===page;
    view.classList.toggle('hidden',!active)
  }
  for(const tab of document.querySelectorAll('.admin-tabs [data-admin-page]')){
    const active=tab.dataset.adminPage===page;
    tab.classList.toggle('active',active);
    if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current')
  }
  const subtitle=q('#adminSubtitle');
  if(subtitle)subtitle.textContent=page==='members'?'Liste des membres':'Calendrier des permanences';
  if(push&&!LOCAL){
    const target=adminPathForPage(page);
    if(location.pathname!==target)history.pushState({adminPage:page},'',target)
  }
  if(scroll)scrollTo({top:0,behavior:'instant'})
}

function toast(text){const admin=q('#adminRoot');if(admin&&!admin.classList.contains('hidden'))return;const e=q('#toast');e.textContent=text;e.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.add('hidden'),2200)}
function setNotice(el,text=''){el.classList.toggle('hidden',!text);el.textContent=text}
let memberErrorTimer=0;
function showMemberError(text='',duration=3600){clearTimeout(memberErrorTimer);const el=q('#memberError');setNotice(el,text);if(text&&duration>0)memberErrorTimer=setTimeout(()=>setNotice(el),duration)}
const modalReturnFocus=new WeakMap();
function syncModalBodyState(){
  document.body.classList.toggle('modal-open',!!document.querySelector('.confirm-overlay:not(.hidden)'))
}
function resolveFocusTarget(target,overlay){
  if(typeof target==='function')target=target();
  if(typeof target==='string')target=overlay?.querySelector(target)||document.querySelector(target);
  return target instanceof HTMLElement?target:null
}
function openModalOverlay(overlay,{focus=null,returnFocus=null}={}){
  if(!overlay)return;
  const origin=returnFocus instanceof HTMLElement?returnFocus:(document.activeElement instanceof HTMLElement?document.activeElement:null);
  if(origin)modalReturnFocus.set(overlay,origin);
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden','false');
  syncModalBodyState();
  requestAnimationFrame(()=>resolveFocusTarget(focus,overlay)?.focus({preventScroll:true}))
}
function closeModalOverlay(overlay,{restoreFocus=true}={}){
  if(!overlay||overlay.classList.contains('hidden'))return;
  const active=document.activeElement;
  if(active instanceof HTMLElement&&overlay.contains(active))active.blur();
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden','true');
  syncModalBodyState();
  const restore=modalReturnFocus.get(overlay);modalReturnFocus.delete(overlay);
  if(restoreFocus&&restore?.isConnected)requestAnimationFrame(()=>restore.focus({preventScroll:true}))
}
let confirmResolve=null;
function closeConfirmModal(value){
  const overlay=q('#confirmOverlay');if(!overlay||overlay.classList.contains('hidden'))return;
  closeModalOverlay(overlay);
  const resolve=confirmResolve;confirmResolve=null;
  if(resolve)resolve(Boolean(value))
}
function confirmModal(message,{title='Confirmation',confirmText='Confirmer',danger=false}={}){
  if(confirmResolve)closeConfirmModal(false);
  const overlay=q('#confirmOverlay'),dialog=overlay.querySelector('.confirm-dialog');
  q('#confirmTitle').textContent=title;q('#confirmMessage').textContent=message;q('#confirmAccept').textContent=confirmText;
  dialog.classList.toggle('danger',danger);
  openModalOverlay(overlay,{focus:'#confirmCancel'});
  return new Promise(resolve=>{confirmResolve=resolve})
}
function setButtonBusy(btn,busy,label='Enregistrement…'){if(!btn)return;if(busy){if(!btn.dataset.busyLabel)btn.dataset.busyLabel=btn.textContent;if(!btn.dataset.busyAria)btn.dataset.busyAria=btn.getAttribute('aria-label')||'';btn.classList.add('is-busy');btn.disabled=true;btn.setAttribute('aria-busy','true');btn.setAttribute('aria-label',`${btn.dataset.busyLabel} — ${label}`)}else{btn.classList.remove('is-busy');btn.disabled=false;btn.removeAttribute('aria-busy');if(btn.dataset.busyAria)btn.setAttribute('aria-label',btn.dataset.busyAria);else btn.removeAttribute('aria-label');delete btn.dataset.busyAria;delete btn.dataset.busyLabel}}
function setAdminSaveState(mode,text){
  const el=q('#adminSaveState');if(!el)return;
  clearTimeout(adminSaveTimer);
  el.className='admin-save-state '+(mode||'');
  el.textContent=text||'';
  el.classList.toggle('hidden',!text);
  if(mode==='saved')adminSaveTimer=setTimeout(()=>el.classList.add('hidden'),1400);
  if(mode==='error')adminSaveTimer=setTimeout(()=>el.classList.add('hidden'),2800)
}
function beginAdminSave(){
  adminSavePending++;
  setAdminSaveState('saving',adminSavePending>1?`${adminSavePending} enregistrements…`:'Enregistrement…')
}
function endAdminSave(ok=true){
  adminSavePending=Math.max(0,adminSavePending-1);
  if(adminSavePending){
    setAdminSaveState('saving',adminSavePending>1?`${adminSavePending} enregistrements…`:'Enregistrement…');
    return
  }
  setAdminSaveState(ok?'saved':'error',ok?'Enregistré ✓':'Échec de l’enregistrement')
}
function adminIds(v){return[...new Set((Array.isArray(v)?v:[]).map(String).filter(Boolean))]}
function sameAdminIds(a,b){
  a=adminIds(a);b=adminIds(b);
  return a.length===b.length&&a.every((x,i)=>x===b[i])
}
function writeAdminRoleIds(date,role,ids){
  if(!adminData)return;
  const next=adminIds(ids);
  adminData.assignments=adminData.assignments||{};
  const day={...(adminData.assignments[date]||{})};
  day[role]=next;
  if(ROLE_KEYS.some(r=>(day[r]||[]).length))adminData.assignments[date]=day;
  else delete adminData.assignments[date];

  if(role==='present'){
    adminData.attendance=adminData.attendance||{};
    if(next.length)adminData.attendance[date]=next;else delete adminData.attendance[date]
  }else{
    adminData.roleAssignments=adminData.roleAssignments||{};
    const roles={...(adminData.roleAssignments[date]||{})};
    if(next.length)roles[role]=next;else delete roles[role];
    if(Object.keys(roles).length)adminData.roleAssignments[date]=roles;
    else delete adminData.roleAssignments[date]
  }
}
function optimisticAdminChanges(changes){
  const tx=(changes||[]).map(c=>({date:c.date,role:c.role,before:currentAdminRoleIds(c.date,c.role),after:adminIds(c.ids)}));
  for(const c of tx)writeAdminRoleIds(c.date,c.role,c.after);
  renderAdminCalendar();
  return tx
}
function rollbackAdminChanges(tx){
  let changed=false;
  for(const c of [...(tx||[])].reverse()){
    if(!sameAdminIds(currentAdminRoleIds(c.date,c.role),c.after))continue;
    writeAdminRoleIds(c.date,c.role,c.before);changed=true
  }
  if(changed)renderAdminCalendar()
}
function reconcileAdminChanges(tx,canonical){
  let changed=false;
  const map=new Map((canonical||[]).map(c=>[`${c.date}|${c.role}`,adminIds(c.ids)]));
  for(const c of tx||[]){
    const ids=map.get(`${c.date}|${c.role}`);
    if(!ids||!sameAdminIds(currentAdminRoleIds(c.date,c.role),c.after))continue;
    if(!sameAdminIds(ids,c.after)){writeAdminRoleIds(c.date,c.role,ids);changed=true}
  }
  if(changed)renderAdminCalendar()
}
function scheduleAdminReconcile(delay=8000){
  if(LOCAL)return;
  clearTimeout(adminReconcileTimer);
  adminReconcileTimer=setTimeout(async()=>{
    if(!adminRefreshSafe()){scheduleAdminReconcile(3000);return}
    await refreshAdmin(null,{silent:true});
  },delay)
}


/* =========================================================
   V15.37 — MOTEUR DE MODIFICATIONS PLANNING
   UI optimiste immédiate + consolidation 150 ms + batch atomique.
   ========================================================= */
const PLANNING_BATCH_DELAY=150;

let adminPlanningPending=new Map();
let adminPlanningInFlightCells=[];
let adminPlanningTimer=0;
let adminPlanningInFlight=false;
let adminPlanningLastQueuedAt=0;
let adminPlanningSaveOpen=false;
let adminPlanningHadError=false;

let memberPlanningPending=new Map();
let memberPlanningTimer=0;
let memberPlanningInFlight=false;
let memberPlanningLastQueuedAt=0;

function planningCellKey(date,role){return `${date}|${role}`}
function adminPlanningHasWork(){return adminPlanningInFlight||adminPlanningPending.size>0}
function memberPlanningHasWork(){return memberPlanningInFlight||memberPlanningPending.size>0}

function normalizedAdminCellChanges(changes){
  const map=new Map();
  for(const raw of changes||[]){
    const date=String(raw?.date||''),role=String(raw?.role||'');
    if(!date||!ROLE_KEYS.includes(role))continue;
    map.set(planningCellKey(date,role),{date,role,ids:adminIds(raw.ids)})
  }

  const dates=[...new Set([...map.values()].map(c=>c.date))];
  for(const date of dates){
    const coreIds=new Set();
    for(const role of CORE_ROLE_KEYS){
      const pending=map.get(planningCellKey(date,role));
      const ids=pending?pending.ids:currentAdminRoleIds(date,role);
      for(const id of ids)coreIds.add(String(id))
    }
    const pKey=planningCellKey(date,'present');
    const pPending=map.get(pKey);
    const requested=pPending?pPending.ids:currentAdminRoleIds(date,'present');
    const filtered=requested.filter(id=>!coreIds.has(String(id)));
    if(pPending||!sameAdminIds(filtered,currentAdminRoleIds(date,'present'))){
      map.set(pKey,{date,role:'present',ids:filtered})
    }
  }
  return [...map.values()]
}

function applyAdminServerSnapshot(snapshot){
  if(!snapshot)return adminData;
  noteSharedSyncVersion(snapshot);
  adminData=snapshot;

  for(const c of adminPlanningInFlightCells)writeAdminRoleIds(c.date,c.role,c.ids);
  for(const c of adminPlanningPending.values())writeAdminRoleIds(c.date,c.role,c.ids);

  const statuses=new Map();
  for(const c of memberStatusInFlightBatch)statuses.set(String(c.memberId),!!c.active);
  for(const c of memberStatusPending.values())statuses.set(String(c.memberId),!!c.active);
  for(const [id,active] of statuses){
    const m=(adminData?.membersAdmin||[]).find(x=>String(x.id)===id);
    if(m)m.active=active
  }
  return adminData
}
function applyAdminPendingOverlay(snapshot){
  return applyAdminServerSnapshot(snapshot)
}

function scheduleAdminPlanningFlush(){
  clearTimeout(adminPlanningTimer);
  const wait=Math.max(0,PLANNING_BATCH_DELAY-(Date.now()-adminPlanningLastQueuedAt));
  adminPlanningTimer=setTimeout(flushAdminPlanningBatch,wait)
}

function finishAdminPlanningSaveIfIdle(){
  if(adminPlanningInFlight||adminPlanningPending.size)return;
  if(adminPlanningSaveOpen){
    const ok=!adminPlanningHadError;
    adminPlanningSaveOpen=false;
    adminPlanningHadError=false;
    endAdminSave(ok)
  }
}

function queueAdminPlanningChanges(changes){
  const normalized=normalizedAdminCellChanges(changes);
  if(!normalized.length)return;

  if(LOCAL){
    try{
      for(const c of normalized)localWriteAdminRoleIds(c.date,c.role,c.ids);
      saveLocal();
      adminData=localAdminSnapshot();
      renderAdminCalendar()
    }catch(e){setNotice(q('#adminError'),e.message)}
    return
  }

  if(!adminPlanningSaveOpen){
    adminPlanningSaveOpen=true;
    adminPlanningHadError=false;
    beginAdminSave()
  }

  /* Capture l'état avant le premier geste de cette cellule, puis applique
     immédiatement le nouvel état à l'écran. */
  for(const c of normalized){
    const key=planningCellKey(c.date,c.role);
    const existing=adminPlanningPending.get(key);
    const base=existing?.base||currentAdminRoleIds(c.date,c.role);
    writeAdminRoleIds(c.date,c.role,c.ids);
    adminPlanningPending.set(key,{...c,base})
  }
  renderAdminCalendar();

  adminPlanningLastQueuedAt=Date.now();
  scheduleAdminPlanningFlush()
}

async function refreshAdminAfterPlanningFailure(batch){
  try{
    const fresh=await netApi('/api/admin');
    lastAdminSyncAt=Date.now();
    adminSessionContext=fresh.adminContext||adminSessionContext;
    applyAdminPendingOverlay(fresh);
    renderAdminCalendar();
    return
  }catch{}

  /* Fallback hors-ligne : ne revient en arrière que si aucun geste plus
     récent n'a remplacé la cellule concernée. */
  let changed=false;
  for(const c of batch){
    const key=planningCellKey(c.date,c.role);
    if(adminPlanningPending.has(key))continue;
    if(sameAdminIds(currentAdminRoleIds(c.date,c.role),c.ids)){
      writeAdminRoleIds(c.date,c.role,c.base);
      changed=true
    }
  }
  if(changed)renderAdminCalendar()
}

async function flushAdminPlanningBatch(){
  clearTimeout(adminPlanningTimer);
  if(adminPlanningInFlight||!adminPlanningPending.size)return;

  const batch=[...adminPlanningPending.values()];
  adminPlanningPending.clear();
  adminPlanningInFlightCells=batch.map(c=>({...c,ids:[...c.ids]}));
  adminPlanningInFlight=true;

  try{
    const j=await netApi('/api/admin/planning-batch',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        cells:batch.map(({date,role,ids})=>({date,role,memberIds:ids}))
      })
    });

    applyAdminPendingOverlay(j.snapshot);
    renderAdminCalendar();
    scheduleAdminReconcile()
  }catch(e){
    adminPlanningHadError=true;
    await refreshAdminAfterPlanningFailure(batch);
    setNotice(q('#adminError'),`Modification non enregistrée : ${e.message}`)
  }finally{
    adminPlanningInFlight=false;
    adminPlanningInFlightCells=[];
    if(adminPlanningPending.size){
      scheduleAdminPlanningFlush()
    }else{
      finishAdminPlanningSaveIfIdle()
    }
  }
}

function memberPendingOverlay(snapshot){
  noteSharedSyncVersion(snapshot);
  let next=snapshot;
  for(const c of memberPlanningPending.values()){
    next=optimisticAssignment(next,c.date,c.role,c.present)
  }
  return next
}

function scheduleMemberPlanningFlush(){
  clearTimeout(memberPlanningTimer);
  const wait=Math.max(0,PLANNING_BATCH_DELAY-(Date.now()-memberPlanningLastQueuedAt));
  memberPlanningTimer=setTimeout(flushMemberPlanningBatch,wait)
}

function setMemberPlanningVisualState(saved=false){
  const el=q('#lastRefresh');
  if(!el)return;
  clearTimeout(memberSaveTimer);
  if(memberPlanningHasWork()){
    el.className='admin-save-state saving';
    el.textContent='Enregistrement…';
    return
  }
  if(saved){
    el.className='admin-save-state saved';
    el.textContent='Enregistré ✓';
    memberSaveTimer=setTimeout(()=>el.classList.add('hidden'),1400);
    return
  }
  el.textContent='';
  el.className='admin-save-state hidden'
}

function queueMemberPlanningChange(date,role,present){
  markMemberActivity();

  const myId=String(memberData?.me?.id||currentLocalMemberId||'');
  const currentDay=memberData?.assignments?.[date]||{};
  const hasCoreRole=CORE_ROLE_KEYS.some(r=>(currentDay[r]||[]).map(String).includes(myId));
  if(role==='present'&&present&&hasCoreRole){
    showMemberError('Vous avez déjà un rôle pour cette journée : vous ne pouvez pas être également disponible.');
    return
  }
  if(role!=='present'&&present){
    const occupants=(currentDay[role]||[]).map(String);
    const occupiedByOther=occupants.some(id=>id!==myId);
    if(occupiedByOther){
      showMemberError('Cette position est déjà occupée par un autre membre.');
      return
    }
  }

  if(LOCAL){
    try{
      if(role==='present'){
        const ids=localState.attendance[date]||[];
        if(present)localState.attendance[date]=[...new Set([...ids,currentLocalMemberId])];
        else{
          localState.attendance[date]=ids.filter(x=>x!==currentLocalMemberId);
          if(!localState.attendance[date].length)delete localState.attendance[date]
        }
      }else{
        const day=localState.roleAssignments[date]||{},ids=day[role]||[];
        if(present){
          day[role]=[...new Set([...ids,currentLocalMemberId])];
          const available=localState.attendance[date]||[];
          localState.attendance[date]=available.filter(x=>x!==currentLocalMemberId);
          if(!localState.attendance[date].length)delete localState.attendance[date]
        }else{
          day[role]=ids.filter(x=>x!==currentLocalMemberId);
          if(!day[role].length)delete day[role]
        }
        if(Object.keys(day).length)localState.roleAssignments[date]=day;
        else delete localState.roleAssignments[date]
      }
      const m=localState.members.find(x=>x.id===currentLocalMemberId);
      audit(m.name,present?'role_inscription':'role_retrait',date,{role});
      saveLocal();
      memberData=localMemberSnapshot(currentLocalMemberId);
      renderMember()
    }catch(e){showMemberError(e.message)}
    return
  }

  if(role!=='present'&&present&&(memberData?.assignments?.[date]?.present||[]).map(String).includes(String(memberData.me.id))){
    const pKey=planningCellKey(date,'present');
    const pExisting=memberPlanningPending.get(pKey);
    const pIds=memberData?.assignments?.[date]?.present||[];
    const pBefore=pExisting?.before??pIds.includes(memberData.me.id);
    memberData=optimisticAssignment(memberData,date,'present',false);
    memberPlanningPending.set(pKey,{date,role:'present',present:false,before:pBefore})
  }

  const key=planningCellKey(date,role);
  const existing=memberPlanningPending.get(key);
  const ids=memberData?.assignments?.[date]?.[role]||[];
  const before=existing?.before??ids.includes(memberData.me.id);

  memberData=optimisticAssignment(memberData,date,role,present);
  memberPlanningPending.set(key,{date,role,present:!!present,before});
  renderMember();
  setMemberPlanningVisualState();

  memberPlanningLastQueuedAt=Date.now();
  scheduleMemberPlanningFlush()
}

async function refreshMemberAfterPlanningFailure(batch){
  try{
    const fresh=await netApi('/api/me');
    lastMemberSyncAt=Date.now();
    memberData=memberPendingOverlay(fresh);
    renderMember();
    return
  }catch{}

  let next=memberData;
  for(const c of batch){
    const key=planningCellKey(c.date,c.role);
    if(memberPlanningPending.has(key))continue;
    const ids=next?.assignments?.[c.date]?.[c.role]||[];
    const current=ids.includes(next.me.id);
    if(current===c.present)next=optimisticAssignment(next,c.date,c.role,c.before)
  }
  memberData=next;
  renderMember()
}

async function flushMemberPlanningBatch(){
  clearTimeout(memberPlanningTimer);
  if(memberPlanningInFlight||!memberPlanningPending.size)return;

  const batch=[...memberPlanningPending.values()];
  memberPlanningPending.clear();
  memberPlanningInFlight=true;
  setMemberPlanningVisualState();

  try{
    const j=await netApi('/api/me/assignments-batch',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        changes:batch.map(({date,role,present})=>({date,role,present}))
      })
    });
    memberData=memberPendingOverlay(j.snapshot);
    renderMember()
  }catch(e){
    if(e.status===401){
      memberPlanningInFlight=false;
      invalidMemberSession();
      return
    }
    await refreshMemberAfterPlanningFailure(batch);
    showMemberError(`Modification non enregistrée : ${e.message}`,4800)
  }finally{
    memberPlanningInFlight=false;
    if(memberPlanningPending.size){
      scheduleMemberPlanningFlush();
      setMemberPlanningVisualState()
    }else{
      setMemberPlanningVisualState(true)
    }
  }
}

function localSeed(){return {schema:3,rosterVersion:LOCAL_ROSTER_VERSION,members:INITIAL_MEMBERS.map((m,i)=>({id:`roster_local_${i+1}`,name:m.name,email:m.email,active:true,adminPrivilege:false,createdAt:nowIso()})),attendance:{},roleAssignments:{},scheduleExceptions:{},settings:{minRequired:1},auditLog:[]}}
function loadLocal(){try{const x=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(x&&x.rosterVersion===LOCAL_ROSTER_VERSION&&Array.isArray(x.members)&&x.attendance&&x.scheduleExceptions){x.roleAssignments=x.roleAssignments&&typeof x.roleAssignments==='object'?x.roleAssignments:{};for(const m of x.members)m.adminPrivilege=m.adminPrivilege===true;return x}}catch{}return localSeed()}
function saveLocal(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(localState))}catch{}}
function audit(actor,action,date='',meta={}){localState.auditLog.push({at:nowIso(),actor,action,date,...meta});if(localState.auditLog.length>1000)localState.auditLog=localState.auditLog.slice(-1000)}
function localAssignmentsSnapshot(){const out={};const dates=new Set([...Object.keys(localState.attendance||{}),...Object.keys(localState.roleAssignments||{})]);for(const d of dates){const r=localState.roleAssignments?.[d]||{};out[d]={accueil:[...(r.accueil||[])],tpe:[...(r.tpe||[])],mep:[...(r.mep||[])],arbitrage:[...(r.arbitrage||[])],present:[...(localState.attendance?.[d]||[])]}}return out}
function localMemberSnapshot(id){const me=localState.members.find(m=>m.id===id&&m.active);if(!me)return null;const from=parisToday(),to=planningHorizonEnd(from),all=localAssignmentsSnapshot(),assignments={},visible=new Set([id]);for(const[d,roles]of Object.entries(all)){if(d<from||d>to)continue;const clean={};for(const role of ROLE_KEYS){const ids=(roles[role]||[]).filter(mid=>localState.members.some(m=>m.id===mid&&m.active));clean[role]=ids;for(const x of ids)visible.add(x)}if(ROLE_KEYS.some(r=>clean[r].length))assignments[d]=clean}const attendance=Object.fromEntries(Object.entries(assignments).filter(([,r])=>r.present.length).map(([d,r])=>[d,r.present]));const exceptions=Object.fromEntries(Object.entries(localState.scheduleExceptions).filter(([d])=>d>=from&&d<=to));return {me:{id:me.id,name:me.name,adminPrivilege:me.adminPrivilege===true},members:localState.members.filter(m=>m.active&&visible.has(m.id)).map(m=>({id:m.id,name:m.name})),attendance,roleAssignments:Object.fromEntries(Object.entries(localState.roleAssignments||{}).filter(([d])=>d>=from&&d<=to)),assignments,scheduleExceptions:clone(exceptions),settings:{minRequired:localState.settings.minRequired,timezone:'Europe/Paris',defaultOpenDays:[1,2,4],roles:ROLE_KEYS,memberWindow:{from,to}}}}
function localAdminSnapshot(){const members=localState.members.map(m=>({id:m.id,name:m.name,email:m.email||'',active:m.active,adminPrivilege:m.adminPrivilege===true})),assignments=localAssignmentsSnapshot();return {members,attendance:clone(localState.attendance),roleAssignments:clone(localState.roleAssignments),assignments,scheduleExceptions:clone(localState.scheduleExceptions),settings:{minRequired:localState.settings.minRequired,timezone:'Europe/Paris',defaultOpenDays:[1,2,4],roles:ROLE_KEYS},membersAdmin:members.map(m=>({...m,createdAt:m.createdAt,hasActiveLink:m.active})),auditLog:clone(localState.auditLog.slice(-200).reverse()),integrity:{ok:true,counts:{activeMembers:members.filter(m=>m.active).length,attendanceDates:Object.keys(localState.attendance).length,roleAssignmentDates:Object.keys(localState.roleAssignments).length}}}}
function csrf(name){const m=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)'));return m?decodeURIComponent(m[1]):''}
let adminWriteQueue=Promise.resolve();
let adminWriteQueued=0;
const memberLinkRotationInFlight=new Map();

async function netApiRaw(url,opts={}){
  const h=new Headers(opts.headers||{});
  const method=String(opts.method||'GET').toUpperCase();
  if(method!=='GET'&&method!=='HEAD')h.set('X-CSRF-Token',url.startsWith('/api/admin')?csrf('club_admin_csrf'):csrf('club_member_csrf'));
  const r=await fetch(url,{...opts,headers:h,cache:'no-store'});
  let j={};
  try{j=await r.json()}catch{}
  if(!r.ok)throw Object.assign(new Error(j.error||'Erreur'),{status:r.status,payload:j});
  return j
}
function netApi(url,opts={}){
  const method=String(opts.method||'GET').toUpperCase();
  const adminWrite=url.startsWith('/api/admin')&&!['GET','HEAD'].includes(method);
  if(!adminWrite)return netApiRaw(url,opts);

  adminWriteQueued++;
  const run=()=>netApiRaw(url,opts);
  const result=adminWriteQueue.then(run,run);
  adminWriteQueue=result.catch(()=>{});
  return result.finally(()=>{adminWriteQueued=Math.max(0,adminWriteQueued-1)})
}
function downloadBlob(name,type,text){const b=new Blob([text],{type}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),500)}
function csvCell(v){let t=String(v??'');if(/^[\t \r\n]*[=+\-@]/.test(t))t="'"+t;return /[;"\n\r]/.test(t)?'"'+t.replaceAll('"','""')+'"':t}
function localPlanningCsv(){const data=localAdminSnapshot(),from=parisToday(),to=planningHorizonEnd(from),byId=Object.fromEntries(data.members.map(m=>[m.id,m.name]));const rows=[['Date','Jour','Accueil','TPE','Mise en place','Arbitrage','Disponible','Nombre disponibles','Postes pourvus','Postes requis','Couverture']];for(let d=from;d<=to;d=addDays(d,1)){if(!effectiveOpen(data,d))continue;const a=data.assignments[d]||{},names=r=>sortNamesAlpha((a[r]||[]).map(id=>byId[id]).filter(Boolean)).join(', '),present=a.present||[],c=assignmentCoverage(data,d);rows.push([d,dayLabel(d,true),names('accueil'),names('tpe'),names('mep'),names('arbitrage'),names('present'),present.length,c.filled,CORE_ROLE_KEYS.length,c.covered?'OK':'À pourvoir'])}return '\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n')+'\r\n'}
function actionLabel(a){return ({inscription:'inscription',retrait:'retrait',membre_cree:'membre créé',membre_renomme:'membre renommé',membre_desactive:'membre désactivé',membre_reactive:'membre réactivé',lien_regenere:'nouveau lien',fermeture_exceptionnelle:'fermeture',ouverture_exceptionnelle:'ouverture',fermeture_periode:'fermeture de période',ouverture_periode:'ouverture de période',exception_supprimee:'exception supprimée',exceptions_periode_supprimees:'horaires habituels rétablis',minimum_modifie:'minimum modifié',admin_inscription:'présence ajoutée par admin',admin_retrait:'présence retirée par admin',sauvegarde_importee:'sauvegarde restaurée',presence_retiree_fermeture:'présence retirée lors d’une fermeture',presence_retiree_desactivation:'présence retirée lors d’une désactivation',role_inscription:'inscription à un rôle',role_retrait:'retrait d’un rôle',admin_role_inscription:'rôle ajouté par admin',admin_role_retrait:'rôle retiré par admin',role_retire_fermeture:'rôle retiré lors d’une fermeture',role_retire_desactivation:'rôle retiré lors d’une désactivation',sessions_membre_revoquees:'appareils membre déconnectés'})[a]||String(a||'').replaceAll('_',' ')}

// --- Choix local / liens locaux ---
function renderChooser(){const box=q('#chooserGrid');box.innerHTML='';for(const m of sortMembersAlpha(localState.members.filter(m=>m.active))){const b=document.createElement('button');b.className='btn';b.textContent=m.name;b.addEventListener('click',()=>enterLocalMember(m.id));box.append(b)}const a=document.createElement('button');a.className='btn admin-entry';a.textContent='⚙ Administration';a.addEventListener('click',()=>{adminSessionContext=null;enterAdmin()});box.append(a);showOnly('chooserView')}
function enterLocalMember(id){currentLocalMemberId=id;memberData=localMemberSnapshot(id);memberCalendarMode='auto';memberMonth=chooseInitialMonth();showOnly('memberRoot');renderMember()}
function localPersonalUrl(id){const base=location.href.split('#')[0];return `${base}#member=${encodeURIComponent(id)}`}
function shortPersonalUrl(token){return `${GITHUB_HOME}#${String(token||'').normalize('NFC')}`}

// --- Vue membre ---
function memberIsOpen(date){return effectiveOpen(memberData,date)}
function memberHomeMode(today=parisToday()){
  const[y,m,d]=today.split('-').map(Number);
  return daysInMonth(y,m)-d<14?'upcoming':'month'
}
function memberHomeMonth(today=parisToday()){return monthKey(today)}
function nextMemberOpenDate(from=parisToday()){
  const max=memberData?.settings?.memberWindow?.to||from;
  for(let i=0;i<=366;i++){
    const s=addDays(from,i);
    if(s>max)break;
    if(memberIsOpen(s))return s
  }
  return from
}
function memberNextOpenDates(limit=6,from=parisToday()){
  const out=[],max=memberData?.settings?.memberWindow?.to||from;
  for(let i=0;i<=366&&out.length<limit;i++){
    const s=addDays(from,i);
    if(s>max)break;
    if(memberIsOpen(s))out.push(s)
  }
  return out
}
function memberDatesForMonth(k){
  const[y,m]=k.split('-').map(Number),out=[],today=parisToday();
  const from=memberData.settings.memberWindow.from,to=memberData.settings.memberWindow.to;
  for(let d=1;d<=daysInMonth(y,m);d++){
    const s=iso(y,m,d);
    if(s<today||s<from||s>to)continue;
    if(memberIsOpen(s))out.push(s)
  }
  return out
}
function chooseInitialMonth(){return memberHomeMonth()}
function weekStart(s){const[y,m,d]=s.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d)),wd=dt.getUTCDay(),diff=wd===0?-6:1-wd;dt.setUTCDate(dt.getUTCDate()+diff);return iso(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate())}
function compactDayLabel(s){const[y,m,d]=s.split('-').map(Number);const wd=new Intl.DateTimeFormat('fr-FR',{weekday:'long',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)));return `${wd.charAt(0).toUpperCase()+wd.slice(1)} ${pad(d)}/${pad(m)}`}
function mobileRoleButton(date,role,assignments,open,past,outside,map){
  const ids=sortMemberIds(assignments[role]||[],map),mine=ids.includes(memberData.me.id),btn=document.createElement('button');
  const locked=role!=='present'&&!mine&&ids.length>0;
  btn.className='mobile-role-button member-mobile-role'+(mine?' mine':'')+(locked?' role-locked':'');
  btn.disabled=!open||past||outside||locked;
  btn.setAttribute('aria-label',`${ROLE_LABELS[role]} — ${compactDayLabel(date)} — ${mine?'vous êtes inscrit':locked?'position déjà occupée':'vous n’êtes pas inscrit'}`);
  btn.title=mine?'Cliquez pour vous désinscrire':locked?'Position déjà occupée':'Cliquez pour vous inscrire';
  const label=document.createElement('span');label.className='mobile-role-label';label.textContent=ROLE_LABELS[role];
  const value=document.createElement('span');value.className='mobile-role-value';
  if(!open){const x=document.createElement('span');x.className='mobile-role-empty';x.textContent='—';value.append(x)}
  else if(!ids.length){const x=document.createElement('span');x.className='mobile-role-empty';x.textContent=role==='present'?'Personne disponible':'À pourvoir';value.append(x)}
  else for(const id of ids){const m=map[id];if(!m)continue;const chip=document.createElement('span');chip.className='role-chip'+(id===memberData.me.id?' me':'');chip.textContent=m.name;value.append(chip)}
  btn.append(label,value);
  if(!btn.disabled)btn.addEventListener('click',()=>toggleAssignment(date,role,!mine));
  return btn
}
function renderMember(){
  if(!memberData)return;
  showMemberError();
  q('#memberToAdmin')?.classList.toggle('hidden',!memberData.me?.adminPrivilege);
  q('#memberHeaderTitle').textContent=`Bonjour ${memberData.me.name}`;
  setMemberPlanningVisualState(false);

  const today=parisToday();
  const homeMonth=memberHomeMonth(today);
  const homeMode=memberHomeMode(today);
  const effectiveMode=memberCalendarMode==='auto'?homeMode:memberCalendarMode;
  const nextOpen=nextMemberOpenDate(today);
  const max=monthKey(memberData.settings.memberWindow.to);

  if(effectiveMode==='upcoming'){
    if(memberCalendarMode==='auto')memberMonth='';
    q('#monthLabel').textContent='Deux prochaines semaines';
    q('#prevMonth').disabled=true;
    q('#nextMonth').disabled=false
  }else{
    if(memberCalendarMode==='auto')memberMonth=homeMonth;
    else if(!memberMonth)memberMonth=homeMonth;
    q('#monthLabel').textContent=monthLabel(memberMonth);
    q('#prevMonth').disabled=memberCalendarMode==='auto'||memberMonth<=homeMonth;
    q('#nextMonth').disabled=memberMonth>=max
  }

  const body=q('#scheduleBody'),mobile=q('#scheduleMobile');
  body.innerHTML='';mobile.innerHTML='';
  const map=Object.fromEntries(memberData.members.map(m=>[m.id,m]));
  const from=memberData.settings.memberWindow.from,to=memberData.settings.memberWindow.to;
  let prevWeek='',weekIndex=-1;
  const dates=effectiveMode==='upcoming'?memberNextOpenDates(6,nextOpen):memberDatesForMonth(memberMonth);

  for(const date of dates){
    const open=memberIsOpen(date);
    if(!open)continue;
    const wk=weekStart(date);
    if(wk!==prevWeek){
      weekIndex++;
      if(prevWeek){
        const sr=document.createElement('tr');sr.className='week-separator';
        const td=document.createElement('td');td.colSpan=6;
        const ln=document.createElement('div');ln.className='week-separator-line';
        td.append(ln);sr.append(td);body.append(sr)
      }
      prevWeek=wk
    }

    const assignments=memberData.assignments?.[date]||{accueil:[],tpe:[],mep:[],arbitrage:[],present:memberData.attendance?.[date]||[]};
    const past=date<today,outside=date<from||date>to,coverageState=assignmentCoverage(memberData,date),covered=open&&coverageState.covered;
    const row=document.createElement('tr');
    row.id='date-'+date;
    row.className=(weekIndex%2?'week-b':'week-a')+(covered?' day-complete':'');

    const dateTd=document.createElement('td');dateTd.className='date-cell';
    const dm=document.createElement('div');dm.className='date-main';dm.textContent=compactDayLabel(date);
    dateTd.append(dm);row.append(dateTd);

    for(const role of ROLE_KEYS){
      const td=document.createElement('td');td.className='role-cell member-role-cell';
      const btn=document.createElement('button');btn.className='role-button member-role-button';
      const ids=sortMemberIds(assignments[role]||[],map),mine=ids.includes(memberData.me.id);
      const locked=role!=='present'&&!mine&&ids.length>0;
      if(mine)btn.classList.add('mine');
      if(locked)btn.classList.add('role-locked');
      btn.disabled=!open||past||outside||locked;
      btn.setAttribute('aria-label',`${ROLE_LABELS[role]} — ${compactDayLabel(date)} — ${mine?'vous êtes inscrit':locked?'position déjà occupée':'vous n’êtes pas inscrit'}`);
      btn.title=mine?'Cliquez pour vous désinscrire':locked?'Position déjà occupée':'Cliquez pour vous inscrire';

      const display=document.createElement('div');display.className='admin-role-display member-role-display';
      if(ids.length){
        const stack=document.createElement('div');stack.className='role-stack';
        for(const id of ids){
          const m=map[id];if(!m)continue;
          const chip=document.createElement('span');chip.className='role-chip'+(id===memberData.me.id?' me':'');chip.textContent=m.name;stack.append(chip)
        }
        display.append(stack)
      }else{
        display.classList.add('empty');
        display.textContent=role==='present'?'Personne disponible':'À pourvoir'
      }
      btn.append(display);
      if(!btn.disabled)btn.addEventListener('click',()=>toggleAssignment(date,role,!mine));
      td.append(btn);row.append(td)
    }
    body.append(row);

    const card=document.createElement('article');
    card.className='mobile-date-card '+(weekIndex%2?'week-b':'week-a')+(covered?' day-complete':'');
    card.id='mobile-date-'+date;
    const head=document.createElement('div');head.className='mobile-date-head';
    const title=document.createElement('div');title.className='mobile-date-title';title.textContent=compactDayLabel(date);
    head.append(title);card.append(head);
    const roles=document.createElement('div');roles.className='mobile-roles';
    for(const role of ROLE_KEYS)roles.append(mobileRoleButton(date,role,assignments,open,past,outside,map));
    card.append(roles);mobile.append(card)
  }
  animateMemberCalendarIfNeeded()
}
function optimisticAssignment(data,date,role,present){const next=JSON.parse(JSON.stringify(data)),id=next.me.id;next.assignments ||= {};next.attendance ||= {};next.roleAssignments ||= {};const emptyDay=()=>({accueil:[],tpe:[],mep:[],arbitrage:[],present:[]});const day={...emptyDay(),...(next.assignments[date]||{})};const set=new Set(day[role]||[]);present?set.add(id):set.delete(id);day[role]=[...set];next.assignments[date]=day;if(role==='present'){if(day.present.length)next.attendance[date]=[...day.present];else delete next.attendance[date]}else{const roles={...(next.roleAssignments[date]||{})};if(day[role].length)roles[role]=[...day[role]];else delete roles[role];if(Object.keys(roles).length)next.roleAssignments[date]=roles;else delete next.roleAssignments[date]}return next}
function toggleAssignment(date,role,present){
  queueMemberPlanningChange(date,role,present)
}

function showMemberLinkRequired(message='Ouvrez votre lien personnel une première fois sur cet appareil.'){setAdminLoginView(false);showOnly('joinView');q('#adminCodeForm').classList.add('hidden');q('#joinTitle').textContent='Lien personnel requis';q('#joinStatus').textContent=message;setNotice(q('#joinError'));q('#githubAdminLink').classList.toggle('hidden',!GITHUB_PAGES)}
function invalidMemberSession(){if(!LOCAL&&!GITHUB_PAGES){location.replace(`${GITHUB_HOME}#session-invalid`);return true}showMemberLinkRequired('Votre association à cet appareil n’est plus valide. Ouvrez à nouveau votre lien personnel.');return false}
let memberRefreshBusy=false,lastMemberActivityAt=Date.now(),lastMemberSyncAt=0,memberPollTimer=0;
const QUOTA_ACTIVE_POLL_MS=5*60*1000;
const QUOTA_IDLE_POLL_MS=15*60*1000;
const QUOTA_WAKE_STALE_MS=30*1000;
const SHARED_SYNC_POLL_MS=4000;
let sharedSyncVersion='',sharedSyncTimer=0,sharedSyncBusy=false;
function noteSharedSyncVersion(payload){
  const version=String(payload?.syncVersion||payload?.version||'');
  if(version)sharedSyncVersion=version;
  return version
}
function markMemberActivity(){lastMemberActivityAt=Date.now();if(!LOCAL&&!GITHUB_PAGES)scheduleMemberPoll()}
function memberPollDelay(){return Date.now()-lastMemberActivityAt<10*60*1000?QUOTA_ACTIVE_POLL_MS:QUOTA_IDLE_POLL_MS}
async function refreshMember({openIfSuccessful=false}={}){
  if(memberRefreshBusy||memberPlanningHasWork())return;

  if(LOCAL){
    memberData=localMemberSnapshot(currentLocalMemberId);
    if(openIfSuccessful&&activeRootView!=='memberRoot')showOnly('memberRoot');
    if(activeRootView==='memberRoot')renderMember();
    return
  }

  memberRefreshBusy=true;
  try{
    const fresh=await netApi('/api/me');
    lastMemberSyncAt=Date.now();
    memberData=memberPendingOverlay(fresh);

    if(!memberMonth){
      memberCalendarMode='auto';
      memberMonth=chooseInitialMonth()
    }

    /* Une ouverture explicite de /calendar a le droit d'afficher la vue.
       Un polling / refresh de fond n'a toujours jamais le droit de naviguer. */
    if(openIfSuccessful&&activeRootView!=='memberRoot'){
      showOnly('memberRoot')
    }

    if(activeRootView==='memberRoot'){
      q('#githubAdminLink').classList.add('hidden');
      renderMember()
    }
  }catch(e){
    if(e.status===401){
      if(openIfSuccessful||activeRootView==='memberRoot')invalidMemberSession();
      return
    }

    if(openIfSuccessful){
      setAdminLoginView(false);
      showOnly('joinView');
      q('#adminCodeForm').classList.add('hidden');
      q('#joinTitle').textContent='Calendrier indisponible';
      q('#joinStatus').textContent='Le serveur n’a pas pu ouvrir le calendrier.';
      setNotice(q('#joinError'),e.message)
    }else if(activeRootView==='memberRoot'){
      showMemberError(`Actualisation impossible : ${e.message}`)
    }
  }finally{
    memberRefreshBusy=false
  }
}
function scheduleMemberPoll(){
  clearTimeout(memberPollTimer);
  memberPollTimer=setTimeout(async()=>{
    if(document.visibilityState==='visible'&&!memberPlanningHasWork()&&activeRootView==='memberRoot')await refreshMember();
    scheduleMemberPoll()
  },memberPollDelay())
}

// --- Vue admin ---
function adminIsOpen(d){return effectiveOpen(adminData,d)}
function nextAdminOpenDate(from=parisToday()){
  for(let i=0;i<=366;i++){
    const s=addDays(from,i);
    if(adminIsOpen(s))return s
  }
  return from
}
function adminNextOpenDates(limit=6,from=parisToday()){
  const out=[];
  for(let i=0;i<=366&&out.length<limit;i++){
    const s=addDays(from,i);
    if(adminIsOpen(s))out.push(s)
  }
  return out
}
function adminHomeMode(today=parisToday()){
  const[y,m,d]=today.split('-').map(Number);
  const remaining=daysInMonth(y,m)-d;
  return remaining<14?'upcoming':'month'
}
function adminHomeMonth(today=parisToday()){
  return monthKey(today)
}

function adminDatesForMonth(k){
  const[y,m]=k.split('-').map(Number),out=[],today=parisToday();
  for(let d=1;d<=daysInMonth(y,m);d++){
    const s=iso(y,m,d);
    if(s<today)continue;
    if(adminIsOpen(s))out.push(s)
  }
  return out
}
function fillDaySingleChoiceList(container,currentIds,members){
  const current=String((currentIds||[])[0]||'');
  container.innerHTML='';
  container.dataset.selectedId=current;
  const makeButton=(id,label,extra='')=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className=`single-choice-item${extra?` ${extra}`:''}${current===String(id)?' selected':''}`;
    btn.dataset.memberId=String(id);
    btn.textContent=label;
    btn.addEventListener('click',()=>setDaySingleChoice(container,String(id)));
    container.append(btn)
  };
  makeButton('','À pourvoir','empty-choice');
  for(const m of sortMembersAlpha(members))makeButton(String(m.id),m.name)
}
function setDaySingleChoice(container,memberId){
  const selected=String(memberId||'');
  container.dataset.selectedId=selected;
  for(const btn of container.querySelectorAll('.single-choice-item'))btn.classList.toggle('selected',String(btn.dataset.memberId||'')===selected)
}
function getDaySingleChoiceValue(container){
  return String(container?.dataset.selectedId||'')
}
function dayRoleChoiceContainer(role){
  return q(role==='accueil'?'#dayAccueilChoices':role==='tpe'?'#dayTpeChoices':role==='mep'?'#dayMepChoices':'#dayArbitrageChoices')
}
function fillAvailableChecklist(container,currentIds,members,prefix,{disabledIds=[]}={}){
  const current=new Set((currentIds||[]).map(String));
  const disabled=new Set((disabledIds||[]).map(String));
  container.innerHTML='';
  for(const m of sortMembersAlpha(members)){
    const id=String(m.id),unavailable=disabled.has(id);
    const label=document.createElement('label');
    label.className=`available-check${unavailable?' is-disabled':''}`;
    if(unavailable)label.title='Déjà affecté à un rôle pour cette journée';
    const box=document.createElement('input');
    box.type='checkbox';box.value=id;box.name=`${prefix}-${id}`;
    box.disabled=unavailable;
    box.checked=!unavailable&&current.has(id);
    const span=document.createElement('span');span.textContent=m.name;
    label.append(box,span);container.append(label)
  }
}
function checkedAvailableIds(container){
  return [...container.querySelectorAll('input[type="checkbox"]:checked')].map(x=>String(x.value))
}
function fillSingleChoiceList(container,currentIds,members,onChoose){
  const current=String((currentIds||[])[0]||'');
  container.innerHTML='';
  const makeButton=(id,label,extra='')=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className=`single-choice-item${extra?` ${extra}`:''}${current===String(id)?' selected':''}`;
    btn.dataset.memberId=String(id);
    btn.textContent=label;
    btn.addEventListener('click',()=>onChoose(String(id)));
    container.append(btn)
  };
  makeButton('','À pourvoir','empty-choice');
  for(const m of sortMembersAlpha(members))makeButton(String(m.id),m.name)
}

let dayEditorDraft=null;
let dayEditorTouchSelectedId='';

function dayEditorActiveMembers(){
  return sortMembersAlpha((adminData?.membersAdmin||[]).filter(m=>m.active))
}
function dayEditorMemberName(id){
  return dayEditorActiveMembers().find(m=>String(m.id)===String(id))?.name||String(id||'')
}
function dayEditorCoreIds(){
  return new Set(CORE_ROLE_KEYS.map(r=>String(dayEditorDraft?.roles?.[r]||'')).filter(Boolean))
}
function dayEditorSetWarning(text=''){
  const warning=q('#dayEditorWarning');
  warning.textContent=text;
  warning.classList.toggle('hidden',!text)
}
function dayEditorMemberStatus(id){
  const labels=[];
  for(const role of CORE_ROLE_KEYS){
    if(String(dayEditorDraft?.roles?.[role]||'')===String(id))labels.push(ROLE_LABELS[role])
  }
  if((dayEditorDraft?.present||[]).map(String).includes(String(id)))labels.push('Disponible');
  return labels.join(' · ')
}
function toggleDayEditorMemberSelection(memberId){
  dayEditorTouchSelectedId=dayEditorTouchSelectedId===String(memberId)?'':String(memberId);
  renderDayEditorDraft()
}
function makeDayMemberDraggable(el,id){
  const memberId=String(id);
  el.dataset.memberId=memberId;
  el.tabIndex=0;
  el.setAttribute('role','button');
  el.setAttribute('aria-pressed',dayEditorTouchSelectedId===memberId?'true':'false');
  el.addEventListener('keydown',e=>{
    if(!['Enter',' '].includes(e.key))return;
    e.preventDefault();toggleDayEditorMemberSelection(memberId)
  });
  el.addEventListener('click',()=>{
    if(el.classList.contains('is-dragging'))return;
    toggleDayEditorMemberSelection(memberId)
  });

  if(isTouchUi()){
    el.draggable=false;
    el.classList.add('touch-selectable');
    return
  }

  el.draggable=true;
  el.addEventListener('dragstart',e=>{
    e.dataTransfer.effectAllowed='copy';
    e.dataTransfer.setData('text/plain',memberId);
    document.body.classList.add('day-dragging');
    requestAnimationFrame(()=>el.classList.add('is-dragging'))
  });
  el.addEventListener('dragend',()=>{
    el.classList.remove('is-dragging');
    document.body.classList.remove('day-dragging');
    for(const z of document.querySelectorAll('.day-role-dropzone'))z.classList.remove('drag-over','drop-denied')
  })
}
function dayEditorAssign(memberId,role){
  if(!dayEditorDraft)return false;
  const id=String(memberId||'');
  if(!id)return false;

  if(role==='present'){
    if(dayEditorCoreIds().has(id)){
      const roles=CORE_ROLE_KEYS
        .filter(r=>String(dayEditorDraft.roles[r]||'')===id)
        .map(r=>ROLE_LABELS[r]).join(', ');
      dayEditorSetWarning(`${dayEditorMemberName(id)} est déjà affecté${roles?` à ${roles}`:''} et ne peut pas être également disponible.`);
      return false
    }
    dayEditorDraft.present=[...new Set([...(dayEditorDraft.present||[]).map(String),id])]
  }else{
    dayEditorDraft.roles[role]=id;
    dayEditorDraft.present=(dayEditorDraft.present||[]).map(String).filter(x=>x!==id)
  }

  dayEditorSetWarning('');
  renderDayEditorDraft();
  return true
}
function dayEditorRemove(role,memberId=''){
  if(!dayEditorDraft)return;
  if(role==='present'){
    dayEditorDraft.present=(dayEditorDraft.present||[]).map(String).filter(id=>id!==String(memberId))
  }else{
    dayEditorDraft.roles[role]=''
  }
  dayEditorSetWarning('');
  renderDayEditorDraft()
}
function dayEditorTouchAssign(role){
  if(!dayEditorTouchSelectedId)return;
  const id=dayEditorTouchSelectedId;
  dayEditorTouchSelectedId='';
  if(!dayEditorAssign(id,role)){
    dayEditorTouchSelectedId=id;
    renderDayEditorDraft()
  }
}

function dayEditorWireDropzone(zone,role){
  zone.onclick=e=>{
    if(!dayEditorTouchSelectedId)return;
    if(e.target.closest('.day-assignment-remove'))return;
    dayEditorTouchAssign(role)
  };
  zone.ondragenter=e=>{e.preventDefault();zone.classList.add('drag-over')};
  zone.ondragover=e=>{
    e.preventDefault();
    const id=e.dataTransfer.getData('text/plain');
    const denied=role==='present'&&id&&dayEditorCoreIds().has(String(id));
    e.dataTransfer.dropEffect=denied?'none':'copy';
    zone.classList.toggle('drop-denied',!!denied);
    zone.classList.toggle('drag-over',!denied)
  };
  zone.ondragleave=e=>{
    if(!zone.contains(e.relatedTarget))zone.classList.remove('drag-over','drop-denied')
  };
  zone.ondrop=e=>{
    e.preventDefault();
    zone.classList.remove('drag-over','drop-denied');
    const id=e.dataTransfer.getData('text/plain');
    if(id)dayEditorAssign(id,role)
  }
}
function syncDayEditorCompletionVisual(){
  const workspace=q('.day-editor-columns');
  if(!workspace||!dayEditorDraft)return;
  const complete=CORE_ROLE_KEYS.every(
    role=>String(dayEditorDraft.roles?.[role]||'').trim()!==''
  );
  workspace.classList.toggle('day-complete',complete)
}

function renderDayEditorDraft(){
  if(!dayEditorDraft)return;
  syncDayEditorCompletionVisual();
  q('.day-editor-columns')?.classList.toggle('touch-member-selected',isTouchUi()&&!!dayEditorTouchSelectedId);
  const touchHelp=q('#dayEditorTouchHelp');
  if(touchHelp){
    touchHelp.classList.remove('hidden');
    if(dayEditorTouchSelectedId){
      touchHelp.textContent=`${dayEditorMemberName(dayEditorTouchSelectedId)} sélectionné · choisissez un poste.`
    }else if(isTouchUi()){
      touchHelp.textContent='Touchez un membre, puis un poste. Balayez horizontalement pour voir tous les postes.'
    }else{
      touchHelp.textContent='Cliquez un membre puis un poste, ou glissez-déposez le membre vers le poste.'
    }
  }
  const quickRoles=q('#dayEditorQuickRoles'),quickSelected=q('#dayEditorQuickSelected');
  if(quickRoles){
    const show=isTouchUi()&&!!dayEditorTouchSelectedId;
    quickRoles.classList.toggle('hidden',!show);
    if(quickSelected)quickSelected.textContent=show?`${dayEditorMemberName(dayEditorTouchSelectedId)} sélectionné`:''
  }
  const members=dayEditorActiveMembers();
  const pool=q('#dayMemberPool');
  pool.innerHTML='';

  for(const m of members){
    const item=document.createElement('div');
    item.className='day-member-source-item'+(dayEditorTouchSelectedId===String(m.id)?' touch-selected':'');

    const grip=document.createElement('span');
    grip.className='day-member-grip';
    grip.textContent='⋮⋮';
    grip.setAttribute('aria-hidden','true');

    const text=document.createElement('div');
    text.className='day-member-source-text';
    const name=document.createElement('strong');
    name.textContent=m.name;
    const statusText=dayEditorMemberStatus(m.id);

    text.append(name);
    item.append(grip,text);
    item.title=isTouchUi()
      ?(dayEditorTouchSelectedId===String(m.id)?`${m.name} sélectionné · choisissez un poste`:`Touchez ${m.name} puis un poste`)
      :(dayEditorTouchSelectedId===String(m.id)?`${m.name} sélectionné · cliquez un poste`:(statusText?`${m.name} · ${statusText} · cliquer ou glisser`:`Cliquer ou glisser ${m.name}`));
    makeDayMemberDraggable(item,m.id);
    pool.append(item)
  }

  for(const role of CORE_ROLE_KEYS){
    const zone=dayRoleChoiceContainer(role);
    zone.innerHTML='';
    zone.dataset.selectedId=String(dayEditorDraft.roles[role]||'');
    dayEditorWireDropzone(zone,role);
    const id=String(dayEditorDraft.roles[role]||'');

    if(!id){
      const empty=document.createElement('div');
      empty.className='day-drop-placeholder';
      empty.textContent='À pourvoir';
      zone.append(empty);
      continue
    }

    const chip=document.createElement('div');
    chip.className='day-assignment-chip';
    const name=document.createElement('span');
    name.textContent=dayEditorMemberName(id);
    const remove=document.createElement('button');
    remove.type='button';
    remove.className='day-assignment-remove';
    remove.textContent='×';
    remove.title=`Retirer ${dayEditorMemberName(id)} de ${ROLE_LABELS[role]}`;
    remove.setAttribute('aria-label',remove.title);
    remove.addEventListener('click',()=>dayEditorRemove(role,id));
    chip.append(name,remove);
    zone.append(chip)
  }

  const availableZone=q('#dayPresentChoices');
  availableZone.innerHTML='';
  dayEditorWireDropzone(availableZone,'present');
  const available=(dayEditorDraft.present||[]).map(String);

  if(!available.length){
    const empty=document.createElement('div');
    empty.className='day-drop-placeholder';
    empty.textContent='Personne disponible';
    availableZone.append(empty)
  }else{
    const wrap=document.createElement('div');
    wrap.className='day-available-chip-wrap';
    for(const id of available){
      const chip=document.createElement('div');
      chip.className='day-available-chip';
      const name=document.createElement('span');
      name.textContent=dayEditorMemberName(id);
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='day-assignment-remove';
      remove.textContent='×';
      remove.title=`Retirer ${dayEditorMemberName(id)} de Disponible`;
      remove.setAttribute('aria-label',remove.title);
      remove.addEventListener('click',()=>dayEditorRemove('present',id));
      chip.append(name,remove);
      wrap.append(chip)
    }
    availableZone.append(wrap)
  }
  wireHorizontalScrollAffordances()
}
function populateDayEditor(date){
  dayEditorTouchSelectedId='';
  const assignments=adminData.assignments?.[date]||{};
  const roles=Object.fromEntries(CORE_ROLE_KEYS.map(role=>[
    role,
    String((Array.isArray(assignments[role])?assignments[role]:[])[0]||'')
  ]));
  const coreIds=new Set(Object.values(roles).filter(Boolean));
  const rawPresent=[...new Set((assignments.present||[]).map(String))];
  const cleanedPresent=rawPresent.filter(id=>!coreIds.has(id));
  const removed=rawPresent.filter(id=>coreIds.has(id));

  dayEditorDraft={date,roles,present:cleanedPresent};
  q('#dayEditorDate').value=date;
  q('#dayEditorDateLabel').textContent=dayLabel(date);

  /* Le panneau Modifier reprend exactement la couleur de la ligne
     actuellement affichée dans le planning principal. */
  const workspace=q('.day-editor-columns');
  if(workspace){
    workspace.classList.remove('week-a','week-b','day-complete');
    const sourceCell=[...document.querySelectorAll('#adminScheduleBody td[data-date]')]
      .find(td=>td.dataset.date===date);
    const sourceRow=sourceCell?.closest('tr');
    workspace.classList.add(sourceRow?.classList.contains('week-b')?'week-b':'week-a');
    if(sourceRow?.classList.contains('day-complete'))workspace.classList.add('day-complete')
  }

  renderDayEditorDraft();

  if(removed.length){
    dayEditorSetWarning(`${removed.map(dayEditorMemberName).join(', ')} ${removed.length>1?'ont été retirés':'a été retiré'} de Disponible dans ce brouillon car ${removed.length>1?'ils ont':'il a'} déjà un rôle.`)
  }else{
    dayEditorSetWarning('')
  }
}
function openAdminCorrection(date){
  populateDayEditor(date);
  const overlay=q('#adminCorrectionOverlay');
  openModalOverlay(overlay,{focus:()=>q('#dayMemberPool .day-member-source-item')||q('#adminCorrectionClose')});
  wireHorizontalScrollAffordances()
}
function closeAdminCorrection(){
  dayEditorTouchSelectedId='';
  closeModalOverlay(q('#adminCorrectionOverlay'))
}
function adminCorrectionForDate(date){openAdminCorrection(date)}
function populateAdminCellEditor(date,role){
  const active=(adminData.membersAdmin||[]).filter(m=>m.active);
  const assignments=adminData.assignments?.[date]||{};
  const ids=Array.isArray(assignments[role])?assignments[role]:[];
  q('#adminCellDate').value=date;
  q('#adminCellRole').value=role;
  q('#adminCellContext').textContent=`${dayLabel(date)} · ${ROLE_LABELS[role]}`;
  const roleField=q('#adminCellRoleField'),availableField=q('#adminCellAvailableField');
  const actions=q('#adminCellActions');
  const warning=q('#adminCellWarning');
  warning.textContent='';warning.classList.add('hidden');
  if(role==='present'){
    roleField.classList.add('hidden');
    availableField.classList.remove('hidden');
    actions.classList.remove('hidden');
    const assignedCoreIds=[...new Set(CORE_ROLE_KEYS.flatMap(r=>Array.isArray(assignments[r])?assignments[r].map(String):[]))];
    fillAvailableChecklist(
      q('#adminCellAvailableChoices'),
      ids.filter(id=>!assignedCoreIds.includes(String(id))),
      active,
      'cell-available',
      {disabledIds:assignedCoreIds}
    )
  }else{
    availableField.classList.add('hidden');
    roleField.classList.remove('hidden');
    actions.classList.add('hidden');
    fillSingleChoiceList(q('#adminCellRoleChoices'),ids,active,(memberId)=>saveAdminCellSelection(date,role,memberId,true))
  }
}
function openAdminCellEditor(date,role){
  populateAdminCellEditor(date,role);
  const overlay=q('#adminCellOverlay');
  openModalOverlay(overlay,{focus:()=>role==='present'?q('#adminCellClose'):q('#adminCellRoleChoices .single-choice-item.selected, #adminCellRoleChoices .single-choice-item')})
}
function closeAdminCellEditor(){closeModalOverlay(q('#adminCellOverlay'))}
function setLocalCellAssignment(date,role,value){
  const old=(localAssignmentsSnapshot()[date]?.[role]||[]).map(String);
  const next=role==='present'
    ?[...new Set((Array.isArray(value)?value:[]).map(String).filter(Boolean))]
    :(value?[String(value)]:[]);
  if(role==='present'){
    for(const id of old)if(!next.includes(id))audit('Administrateur','admin_retrait',date,{memberId:id});
    for(const id of next)if(!old.includes(id))audit('Administrateur','admin_inscription',date,{memberId:id});
    if(next.length)localState.attendance[date]=next;else delete localState.attendance[date]
  }else{
    const roles={...(localState.roleAssignments[date]||{})};
    for(const id of old)if(!next.includes(id))audit('Administrateur','admin_role_retrait',date,{memberId:id,role});
    for(const id of next)if(!old.includes(id))audit('Administrateur','admin_role_inscription',date,{memberId:id,role});
    if(next.length)roles[role]=next;else delete roles[role];
    if(Object.keys(roles).length)localState.roleAssignments[date]=roles;else delete localState.roleAssignments[date]
  }
  saveLocal();
  adminData=localAdminSnapshot()
}
function saveAdminCellSelection(date,role,value,closeOnSuccess=true){
  const nextValue=role==='present'
    ?[...new Set((Array.isArray(value)?value:[]).map(String).filter(Boolean))]
    :(value?String(value):'');
  const nextIds=role==='present'?nextValue:(nextValue?[nextValue]:[]);
  queueAdminPlanningChanges([{date,role,ids:nextIds}]);
  if(closeOnSuccess)closeAdminCellEditor()
}

async function saveAdminCell(btn=null){
  const date=q('#adminCellDate').value,role=q('#adminCellRole').value;
  const value=checkedAvailableIds(q('#adminCellAvailableChoices'));
  return saveAdminCellSelection(date,role,value,true)
}


let adminDragPayload=null;
let adminDragDropHandled=false;
function currentAdminRoleIds(date,role){
  const a=adminData?.assignments?.[date]||{};
  return (Array.isArray(a[role])?a[role]:[]).map(String)
}
function localWriteAdminRoleIds(date,role,nextIds){
  const next=[...new Set((nextIds||[]).map(String).filter(Boolean))];
  const old=currentAdminRoleIds(date,role);
  if(role==='present'){
    for(const id of old)if(!next.includes(id))audit('Administrateur','admin_retrait',date,{memberId:id});
    for(const id of next)if(!old.includes(id))audit('Administrateur','admin_inscription',date,{memberId:id});
    if(next.length)localState.attendance[date]=next;else delete localState.attendance[date];
    return
  }
  const roles={...(localState.roleAssignments[date]||{})};
  for(const id of old)if(!next.includes(id))audit('Administrateur','admin_role_retrait',date,{memberId:id,role});
  for(const id of next)if(!old.includes(id))audit('Administrateur','admin_role_inscription',date,{memberId:id,role});
  if(next.length)roles[role]=next;else delete roles[role];
  if(Object.keys(roles).length)localState.roleAssignments[date]=roles;else delete localState.roleAssignments[date]
}
function moveLocalAdminAssignment({memberId,sourceDate,sourceRole,targetDate,targetRole}){
  if(sourceDate===targetDate&&sourceRole===targetRole)return;
  const source=currentAdminRoleIds(sourceDate,sourceRole);
  if(!source.includes(memberId))throw new Error('Cette affectation a déjà changé.');
  const target=currentAdminRoleIds(targetDate,targetRole);
  const copySameRoleAcrossDates=sourceDate!==targetDate&&sourceRole===targetRole;
  const canSwap=!copySameRoleAcrossDates&&CORE_ROLE_KEYS.includes(sourceRole)&&CORE_ROLE_KEYS.includes(targetRole)&&source.length===1&&target.length===1&&target[0]!==memberId;
  if(copySameRoleAcrossDates){
    localWriteAdminRoleIds(targetDate,targetRole,targetRole==='present'?[...target,memberId]:[memberId])
  }else if(canSwap){
    const displaced=target[0];
    localWriteAdminRoleIds(sourceDate,sourceRole,[displaced]);
    localWriteAdminRoleIds(targetDate,targetRole,[memberId])
  }else{
    localWriteAdminRoleIds(sourceDate,sourceRole,source.filter(id=>id!==memberId));
    localWriteAdminRoleIds(targetDate,targetRole,targetRole==='present'?[...target,memberId]:[memberId])
  }
  saveLocal();adminData=localAdminSnapshot()
}
function adminMemberName(id){
  return (adminData.membersAdmin||adminData.members||[]).find(m=>String(m.id)===String(id))?.name||'Membre'
}
async function moveAdminAssignment(payload,targetDate,targetRole){
  if(!payload||!targetDate||!targetRole)return;
  const {memberId,sourceDate,sourceRole}=payload;
  if(sourceDate===targetDate&&sourceRole===targetRole)return;

  const sourceIds=currentAdminRoleIds(sourceDate,sourceRole);
  if(!sourceIds.includes(String(memberId))){
    setNotice(q('#adminError'),'Cette affectation a déjà changé.');
    return
  }

  const targetIds=currentAdminRoleIds(targetDate,targetRole);
  const memberName=adminMemberName(memberId);
  const copySameRoleAcrossDates=sourceDate!==targetDate&&sourceRole===targetRole;
  const canSwap=
    !copySameRoleAcrossDates &&
    CORE_ROLE_KEYS.includes(sourceRole) &&
    CORE_ROLE_KEYS.includes(targetRole) &&
    sourceIds.length===1 &&
    targetIds.length===1 &&
    targetIds[0]!==String(memberId);

  const displacedId=canSwap?targetIds[0]:'';

  /* On garde uniquement la confirmation du remplacement destructif
     sur une même journée. Les swaps et opérations entre dates restent directs. */
  if(sourceDate===targetDate&&!canSwap){
    const replacements=targetRole==='present'?[]:targetIds.filter(id=>id!==memberId);
    if(replacements.length){
      const names=replacements.map(adminMemberName).join(', ');
      if(!await confirmModal(
        `La case ${ROLE_LABELS[targetRole]} contient ${names}. ${memberName} le remplacera.`,
        {title:'Remplacer une affectation',confirmText:'Remplacer'}
      ))return
    }
  }

  const sourceAfter=copySameRoleAcrossDates
    ?sourceIds
    :canSwap
      ?[displacedId]
      :sourceIds.filter(id=>id!==String(memberId));

  const targetAfter=targetRole==='present'
    ?[...new Set([...targetIds,String(memberId)])]
    :[String(memberId)];

  const changes=copySameRoleAcrossDates
    ?[{date:targetDate,role:targetRole,ids:targetAfter}]
    :[
      {date:sourceDate,role:sourceRole,ids:sourceAfter},
      {date:targetDate,role:targetRole,ids:targetAfter}
    ];

  queueAdminPlanningChanges(changes)
}


function removeAdminDraggedAssignment(payload){
  if(!payload)return;
  const memberId=String(payload.memberId||'');
  const sourceDate=String(payload.sourceDate||'');
  const sourceRole=String(payload.sourceRole||'');
  if(!memberId||!sourceDate||!ROLE_KEYS.includes(sourceRole))return;

  const sourceIds=currentAdminRoleIds(sourceDate,sourceRole);
  if(!sourceIds.includes(memberId)){
    setNotice(q('#adminError'),'Cette affectation a déjà changé.');
    return
  }

  /* Un drop hors tableau équivaut à retirer uniquement ce nom de sa
     case d'origine. Pour Disponible, les autres membres restent présents. */
  queueAdminPlanningChanges([{
    date:sourceDate,
    role:sourceRole,
    ids:sourceIds.filter(id=>id!==memberId)
  }])
}

function makeAdminChipDraggable(chip,date,role,memberId){
  chip.draggable=true;
  chip.dataset.memberId=memberId;
  chip.addEventListener('dragstart',e=>{
    adminDragPayload={memberId:String(memberId),sourceDate:date,sourceRole:role};
    adminDragDropHandled=false;
    chip.classList.add('dragging');
    e.dataTransfer.effectAllowed='copyMove';
    e.dataTransfer.setData('text/plain',JSON.stringify(adminDragPayload))
  });
  chip.addEventListener('dragend',()=>{
    adminDragPayload=null;
    adminDragDropHandled=false;
    chip.classList.remove('dragging');
    for(const cell of document.querySelectorAll('.admin-drop-target,.admin-drop-invalid,.admin-drop-swap,.admin-drop-copy'))cell.classList.remove('admin-drop-target','admin-drop-invalid','admin-drop-swap','admin-drop-copy')
  })
}

function renderAdminCalendar(){
  if(!adminData)return;
  const today=parisToday();
  const homeMonth=adminHomeMonth(today);
  const homeMode=adminHomeMode(today);
  const effectiveMode=adminCalendarMode==='auto'?homeMode:adminCalendarMode;
  const nextOpen=nextAdminOpenDate(today);
  const max=shiftMonth(homeMonth,2);

  if(effectiveMode==='upcoming'){
    if(adminCalendarMode==='auto')adminMonth='';
    q('#adminMonthLabel').textContent='Deux prochaines semaines';
    q('#adminPrevMonth').disabled=true;
    q('#adminNextMonth').disabled=false
  }else{
    if(adminCalendarMode==='auto')adminMonth=homeMonth;
    else if(!adminMonth)adminMonth=homeMonth;
    q('#adminMonthLabel').textContent=monthLabel(adminMonth);
    q('#adminPrevMonth').disabled=adminCalendarMode==='auto'||adminMonth<=homeMonth;
    q('#adminNextMonth').disabled=adminMonth>=max
  }

  const body=q('#adminScheduleBody'),mobile=q('#adminScheduleMobile');
  body.innerHTML='';mobile.innerHTML='';
  const nameMap=Object.fromEntries((adminData.membersAdmin||adminData.members||[]).map(m=>[m.id,m.name]));
  let prevWeek='',weekIndex=-1;
  const dates=effectiveMode==='upcoming'?adminNextOpenDates(6,nextOpen):adminDatesForMonth(adminMonth);

  for(const date of dates){
    const open=adminIsOpen(date);
    if(!open&&adminData.scheduleExceptions?.[date]?.isOpen!==false)continue;
    const wk=weekStart(date);
    if(wk!==prevWeek){
      weekIndex++;
      if(prevWeek){
        const sr=document.createElement('tr');sr.className='week-separator';
        const td=document.createElement('td');td.colSpan=6;
        const ln=document.createElement('div');ln.className='week-separator-line';
        td.append(ln);sr.append(td);body.append(sr)
      }
      prevWeek=wk
    }

    const assignments=adminData.assignments?.[date]||{};
    const present=assignments.present||[];
    const coverageState=assignmentCoverage(adminData,date);
    const row=document.createElement('tr');
    row.className=(weekIndex%2?'week-b':'week-a')+(open&&coverageState.covered?' day-complete':'');
    row.dataset.covered=open&&coverageState.covered?'true':'false';

    const dateTd=document.createElement('td');dateTd.className='date-cell';
    const dm=document.createElement('div');dm.className='date-main';dm.textContent=compactDayLabel(date);
    const edit=document.createElement('button');edit.type='button';edit.className='btn admin-calendar-edit';edit.textContent='Modifier';edit.disabled=!open;
    edit.addEventListener('click',()=>adminCorrectionForDate(date));
    dateTd.append(dm,edit);row.append(dateTd);

    for(const role of ROLE_KEYS){
      const td=document.createElement('td');td.className='role-cell';
      td.dataset.date=date;td.dataset.role=role;
      const display=document.createElement('div');display.className='admin-role-display';
      if(open){
        td.classList.add('admin-role-editable');
        td.tabIndex=0;
        td.title=`Modifier ${ROLE_LABELS[role]} : un tap tactile, Entrée/Espace, ou double-clic à la souris`;
        td.addEventListener('click',e=>{
          if(!usesSingleActivation(e)||adminDragPayload)return;
          if(e.target.closest('button,a,input,select,textarea'))return;
          openAdminCellEditor(date,role)
        });
        td.addEventListener('dblclick',e=>{
          if(usesSingleActivation(e))return;
          e.preventDefault();
          openAdminCellEditor(date,role)
        });
        td.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAdminCellEditor(date,role)}});
        td.addEventListener('dragover',e=>{
          if(!adminDragPayload)return;
          e.preventDefault();
          const sourceIds=currentAdminRoleIds(adminDragPayload.sourceDate,adminDragPayload.sourceRole);
          const targetIds=currentAdminRoleIds(date,role);
          const copy=adminDragPayload.sourceDate!==date&&adminDragPayload.sourceRole===role;
          const swap=!copy&&CORE_ROLE_KEYS.includes(adminDragPayload.sourceRole)&&CORE_ROLE_KEYS.includes(role)&&sourceIds.length===1&&targetIds.length===1&&targetIds[0]!==adminDragPayload.memberId;
          e.dataTransfer.dropEffect=copy?'copy':'move';
          td.classList.toggle('admin-drop-copy',copy);
          td.classList.toggle('admin-drop-swap',swap);
          td.classList.toggle('admin-drop-target',!copy&&!swap)
        });
        td.addEventListener('dragleave',e=>{if(!td.contains(e.relatedTarget))td.classList.remove('admin-drop-target')});
        td.addEventListener('drop',e=>{
          e.preventDefault();
          adminDragDropHandled=true;
          td.classList.remove('admin-drop-target','admin-drop-swap','admin-drop-copy');
          const payload=adminDragPayload||(()=>{try{return JSON.parse(e.dataTransfer.getData('text/plain'))}catch{return null}})();
          moveAdminAssignment(payload,date,role)
        })
      }
      if(!open){
        display.classList.add('closed');display.textContent='—'
      }else{
        const ids=sortMemberIds(role==='present'?present:(assignments[role]||[]),nameMap);
        if(ids.length){
          const stack=document.createElement('div');stack.className='role-stack';
          for(const id of ids){
            const chip=document.createElement('span');chip.className='role-chip';
            chip.textContent=nameMap[id]||'Membre';
            makeAdminChipDraggable(chip,date,role,String(id));
            stack.append(chip)
          }
          display.append(stack)
        }else{
          display.classList.add('empty');display.textContent=role==='present'?'Personne disponible':'À pourvoir'
        }
      }
      td.append(display);row.append(td)
    }
    body.append(row);

    const card=document.createElement('article');card.className='mobile-date-card'+(open&&coverageState.covered?' day-complete':'');
    const head=document.createElement('div');head.className='mobile-date-head';
    const left=document.createElement('div');
    const title=document.createElement('div');title.className='mobile-date-title';title.textContent=compactDayLabel(date);
    left.append(title);
    head.append(left);card.append(head);

    const roles=document.createElement('div');roles.className='mobile-roles';
    for(const role of ROLE_KEYS){
      const line=document.createElement('button');
      line.type='button';
      line.className='mobile-role-button admin-mobile-role';
      line.disabled=!open;
      line.title=open?`Modifier ${ROLE_LABELS[role]}`:'Fermé';
      if(open)line.addEventListener('click',()=>openAdminCellEditor(date,role));
      const lab=document.createElement('span');lab.className='mobile-role-label';lab.textContent=ROLE_LABELS[role];
      const val=document.createElement('span');val.className='mobile-role-value';
      if(!open){
        const e=document.createElement('span');e.className='mobile-role-empty';e.textContent='Fermé';val.append(e)
      }else{
        const ids=sortMemberIds(role==='present'?present:(assignments[role]||[]),nameMap);
        if(ids.length){
          for(const id of ids){
            const chip=document.createElement('span');chip.className='role-chip';chip.textContent=nameMap[id]||'Membre';val.append(chip)
          }
        }else{
          const e=document.createElement('span');e.className='mobile-role-empty';e.textContent=role==='present'?'Personne disponible':'À pourvoir';val.append(e)
        }
      }
      line.append(lab,val);roles.append(line)
    }
    card.append(roles);
    const mobileEdit=document.createElement('button');mobileEdit.type='button';mobileEdit.className='btn admin-calendar-edit';mobileEdit.textContent='Modifier';mobileEdit.disabled=!open;
    mobileEdit.addEventListener('click',()=>adminCorrectionForDate(date));
    card.append(mobileEdit);
    mobile.append(card)
  }
  animateAdminCalendarIfNeeded()
}

function coverage(days){let open=0,covered=0;for(let i=0;i<days;i++){const d=addDays(parisToday(),i);if(!adminIsOpen(d))continue;open++;if(assignmentCoverage(adminData,d).covered)covered++}return{open,covered,missing:open-covered,pct:open?Math.round(covered/open*100):100}}
function renderAdmin(){if(!adminData)return;setNotice(q('#adminError'));q('#adminToMember')?.classList.toggle('hidden',!(adminSessionContext?.fromMember&&adminSessionContext?.memberId));q('#memberCount').textContent=`${adminData.membersAdmin.length} membres`;renderAdminCalendar();renderMembers();renderDayEditorMembers();renderAudit();showAdminPage(currentAdminPage,{push:false,scroll:false})}
function renderCoverage(){for(const[n,id,detail]of [[30,'coverage30','coverage30Detail'],[90,'coverage90','coverage90Detail']]){const c=coverage(n);q('#'+id).textContent=`${c.pct}% couvert`;q('#'+detail).textContent=`${c.covered}/${c.open} journées · ${c.missing} à pourvoir`}let next=null;for(let i=0;i<=365;i++){const d=addDays(parisToday(),i),c=assignmentCoverage(adminData,d);if(adminIsOpen(d)&&!c.covered){next={d,c};break}}q('#nextUncovered').textContent=next?dayLabel(next.d):'Aucune';q('#nextUncoveredDetail').textContent=next?`${next.c.filled}/${CORE_ROLE_KEYS.length} postes pourvus · manque${next.c.missing.length>1?'nt':''} : ${next.c.missing.map(r=>ROLE_LABELS[r]).join(', ')}`:'Toutes les dates sont couvertes.'}
function renderUncovered(){const box=q('#uncoveredList');box.innerHTML='';const rows=[];for(let i=0;i<=120;i++){const d=addDays(parisToday(),i);if(adminIsOpen(d))rows.push(d)}const coveredCount=rows.filter(d=>assignmentCoverage(adminData,d).covered).length,missingCount=rows.length-coveredCount;q('#uncoveredCount').textContent=`${coveredCount} couverte${coveredCount>1?'s':''} · ${missingCount} à pourvoir`;const byId=Object.fromEntries(adminData.members.map(m=>[m.id,m.name]));for(const d of rows.slice(0,18)){const coverageState=assignmentCoverage(adminData,d),missing=coverageState.missing.length,el=document.createElement('div');el.className='uncovered-item'+(coverageState.covered?' covered':'');const s=document.createElement('strong');s.textContent=dayLabel(d);el.append(s);const status=document.createElement('div');status.className='coverage-state '+(coverageState.covered?'ok':'bad');status.textContent=coverageState.covered?'Complet ✓':`${missing} poste${missing>1?'s':''} manquant${missing>1?'s':''}`;el.append(status);const count=document.createElement('div');count.className='muted small';count.textContent=`${coverageState.filled}/${CORE_ROLE_KEYS.length} postes pourvus`;el.append(count);const assignments=adminData.assignments?.[d]||{};for(const role of CORE_ROLE_KEYS){const ids=assignments[role]||[],line=document.createElement('div');line.className='small'+(ids.length?'':' muted');const names=sortNamesAlpha(ids.map(id=>byId[id]).filter(Boolean));line.textContent=`${ROLE_LABELS[role]} : ${names.length?names.join(', '):'à pourvoir'}`;el.append(line)}const present=assignments.present||adminData.attendance[d]||[];if(present.length){const line=document.createElement('div');line.className='small muted';const names=sortNamesAlpha(present.map(id=>byId[id]).filter(Boolean));line.textContent=`Disponible : ${names.length?names.join(', '):'—'}`;el.append(line)}const b=document.createElement('button');b.className='btn manage-date-btn';b.textContent='Gérer cette date';b.addEventListener('click',()=>{q('#attendanceDate').value=d;q('#attendanceCorrection').scrollIntoView({behavior:'smooth',block:'start'})});el.append(b);box.append(el)}if(!rows.length){const e=document.createElement('div');e.className='notice ok';e.textContent='Aucune permanence ouverte dans les 120 prochains jours.';box.append(e)}}

async function copyTextToClipboard(text){
  const value=String(text||'');
  if(!value)throw new Error('Aucun lien à copier.');
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(value);
    return
  }
  const ta=document.createElement('textarea');
  ta.value=value;
  ta.setAttribute('readonly','');
  ta.style.position='fixed';
  ta.style.opacity='0';
  document.body.append(ta);
  ta.select();
  const ok=document.execCommand('copy');
  ta.remove();
  if(!ok)throw new Error('Copie impossible sur ce navigateur.')
}

async function copyMemberLink(url,memberName='',btn=null){
  try{
    await copyTextToClipboard(url);
    const old=btn?.textContent;
    if(btn){
      btn.textContent='✓';
      btn.title=`Lien de ${memberName||'ce membre'} copié`;
      setTimeout(()=>{
        btn.textContent=old||'⧉';
        btn.title=`Copier le lien de ${memberName||'ce membre'}`
      },1100)
    }
    toast('Lien copié')
  }catch(e){
    setNotice(q('#adminError'),e.message)
  }
}

async function sendMemberLinkEmail(memberId,memberName='',btn=null){
  if(LOCAL){
    toast('Envoi email indisponible en mode local');
    return
  }

  setButtonBusy(btn,true,'Envoi…');
  setAdminSaveState('saving','Envoi…');
  try{
    const j=await netApi(`/api/admin/members/${encodeURIComponent(memberId)}/send-link`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:'{}'
    });
    if(j.sent!==true)throw new Error(j.error||'Envoi Gmail non configuré.');
    setAdminSaveState('saved','Lien envoyé ✓');
    toast(`Lien envoyé à ${memberName||'ce membre'}`)
  }catch(e){
    setAdminSaveState('error','Échec de l’envoi');
    setNotice(q('#adminError'),e.message);
    toast('Échec : '+e.message)
  }finally{
    setButtonBusy(btn,false)
  }
}

function memberCurrentUrl(m){
  if(!m?.active)return'';
  if(LOCAL)return localPersonalUrl(m.id);
  return m.currentShortToken?shortPersonalUrl(m.currentShortToken):''
}
function formatMemberDeviceLabel(d){
  const label=String(d?.label||'').trim();
  if(label)return label;
  return [d?.type,d?.browser,d?.os].filter(Boolean).join(' · ')||'Appareil'
}
function renderMemberQuick(id){
  const m=(adminData?.membersAdmin||[]).find(x=>String(x.id)===String(id));
  if(!m)return false;
  const panel=q('#memberQuickPanel');panel.dataset.memberId=String(m.id);
  q('#memberQuickTitle').textContent=m.name||'Membre';
  q('#memberQuickEmail').textContent=m.email||'Aucun email';
  q('#memberQuickStatus').textContent=m.active?'Actif':'Inactif';
  const n=Number(m.deviceCount||0);q('#memberQuickDevices').textContent=`${n} appareil${n>1?'s':''}`;
  const list=q('#memberQuickDeviceList');list.innerHTML='';
  const devices=(m.devices||[]).filter(Boolean);
  if(!devices.length){const e=document.createElement('div');e.className='muted small';e.textContent='Aucun appareil connecté.';list.append(e)}
  else for(const d of devices){const row=document.createElement('div');row.className='member-quick-device';const strong=document.createElement('strong');strong.textContent=formatMemberDeviceLabel(d);const small=document.createElement('span');small.textContent=d.createdAt?`Depuis ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(d.createdAt))}`:'';row.append(strong,small);list.append(row)}
  const url=memberCurrentUrl(m);q('#memberQuickLink').textContent=url||'Aucun lien actif';q('#memberQuickLink').title=url;
  const toggle=q('#memberQuickToggle');toggle.textContent=m.active?'Désactiver':'Activer';toggle.classList.toggle('danger',m.active);toggle.disabled=false;
  q('#memberQuickRotate').disabled=!m.active;
  q('#memberQuickCopy').disabled=!url;
  q('#memberQuickSend').disabled=!url||!m.email;
  return true
}
function openMemberQuick(id,trigger=null){
  if(!isTouchUi()||!renderMemberQuick(id))return;
  openModalOverlay(q('#memberQuickPanel'),{focus:'#memberQuickClose',returnFocus:trigger})
}
function closeMemberQuick(){closeModalOverlay(q('#memberQuickPanel'))}
async function refreshMemberQuickAfter(id,work){
  await work;
  if(!q('#memberQuickPanel')?.classList.contains('hidden'))renderMemberQuick(id)
}

let overflowHintRaf=0;
function horizontalScrollHintKey(el){
  if(el.closest('#adminCorrectionOverlay'))return'editor';
  if(el.closest('#adminMembers'))return'members';
  if(el.closest('#adminHistory'))return'history';
  return'planning'
}
function syncHorizontalScrollHint(el,right){
  if(!isTouchUi())return;
  const key=horizontalScrollHintKey(el),storageKey=`calasorga-scroll-hint-${key}`;
  let seen=false;try{seen=sessionStorage.getItem(storageKey)==='1'}catch{}
  let hint=el.parentElement?.querySelector(`:scope > .horizontal-scroll-hint[data-scroll-key="${key}"]`);
  if(right&&!seen){
    if(!hint){hint=document.createElement('div');hint.className='horizontal-scroll-hint';hint.dataset.scrollKey=key;hint.textContent='Balayez horizontalement →';el.insertAdjacentElement('afterend',hint)}
  }else hint?.remove()
  if(el.scrollLeft>12&&!seen){try{sessionStorage.setItem(storageKey,'1')}catch{};hint?.remove()}
}
function updateHorizontalScrollAffordance(el){
  if(!el)return;
  const overflow=el.scrollWidth>el.clientWidth+3;
  const left=overflow&&el.scrollLeft>3;
  const right=overflow&&el.scrollLeft+el.clientWidth<el.scrollWidth-3;
  el.classList.toggle('has-horizontal-overflow',overflow);
  el.classList.toggle('can-scroll-left',left);
  el.classList.toggle('can-scroll-right',right);
  if(overflow)el.setAttribute('aria-description','Contenu horizontal : balayez ou faites défiler pour voir les colonnes suivantes.');else el.removeAttribute('aria-description');
  syncHorizontalScrollHint(el,right)
}
function wireHorizontalScrollAffordances(){
  cancelAnimationFrame(overflowHintRaf);
  overflowHintRaf=requestAnimationFrame(()=>{
    const selectors=['#memberRoot .member-schedule-wrap','#adminRoot .admin-schedule-wrap','#adminMembers .members-table-wrap','#adminHistory .table-wrap','#adminCorrectionOverlay .day-editor-columns'];
    for(const el of document.querySelectorAll(selectors.join(','))){
      if(!el.dataset.scrollAffordance){el.dataset.scrollAffordance='1';el.addEventListener('scroll',()=>updateHorizontalScrollAffordance(el),{passive:true})}
      updateHorizontalScrollAffordance(el)
    }
  })
}
window.addEventListener('resize',wireHorizontalScrollAffordances,{passive:true});

function renderMembers(){
  const body=q('#membersTable');
  body.innerHTML='';

  for(const m of sortMembersAlpha(adminData.membersAdmin)){
    const tr=document.createElement('tr');
    tr.dataset.memberId=m.id;

    const nameTd=document.createElement('td');
    const nameLine=document.createElement('div');
    nameLine.className='member-name-line';
    const name=document.createElement('span');
    name.className='member-display-name';
    name.textContent=m.name;
    name.title=m.name;
    nameLine.append(name);
    if(m.adminPrivilege){
      const adminBadge=document.createElement('span');
      adminBadge.className='admin-member-badge';
      adminBadge.textContent='Admin';
      adminBadge.title='Privilèges administrateur';
      nameLine.append(adminBadge)
    }
    nameTd.append(nameLine);

    const emailTd=document.createElement('td');
    const email=document.createElement('a');
    email.className='member-display-email';
    email.textContent=m.email||'—';
    email.title=m.email||'';
    if(m.email)email.href=`mailto:${m.email}`;
    emailTd.append(email);

    const stateTd=document.createElement('td');
    stateTd.className='member-state-cell';
    const state=document.createElement('button');
    state.type='button';
    state.className='member-state-pill '+(m.active?'active':'inactive');
    state.textContent=m.active?'Actif':'Inactif';
    state.title=memberStateActionTitle(m.active,m.name);
    state.setAttribute('aria-label',state.title);
    state.addEventListener('click',e=>{
      if(!usesSingleActivation(e))return;
      e.preventDefault();
      toggleMemberActiveDirect(m.id,!m.active,m.name,state)
    });
    state.addEventListener('dblclick',e=>{
      if(usesSingleActivation(e))return;
      e.preventDefault();
      toggleMemberActiveDirect(m.id,!m.active,m.name,state)
    });
    stateTd.append(state);

    const devicesTd=document.createElement('td');
    devicesTd.className='member-device-cell';
    const n=Number(m.deviceCount||0);
    const deviceLine=document.createElement('div');
    deviceLine.className='member-device-primary';
    const dot=document.createElement('span');
    dot.className='member-device-dot'+(n?' connected':'');
    const deviceText=document.createElement('span');

    const deviceEntries=(m.devices||[]).filter(Boolean);
    const latestDevice=deviceEntries.length?deviceEntries[deviceEntries.length-1]:null;
    const latestLabel=latestDevice?.label||'';

    if(!n){
      deviceText.textContent='Aucun appareil';
    }else if(n===1&&latestLabel){
      deviceText.textContent=latestLabel;
      deviceText.title=latestLabel;
    }else if(n>1&&latestLabel){
      deviceText.textContent=`${n} appareils · ${latestLabel}`;
      deviceText.title=`${n} appareils\nDernier appareil : ${latestLabel}`;
    }else{
      deviceText.textContent=`${n} appareil${n>1?'s':''}`;
    }

    deviceLine.append(dot,deviceText);
    devicesTd.append(deviceLine);

    if(n&&m.latestDeviceAt){
      const last=document.createElement('div');
      last.className='member-device-secondary member-device-last';
      const dateText=new Intl.DateTimeFormat('fr-FR',{
        dateStyle:'short',
        timeStyle:'short',
        timeZone:'Europe/Paris'
      }).format(new Date(m.latestDeviceAt));
      last.textContent=`Dernière connexion : ${dateText}`;
      last.title=`Dernière connexion : ${dateText}`;
      devicesTd.append(last)
    }

    const linkTd=document.createElement('td');
    linkTd.className='member-link-cell';
    const linkRow=document.createElement('div');
    linkRow.className='member-link-row';

    const refreshLink=document.createElement('button');
    refreshLink.type='button';
    refreshLink.className='member-link-refresh';
    refreshLink.textContent='↻';
    refreshLink.title=m.active?`Renouveler le lien de ${m.name}`:`Réactivez ${m.name} pour générer un lien`;
    refreshLink.setAttribute('aria-label',refreshLink.title);
    refreshLink.disabled=!m.active;
    if(m.active)refreshLink.addEventListener('click',()=>rotateMember(m.id,m.name,refreshLink,{showResult:false,scrollResult:false}));
    linkRow.append(refreshLink);

    let currentMemberUrl='';
    if(LOCAL&&m.active){
      currentMemberUrl=localPersonalUrl(m.id);
      const a=document.createElement('a');
      a.className='member-current-link';a.href=currentMemberUrl;a.textContent=currentMemberUrl;a.title=currentMemberUrl;
      linkRow.append(a)
    }else if(m.currentShortToken){
      currentMemberUrl=shortPersonalUrl(m.currentShortToken);
      const a=document.createElement('a');
      a.className='member-current-link';a.href=currentMemberUrl;a.textContent=currentMemberUrl;a.title=currentMemberUrl;
      linkRow.append(a)
    }else{
      const span=document.createElement('span');
      span.className=m.hasActiveLink?'member-link-legacy':'member-link-empty';
      span.textContent=m.hasActiveLink?'Lien indisponible':'Aucun lien';
      linkRow.append(span)
    }

    const linkActions=document.createElement('div');
    linkActions.className='member-link-actions';

    const copyLink=document.createElement('button');
    copyLink.type='button';
    copyLink.className='member-link-action member-link-copy';
    copyLink.textContent='⧉';
    copyLink.title=currentMemberUrl?`Copier le lien de ${m.name}`:'Aucun lien disponible à copier';
    copyLink.setAttribute('aria-label',copyLink.title);
    copyLink.disabled=!currentMemberUrl;
    if(currentMemberUrl)copyLink.addEventListener('click',()=>copyMemberLink(currentMemberUrl,m.name,copyLink));

    const sendLink=document.createElement('button');
    sendLink.type='button';
    sendLink.className='member-link-action member-link-send';
    sendLink.textContent='✉';
    sendLink.title=currentMemberUrl&&m.email?`Envoyer le lien à ${m.name}`:(!m.email?'Aucune adresse email renseignée':'Aucun lien disponible à envoyer');
    sendLink.setAttribute('aria-label',sendLink.title);
    sendLink.disabled=!currentMemberUrl||!m.email;
    if(!sendLink.disabled)sendLink.addEventListener('click',()=>sendMemberLinkEmail(m.id,m.name,sendLink));

    linkActions.append(copyLink,sendLink);
    linkRow.append(linkActions);
    linkTd.append(linkRow)

    tr.append(nameTd,emailTd,stateTd,devicesTd,linkTd);
    tr.classList.add('member-row-detail');
    tr.tabIndex=isTouchUi()?0:-1;
    tr.setAttribute('aria-label',`Ouvrir la fiche de ${m.name}`);
    tr.addEventListener('click',e=>{
      if(!isTouchUi()||e.target.closest('button,a,input,select,textarea'))return;
      openMemberQuick(m.id,tr)
    });
    tr.addEventListener('keydown',e=>{
      if(!isTouchUi()||!['Enter',' '].includes(e.key)||e.target!==tr)return;
      e.preventDefault();openMemberQuick(m.id,tr)
    });
    body.append(tr)
  }
  renderMemberManagementList();wireHorizontalScrollAffordances()
}

function renderDayEditorMembers(){
  const date=q('#dayEditorDate')?.value;
  if(date&&!q('#adminCorrectionOverlay').classList.contains('hidden'))populateDayEditor(date)
}

function renderAudit(){if(!q('#auditSearch')||!q('#auditAction')||!q('#logsTable'))return;const search=(q('#auditSearch').value||'').trim().toLowerCase(),selected=q('#auditAction').value,all=adminData.auditLog||[],actions=[...new Set(all.map(x=>x.action).filter(Boolean))].sort(),sel=q('#auditAction'),prev=sel.value;sel.innerHTML='<option value="">Toutes les actions</option>';for(const a of actions){const o=document.createElement('option');o.value=a;o.textContent=actionLabel(a);sel.append(o)}if([...sel.options].some(o=>o.value===prev))sel.value=prev;const rows=all.filter(l=>(!selected||l.action===selected)&&(!search||`${l.actor} ${actionLabel(l.action)} ${l.date||''}`.toLowerCase().includes(search)));const body=q('#logsTable');body.innerHTML='';for(const l of rows){const tr=document.createElement('tr');for(const v of [new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(l.at)),l.actor,actionLabel(l.action),l.date||'—']){const td=document.createElement('td');td.textContent=v;tr.append(td)}body.append(tr)}q('#auditShown').textContent=`${rows.length}/${all.length} affiché(s)`;wireHorizontalScrollAffordances()}
let adminRefreshBusy=false,lastAdminActivityAt=Date.now(),lastAdminSyncAt=0,adminPollTimer=0;
function markAdminActivity(){
  lastAdminActivityAt=Date.now();
  if(!LOCAL&&!GITHUB_PAGES)scheduleAdminPoll()
}
function adminPollDelay(){
  return Date.now()-lastAdminActivityAt<10*60*1000?QUOTA_ACTIVE_POLL_MS:QUOTA_IDLE_POLL_MS
}
function adminRefreshSafe(){
  if(LOCAL||GITHUB_PAGES)return false;
  if(document.visibilityState!=='visible')return false;
  if(activeRootView!=='adminRoot')return false;
  if(adminRefreshBusy||adminSavePending||adminWriteQueued||adminDragPayload)return false;
  if(!q('#adminCellOverlay')?.classList.contains('hidden'))return false;
  if(!q('#adminCorrectionOverlay')?.classList.contains('hidden'))return false;
  const active=document.activeElement;
  if(active&&q('#adminRoot')?.contains(active)&&/^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName))return false;
  return true
}
function scheduleAdminPoll(){
  if(LOCAL||GITHUB_PAGES)return;
  clearTimeout(adminPollTimer);
  adminPollTimer=setTimeout(async()=>{
    if(adminRefreshSafe())await refreshAdmin(null,{silent:true});
    scheduleAdminPoll()
  },adminPollDelay())
}
async function enterAdmin(){
  if(LOCAL){
    adminData=localAdminSnapshot();
    showOnly('adminRoot');
    renderAdmin()
  }else{
    await refreshAdmin(null,{openIfSuccessful:true});
    if(activeRootView==='adminRoot')markAdminActivity()
  }
}
async function refreshAdmin(btn=null,{silent=false,openIfSuccessful=false}={}){
  if(adminRefreshBusy)return;
  adminRefreshBusy=true;
  setButtonBusy(btn,true,'Actualisation…');
  try{
    const fresh=await netApi('/api/admin');
    lastAdminSyncAt=Date.now();
    adminSessionContext=fresh.adminContext||{fromMember:false,memberId:null,name:null};
    applyAdminServerSnapshot(fresh);
    if(openIfSuccessful&&activeRootView!=='adminRoot')showOnly('adminRoot');
    if(activeRootView==='adminRoot')renderAdmin()
  }catch(e){
    if(e.status===401){
      clearTimeout(adminPollTimer);
      if(activeRootView==='adminRoot'||openIfSuccessful)showAdminCodeLogin('Entrez votre code administrateur pour continuer.');
      return
    }
    if(!silent&&(activeRootView==='adminRoot'||openIfSuccessful)){
      showOnly('joinView');
      q('#adminCodeForm').classList.add('hidden');
      q('#joinTitle').textContent='Administration indisponible';
      q('#joinStatus').textContent='Le serveur n’a pas pu ouvrir le panneau.';
      setNotice(q('#joinError'),e.message)
    }
  }finally{
    adminRefreshBusy=false;
    setButtonBusy(btn,false)
  }
}
function activateCachedAdminView(){
  viewSwitchTarget='admin';
  currentAdminPage='calendar';
  history.replaceState(null,'','/admin');
  showOnly('adminRoot');
  renderAdmin();
  markAdminActivity()
}

function activateCachedMemberView(){
  viewSwitchTarget='member';
  memberCalendarMode='auto';
  if(!memberMonth)memberMonth=chooseInitialMonth();
  history.replaceState(null,'','/calendar');
  showOnly('memberRoot');
  q('#githubAdminLink')?.classList.add('hidden');
  renderMember()
}

async function switchMemberToAdmin(btn=null){
  if(!memberData?.me?.adminPrivilege)return;

  const sourceMemberId=String(memberData.me.id);
  const sourceMemberName=memberData.me.name;
  const myEpoch=++viewSwitchEpoch;
  viewSwitchTarget='admin';

  const canShowCachedAdmin=
    !!adminData &&
    adminSessionContext?.fromMember===true &&
    String(adminSessionContext?.memberId||'')===sourceMemberId;

  /* Dès qu'un cache admin existe, le clic ne met PLUS le bouton en busy :
     la bascule est purement locale et donc réversible immédiatement. */
  if(canShowCachedAdmin)activateCachedAdminView();

  if(LOCAL){
    adminSessionContext={fromMember:true,memberId:sourceMemberId,name:sourceMemberName};
    adminData=localAdminSnapshot();
    if(viewSwitchTarget==='admin'&&myEpoch===viewSwitchEpoch)activateCachedAdminView();
    return
  }

  /* Premier accès seulement : sans cache on affiche l'état busy car il faut
     réellement attendre le serveur avant de pouvoir construire l'admin. */
  const firstOpen=!canShowCachedAdmin;
  if(firstOpen)setButtonBusy(btn,true,'Ouverture…');

  if(!adminSwitchRefreshPromise){
    adminSwitchRefreshPromise=netApi('/api/session/admin-from-member',{method:'POST'})
      .finally(()=>{adminSwitchRefreshPromise=null})
  }

  try{
    const fresh=await adminSwitchRefreshPromise;
    adminSessionContext=fresh.adminContext||{
      fromMember:true,
      memberId:sourceMemberId,
      name:sourceMemberName
    };
    if(adminWriteQueued===0||!adminData)applyAdminServerSnapshot(fresh);

    /* Une réponse ancienne ne peut jamais reprendre l'écran après un clic
       dans l'autre sens. Seule l'intention UI la plus récente décide. */
    if(viewSwitchTarget==='admin'&&myEpoch===viewSwitchEpoch){
      activateCachedAdminView()
    }
  }catch(e){
    if(viewSwitchTarget==='admin'&&myEpoch===viewSwitchEpoch){
      history.replaceState(null,'','/calendar');
      showOnly('memberRoot');
      renderMember();
      showMemberError(e.message)
    }
  }finally{
    if(firstOpen)setButtonBusy(btn,false)
  }
}

async function switchAdminToMember(btn=null){
  const memberId=String(adminSessionContext?.memberId||'');
  if(!memberId)return;

  const myEpoch=++viewSwitchEpoch;
  viewSwitchTarget='member';

  if(LOCAL){
    const m=localState.members.find(x=>String(x.id)===memberId&&x.active&&x.adminPrivilege===true);
    if(!m){
      setNotice(q('#adminError'),'Privilèges administrateur retirés.');
      return
    }
    currentLocalMemberId=memberId;
    memberData=localMemberSnapshot(memberId);
    memberCalendarMode='auto';
    memberMonth=chooseInitialMonth();
    activateCachedMemberView();
    return
  }

  const hasMemberCache=memberData?.me&&String(memberData.me.id)===memberId;

  /* Normalement le cache membre existe toujours : on réaffiche donc
     immédiatement la vue sans mettre Affichage membre en busy. */
  if(hasMemberCache){
    activateCachedMemberView()
  }else{
    history.replaceState(null,'','/calendar');
    setButtonBusy(btn,true,'Ouverture…')
  }

  if(!memberSwitchRefreshPromise){
    memberSwitchRefreshPromise=netApi('/api/me')
      .finally(()=>{memberSwitchRefreshPromise=null})
  }

  try{
    const fresh=await memberSwitchRefreshPromise;
    memberData=memberPendingOverlay(fresh);
    if(!memberMonth){
      memberCalendarMode='auto';
      memberMonth=chooseInitialMonth()
    }

    if(viewSwitchTarget==='member'&&myEpoch===viewSwitchEpoch){
      activateCachedMemberView()
    }
  }catch(e){
    if(e.status===401){
      /* Ne détruit l'écran que si l'utilisateur demande encore la vue membre.
         S'il est déjà reparti admin, cette ancienne réponse devient passive. */
      if(viewSwitchTarget==='member'&&myEpoch===viewSwitchEpoch)invalidMemberSession();
      return
    }

    if(viewSwitchTarget==='member'&&myEpoch===viewSwitchEpoch){
      if(hasMemberCache){
        showMemberError(`Actualisation impossible : ${e.message}`)
      }else{
        history.replaceState(null,'','/admin');
        showOnly('adminRoot');
        renderAdmin();
        setNotice(q('#adminError'),e.message)
      }
    }
  }finally{
    if(!hasMemberCache)setButtonBusy(btn,false)
  }
}

function showNewLink(url){latestPersonalUrl=url;q('#newLink').textContent=url;q('#newLinkBox').classList.remove('hidden')}
let memberManagementMode='',memberManagementSelectedId='';
function closeMemberManagement(){
  memberManagementMode='';
  for(const id of ['memberCreatePanel','memberModifyPanel'])closeModalOverlay(q('#'+id))
}
function setMemberManagementMode(mode,{selectedId=''}={}){
  closeMemberManagement();
  if(!['create','modify'].includes(mode))return;
  memberManagementMode=mode;
  const overlay=q(mode==='create'?'#memberCreatePanel':'#memberModifyPanel');
  if(mode==='modify'){
    memberManagementSelectedId=selectedId||'';
    q('#memberManageEditForm')?.classList.toggle('hidden',!memberManagementSelectedId);
    renderMemberManagementList();
    openModalOverlay(overlay,{focus:()=>memberManagementSelectedId?q('#memberManageEditName'):q('#memberModifyList .btn')})
  }else{
    q('#newName').value='';q('#newEmail').value='';
    openModalOverlay(overlay,{focus:'#newName'})
  }
}
function renderMemberManagementList(){
  const box=q('#memberModifyList');
  if(!box)return;
  box.innerHTML='';
  const members=sortMembersAlpha(adminData?.membersAdmin||[]);
  if(memberManagementSelectedId&&!members.some(m=>m.id===memberManagementSelectedId))memberManagementSelectedId='';
  for(const m of members){
    const b=document.createElement('button');
    b.type='button';
    b.className='btn'+(m.id===memberManagementSelectedId?' selected':'');
    b.textContent=m.name;
    b.addEventListener('click',()=>selectManagedMember(m.id));
    box.append(b)
  }
  if(memberManagementSelectedId)fillManagedMemberForm(memberManagementSelectedId)
}
function selectManagedMember(id){
  memberManagementSelectedId=id;
  renderMemberManagementList();
  fillManagedMemberForm(id)
}
function fillManagedMemberForm(id){
  const m=(adminData?.membersAdmin||[]).find(x=>x.id===id);
  const form=q('#memberManageEditForm');
  if(!m){form.classList.add('hidden');return}
  q('#memberManageEditId').value=m.id;
  q('#memberManageEditName').value=m.name||'';
  q('#memberManageEditEmail').value=m.email||'';
  q('#memberManageEditAdminPrivilege').checked=m.adminPrivilege===true;
  form.classList.remove('hidden');
  q('#memberManageRotateLink').disabled=!m.active
}
async function saveManagedMember(btn=null){
  const id=q('#memberManageEditId').value;
  const name=q('#memberManageEditName').value.trim();
  const email=q('#memberManageEditEmail').value.trim().toLowerCase();
  const adminPrivilege=q('#memberManageEditAdminPrivilege').checked===true;
  const current=(adminData?.membersAdmin||[]).find(x=>x.id===id);
  if(!current||!name||!email)return;
  const nameChanged=name!==String(current.name||'');
  const emailChanged=email!==String(current.email||'').toLowerCase();
  const privilegeChanged=adminPrivilege!==(current.adminPrivilege===true);
  if(!nameChanged&&!emailChanged&&!privilegeChanged)return;
  setButtonBusy(btn,true,'Enregistrement…');beginAdminSave();
  try{
    if(LOCAL){
      const m=localState.members.find(x=>x.id===id);if(!m)return;
      if(nameChanged)m.name=name.slice(0,80);
      if(emailChanged)m.email=email;
      if(privilegeChanged)m.adminPrivilege=adminPrivilege;
      audit('Administrateur','membre_modifie','',{memberId:id,adminPrivilege:m.adminPrivilege===true});saveLocal();adminData=localAdminSnapshot()
    }else{
      if(nameChanged){const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});applyAdminServerSnapshot(j.snapshot)}
      if(emailChanged){const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});applyAdminServerSnapshot(j.snapshot)}
      if(privilegeChanged){const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminPrivilege})});applyAdminServerSnapshot(j.snapshot)}
    }
    renderAdmin();fillManagedMemberForm(id);endAdminSave(true)
  }catch(e){endAdminSave(false);setNotice(q('#adminError'),e.message)}finally{setButtonBusy(btn,false)}
}
async function createMember(name,email,btn=null){setButtonBusy(btn,true,'Création…');try{name=String(name).trim();email=String(email).trim().toLowerCase();if(!name||!email)return false;if(LOCAL){const id='m'+Math.random().toString(36).slice(2,10);localState.members.push({id,name,email,active:true,adminPrivilege:false,createdAt:nowIso()});audit('Administrateur','membre_cree','',{memberId:id});saveLocal();adminData=localAdminSnapshot();showNewLink(localPersonalUrl(id));renderAdmin()}else{const j=await netApi('/api/admin/members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email})});applyAdminServerSnapshot(j.snapshot);showNewLink(j.shortToken?shortPersonalUrl(j.shortToken):location.origin+j.personalPath);renderAdmin()}toast('Membre créé');return true}catch(e){setNotice(q('#adminError'),e.message);return false}finally{setButtonBusy(btn,false)}}
async function renameMember(id,name,input=null){if(input){input.disabled=true;input.setAttribute('aria-busy','true')}try{if(LOCAL){const m=localState.members.find(x=>x.id===id);if(!m)return;m.name=String(name).trim().slice(0,80)||m.name;audit('Administrateur','membre_renomme','',{memberId:id});saveLocal();adminData=localAdminSnapshot()}else{const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});applyAdminServerSnapshot(j.snapshot)}renderAdmin();toast('Nom enregistré')}catch(e){setNotice(q('#adminError'),e.message)}finally{if(input){input.disabled=false;input.removeAttribute('aria-busy')}}}
async function updateMemberEmail(id,email,input=null){
  if(input){input.disabled=true;input.setAttribute('aria-busy','true')}
  try{
    email=String(email||'').trim().toLowerCase();
    if(LOCAL){
      const m=localState.members.find(x=>x.id===id);
      if(!m)return;
      m.email=email;
      audit('Administrateur','email_membre_modifie','',{memberId:id});
      saveLocal();
      adminData=localAdminSnapshot()
    }else{
      const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
      applyAdminServerSnapshot(j.snapshot)
    }
    renderAdmin();
    toast('Email enregistré')
  }catch(e){
    setNotice(q('#adminError'),e.message)
  }finally{
    if(input){input.disabled=false;input.removeAttribute('aria-busy')}
  }
}
function memberStatusRow(id){
  return [...(q('#membersTable')?.querySelectorAll('tr[data-member-id]')||[])].find(tr=>tr.dataset.memberId===String(id))||null
}
function paintMemberStatus(id,active){
  const m=(adminData?.membersAdmin||[]).find(x=>x.id===id);
  if(m)m.active=!!active;
  const row=memberStatusRow(id),pill=row?.querySelector('.member-state-pill');
  if(pill){
    pill.classList.toggle('active',!!active);
    pill.classList.toggle('inactive',!active);
    pill.textContent=active?'Actif':'Inactif';
    const memberName=m?.name||m?.displayName||'';
    pill.title=memberStateActionTitle(active,memberName);
    pill.setAttribute('aria-label',pill.title)
  }
  const count=q('#memberCount');
  if(count&&adminData)count.textContent=`${adminData.membersAdmin.length} membres`
}
function reapplyPendingMemberStatuses(){
  for(const pending of memberStatusPending.values())paintMemberStatus(pending.memberId,pending.active)
}
function queueMemberStatusChange(id,active,name=''){
  const m=(adminData?.membersAdmin||[]).find(x=>x.id===id);
  if(!m)return;
  const desired=!!active;
  const current=!!m.active;
  if(current===desired)return;

  if(!memberStatusSaveOpen){
    beginAdminSave();
    memberStatusSaveOpen=true;
    memberStatusCycleOk=true
  }

  const existing=memberStatusPending.get(id);
  if(existing){
    existing.active=desired;
    if(desired===existing.rollbackActive)memberStatusPending.delete(id)
  }else{
    memberStatusPending.set(id,{memberId:id,active:desired,rollbackActive:current,name})
  }

  paintMemberStatus(id,desired);
  clearTimeout(memberStatusBatchTimer);

  if(!memberStatusPending.size&&!memberStatusBatchInFlight){
    if(memberStatusSaveOpen){endAdminSave(true);memberStatusSaveOpen=false}
    return
  }
  memberStatusBatchTimer=setTimeout(flushMemberStatusBatch,140)
}
async function applyLocalMemberStatusBatch(batch){
  const today=parisToday();
  for(const change of batch){
    const m=localState.members.find(x=>x.id===change.memberId);
    if(!m||!!m.active===!!change.active)continue;
    m.active=!!change.active;
    if(!change.active){
      for(const[d,ids]of Object.entries(localState.attendance)){
        if(d>=today){
          localState.attendance[d]=ids.filter(x=>x!==change.memberId);
          if(!localState.attendance[d].length)delete localState.attendance[d]
        }
      }
      for(const[d,roles]of Object.entries(localState.roleAssignments||{})){
        if(d<today)continue;
        for(const role of ['accueil','tpe','mep','arbitrage']){
          roles[role]=(roles[role]||[]).filter(x=>x!==change.memberId);
          if(!roles[role].length)delete roles[role]
        }
        if(!Object.keys(roles).length)delete localState.roleAssignments[d]
      }
    }
    audit('Administrateur',change.active?'membre_reactive':'membre_desactive','',{memberId:change.memberId})
  }
  saveLocal();
  return{snapshot:localAdminSnapshot()}
}
async function flushMemberStatusBatch(){
  clearTimeout(memberStatusBatchTimer);
  memberStatusBatchTimer=0;
  if(memberStatusBatchInFlight||!memberStatusPending.size)return;

  const batch=[...memberStatusPending.values()];
  memberStatusPending.clear();
  memberStatusInFlightBatch=batch.map(c=>({...c}));
  memberStatusBatchInFlight=true;
  try{
    const j=LOCAL
      ?await applyLocalMemberStatusBatch(batch)
      :await netApi('/api/admin/members/batch-active',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({changes:batch.map(({memberId,active})=>({memberId,active}))})
      });

    applyAdminServerSnapshot(j.snapshot);
    reapplyPendingMemberStatuses();
    renderAdmin()
  }catch(e){
    memberStatusCycleOk=false;
    for(const change of batch){
      if(memberStatusPending.has(change.memberId))continue;
      paintMemberStatus(change.memberId,change.rollbackActive)
    }
    reapplyPendingMemberStatuses();
    setNotice(q('#adminError'),e.message)
  }finally{
    memberStatusBatchInFlight=false;
    memberStatusInFlightBatch=[];
    if(memberStatusPending.size){
      clearTimeout(memberStatusBatchTimer);
      memberStatusBatchTimer=setTimeout(flushMemberStatusBatch,140)
    }else if(memberStatusSaveOpen){
      endAdminSave(memberStatusCycleOk);
      memberStatusSaveOpen=false
    }
  }
}
async function toggleMemberActiveDirect(id,active,name='',btn=null){
  return setMemberActive(id,active,name,btn)
}


async function setMemberActive(id,active,name='',btn=null){if(!active){const ok=await confirmModal(`Désactiver ${name||'ce membre'} ?\n\nSes accès seront révoqués et ses inscriptions futures seront retirées.`,{title:'Désactiver un membre',confirmText:'Désactiver',danger:true});if(!ok)return}setButtonBusy(btn,true,active?'Réactivation…':'Désactivation…');toast(active?'Réactivation…':'Désactivation…');try{if(LOCAL){const m=localState.members.find(x=>x.id===id);if(!m)return;m.active=active;if(!active){for(const[d,ids]of Object.entries(localState.attendance)){if(d>=parisToday()){localState.attendance[d]=ids.filter(x=>x!==id);if(!localState.attendance[d].length)delete localState.attendance[d]}}for(const[d,roles]of Object.entries(localState.roleAssignments||{})){if(d<parisToday())continue;for(const role of ['accueil','tpe','mep','arbitrage']){roles[role]=(roles[role]||[]).filter(x=>x!==id);if(!roles[role].length)delete roles[role]}if(!Object.keys(roles).length)delete localState.roleAssignments[d]}}audit('Administrateur',active?'membre_reactive':'membre_desactive','',{memberId:id});saveLocal();adminData=localAdminSnapshot();if(active)showNewLink(localPersonalUrl(id))}else{const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});applyAdminServerSnapshot(j.snapshot);if(j.shortToken)showNewLink(shortPersonalUrl(j.shortToken));else if(j.personalPath)showNewLink(location.origin+j.personalPath)}renderAdmin();toast(active?'Membre réactivé':'Membre désactivé')}catch(e){setNotice(q('#adminError'),e.message);toast('Échec : '+e.message)}finally{setButtonBusy(btn,false)}}
async function rotateMemberImpl(id,name='',btn=null,{showResult=true,scrollResult=true}={}){const ok=await confirmModal(`Générer un nouveau lien pour ${name||'ce membre'} ?\n\nL’ancien lien ne fonctionnera plus et les appareils déjà associés devront se reconnecter avec le nouveau lien.`,{title:'Nouveau lien personnel',confirmText:'Générer le lien',danger:true});if(!ok)return;setButtonBusy(btn,true,'Création…');beginAdminSave();let saveOk=false;toast('Création du nouveau lien…');try{if(LOCAL){if(showResult)showNewLink(localPersonalUrl(id));audit('Administrateur','lien_regenere','',{memberId:id});saveLocal();adminData=localAdminSnapshot()}else{const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}/rotate`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});applyAdminServerSnapshot(j.snapshot);if(showResult)showNewLink(j.shortToken?shortPersonalUrl(j.shortToken):location.origin+j.personalPath)}saveOk=true;renderAdmin();toast('Nouveau lien créé');if(showResult&&scrollResult)setTimeout(()=>q('#newLinkBox')?.scrollIntoView({behavior:'smooth',block:'center'}),30)}catch(e){setNotice(q('#adminError'),e.message);toast('Échec : '+e.message)}finally{endAdminSave(saveOk);setButtonBusy(btn,false)}}
async function rotateMember(id,name='',btn=null,opts={}){
  const key=String(id);
  if(memberLinkRotationInFlight.has(key))return memberLinkRotationInFlight.get(key);
  const p=rotateMemberImpl(id,name,btn,opts).finally(()=>memberLinkRotationInFlight.delete(key));
  memberLinkRotationInFlight.set(key,p);
  return p
}

async function rotateAllMemberLinks(btn=null){
  const members=(adminData?.membersAdmin||[]);
  const active=members.filter(m=>m.active);
  if(!active.length){
    toast('Aucun membre actif');
    return
  }

  const ok=await confirmModal(
    `Renouveler les liens de ${active.length} membre${active.length>1?'s':''} actif${active.length>1?'s':''} ?\n\nTous les anciens liens seront invalidés et les appareils associés devront se reconnecter. Si votre accès administrateur provient d’un compte membre concerné, votre session pourra également être interrompue.`,
    {title:'Renouveler tous les liens',confirmText:'Renouveler les liens',danger:true}
  );
  if(!ok)return;

  setButtonBusy(btn,true,'Renouvellement…');
  beginAdminSave();
  let saveOk=false;
  toast('Renouvellement des liens…');
  try{
    if(LOCAL){
      for(const m of active)audit('Administrateur','lien_regenere','',{memberId:m.id,bulk:true});
      saveLocal();
      adminData=localAdminSnapshot()
    }else{
      const j=await netApi('/api/admin/members/rotate-all',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:'{}'
      });
      applyAdminServerSnapshot(j.snapshot)
    }
    saveOk=true;
    renderAdmin();
    toast(`${active.length} lien${active.length>1?'s':''} renouvelé${active.length>1?'s':''}`)
  }catch(e){
    setNotice(q('#adminError'),e.message);
    toast('Échec : '+e.message)
  }finally{
    endAdminSave(saveOk);
    setButtonBusy(btn,false)
  }
}
async function revokeMemberDevices(id,name,count,btn=null){const ok=await confirmModal(`Déconnecter ${count} appareil${count>1?'s':''} associé${count>1?'s':''} à ${name} ?\n\nLe lien personnel restera valide et pourra être utilisé pour reconnecter un appareil.`,{title:'Déconnecter les appareils',confirmText:'Déconnecter',danger:true});if(!ok)return;setButtonBusy(btn,true,'Déconnexion…');try{const j=await netApi(`/api/admin/members/${encodeURIComponent(id)}/sessions/revoke`,{method:'POST'});applyAdminServerSnapshot(j.snapshot);renderAdmin();toast(`${j.revoked} appareil${j.revoked>1?'s':''} déconnecté${j.revoked>1?'s':''}`)}catch(e){setNotice(q('#adminError'),e.message)}finally{setButtonBusy(btn,false)}}
function setLocalDayAssignments(date,selections){
  if(!effectiveOpen(localAdminSnapshot(),date))throw new Error("Le club n'est pas ouvert ce jour-là.");
  const active=new Map(localState.members.filter(m=>m.active).map(m=>[m.id,m]));
  for(const role of CORE_ROLE_KEYS){
    const id=String(selections[role]||'');
    if(id&&!active.has(id))throw new Error(`Membre introuvable pour ${ROLE_LABELS[role]}.`)
  }
  const available=[...new Set((Array.isArray(selections.present)?selections.present:[]).map(String).filter(Boolean))];
  for(const id of available)if(!active.has(id))throw new Error('Membre introuvable pour Disponible.');
  const before=localAssignmentsSnapshot()[date]||{};
  const day=localState.roleAssignments[date]&&typeof localState.roleAssignments[date]==='object'?clone(localState.roleAssignments[date]):{};
  for(const role of CORE_ROLE_KEYS){
    const oldIds=Array.isArray(before[role])?before[role]:[],id=String(selections[role]||''),nextIds=id?[id]:[];
    for(const oldId of oldIds)if(!nextIds.includes(oldId))audit('Administrateur','admin_role_retrait',date,{memberId:oldId,role});
    for(const newId of nextIds)if(!oldIds.includes(newId))audit('Administrateur','admin_role_inscription',date,{memberId:newId,role});
    if(nextIds.length)day[role]=nextIds;else delete day[role]
  }
  if(Object.keys(day).length)localState.roleAssignments[date]=day;else delete localState.roleAssignments[date];
  const oldPresent=Array.isArray(before.present)?before.present:[];
  for(const oldId of oldPresent)if(!available.includes(oldId))audit('Administrateur','admin_retrait',date,{memberId:oldId});
  for(const newId of available)if(!oldPresent.includes(newId))audit('Administrateur','admin_inscription',date,{memberId:newId});
  if(available.length)localState.attendance[date]=available;else delete localState.attendance[date];
  saveLocal();adminData=localAdminSnapshot()
}
function saveAdminDay(btn=null){
  if(!dayEditorDraft)return;
  const date=dayEditorDraft.date;
  const changes=CORE_ROLE_KEYS.map(role=>({
    date,
    role,
    ids:dayEditorDraft.roles[role]?[String(dayEditorDraft.roles[role])]:[]
  }));
  changes.push({
    date,
    role:'present',
    ids:(dayEditorDraft.present||[]).map(String).filter(id=>!dayEditorCoreIds().has(id))
  });
  queueAdminPlanningChanges(changes);
  closeAdminCorrection()
}

function futureAttendanceAffected(willOpen,date){if(willOpen||date<parisToday())return 0;const a=localAssignmentsSnapshot()[date]||{};return ROLE_KEYS.reduce((n,r)=>n+(a[r]||[]).length,0)}
function clearLocalDateAssignments(date){delete localState.attendance[date];delete localState.roleAssignments[date]}
async function setException(date,isOpen,note,btn=null){setButtonBusy(btn,true,'Enregistrement…');try{if(LOCAL){const affected=futureAttendanceAffected(isOpen,date);if(affected&&!await confirmModal(`Cette fermeture retirera ${affected} inscription(s) future(s).`,{title:'Fermer cette date',confirmText:'Fermer la date',danger:true}))return;if(affected)clearLocalDateAssignments(date);localState.scheduleExceptions[date]={isOpen,note:String(note||'').slice(0,200)};audit('Administrateur',isOpen?'ouverture_exceptionnelle':'fermeture_exceptionnelle',date);saveLocal();adminData=localAdminSnapshot()}else{let confirmationToken='';for(;;){try{const j=await netApi('/api/admin/exception',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,isOpen,note,confirmationToken})});applyAdminServerSnapshot(j.snapshot);break}catch(e){const p=e.payload||{};if(e.status!==409||!p.requiresConfirmation||!p.confirmationToken)throw e;if(!await confirmModal(`Cette opération retirera ${p.attendanceCount||0} inscription(s) future(s).`,{title:'Confirmer la modification',confirmText:'Continuer',danger:true}))return;confirmationToken=p.confirmationToken}}}renderAdmin();toast('Exception enregistrée')}catch(e){setNotice(q('#adminError'),e.message)}finally{setButtonBusy(btn,false)}}
async function removeException(date){try{if(LOCAL){const ex=localState.scheduleExceptions[date];if(!ex)return;const afterDefault=defaultOpen(date);if(!afterDefault){const affected=futureAttendanceAffected(false,date);if(affected){if(!await confirmModal(`Le retour aux horaires habituels fermera ce jour et retirera ${affected} inscription(s).`,{title:'Supprimer l’exception',confirmText:'Continuer',danger:true}))return;clearLocalDateAssignments(date)}}delete localState.scheduleExceptions[date];audit('Administrateur','exception_supprimee',date);saveLocal();adminData=localAdminSnapshot()}else{let confirmationToken='';for(;;){try{const j=await netApi(`/api/admin/exception?date=${encodeURIComponent(date)}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmationToken})});applyAdminServerSnapshot(j.snapshot);break}catch(e){const p=e.payload||{};if(e.status!==409||!p.requiresConfirmation||!p.confirmationToken)throw e;if(!await confirmModal(`Cette opération retirera ${p.attendanceCount||0} inscription(s) future(s).`,{title:'Confirmer la modification',confirmText:'Continuer',danger:true}))return;confirmationToken=p.confirmationToken}}}renderAdmin()}catch(e){setNotice(q('#adminError'),e.message)}}
async function bulkException(from,to,mode,note,btn=null){if(from>to){setNotice(q('#adminError'),'La date de fin doit être postérieure à la date de début.');return}if(!await confirmModal(`Appliquer cette modification du ${from} au ${to} ?`,{title:'Modifier une période',confirmText:'Appliquer'}))return;setButtonBusy(btn,true,'Enregistrement…');try{if(LOCAL){for(let d=from;d<=to;d=addDays(d,1)){if(mode==='normal'){if(localState.scheduleExceptions[d]){const willOpen=defaultOpen(d);if(!willOpen&&futureAttendanceAffected(false,d)){const n=futureAttendanceAffected(false,d);if(!await confirmModal(`Le retour aux horaires habituels fermera ${dayLabel(d)} et retirera ${n} inscription(s).`,{title:'Modifier la période',confirmText:'Continuer',danger:true}))return;clearLocalDateAssignments(d)}delete localState.scheduleExceptions[d]}}else{const isOpen=mode==='open';if(!isOpen&&futureAttendanceAffected(false,d))clearLocalDateAssignments(d);localState.scheduleExceptions[d]={isOpen,note:String(note||'').slice(0,200)}}}audit('Administrateur',mode==='normal'?'exceptions_periode_supprimees':mode==='open'?'ouverture_periode':'fermeture_periode',from,{to});saveLocal();adminData=localAdminSnapshot()}else{let confirmationToken='';for(;;){try{const endpoint=mode==='normal'?'/api/admin/exceptions/reset-range':'/api/admin/exceptions/bulk';const body=mode==='normal'?{from,to,confirmationToken}:{from,to,isOpen:mode==='open',note,confirmationToken};const j=await netApi(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});applyAdminServerSnapshot(j.snapshot);break}catch(e){const p=e.payload||{};if(e.status!==409||!p.requiresConfirmation||!p.confirmationToken)throw e;if(!await confirmModal(`Cette opération retirera ${p.attendanceCount||0} inscription(s) future(s).`,{title:'Confirmer la modification',confirmText:'Continuer',danger:true}))return;confirmationToken=p.confirmationToken}}}renderAdmin();toast('Période mise à jour')}catch(e){setNotice(q('#adminError'),e.message)}finally{setButtonBusy(btn,false)}}
function localBackup(){return {format:'club-presences-prefinale-local-v1',exportedAt:nowIso(),state:clone(localState)}}
async function restoreBackup(file,btn=null){setButtonBusy(btn,true,'Validation…');try{const payload=JSON.parse(await file.text());if(LOCAL){const s=payload.state||payload;if(!s||!Array.isArray(s.members)||!s.attendance||!s.scheduleExceptions||!s.settings)throw new Error('Sauvegarde locale invalide.');s.roleAssignments=s.roleAssignments&&typeof s.roleAssignments==='object'?s.roleAssignments:{};if(!await confirmModal('Restaurer cette sauvegarde et remplacer les données locales actuelles ?',{title:'Restaurer la sauvegarde',confirmText:'Restaurer',danger:true}))return;localState=s;saveLocal();adminData=localAdminSnapshot();audit('Administrateur','sauvegarde_importee');saveLocal();renderAdmin();toast('Sauvegarde restaurée')}else{const check=await netApi('/api/admin/backup/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!await confirmModal(`La sauvegarde est valide et contient ${check.summary?.activeMembers??'?'} membre(s) actif(s).\n\nLa restauration remplacera les données actuelles.`,{title:'Restaurer la sauvegarde',confirmText:'Restaurer',danger:true}))return;const j=await netApi('/api/admin/backup/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});applyAdminServerSnapshot(j.snapshot);renderAdmin();toast('Sauvegarde restaurée')}}catch(e){setNotice(q('#adminError'),e.message)}finally{setButtonBusy(btn,false)}}

// --- Connexion / démarrage serveur ---
function setAdminLoginView(active){
  q('#joinView')?.classList.toggle('admin-login-view',!!active)
}
function showAdminCodeLogin(message='Entrez votre code administrateur.'){setAdminLoginView(true);showOnly('joinView');q('#joinTitle').textContent='Administration';q('#joinStatus').textContent=message;setNotice(q('#joinError'));q('#adminCodeForm').classList.remove('hidden');setTimeout(()=>q('#adminCode').focus(),0)}
async function serverJoin(kind,token){setAdminLoginView(false);showOnly('joinView');q('#adminCodeForm').classList.add('hidden');q('#githubAdminLink').classList.add('hidden');q('#joinTitle').textContent=kind==='admin'?'Ouverture de l’administration…':'Ouverture de votre calendrier…';q('#joinStatus').textContent='Vérification du lien.';setNotice(q('#joinError'));try{const endpoint=kind==='admin'?'/api/session/admin':kind==='short'?'/api/session/member-short':'/api/session/member';let confirmSwitch=false;for(;;){try{const body=kind==='short'?{shortToken:token,confirmSwitch}:{token};await netApi(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});break}catch(e){const p=e.payload||{};if(kind==='short'&&e.status===409&&p.requiresIdentitySwitch&&p.currentMember?.name&&p.targetMember?.name){const ok=await confirmModal(`Cet appareil est déjà associé à ${p.currentMember.name}.\n\nLe lien ouvert appartient à ${p.targetMember.name}.\n\nVoulez-vous réassocier cet appareil à ${p.targetMember.name} ?`,{title:'Changer de membre',confirmText:`Passer à ${p.targetMember.name}`});if(!ok){location.replace(GITHUB_HOME);return}confirmSwitch=true;q('#joinStatus').textContent=`Réassociation à ${p.targetMember.name}…`;continue}throw e}}history.replaceState(null,'',kind==='admin'?'/admin':'/calendar');if(kind==='admin'){await enterAdmin();return}if(kind==='short'){location.replace(`${GITHUB_HOME}#enrolled`);return}await refreshMember({openIfSuccessful:true})}catch(e){q('#joinStatus').textContent='Impossible d’ouvrir le lien.';setNotice(q('#joinError'),e.message)}}
async function serverAdminCode(code){adminSessionContext=null;setAdminLoginView(true);showOnly('joinView');q('#joinTitle').textContent='Administration';q('#joinStatus').textContent='Vérification du code…';setNotice(q('#joinError'));try{await netApi('/api/session/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});q('#adminCode').value='';history.replaceState(null,'','/admin');await enterAdmin()}catch(e){q('#joinStatus').textContent='Entrez votre code administrateur.';setNotice(q('#joinError'),e.message);q('#adminCode').select()}}
async function boot(){
  if(GITHUB_PAGES){
    const h=decodeURIComponent(location.hash.slice(1)).normalize('NFC');
    if(h==='enrolled'){try{localStorage.setItem(DEVICE_MARKER_KEY,'1')}catch{}history.replaceState(null,'',location.pathname);location.replace(`${PROD_ORIGIN}/calendar`);return}
    if(h==='logout'){try{localStorage.removeItem(DEVICE_MARKER_KEY)}catch{}history.replaceState(null,'',location.pathname);showMemberLinkRequired('Cet appareil a été déconnecté. Ouvrez à nouveau votre lien personnel pour le réassocier.');return}
    if(h==='session-invalid'){try{localStorage.removeItem(DEVICE_MARKER_KEY)}catch{}history.replaceState(null,'',location.pathname);showMemberLinkRequired('Votre association à cet appareil n’est plus valide. Ouvrez à nouveau votre lien personnel.');return}
    if(/^[\p{L}\p{N}]{1,40}\d{6}$/u.test(h)){location.replace(`${PROD_ORIGIN}/join-short#${encodeURIComponent(h)}`);return}
    let enrolled=false;try{enrolled=localStorage.getItem(DEVICE_MARKER_KEY)==='1'}catch{}
    if(enrolled){location.replace(`${PROD_ORIGIN}/calendar`);return}
    showMemberLinkRequired();return
  }
  if(LOCAL){localState=loadLocal();const h=decodeURIComponent(location.hash.slice(1));if(h==='admin'){adminSessionContext=null;enterAdmin();return}if(h.startsWith('member=')){const id=h.slice(7);if(localState.members.some(m=>m.id===id&&m.active)){enterLocalMember(id);return}}renderChooser();return}
  const path=location.pathname,token=decodeURIComponent(location.hash.slice(1));
  if(path==='/join-short'&&token){history.replaceState(null,'',path);await serverJoin('short',token);return}
  if(path==='/join'&&token){history.replaceState(null,'',path);await serverJoin('member',token);return}
  if(path==='/admin-login'&&token){history.replaceState(null,'',path);await serverJoin('admin',token);return}
  if(path==='/admin'||path==='/admin/membres'){currentAdminPage=adminPageFromPath(path);await enterAdmin();return}
  if(path==='/calendar'){await refreshMember({openIfSuccessful:true});return}
  if(path==='/join'||path==='/join-short'||path==='/'){showMemberLinkRequired();return}
  if(path==='/admin-login'){showAdminCodeLogin();return}
  await refreshMember({openIfSuccessful:true})
}


let memberMonthDeltaPending=0;
let memberMonthTransitionRunning=false;
let adminMonthDeltaPending=0;
let adminMonthTransitionRunning=false;

function monthOffset(base,target){
  if(!base||!target)return 0;
  const [by,bm]=base.split('-').map(Number),[ty,tm]=target.split('-').map(Number);
  return (ty-by)*12+(tm-bm)
}
function memberMonthOffsetNow(){
  return memberCalendarMode==='auto'?0:Math.max(0,monthOffset(memberHomeMonth(),memberMonth))
}
function adminMonthOffsetNow(){
  return adminCalendarMode==='auto'?0:Math.max(0,monthOffset(adminHomeMonth(),adminMonth))
}
function setMemberMonthOffset(offset){
  const home=memberHomeMonth();
  const max=Math.max(0,monthOffset(home,monthKey(memberData.settings.memberWindow.to)));
  const next=Math.max(0,Math.min(max,offset));
  if(next===0){memberCalendarMode='auto';memberMonth=''}
  else{memberCalendarMode='month';memberMonth=shiftMonth(home,next)}
}
function setAdminMonthOffset(offset){
  const home=adminHomeMonth(),next=Math.max(0,Math.min(2,offset));
  if(next===0){adminCalendarMode='auto';adminMonth=''}
  else{adminCalendarMode='month';adminMonth=shiftMonth(home,next)}
}
async function queueMemberMonthDelta(delta){
  markMemberActivity();
  memberMonthDeltaPending+=delta;
  if(memberMonthTransitionRunning)return;
  memberMonthTransitionRunning=true;
  try{
    while(memberMonthDeltaPending!==0){
      await microCalendarTransition({
        label:q('#monthLabel'),
        body:q('#scheduleBody'),
        mobile:q('#scheduleMobile'),
        swapFn:()=>{
          const d=memberMonthDeltaPending;
          memberMonthDeltaPending=0;
          setMemberMonthOffset(memberMonthOffsetNow()+d);
          renderMember();
          scrollTo({top:0,behavior:'instant'})
        }
      })
    }
  }finally{
    memberMonthTransitionRunning=false;
    if(memberMonthDeltaPending!==0)queueMicrotask(()=>queueMemberMonthDelta(0))
  }
}
async function queueAdminMonthDelta(delta){
  adminMonthDeltaPending+=delta;
  if(adminMonthTransitionRunning)return;
  adminMonthTransitionRunning=true;
  try{
    while(adminMonthDeltaPending!==0){
      await microCalendarTransition({
        label:q('#adminMonthLabel'),
        body:q('#adminScheduleBody'),
        mobile:q('#adminScheduleMobile'),
        swapFn:()=>{
          const d=adminMonthDeltaPending;
          adminMonthDeltaPending=0;
          setAdminMonthOffset(adminMonthOffsetNow()+d);
          renderAdminCalendar();
          scrollTo({top:0,behavior:'instant'})
        }
      })
    }
  }finally{
    adminMonthTransitionRunning=false;
    if(adminMonthDeltaPending!==0)queueMicrotask(()=>queueAdminMonthDelta(0))
  }
}


/* Drag admin : lâcher une affectation hors du tableau la retire.
   On ne transforme pas les en-têtes / dates du tableau en corbeille :
   ils restent des zones neutres. */
document.addEventListener('dragover',e=>{
  if(!adminDragPayload)return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('.admin-schedule-wrap'))return;
  e.preventDefault();
  if(e.dataTransfer)e.dataTransfer.dropEffect='move'
});
document.addEventListener('drop',e=>{
  if(!adminDragPayload||adminDragDropHandled)return;
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest('.admin-schedule-wrap'))return;
  e.preventDefault();
  adminDragDropHandled=true;
  removeAdminDraggedAssignment(adminDragPayload)
});

// --- Listeners ---
q('#prevMonth').addEventListener('click',()=>queueMemberMonthDelta(-1));
q('#nextMonth').addEventListener('click',()=>queueMemberMonthDelta(1));
q('#adminPrevMonth').addEventListener('click',()=>queueAdminMonthDelta(-1));
q('#adminNextMonth').addEventListener('click',()=>queueAdminMonthDelta(1));q('#memberToAdmin').addEventListener('click',e=>switchMemberToAdmin(e.currentTarget));q('#adminToMember').addEventListener('click',e=>switchAdminToMember(e.currentTarget));q('#memberExit').addEventListener('click',async()=>{if(LOCAL){currentLocalMemberId='';location.hash='';renderChooser()}else{try{await netApi('/api/logout',{method:'POST'})}catch{}location.href=`${GITHUB_HOME}#logout`}});
q('#adminExit').addEventListener('click',async()=>{adminSessionContext=null;if(LOCAL){location.hash='';renderChooser()}else{try{await netApi('/api/admin/logout',{method:'POST'})}catch{}location.href='/calendar'}});q('#toggleAdminCode').addEventListener('click',()=>{const input=q('#adminCode'),btn=q('#toggleAdminCode'),show=input.type==='password';input.type=show?'text':'password';btn.setAttribute('aria-pressed',show?'true':'false');btn.setAttribute('aria-label',show?'Masquer le code administrateur':'Afficher le code administrateur');btn.title=show?'Masquer le code':'Afficher le code';input.focus()});q('#adminCodeForm').addEventListener('submit',async e=>{e.preventDefault();const code=q('#adminCode').value.trim();if(Array.from(code).length!==6){setNotice(q('#joinError'),'Le code doit contenir exactement 6 caractères.');return}const btn=e.submitter;setButtonBusy(btn,true,'Connexion…');try{await serverAdminCode(code)}finally{setButtonBusy(btn,false)}});
q('#addMember').addEventListener('submit',async e=>{e.preventDefault();const name=q('#newName').value.trim(),email=q('#newEmail').value.trim();if(!name||!email)return;const ok=await createMember(name,email,e.submitter);if(ok){q('#newName').value='';q('#newEmail').value='';closeMemberManagement()}});q('#copyNewLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(latestPersonalUrl);toast('Lien copié')}catch{prompt('Copiez ce lien :',latestPersonalUrl)}});
q('#memberManageCreate').addEventListener('click',()=>setMemberManagementMode('create'));
q('#memberManageModify').addEventListener('click',()=>setMemberManagementMode('modify'));
q('#memberManageRotateAll').addEventListener('click',e=>rotateAllMemberLinks(e.currentTarget));
q('#memberCreateClose').addEventListener('click',closeMemberManagement);
q('#memberModifyClose').addEventListener('click',closeMemberManagement);
q('#memberCreatePanel').addEventListener('click',e=>{if(e.target===e.currentTarget)closeMemberManagement()});
q('#memberModifyPanel').addEventListener('click',e=>{if(e.target===e.currentTarget)closeMemberManagement()});
q('#memberManageEditForm').addEventListener('submit',e=>{e.preventDefault();saveManagedMember(e.submitter)});
q('#memberManageRotateLink').addEventListener('click',()=>{const id=q('#memberManageEditId').value,m=(adminData?.membersAdmin||[]).find(x=>x.id===id);if(m)rotateMember(m.id,m.name,q('#memberManageRotateLink'))});
for(const btn of document.querySelectorAll('#dayEditorQuickRoles [data-quick-role]'))btn.addEventListener('click',()=>dayEditorTouchAssign(btn.dataset.quickRole));
q('#memberQuickClose').addEventListener('click',closeMemberQuick);
q('#memberQuickPanel').addEventListener('click',e=>{if(e.target===e.currentTarget)closeMemberQuick()});
q('#memberQuickToggle').addEventListener('click',async e=>{const id=q('#memberQuickPanel').dataset.memberId,m=(adminData?.membersAdmin||[]).find(x=>String(x.id)===String(id));if(m)await refreshMemberQuickAfter(id,()=>toggleMemberActiveDirect(m.id,!m.active,m.name,e.currentTarget))});
q('#memberQuickRotate').addEventListener('click',async e=>{const id=q('#memberQuickPanel').dataset.memberId,m=(adminData?.membersAdmin||[]).find(x=>String(x.id)===String(id));if(m)await refreshMemberQuickAfter(id,()=>rotateMember(m.id,m.name,e.currentTarget,{showResult:false,scrollResult:false}))});
q('#memberQuickCopy').addEventListener('click',async e=>{const id=q('#memberQuickPanel').dataset.memberId,m=(adminData?.membersAdmin||[]).find(x=>String(x.id)===String(id)),url=memberCurrentUrl(m);if(url)await copyMemberLink(url,m.name,e.currentTarget)});
q('#memberQuickSend').addEventListener('click',async e=>{const id=q('#memberQuickPanel').dataset.memberId,m=(adminData?.membersAdmin||[]).find(x=>String(x.id)===String(id));if(m)await sendMemberLinkEmail(m.id,m.name,e.currentTarget)});
q('#memberQuickEdit').addEventListener('click',()=>{const id=q('#memberQuickPanel').dataset.memberId;closeMemberQuick();setTimeout(()=>setMemberManagementMode('modify',{selectedId:id}),0)});


function trapModalFocus(event){
  if(event.key!=='Tab')return;
  const overlays=[...document.querySelectorAll('.confirm-overlay:not(.hidden)')];
  const overlay=overlays.at(-1);
  if(!overlay)return;
  const focusable=[...overlay.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>!el.closest('.hidden')&&el.getClientRects().length);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
document.addEventListener('keydown',trapModalFocus);

q('#adminDayForm').addEventListener('submit',e=>{e.preventDefault();saveAdminDay(e.submitter)});
q('#adminCellForm').addEventListener('submit',e=>{e.preventDefault();saveAdminCell(e.submitter)});
q('#adminCellClose').addEventListener('click',closeAdminCellEditor);
q('#adminCellOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeAdminCellEditor()});q('#exceptionForm').addEventListener('submit',e=>{e.preventDefault();setException(q('#exceptionDate').value,q('#exceptionState').value==='open',q('#exceptionNote').value,e.submitter)});q('#bulkExceptionForm').addEventListener('submit',e=>{e.preventDefault();bulkException(q('#bulkFrom').value,q('#bulkTo').value,q('#bulkState').value,q('#bulkNote').value,e.submitter)});q('#auditSearch')?.addEventListener('input',renderAudit);q('#auditAction')?.addEventListener('change',renderAudit);q('#auditClear')?.addEventListener('click',()=>{q('#auditSearch').value='';q('#auditAction').value='';renderAudit()});
q('#downloadPlanning').addEventListener('click',()=>{if(LOCAL)downloadBlob(`planning-presences-${parisToday()}.csv`,'text/csv;charset=utf-8',localPlanningCsv());else location.href='/api/admin/planning.csv'});q('#downloadAudit')?.addEventListener('click',()=>{if(LOCAL){const rows=[['Quand','Acteur','Action','Date'],...localState.auditLog.map(l=>[l.at,l.actor,actionLabel(l.action),l.date||''])];downloadBlob(`historique-${parisToday()}.csv`,'text/csv;charset=utf-8','\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n'))}else location.href='/api/admin/audit.csv'});q('#downloadBackup').addEventListener('click',()=>{if(LOCAL)downloadBlob(`club-presences-backup-local-${parisToday()}.json`,'application/json',JSON.stringify(localBackup(),null,2));else location.href='/api/admin/backup'});q('#restoreBackup').addEventListener('click',e=>{const f=q('#backupFile').files?.[0];if(f)restoreBackup(f,e.currentTarget);else setNotice(q('#adminError'),'Choisissez d’abord un fichier JSON.')});q('#revokeOtherAdmins').addEventListener('click',async e=>{if(!await confirmModal('Déconnecter toutes les autres sessions administrateur ?',{title:'Sessions administrateur',confirmText:'Déconnecter',danger:true}))return;const btn=e.currentTarget;setButtonBusy(btn,true,'Déconnexion…');try{const j=await netApi('/api/admin/sessions/revoke-others',{method:'POST'});applyAdminServerSnapshot(j.snapshot);renderAdmin();toast(`${j.revoked} session(s) déconnectée(s)`)}catch(e){setNotice(q('#adminError'),e.message)}finally{setButtonBusy(btn,false)}});
q('#confirmCancel').addEventListener('click',()=>closeConfirmModal(false));q('#confirmAccept').addEventListener('click',()=>closeConfirmModal(true));q('#confirmOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeConfirmModal(false)});document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(confirmResolve){closeConfirmModal(false);return}if(!q('#memberQuickPanel')?.classList.contains('hidden')){closeMemberQuick();return}if(!q('#memberCreatePanel')?.classList.contains('hidden')||!q('#memberModifyPanel')?.classList.contains('hidden')){closeMemberManagement();return}if(!q('#adminCellOverlay').classList.contains('hidden')){closeAdminCellEditor();return}if(!q('#adminCorrectionOverlay').classList.contains('hidden'))closeAdminCorrection()});
for(const tab of document.querySelectorAll('.admin-tabs [data-admin-page]'))tab.addEventListener('click',e=>{
  e.preventDefault();
  microAdminPageTransition(tab.dataset.adminPage,{push:true,scroll:false})
});
window.addEventListener('popstate',()=>{
  if(!q('#adminRoot').classList.contains('hidden'))microAdminPageTransition(adminPageFromPath(location.pathname),{push:false,scroll:false})
});
q('#adminCorrectionClose').addEventListener('click',closeAdminCorrection);
q('#adminCorrectionOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeAdminCorrection()});
const backTop=q('#backTop');window.addEventListener('scroll',()=>backTop.classList.toggle('hidden',scrollY<650),{passive:true});backTop.addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));
async function pollSharedSync(){
  clearTimeout(sharedSyncTimer);
  if(LOCAL||GITHUB_PAGES){return}
  if(sharedSyncBusy||document.visibilityState!=='visible'){
    sharedSyncTimer=setTimeout(pollSharedSync,SHARED_SYNC_POLL_MS);
    return
  }

  let view='';
  if(activeRootView==='memberRoot'&&!memberPlanningHasWork()&&!memberRefreshBusy)view='member';
  else if(activeRootView==='adminRoot'&&adminRefreshSafe())view='admin';
  if(!view){
    sharedSyncTimer=setTimeout(pollSharedSync,SHARED_SYNC_POLL_MS);
    return
  }

  sharedSyncBusy=true;
  try{
    const j=await netApiRaw(`/api/sync?view=${view}&since=${encodeURIComponent(sharedSyncVersion)}`);
    noteSharedSyncVersion(j);
    if(j.changed&&j.snapshot){
      if(view==='member'&&activeRootView==='memberRoot'&&!memberPlanningHasWork()){
        memberData=memberPendingOverlay(j.snapshot);
        lastMemberSyncAt=Date.now();
        renderMember()
      }else if(view==='admin'&&activeRootView==='adminRoot'&&adminRefreshSafe()){
        adminSessionContext=j.snapshot.adminContext||adminSessionContext;
        applyAdminServerSnapshot(j.snapshot);
        lastAdminSyncAt=Date.now();
        renderAdmin()
      }
    }
  }catch(e){
    if(e.status===401){
      if(view==='member'&&activeRootView==='memberRoot')invalidMemberSession();
      else if(view==='admin'&&activeRootView==='adminRoot')showAdminCodeLogin('Votre session administrateur a expiré.');
    }
  }finally{
    sharedSyncBusy=false;
    sharedSyncTimer=setTimeout(pollSharedSync,SHARED_SYNC_POLL_MS)
  }
}

if(!LOCAL&&!GITHUB_PAGES){
  q('#memberRoot').addEventListener('pointerdown',markMemberActivity,{passive:true});
  q('#memberRoot').addEventListener('keydown',markMemberActivity);
  q('#adminRoot').addEventListener('pointerdown',markAdminActivity,{passive:true});
  q('#adminRoot').addEventListener('keydown',markAdminActivity);
  const quotaSafeWakeRefresh=()=>{
    const now=Date.now();
    if(!memberPlanningHasWork()&&!q('#memberRoot').classList.contains('hidden')&&now-lastMemberSyncAt>=QUOTA_WAKE_STALE_MS){
      markMemberActivity();
      refreshMember()
    }
    if(!q('#adminRoot').classList.contains('hidden')&&now-lastAdminSyncAt>=QUOTA_WAKE_STALE_MS){
      markAdminActivity();
      if(adminRefreshSafe())refreshAdmin(null,{silent:true})
    }
  };
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')quotaSafeWakeRefresh()
  });
  window.addEventListener('focus',quotaSafeWakeRefresh,{passive:true});
  window.addEventListener('pageshow',quotaSafeWakeRefresh,{passive:true});
  window.addEventListener('online',quotaSafeWakeRefresh,{passive:true});
  scheduleMemberPoll();
  scheduleAdminPoll();
  pollSharedSync()
}
boot();
})();
