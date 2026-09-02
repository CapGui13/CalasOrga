import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

let chrome=null,cdp=null;
try{
  const chromeDir=path.join(tmp,'chrome');await fs.mkdir(chromeDir,{recursive:true});
  chrome=spawn(chromium,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${chromeDir}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let chromeErr='';
  const wsUrl=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Chromium DevTools timeout: '+chromeErr)),10000);
    chrome.stderr.on('data',d=>{chromeErr+=d;const m=chromeErr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1])}});
    chrome.on('exit',code=>{if(code)reject(new Error('Chromium exited '+code+': '+chromeErr))})
  });
  cdp=await connectCdp(wsUrl);

  async function newPage({mode,width,height}){
    const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Page.enable',{},sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false,screenWidth:width,screenHeight:height},sessionId);
    const tree=await cdp.send('Page.getFrameTree',{},sessionId);
    await cdp.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:testHtml},sessionId);
    await sleep(350);
    async function evalJs(expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text)+' :: '+expression);return r.result.value}
    await evalJs(`CalasOrgaUiMode.set('${mode}');document.querySelector('.admin-entry')?.click();true`);await sleep(250);
    return {targetId,sessionId,evalJs,close:()=>cdp.send('Target.closeTarget',{targetId})}
  }

  const desktop=await newPage({mode:'desktop',width:1440,height:900});
  assert.equal(await desktop.evalJs(`document.documentElement.dataset.uiMode`),'desktop');
  assert.equal(await desktop.evalJs(`document.title`),'Planning Bridge');
  assert.notEqual(await desktop.evalJs(`getComputedStyle(document.querySelector('.admin-tabs')).position`),'fixed');
  await desktop.evalJs(`document.querySelector('.admin-calendar-edit')?.click()`);await sleep(60);
  assert.match(await desktop.evalJs(`document.querySelector('#dayEditorTouchHelp')?.textContent||''`),/Cliquez un membre puis un poste/);
  await desktop.close();

  const tablet=await newPage({mode:'tablet',width:712,height:1138});
  assert.equal(await tablet.evalJs(`document.documentElement.dataset.uiMode`),'tablet');
  assert.ok(Number(await tablet.evalJs(`parseFloat(getComputedStyle(document.querySelector('.admin-calendar-edit')).minHeight)`))>=44);
  await tablet.evalJs(`document.querySelector('.admin-calendar-edit')?.click()`);await sleep(70);
  assert.equal(await tablet.evalJs(`document.querySelector('#adminCorrectionOverlay').classList.contains('hidden')`),false);
  assert.equal(await tablet.evalJs(`getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-editor-columns')).overflowX`),'auto');
  assert.ok(Number(await tablet.evalJs(`parseFloat(getComputedStyle(document.querySelector('#adminCorrectionOverlay .day-editor-columns')).minWidth)`))>=800);
  assert.ok(Number(await tablet.evalJs(`(()=>{const b=document.createElement('button');b.className='day-assignment-remove';document.querySelector('#adminCorrectionOverlay').append(b);const n=parseFloat(getComputedStyle(b).minWidth||getComputedStyle(b).width);b.remove();return n})()`))>=44);
  assert.equal(await tablet.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'tablet body must not overflow horizontally');
  await tablet.close();

  const mobile=await newPage({mode:'mobile',width:375,height:667});
  assert.equal(await mobile.evalJs(`document.documentElement.dataset.uiMode`),'mobile');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('.admin-tabs')).position`),'fixed');
  assert.equal(await mobile.evalJs(`document.querySelector('[data-admin-page="members"]').innerText.trim()`),'Membres');
  assert.equal(await mobile.evalJs(`document.querySelector('[data-admin-page="members"]').innerText.includes('Gestion des membres')`),false);
  assert.equal(await mobile.evalJs(`(()=>{const a=[...document.querySelectorAll('.admin-tabs a')].map(x=>x.getBoundingClientRect());return a.every((r,i)=>r.left>=0&&r.right<=innerWidth+1&&(i===0||r.left>=a[i-1].right-1))})()`),true,'mobile bottom nav must fit without overlap');
  assert.equal(await mobile.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'mobile body must not overflow horizontally');
  assert.equal(await mobile.evalJs(`(()=>{const b=document.querySelector('#adminRoot .brand').getBoundingClientRect(),x=document.querySelector('#adminExit').getBoundingClientRect();return b.right<=x.left+1})()`),true,'mobile brand and logout must not overlap');
  assert.ok(Number(await mobile.evalJs(`parseFloat(getComputedStyle(document.querySelector('#adminRoot .top-actions .btn')).minHeight)`))>=44);
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-wrap')).display`),'block');
  assert.equal(await mobile.evalJs(`getComputedStyle(document.querySelector('#adminRoot .admin-schedule-mobile')).display`),'none');

  await mobile.evalJs(`document.querySelector('[data-admin-page="members"]').click()`);await sleep(350);
  assert.equal(await mobile.evalJs(`document.querySelector('[data-admin-view="members"]').classList.contains('hidden')`),false);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminMembers .members-table-wrap').scrollWidth<=document.querySelector('#adminMembers .members-table-wrap').clientWidth+2`),true);
  await mobile.evalJs(`document.querySelector('#membersTable tr')?.click()`);await sleep(60);
  assert.equal(await mobile.evalJs(`document.querySelector('#memberQuickPanel').classList.contains('hidden')`),false);
  await mobile.evalJs(`document.querySelector('#memberQuickClose').click()`);await sleep(40);


  await mobile.evalJs(`document.querySelector('[data-admin-page="calendar"]').click()`);await sleep(350);
  await mobile.evalJs(`document.querySelector('.admin-calendar-edit')?.click()`);await sleep(60);
  await mobile.evalJs(`document.querySelector('#dayMemberPool .day-member-source-item')?.click()`);await sleep(40);
  assert.equal(await mobile.evalJs(`document.querySelector('#dayEditorQuickRoles').classList.contains('hidden')`),false);
  assert.ok(Number(await mobile.evalJs(`parseFloat(getComputedStyle(document.querySelector('#dayEditorQuickRoles button')).minHeight)`))>=44);
  await mobile.evalJs(`document.querySelector('#adminCorrectionClose').click()`);await sleep(40);
  assert.equal(await mobile.evalJs(`document.querySelector('#adminCorrectionOverlay').contains(document.activeElement)`),false);
  await mobile.close();

  const mobileLandscape=await newPage({mode:'mobile',width:780,height:360});
  assert.equal(await mobileLandscape.evalJs(`document.documentElement.dataset.uiMode`),'mobile');
  assert.equal(await mobileLandscape.evalJs(`document.documentElement.scrollWidth<=innerWidth+2`),true,'mobile landscape body must not overflow horizontally');
  assert.equal(await mobileLandscape.evalJs(`(()=>{const n=document.querySelector('.admin-tabs').getBoundingClientRect();return n.left>=0&&n.right<=innerWidth+1&&n.bottom<=innerHeight+1})()`),true,'mobile landscape nav must remain inside viewport');
  assert.ok(Number(await mobileLandscape.evalJs(`parseFloat(getComputedStyle(document.querySelector('.admin-tabs a')).minHeight)`))>=44);
  await mobileLandscape.close();

  console.log('UI browser tests: PASS (desktop/tablet/mobile + visual geometry + landscape)');
} finally {
  try{cdp?.close()}catch{}
  if(chrome){
    try{chrome.kill('SIGTERM')}catch{}
    await Promise.race([
      new Promise(resolve=>chrome.once('exit',resolve)),
      sleep(750)
    ]);
  }
  await fs.rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
