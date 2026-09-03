import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'calasorga-ui-'));
const chromium=process.env.CHROMIUM_BIN||'/usr/bin/chromium';
try{await fs.access(chromium)}catch{console.log('UI browser tests: SKIP (Chromium not found)');process.exit(0)}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

const [indexRaw,stylesRaw,clientRaw,enhanceRaw]=await Promise.all([
  fs.readFile(path.join(root,'index.html'),'utf8'),
  fs.readFile(path.join(root,'styles.css'),'utf8'),
  fs.readFile(path.join(root,'client.js'),'utf8'),
  fs.readFile(path.join(root,'admin-desktop-enhancements-core.js'),'utf8')
]);
const clientTest=clientRaw.replace(/const LOCAL = .*?;\n/,"const LOCAL = true;\n");
const testHtml=indexRaw
  .replace(/<link rel="stylesheet" href="[^"]+">/,`<style>${stylesRaw}</style>`)
  .replace(/<script src="[^"]+"><\/script>/,`<script>${clientTest.replace(/<\/script/gi,'<\\/script')}</script>`).replace(/<script src="[^"]*admin-desktop-enhancements[^"]*"><\/script>/,`<script>${enhanceRaw.replace(/<\/script/gi,'<\\/script')}</script>`)
  .replace('</head>','<style>#localBanner{display:none!important}</style></head>');

function connectCdp(wsUrl){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(wsUrl);let seq=0;const pending=new Map();
    const api={
      send(method,params={},sessionId){return new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})},
      close(){ws.close()}
    };
    ws.onopen=()=>resolve(api);ws.onerror=reject;
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.rej(new Error(m.error.message)):p.res(m.result)};
  })
}

async function reserveLoopbackPort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.unref();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      const port=typeof address==='object'&&address?address.port:0;
      server.close(err=>err?reject(err):resolve(port))
    })
  })
}

async function stopChromium(child){
  if(!child||child.exitCode!==null)return;
  try{child.kill('SIGTERM')}catch{}
  await Promise.race([
    new Promise(resolve=>child.once('exit',resolve)),
    sleep(1000)
  ]);
  if(child.exitCode===null){
    try{child.kill('SIGKILL')}catch{}
    await Promise.race([
      new Promise(resolve=>child.once('exit',resolve)),
      sleep(500)
    ])
  }
}

async function launchChromium(){
  const failures=[];
  for(let attempt=1;attempt<=3;attempt++){
    const port=await reserveLoopbackPort();
    const chromeDir=path.join(tmp,`chrome-${attempt}`);
    await fs.mkdir(chromeDir,{recursive:true});
    let chromeErr='';
    const child=spawn(chromium,[
      '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--no-first-run','--no-default-browser-check','--disable-background-networking',
      '--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,
      `--user-data-dir=${chromeDir}`,'about:blank'
    ],{stdio:['ignore','ignore','pipe']});
    child.stderr.on('data',d=>{chromeErr+=String(d)});

    const deadline=Date.now()+20000;
    let wsUrl='';
    while(Date.now()<deadline&&child.exitCode===null){
      try{
        const r=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1200)});
        if(r.ok){
          const info=await r.json();
          if(typeof info?.webSocketDebuggerUrl==='string'&&info.webSocketDebuggerUrl){
            wsUrl=info.webSocketDebuggerUrl;
            break
          }
        }
      }catch{}
      await sleep(150)
    }

    if(wsUrl)return {child,wsUrl};
    failures.push(`tentative ${attempt}: code=${child.exitCode ?? 'actif'}\n${chromeErr.slice(-3000)}`);
    await stopChromium(child);
    await fs.rm(chromeDir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    if(attempt<3)await sleep(300*attempt)
  }
  throw new Error(`Chromium DevTools indisponible après 3 tentatives:\n${failures.join('\n---\n')}`)
}

let chrome=null,cdp=null;
try{
  const launched=await launchChromium();
  chrome=launched.child;
  cdp=await connectCdp(launched.wsUrl);

  async function newPage({mode,width,height,view='admin'}){
    const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Page.enable',{},sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false,screenWidth:width,screenHeight:height},sessionId);
    const tree=await cdp.send('Page.getFrameTree',{},sessionId);
    await cdp.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:testHtml},sessionId);
    await sleep(350);
    async function evalJs(expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text)+' :: '+expression);return r.result.value}
    await evalJs(`CalasOrgaUiMode.set('${mode}');true`);await sleep(40);
    if(view==='member')await evalJs(`document.querySelector('#chooserGrid .btn:not(.admin-entry)')?.click();true`);
    else await evalJs(`document.querySelector('.admin-entry')?.click();true`);
    await sleep(250);
    return {targetId,sessionId,evalJs,close:()=>cdp.send('Target.closeTarget',{targetId})}
  }

  const desktop=await newPage({mode:'desktop',width:1440,height:900});
  assert.equal(await desktop.evalJs(`document.documentElement.dataset.uiMode`),'desktop');
  assert.equal(await desktop.evalJs(`document.title`),'Planning Bridge');
  assert.notEqual(await desktop.evalJs(`getComputedStyle(document.querySelector('.admin-tabs')).position`),'fixed');
  assert.equal(await desktop.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-wrap')).display`),'block');
  assert.equal(await desktop.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).display`),'none');
  await desktop.evalJs(`document.querySelector('.admin-calendar-edit')?.click()`);await sleep(60);
  assert.match(await desktop.evalJs(`document.querySelector('#dayEditorTouchHelp')?.textContent||''`),/Cliquez un membre puis un poste/);
  await desktop.evalJs(`(()=>{for(const b of [...document.querySelectorAll('#adminCorrectionOverlay .day-assignment-remove')])b.click();return true})()`);await sleep(40);
  assert.equal(await desktop.evalJs(`(()=>{const a=document.querySelector('#dayAccueilChoices .day-drop-placeholder')?.getBoundingClientRect(),p=document.querySelector('#dayPresentChoices .day-drop-placeholder')?.getBoundingClientRect();return !!a&&!!p&&Math.abs(a.top-p.top)<2})()`),true,'desktop empty Disponible must align with the other empty role cells');
  await desktop.evalJs(`document.querySelector('#adminCorrectionClose').click()`);await sleep(40);
  await desktop.evalJs(`document.querySelector('[data-admin-page="members"]').click()`);await sleep(350);
  await desktop.evalJs(`document.querySelector('#memberManageModify').click()`);await sleep(50);
  const desktopModifyTop=Number(await desktop.evalJs(`document.querySelector('#memberModifyPanel .member-modify-dialog').getBoundingClientRect().top`));
  const desktopModifyScroll=Number(await desktop.evalJs(`(()=>{const l=document.querySelector('#memberModifyList');l.scrollTop=l.scrollHeight;return l.scrollTop})()`));
  await desktop.evalJs(`(()=>{const l=document.querySelector('#memberModifyList'),b=l.querySelector('.btn:last-child');window.__stableMemberButton=b;b.click();return true})()`);await sleep(40);
  assert.equal(await desktop.evalJs(`document.querySelector('#memberModifyList .btn:last-child')===window.__stableMemberButton`),true,'desktop member selection must not rebuild the whole picker');
  assert.ok(Math.abs(Number(await desktop.evalJs(`document.querySelector('#memberModifyPanel .member-modify-dialog').getBoundingClientRect().top`))-desktopModifyTop)<2,'desktop member editor should stay anchored when a member is selected');
  assert.ok(Math.abs(Number(await desktop.evalJs(`document.querySelector('#memberModifyList').scrollTop`))-desktopModifyScroll)<3,'desktop member picker must keep its scroll position after selection');
  await desktop.evalJs(`document.querySelector('#memberModifyClose').click()`);await sleep(30);
  await desktop.close();

  /* Real-device portrait tablet regression: some Android tablets expose a
     CSS viewport around 600–680 px. They must still show one week per row. */
  const tabletNarrow=await newPage({mode:'tablet',width:640,height:1024});
  assert.equal(await tabletNarrow.evalJs(`document.documentElement.dataset.uiMode`),'tablet');
  assert.equal(await tabletNarrow.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).gridTemplateColumns.split(' ').length`),3,'narrow real-device tablet portrait must still use three date-card columns');
  assert.equal(await tabletNarrow.evalJs(`(()=>{const cards=[...document.querySelectorAll('#adminScheduleMobile .mobile-date-card')],groups=new Map();for(const c of cards){const r=c.style.getPropertyValue('--tablet-week-row');if(!groups.has(r))groups.set(r,[]);groups.get(r).push(c)}const full=[...groups.values()].find(g=>g.length>=3);if(!full)return false;const tops=full.slice(0,3).map(c=>Math.round(c.getBoundingClientRect().top));return Math.max(...tops)-Math.min(...tops)<2})()`),true,'narrow tablet Monday/Tuesday/Thursday must share one visual row');
  assert.equal(await tabletNarrow.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'narrow tablet three-column planning must not overflow horizontally');
  assert.equal(await tabletNarrow.evalJs(`(()=>{const seed=[...document.querySelectorAll('#adminScheduleMobile .mobile-role-button')].find(b=>b.querySelector('.mobile-role-empty'));if(!seed)return false;const clone=seed.cloneNode(true);const value=clone.querySelector('.mobile-role-value');value.replaceChildren();const chip=document.createElement('span');chip.className='role-chip';chip.textContent='Christian';value.append(chip);seed.parentElement.append(clone);const a=seed.getBoundingClientRect().height,b=clone.getBoundingClientRect().height;clone.remove();return Math.abs(a-b)<2})()`),true,'a normal filled tablet role must keep the same row height as an empty role');
  await tabletNarrow.close();

  const tabletMember=await newPage({mode:'tablet',width:712,height:1138,view:'member'});
  assert.equal(await tabletMember.evalJs(`document.documentElement.dataset.uiMode`),'tablet');
  assert.equal(await tabletMember.evalJs(`getComputedStyle(document.querySelector('#memberRoot .member-schedule-wrap')).display`),'none');
  assert.equal(await tabletMember.evalJs(`getComputedStyle(document.querySelector('#memberRoot .member-schedule-mobile')).display`),'grid');
  assert.equal(await tabletMember.evalJs(`getComputedStyle(document.querySelector('#memberRoot .member-schedule-mobile')).gridTemplateColumns.split(' ').length`),3,'standard tablet portrait member planning should place the three open weekdays on one row');
  assert.equal(await tabletMember.evalJs(`(()=>{const cards=[...document.querySelectorAll('#scheduleMobile .mobile-date-card')],groups=new Map();for(const c of cards){const r=c.style.getPropertyValue('--tablet-week-row');if(!groups.has(r))groups.set(r,[]);groups.get(r).push(c)}const full=[...groups.values()].find(g=>g.length>=3);if(!full)return false;const tops=full.slice(0,3).map(c=>Math.round(c.getBoundingClientRect().top));return Math.max(...tops)-Math.min(...tops)<2})()`),true,'the three dates of a complete tablet week must share one visual row');
  assert.match(await tabletMember.evalJs(`document.querySelector('#memberMobilePlanningHelp')?.textContent||''`),/Touchez une case libre/);
  assert.equal(await tabletMember.evalJs(`getComputedStyle(document.querySelector('#scheduleMobile .mobile-date-status.alert')).display`),'none','tablet member cards should not repeat x-to-fill tags');
  assert.equal(await tabletMember.evalJs(`getComputedStyle(document.querySelector('#scheduleMobile .mobile-date-missing')).display`),'none','tablet member cards should not repeat missing-role tags');
  assert.equal(await tabletMember.evalJs(`(()=>{const cards=[...document.querySelectorAll('#scheduleMobile .mobile-date-card')];if(cards.length<2)return false;const before=getComputedStyle(cards[1]).backgroundColor;cards[0].classList.add('day-complete');return getComputedStyle(cards[0]).backgroundColor!==before})()`),true,'tablet member complete days must have a visible green variation');
  assert.ok(Number(await tabletMember.evalJs(`parseFloat(getComputedStyle(document.querySelector('#scheduleMobile .mobile-role-button')).minHeight)`))>=44);
  assert.equal(await tabletMember.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'tablet portrait member view must fit viewport');
  await tabletMember.close();

  const tabletMemberLandscape=await newPage({mode:'tablet',width:1138,height:712,view:'member'});
  assert.equal(await tabletMemberLandscape.evalJs(`getComputedStyle(document.querySelector('#memberRoot .member-schedule-wrap')).display`),'block');
  assert.equal(await tabletMemberLandscape.evalJs(`getComputedStyle(document.querySelector('#memberRoot .member-schedule-mobile')).display`),'none');
  assert.equal(await tabletMemberLandscape.evalJs(`document.querySelector('#memberRoot .member-schedule-wrap').scrollWidth<=document.querySelector('#memberRoot .member-schedule-wrap').clientWidth+2`),true,'tablet landscape member planning should fit without horizontal swipe');
  assert.equal(await tabletMemberLandscape.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true);
  await tabletMemberLandscape.close();

  const tablet=await newPage({mode:'tablet',width:712,height:1138});
  assert.equal(await tablet.evalJs(`document.documentElement.dataset.uiMode`),'tablet');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-wrap')).display`),'none','tablet portrait must avoid the clipped wide planning table');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).display`),'grid');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).gridTemplateColumns.split(' ').length`),3,'standard tablet portrait planning should use three date-card columns');
  assert.ok(Number(await tablet.evalJs(`document.querySelectorAll('#adminScheduleMobile .mobile-date-card').length`))>0);
  assert.match(await tablet.evalJs(`document.querySelector('#adminMobilePlanningHelp')?.textContent||''`),/Touchez un poste/);
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminScheduleMobile .mobile-date-status.alert')).display`),'none','tablet admin cards should not repeat x-to-fill tags');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminScheduleMobile .mobile-date-missing')).display`),'none','tablet admin cards should not repeat missing-role tags');
  assert.equal(await tablet.evalJs(`(()=>{const cards=[...document.querySelectorAll('#adminScheduleMobile .mobile-date-card')];if(cards.length<2)return false;const before=getComputedStyle(cards[1]).backgroundColor;cards[0].classList.add('day-complete');return getComputedStyle(cards[0]).backgroundColor!==before})()`),true,'tablet admin complete days must have a visible green variation');
  assert.equal(await tablet.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'tablet portrait body must not overflow horizontally');
  assert.ok(Number(await tablet.evalJs(`parseFloat(getComputedStyle(document.querySelector('#adminScheduleMobile .admin-calendar-edit')).minHeight)`))>=44);

  await tablet.evalJs(`document.querySelector('#adminScheduleMobile .admin-mobile-role:not(:disabled)')?.click()`);await sleep(70);
  assert.equal(await tablet.evalJs(`document.querySelector('#adminCellOverlay').classList.contains('hidden')`),false,'tablet direct role edit must open');
  assert.equal(await tablet.evalJs(`document.querySelector('#adminCellMobileSearch')!==null`),true);
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminCellMobileSearchWrap')).display`),'none','tablet direct role editor should show choices directly, without search');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminCellRoleChoices')).gridTemplateColumns.split(' ').length`),2,'tablet direct role choices should use two columns');
  await tablet.evalJs(`document.querySelector('#adminCellClose').click()`);await sleep(40);

  await tablet.evalJs(`document.querySelector('[data-admin-page="members"]').click()`);await sleep(350);
  assert.equal(await tablet.evalJs(`document.querySelector('#mobileMembersSearch')!==null`),true,'tablet member management must provide search');
  assert.notEqual(await tablet.evalJs(`getComputedStyle(document.querySelector('#mobileMembersSearchWrap')).display`),'none');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminMembers .members-table thead')).display`),'none','tablet portrait members should be cards');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#membersTable')).gridTemplateColumns.split(' ').length`),2,'tablet portrait member cards should use two columns');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#membersTable tr')).display`),'grid');
  await tablet.evalJs(`document.querySelector('#membersTable .member-state-pill')?.click()`);await sleep(70);
  assert.equal(await tablet.evalJs(`document.querySelector('#memberQuickPanel').classList.contains('hidden')`),false,'tablet status tap must open member details instead of toggling immediately');
  assert.equal(await tablet.evalJs(`document.querySelector('#memberQuickHeadActions')?.contains(document.querySelector('#memberQuickToggle'))`),true,'tablet member status action must sit in the header beside Fermer');
  assert.equal(await tablet.evalJs(`document.querySelectorAll('#memberQuickLinkActions .btn').length`),3,'tablet personal-link actions must stay grouped together');
  assert.equal(await tablet.evalJs(`(()=>{const xs=[...document.querySelectorAll('#memberQuickLinkActions .btn')].map(x=>x.getBoundingClientRect().top);return xs.length===3&&Math.max(...xs)-Math.min(...xs)<2})()`),true,'tablet personal-link actions must share one row');
  assert.equal(await tablet.evalJs(`document.querySelectorAll('#memberQuickPanel .member-quick-actions .btn').length`),1,'only the member edit action should remain outside the link block');
  await tablet.evalJs(`document.querySelector('#memberQuickClose').click()`);await sleep(40);
  await tablet.evalJs(`document.querySelector('#memberManageModify').click()`);await sleep(50);
  const tabletModifyTop=Number(await tablet.evalJs(`document.querySelector('#memberModifyPanel .member-modify-dialog').getBoundingClientRect().top`));
  const tabletModifyScroll=Number(await tablet.evalJs(`(()=>{const l=document.querySelector('#memberModifyList');l.scrollTop=l.scrollHeight;return l.scrollTop})()`));
  await tablet.evalJs(`(()=>{const l=document.querySelector('#memberModifyList'),b=l.querySelector('.btn:last-child');window.__stableTabletMemberButton=b;b.click();return true})()`);await sleep(40);
  assert.equal(await tablet.evalJs(`document.querySelector('#memberModifyList .btn:last-child')===window.__stableTabletMemberButton`),true,'tablet member selection must not rebuild the whole picker');
  assert.ok(Math.abs(Number(await tablet.evalJs(`document.querySelector('#memberModifyPanel .member-modify-dialog').getBoundingClientRect().top`))-tabletModifyTop)<2,'tablet member editor should stay anchored when a member is selected');
  assert.ok(Math.abs(Number(await tablet.evalJs(`document.querySelector('#memberModifyList').scrollTop`))-tabletModifyScroll)<3,'tablet member picker must keep its scroll position after selection');
  await tablet.evalJs(`document.querySelector('#memberModifyClose').click()`);await sleep(30);

  await tablet.evalJs(`document.querySelector('[data-admin-page="calendar"]').click()`);await sleep(350);
  await tablet.evalJs(`document.querySelector('#adminScheduleMobile .admin-calendar-edit')?.click()`);await sleep(70);
  assert.equal(await tablet.evalJs(`document.querySelector('#adminCorrectionOverlay').classList.contains('hidden')`),false);
  assert.equal(await tablet.evalJs(`document.querySelector('#adminCorrectionOverlay .day-editor-columns').scrollWidth<=document.querySelector('#adminCorrectionOverlay .day-editor-columns').clientWidth+2`),true,'tablet portrait day editor must not require horizontal swiping');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-editor-columns')).gridTemplateColumns.split(' ').length`),1);
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-column-role')).display`),'none');
  assert.equal(await tablet.evalJs(`document.querySelector('#dayEditorQuickRoles').classList.contains('hidden')`),false,'tablet portrait editor must show current assignments before selection');
  assert.equal(await tablet.evalJs(`document.querySelector('#dayEditorMobileSearch')!==null`),true,'tablet portrait day editor must provide member search');
  assert.notEqual(await tablet.evalJs(`getComputedStyle(document.querySelector('#dayEditorMobileSearchWrap')).display`),'none');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#dayMemberPool')).gridTemplateColumns.split(' ').length`),2,'tablet portrait member picker should use two columns');
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#dayMemberPool')).touchAction`),'pan-y','tablet full-day member list must allow vertical touch scrolling');
  assert.equal(await tablet.evalJs(`(()=>{const p=document.querySelector('#dayMemberPool'),seed=p.querySelector('.day-member-source-item');if(!seed)return false;for(let i=0;i<20;i++)p.append(seed.cloneNode(true));p.scrollTop=90;return p.scrollHeight>p.clientHeight&&p.scrollTop>0})()`),true,'tablet full-day member list must actually scroll when it contains many members');
  assert.ok(Number(await tablet.evalJs(`document.querySelectorAll('#dayMemberPool .day-member-source-status').length`))>0);
  await tablet.evalJs(`document.querySelector('#dayMemberPool .day-member-source-item')?.click()`);await sleep(70);
  assert.match(await tablet.evalJs(`document.querySelector('#dayEditorQuickSelected')?.textContent||''`),/choisissez une action/);
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#dayEditorQuickRoles .day-editor-quick-buttons')).gridTemplateColumns.split(' ').length`),2);
  assert.ok(Number(await tablet.evalJs(`parseFloat(getComputedStyle(document.querySelector('#dayEditorQuickRoles button')).minHeight)`))>=44);
  await tablet.evalJs(`document.querySelector('#adminCorrectionClose').click()`);await sleep(40);
  await tablet.close();

  const tabletLandscape=await newPage({mode:'tablet',width:1138,height:712});
  assert.equal(await tabletLandscape.evalJs(`document.documentElement.dataset.uiMode`),'tablet');
  assert.equal(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-wrap')).display`),'none','tablet landscape uses the master/detail planning workspace');
  assert.equal(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).display`),'none');
  assert.equal(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#tabletCalendarSplit')).display`),'grid');
  assert.ok(Number(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletCalendarDateList .tablet-date-item').length`))>0,'tablet landscape must list planning dates');
  assert.ok((await tabletLandscape.evalJs(`document.querySelector('#tabletCalendarInspector h3')?.textContent||''`)).length>0,'tablet landscape must show selected day details');
  assert.equal(await tabletLandscape.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'tablet landscape body must fit viewport');
  assert.equal(await tabletLandscape.evalJs(`([...document.querySelectorAll('#tabletCalendarDateList .tablet-date-item-status')].every(x=>x.textContent.trim()==='Fermé'))`),true,'tablet landscape date list should not repeat complete/missing tags');
  assert.equal(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletCalendarDateList .tablet-date-item-missing').length`),0,'tablet landscape date list should not repeat missing-role text');
  assert.equal(await tabletLandscape.evalJs(`(()=>{const xs=[...document.querySelectorAll('#tabletCalendarDateList .tablet-date-item')];if(xs.length<2)return false;const before=getComputedStyle(xs[1]).backgroundColor;xs[0].classList.add('complete');return getComputedStyle(xs[0]).backgroundColor!==before})()`),true,'tablet landscape complete dates must have a visible green variation');
  await tabletLandscape.evalJs(`document.querySelector('#tabletCalendarInspector .tablet-inspector-role:not(:disabled)')?.click()`);await sleep(60);
  assert.equal(await tabletLandscape.evalJs(`document.querySelector('#adminCellOverlay').classList.contains('hidden')`),true,'tablet landscape quick role edit must stay inline');
  assert.notEqual(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#tabletCalendarRoleEditor')).display`),'none','tablet landscape must expose inline role editor');
  assert.equal(await tabletLandscape.evalJs(`document.querySelector('#tabletCalendarRoleEditor .tablet-inline-editor-search')===null`),true,'tablet landscape direct role edit should not include search');
  assert.ok(Number(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletCalendarRoleEditor .tablet-inline-choice').length`))>0);

  await tabletLandscape.evalJs(`document.querySelector('[data-admin-page="members"]').click()`);await sleep(300);
  assert.notEqual(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#mobileMembersSearchWrap')).display`),'none','tablet landscape still offers member search');
  assert.equal(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#adminMembers .members-table-wrap')).display`),'none','tablet landscape members use master/detail instead of the wide table');
  assert.equal(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#tabletMembersSplit')).display`),'grid');
  assert.equal(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletMembersFilters .tablet-member-filter').length`),3,'tablet member workspace must expose status filters');
  assert.ok(Number(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletMembersList .tablet-member-list-item').length`))>0);
  assert.ok((await tabletLandscape.evalJs(`document.querySelector('#tabletMemberDetail h3')?.textContent||''`)).length>0,'tablet member detail must stay visible');
  assert.equal(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletMemberDetail .tablet-member-detail-head-actions .tablet-member-toggle').length`),1,'tablet member status action must be in the detail header');
  assert.equal(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletMemberDetail .tablet-member-link-actions .btn').length`),3,'tablet member link actions must be grouped together');
  assert.equal(await tabletLandscape.evalJs(`document.querySelectorAll('#tabletMemberDetail .tablet-member-detail-actions .btn').length`),1,'tablet member footer should only contain Modify');
  const firstTabletMember=await tabletLandscape.evalJs(`document.querySelector('#tabletMembersList .tablet-member-list-item')?.dataset.memberId||''`);
  await tabletLandscape.evalJs(`(()=>{const xs=[...document.querySelectorAll('#tabletMembersList .tablet-member-list-item')];(xs[1]||xs[0])?.click();return true})()`);await sleep(40);
  assert.ok((await tabletLandscape.evalJs(`document.querySelector('#tabletMemberDetail h3')?.textContent||''`)).length>0);
  assert.equal(await tabletLandscape.evalJs(`document.querySelector('#memberQuickPanel').classList.contains('hidden')`),true,'tablet landscape list selection must not open a modal');

  await tabletLandscape.evalJs(`document.querySelector('[data-admin-page="calendar"]').click()`);await sleep(300);
  await tabletLandscape.evalJs(`document.querySelector('#tabletCalendarInspector .tablet-inspector-actions .btn')?.click()`);await sleep(70);
  assert.equal(await tabletLandscape.evalJs(`document.querySelector('#adminCorrectionOverlay').classList.contains('hidden')`),false,'full-day edit remains available from the inspector');
  assert.equal(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-editor-columns')).gridTemplateColumns.split(' ').length`),6,'tablet landscape full editor keeps all six columns');
  assert.equal(await tabletLandscape.evalJs(`document.querySelector('#adminCorrectionOverlay .day-editor-columns').scrollWidth<=document.querySelector('#adminCorrectionOverlay .day-editor-columns').clientWidth+2`),true,'tablet landscape editor should fit without horizontal swipe');
  assert.notEqual(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-column-role')).display`),'none');
  assert.equal(await tabletLandscape.evalJs(`document.querySelector('#dayEditorMobileSearch')!==null`),true);
  assert.equal(await tabletLandscape.evalJs(`getComputedStyle(document.querySelector('#dayMemberPool')).touchAction`),'pan-y','tablet landscape full-day member list must allow vertical touch scrolling');
  await tabletLandscape.evalJs(`document.querySelector('#adminCorrectionClose').click()`);await sleep(30);
  await tabletLandscape.close();

  const mobileMember=await newPage({mode:'mobile',width:375,height:667,view:'member'});
  assert.equal(await mobileMember.evalJs(`document.documentElement.dataset.uiMode`),'mobile');
  assert.equal(await mobileMember.evalJs(`getComputedStyle(document.querySelector('#scheduleMobile .mobile-date-status.alert')).display`),'none','mobile member cards should not repeat x-to-fill tags');
  assert.equal(await mobileMember.evalJs(`getComputedStyle(document.querySelector('#scheduleMobile .mobile-date-missing')).display`),'none','mobile member cards should not repeat missing-role tags');
  assert.equal(await mobileMember.evalJs(`(()=>{const host=document.querySelector('#scheduleMobile .mobile-role-value');const chip=document.createElement('span');chip.className='role-chip';chip.textContent='Un nom de membre volontairement très long';host.append(chip);return getComputedStyle(chip).whiteSpace})()`),'normal','mobile member names must wrap instead of being clipped');
  await mobileMember.close();

  const mobile=await newPage({mode:'mobile',width:375,height:667});
  assert.equal(await mobile.evalJs(`document.documentElement.dataset.uiMode`),'mobile');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('.admin-tabs')).position`),'fixed');
  assert.equal(await mobile.evalJs(`document.querySelector('[data-admin-page="members"]').innerText.trim()`),'Membres');
  assert.equal(await mobile.evalJs(`document.querySelector('[data-admin-page="members"]').innerText.includes('Gestion des membres')`),false);
  assert.equal(await mobile.evalJs(`(()=>{const a=[...document.querySelectorAll('.admin-tabs a')].map(x=>x.getBoundingClientRect());return a.every((r,i)=>r.left>=0&&r.right<=innerWidth+1&&(i===0||r.left>=a[i-1].right-1))})()`),true,'mobile bottom nav must fit without overlap');
  assert.equal(await mobile.evalJs(`document.querySelectorAll('.admin-tabs a').length`),2,'mobile admin nav must expose exactly two destinations');
  assert.equal(await mobile.evalJs(`(()=>{const n=document.querySelector('.admin-tabs').getBoundingClientRect();return Math.abs(((n.left+n.right)/2)-(document.documentElement.clientWidth/2))<2})()`),true,'mobile admin nav must be centered');
  assert.equal(await mobile.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'mobile body must not overflow horizontally');
  assert.equal(await mobile.evalJs(`(()=>{const b=document.querySelector('#adminRoot .brand').getBoundingClientRect(),x=document.querySelector('#adminExit').getBoundingClientRect();return b.right<=x.left+1})()`),true,'mobile brand and logout must not overlap');
  assert.ok(Number(await mobile.evalJs(`parseFloat(getComputedStyle(document.querySelector('#adminRoot .top-actions .btn')).minHeight)`))>=44);
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-wrap')).display`),'none');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).display`),'grid');
  assert.ok(Number(await mobile.evalJs(`document.querySelectorAll('#adminScheduleMobile .mobile-date-card').length`))>0,'mobile admin planning must render date cards');
  assert.ok(Number(await mobile.evalJs(`document.querySelectorAll('#adminScheduleMobile .mobile-date-status').length`))>0,'mobile date cards keep semantic coverage status in the DOM');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminScheduleMobile .mobile-date-status.alert')).display`),'none','mobile admin cards should not repeat x-to-fill tags');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminScheduleMobile .mobile-date-missing')).display`),'none','mobile admin cards should not repeat missing-role tags');
  assert.equal(await mobile.evalJs(`(()=>{const host=document.querySelector('#adminScheduleMobile .mobile-role-value');const chip=document.createElement('span');chip.className='role-chip';chip.textContent='Un nom de membre volontairement très long';host.append(chip);return getComputedStyle(chip).whiteSpace})()`),'normal','mobile admin role names must wrap instead of being clipped');
  assert.match(await mobile.evalJs(`document.querySelector('#adminMobilePlanningHelp')?.textContent||''`),/Touchez un poste/);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminScheduleMobile .admin-calendar-edit')?.textContent.trim()`),'Modifier la journée');
  assert.equal(await mobile.evalJs(`document.querySelector('#adminScheduleMobile .mobile-role-button')?.getBoundingClientRect().width<=document.querySelector('#adminScheduleMobile .mobile-date-card')?.getBoundingClientRect().width`),true,'mobile role rows must fit inside cards');
  await mobile.evalJs(`document.querySelector('#adminScheduleMobile .admin-mobile-role:not(:disabled)')?.click()`);await sleep(60);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminCellOverlay').classList.contains('hidden')`),false,'tapping a role row must open direct role editing');
  assert.ok((await mobile.evalJs(`document.querySelector('#adminCellContext')?.textContent||''`)).length>0);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminCellMobileSearch')!==null`),true,'mobile direct role editor must provide member search');
  assert.ok(Number(await mobile.evalJs(`parseFloat(getComputedStyle(document.querySelector('#adminCellMobileSearch')).minHeight)`))>=44);
  await mobile.evalJs(`document.querySelector('#adminCellClose').click()`);await sleep(40);

  await mobile.evalJs(`document.querySelector('[data-admin-page="members"]').click()`);await sleep(350);
  assert.equal(await mobile.evalJs(`document.querySelector('[data-admin-view="members"]').classList.contains('hidden')`),false);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminMembers .members-table-wrap').scrollWidth<=document.querySelector('#adminMembers .members-table-wrap').clientWidth+2`),true);
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminMembers .members-table thead')).display`),'none','mobile members must be a card list, not a wide table');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#membersTable')).display`),'grid');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#membersTable tr')).display`),'grid');
  assert.equal(await mobile.evalJs(`document.querySelector('#mobileMembersSearch')!==null`),true,'mobile members must provide search');
  assert.equal(await mobile.evalJs(`document.querySelector('#memberManageRotateAll')?.textContent.trim()`),'Renouveler tous');
  const mobileMembersVisibleBefore=Number(await mobile.evalJs(`[...document.querySelectorAll('#membersTable tr')].filter(r=>!r.hidden).length`));
  await mobile.evalJs(`(()=>{const i=document.querySelector('#mobileMembersSearch');i.value='zzzz-introuvable';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await sleep(30);
  assert.equal(Number(await mobile.evalJs(`[...document.querySelectorAll('#membersTable tr')].filter(r=>!r.hidden).length`)),0,'mobile member search must filter cards');
  await mobile.evalJs(`(()=>{const i=document.querySelector('#mobileMembersSearch');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await sleep(30);
  assert.equal(Number(await mobile.evalJs(`[...document.querySelectorAll('#membersTable tr')].filter(r=>!r.hidden).length`)),mobileMembersVisibleBefore);
  await mobile.evalJs(`document.querySelector('#membersTable .member-state-pill')?.click()`);await sleep(60);
  assert.equal(await mobile.evalJs(`document.querySelector('#memberQuickPanel').classList.contains('hidden')`),false,'mobile status pill must open details instead of toggling immediately');
  await mobile.evalJs(`document.querySelector('#memberQuickClose').click()`);await sleep(40);
  await mobile.evalJs(`document.querySelector('#membersTable tr')?.click()`);await sleep(60);
  assert.equal(await mobile.evalJs(`document.querySelector('#memberQuickPanel').classList.contains('hidden')`),false);
  assert.equal(await mobile.evalJs(`(()=>{const d=document.querySelector('#memberQuickPanel .member-quick-dialog').getBoundingClientRect();return d.bottom>=innerHeight-2})()`),true,'mobile member details must behave as a bottom sheet');
  await mobile.evalJs(`document.querySelector('#memberQuickClose').click()`);await sleep(40);


  await mobile.evalJs(`document.querySelector('[data-admin-page="calendar"]').click()`);await sleep(350);
  await mobile.evalJs(`document.querySelector('.admin-calendar-edit')?.click()`);await sleep(60);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminCorrectionOverlay .day-editor-columns').scrollWidth<=document.querySelector('#adminCorrectionOverlay .day-editor-columns').clientWidth+2`),true,'mobile day editor must not require horizontal swiping');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-editor-columns')).gridTemplateColumns.split(' ').length`),1,'mobile day editor must use one vertical member flow');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-column-role')).display`),'none','duplicate role columns must be hidden on mobile');
  assert.equal(await mobile.evalJs(`document.querySelector('#dayEditorMobileSearch')!==null`),true,'mobile full-day editor must provide member search');
  assert.ok(Number(await mobile.evalJs(`document.querySelectorAll('#dayMemberPool .day-member-source-status').length`))>0,'mobile member rows must show current assignment status');
  assert.equal(await mobile.evalJs(`document.querySelector('#dayEditorQuickRoles').classList.contains('hidden')`),false,'mobile editor must show current assignments before member selection');
  assert.match(await mobile.evalJs(`document.querySelector('#dayEditorQuickSelected')?.textContent||''`),/Affectations actuelles/);
  assert.equal(await mobile.evalJs(`document.querySelectorAll('#dayEditorQuickRoles [data-quick-role] .quick-role-state').length`),5,'every quick role must show its current state');
  assert.ok((await mobile.evalJs(`document.querySelector('#dayEditorQuickRoles .quick-role-state')?.textContent||''`)).length>0);
  await mobile.evalJs(`document.querySelector('#dayMemberPool .day-member-source-item')?.click()`);await sleep(80);
  assert.equal(await mobile.evalJs(`document.querySelector('#dayEditorQuickRoles').classList.contains('hidden')`),false);
  assert.match(await mobile.evalJs(`document.querySelector('#dayEditorQuickSelected')?.textContent||''`),/choisissez une action/);
  assert.match(await mobile.evalJs(`document.querySelector('#dayEditorQuickRoles [data-quick-role] .quick-role-state')?.textContent||''`),/Libre|Actuel|Remplace|Indisponible|Ajouter/);
  assert.ok(Number(await mobile.evalJs(`parseFloat(getComputedStyle(document.querySelector('#dayEditorQuickRoles button')).minHeight)`))>=44);
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#dayEditorQuickRoles .day-editor-quick-buttons')).gridTemplateColumns.split(' ').length`),2,'mobile quick roles must avoid a horizontal button strip');
  await mobile.evalJs(`document.querySelector('#adminCorrectionClose').click()`);await sleep(40);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminCorrectionOverlay').contains(document.activeElement)`),false);
  await mobile.close();

  const mobileLandscape=await newPage({mode:'mobile',width:780,height:360});
  assert.equal(await mobileLandscape.evalJs(`document.documentElement.dataset.uiMode`),'mobile');
  assert.equal(await mobileLandscape.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'mobile landscape body must not overflow horizontally');
  assert.equal(await mobileLandscape.evalJs(`(()=>{const n=document.querySelector('.admin-tabs').getBoundingClientRect();return n.left>=0&&n.right<=innerWidth+1&&n.bottom<=innerHeight+1})()`),true,'mobile landscape nav must remain inside viewport');
  assert.ok(Number(await mobileLandscape.evalJs(`parseFloat(getComputedStyle(document.querySelector('.admin-tabs a')).minHeight)`))>=44);
  assert.equal(await mobileLandscape.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).gridTemplateColumns.split(' ').length`),2,'mobile landscape planning should use two card columns');
  await mobileLandscape.close();

  console.log('UI browser tests: PASS (desktop/tablet/mobile + visual geometry + landscape)');
} finally {
  try{cdp?.close()}catch{}
  await stopChromium(chrome);
  await fs.rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
