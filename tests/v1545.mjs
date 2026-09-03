import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'calasorga-v1545-'));
const port = 32000 + Math.floor(Math.random() * 10000);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    DEMO_MODE: '1',
    ADMIN_CODE: 'Ab#123',
    MEMBER_SHORT_SECRET: 'test-member-short-secret-0123456789-abcdef',
    DATA_FILE: path.join(tmp, 'store.json'),
    PORT: String(port),
    LISTEN_HOST: '127.0.0.1',
    RELAXED_FSYNC: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr=''; child.stderr.on('data',d=>stderr+=d);

async function waitReady(){
  for(let i=0;i<80;i++){
    try{const r=await fetch(`${origin}/healthz`);if(r.ok)return await r.json()}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error(`Serveur non prêt: ${stderr}`);
}
function cookiesFrom(res){
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return Object.fromEntries(list.map(x=>x.split(';',1)[0].split(/=(.*)/s).slice(0,2)));
}
function cookieHeader(jar){return Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; ')}
function parisTodayIso(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function isoWeekStartForTest(iso){
  const [y,m,d]=iso.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d)),wd=dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate()+(wd===0?-6:1-wd));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}
async function api(pathname,{method='GET',body,cookies={},csrf}={}){
  const headers={Origin:origin};
  if(Object.keys(cookies).length)headers.Cookie=cookieHeader(cookies);
  if(body!==undefined){headers['Content-Type']='application/json';}
  if(csrf)headers['X-CSRF-Token']=csrf;
  const r=await fetch(origin+pathname,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let j={};try{j=await r.json()}catch{}
  return {r,j,set:cookiesFrom(r)};
}

try{
  const health=await waitReady();
  assert.equal(health.appVersion,'0.15.47.4-stabilized');
  assert.equal(health.memberShortSecretMode,'dedicated');

  const adminLogin=await api('/api/session/admin',{method:'POST',body:{code:'Ab#123'}});
  assert.equal(adminLogin.r.status,200,JSON.stringify(adminLogin.j));
  const adminCookies=adminLogin.set;
  const adminCsrf=decodeURIComponent(adminCookies.club_admin_csrf);
  assert.ok(adminCookies.club_admin);

  const createdA=await api('/api/admin/members',{method:'POST',body:{name:'Alice',email:'alice@example.invalid'},cookies:adminCookies,csrf:adminCsrf});
  assert.equal(createdA.r.status,201,JSON.stringify(createdA.j));
  assert.match(createdA.j.shortToken,/^Alice\d{6}$/u);
  const aliceId=createdA.j.member.id;
  const promoteAlice=await api(`/api/admin/members/${encodeURIComponent(aliceId)}`,{
    method:'POST',body:{adminPrivilege:true},cookies:adminCookies,csrf:adminCsrf
  });
  assert.equal(promoteAlice.r.status,200,JSON.stringify(promoteAlice.j));

  const createdB=await api('/api/admin/members',{method:'POST',body:{name:'Bob',email:'bob@example.invalid'},cookies:adminCookies,csrf:adminCsrf});
  assert.equal(createdB.r.status,201,JSON.stringify(createdB.j));
  assert.match(createdB.j.shortToken,/^Bob\d{6}$/u);

  const loginA=await api('/api/session/member-short',{method:'POST',body:{shortToken:createdA.j.shortToken}});
  assert.equal(loginA.r.status,200,JSON.stringify(loginA.j));
  const memberCookies=loginA.set;
  const meA=await api('/api/me',{cookies:memberCookies});
  assert.equal(meA.r.status,200);
  assert.equal(meA.j.me.name,'Alice');
  assert.equal(meA.j.me.adminPrivilege,true);
  assert.equal(meA.j.settings.memberWindow.from,isoWeekStartForTest(parisTodayIso()),'member snapshot must keep the current ISO week available for tablet history');

  const switchBlocked=await api('/api/session/member-short',{method:'POST',body:{shortToken:createdB.j.shortToken},cookies:memberCookies});
  assert.equal(switchBlocked.r.status,409,JSON.stringify(switchBlocked.j));
  assert.equal(switchBlocked.j.requiresIdentitySwitch,true);
  assert.equal(switchBlocked.j.currentMember.name,'Alice');
  assert.equal(switchBlocked.j.targetMember.name,'Bob');

  const switchOk=await api('/api/session/member-short',{method:'POST',body:{shortToken:createdB.j.shortToken,confirmSwitch:true},cookies:memberCookies});
  assert.equal(switchOk.r.status,200,JSON.stringify(switchOk.j));
  const bobCookies={...memberCookies,...switchOk.set};
  const meB=await api('/api/me',{cookies:bobCookies});
  assert.equal(meB.j.me.name,'Bob');

  const loginA2=await api('/api/session/member-short',{method:'POST',body:{shortToken:createdA.j.shortToken}});
  assert.equal(loginA2.r.status,200);
  const aliceCookies1=loginA2.set;
  const loginA3=await api('/api/session/member-short',{method:'POST',body:{shortToken:createdA.j.shortToken},cookies:aliceCookies1});
  assert.equal(loginA3.r.status,200);
  const aliceCookies2={...aliceCookies1,...loginA3.set};
  const adminSnap=await api('/api/admin',{cookies:adminCookies});
  const syncAdmin=await api('/api/sync?view=admin&since=',{cookies:adminCookies});
  assert.equal(syncAdmin.r.status,200,JSON.stringify(syncAdmin.j));
  assert.equal(typeof syncAdmin.j.changed,'boolean');
  const syncMember=await api('/api/sync?view=member&since=',{cookies:aliceCookies2});
  assert.equal(syncMember.r.status,200,JSON.stringify(syncMember.j));
  const alice=adminSnap.j.membersAdmin.find(m=>m.id===aliceId);
  assert.equal(alice.deviceCount,1,'réouvrir le lien sur le même navigateur ne doit pas créer un faux appareil');

  // Un même membre administrateur doit pouvoir garder plusieurs appareils
  // connectés au panneau admin en parallèle.
  const loginASecondDevice=await api('/api/session/member-short',{method:'POST',body:{shortToken:createdA.j.shortToken}});
  assert.equal(loginASecondDevice.r.status,200,JSON.stringify(loginASecondDevice.j));
  const memberCookiesSecondDevice=loginASecondDevice.set;
  const adminFromFirstDevice=await api('/api/session/admin-from-member',{
    method:'POST',
    cookies:aliceCookies2,
    csrf:decodeURIComponent(aliceCookies2.club_member_csrf)
  });
  assert.equal(adminFromFirstDevice.r.status,200,JSON.stringify(adminFromFirstDevice.j));
  const firstDeviceAdminCookies={...aliceCookies2,...adminFromFirstDevice.set};
  const adminFromSecondDevice=await api('/api/session/admin-from-member',{
    method:'POST',
    cookies:memberCookiesSecondDevice,
    csrf:decodeURIComponent(memberCookiesSecondDevice.club_member_csrf)
  });
  assert.equal(adminFromSecondDevice.r.status,200,JSON.stringify(adminFromSecondDevice.j));
  const firstDeviceStillAdmin=await api('/api/admin',{cookies:firstDeviceAdminCookies});
  assert.equal(firstDeviceStillAdmin.r.status,200,'La connexion admin du premier appareil ne doit pas être révoquée par le second.');

  const indexText=await fs.readFile(path.join(root,'index.html'),'utf8');
  const stylesText=await fs.readFile(path.join(root,'styles.css'),'utf8');
  const appText=await fs.readFile(path.join(root,'client.js'),'utf8');
  const serverText=await fs.readFile(path.join(root,'server.mjs'),'utf8');
  const vercelText=await fs.readFile(path.join(root,'vercel.json'),'utf8');
  const desktopEnhancements=await fs.readFile(path.join(root,'admin-desktop-enhancements.js'),'utf8');
  const desktopEnhancementsCore=await fs.readFile(path.join(root,'admin-desktop-enhancements-core.js'),'utf8');
  assert.equal(await fs.stat(path.join(root,'client.js')).then(()=>true),true);
  assert.equal(await fs.access(path.join(root,'app.js')).then(()=>true).catch(()=>false),false,'app.js racine interdit: Vercel peut l’auto-détecter comme entrée serveur');
  assert.match(vercelText,/\"framework\"\s*:\s*null/,'framework preset must stay Other to disable framework auto-detection');
  // V15.45 conserve le hardening V15.44 : pas de PII réelle dans les sources distribuées.
  const realEmailPattern=/[A-Z0-9._%+-]+@(?:gmail\.com|yahoo\.fr|wanadoo\.fr|laposte\.net|orange\.fr|free\.fr)/i;
  assert.doesNotMatch(indexText+appText+stylesText,realEmailPattern);
  assert.doesNotMatch(serverText,realEmailPattern);
  // Multi-input : toucher/stylet/clavier = activation simple, souris = double-clic.
  assert.match(appText,/function usesSingleActivation\(event\)/);
  assert.match(appText,/event\?\.detail===0/);
  assert.match(appText,/pointerType==='touch'\|\|pointerType==='pen'/);
  // Désactivation sécurisée par la voie confirmée existante.
  assert.match(appText,/toggleMemberActiveDirect[\s\S]{0,180}return setMemberActive\(id,active,name,btn\)/);
  assert.match(appText,/Désactiver un membre/);
  // Cibles tactiles et aide explicite.
  assert.match(stylesText,/day-assignment-remove[\s\S]{0,180}width:44px!important/);
  assert.match(stylesText,/member-state-pill\{min-height:44px!important/);
  assert.match(appText,/Touchez un membre, puis un poste/);
  assert.match(stylesText,/safe-area-inset-left/);
  assert.match(stylesText,/safe-area-inset-right/);
  // Roster public supprimé et migration non destructive.
  assert.match(serverText,/const CURRENT_ROSTER = \[\];/);
  assert.match(serverText,/roster_migration_non_destructive/);
  assert.match(serverText,/membersPreserved/);
  assert.match(appText,/session-invalid/);
  assert.match(appText,/QUOTA_ACTIVE_POLL_MS=5\*60\*1000/);
  assert.match(appText,/QUOTA_IDLE_POLL_MS=15\*60\*1000/);
  assert.match(appText,/SHARED_SYNC_POLL_MS=4000/);
  assert.match(appText,/\/api\/sync\?view=\$\{view\}&since=/);
  assert.doesNotMatch(appText,/age<120000\?2000/);
  assert.match(serverText,/remoteRefreshTtlMs/);
  assert.match(serverText,/result\.blob\?\.etag/);
  assert.doesNotMatch(serverText,/#readRemoteCandidate[\s\S]{0,900}api\.head\(/);
  // V15.47 : Supabase devient le stockage distant prioritaire si configuré.
  assert.match(serverText,/SUPABASE_SECRET_KEY/);
  assert.match(serverText,/storageMode = requestedStorage \|\| \(hasSupabase \? 'supabase'/);
  assert.match(serverText,/#readSupabaseCandidate\(/);
  assert.match(serverText,/#persistSupabase\(/);
  assert.match(serverText,/currentRemoteSyncVersion\(\{ force = false \} = \{\}\)/);
  assert.match(serverText,/syncVersionCheckTtlMs/);
  assert.match(serverText,/plausibleSessionToken\(/);
  assert.match(serverText,/pathname === '\/api\/sync'/);
  assert.match(serverText,/version: `eq\.\$\{expectedVersion\}`/);
  assert.match(serverText,/storage: store\.storageMode === 'supabase' \? 'supabase-postgres'/);
  assert.doesNotMatch(indexText+appText,/Choisis un membre|Ouvre ton lien|Entre ton code|Copie ce lien/);

  // V15.46 UX hardening — strict modes, touch targets, quick detail/action surfaces.
  assert.match(appText,/UI_MODE_OVERRIDE_KEY='calasorga-ui-mode-v1'/);
  assert.match(appText,/query==='auto'/);
  assert.match(appText,/globalThis\.CalasOrgaUiMode=\{get:/);
  assert.match(appText,/function openModalOverlay\(/);
  assert.match(appText,/function closeModalOverlay\(/);
  assert.doesNotMatch(indexText+appText,/memberEditOverlay/,'legacy member editor must stay removed');
  assert.match(indexText,/id="memberQuickPanel"/);
  assert.match(indexText,/id="dayEditorQuickRoles"/);
  assert.match(appText,/function openMemberQuick\(/);
  assert.match(appText,/function wireHorizontalScrollAffordances\(/);
  assert.match(appText,/Cliquez un membre puis un poste, ou glissez-déposez/);
  assert.match(stylesText,/V15\.46 — UX HARDENING/);
  assert.match(stylesText,/html\.ui-tablet #adminRoot \.admin-calendar-edit[\s\S]{0,220}min-height:44px!important/);
  assert.match(stylesText,/html\.ui-tablet #adminCorrectionOverlay \.day-assignment-remove[\s\S]{0,220}width:44px!important/);
  assert.match(stylesText,/html\.ui-mobile #adminCorrectionOverlay \.day-assignment-remove[\s\S]{0,220}width:44px!important/);
  assert.match(stylesText,/html\.ui-mobile #adminRoot \.admin-tabs[\s\S]{0,220}position:fixed!important/);
  assert.match(stylesText,/html\.ui-mobile #adminMembers \.members-table th:nth-child\(2\)[\s\S]{0,260}display:none!important/);
  assert.match(stylesText,/html\.ui-mobile #adminHistory \.table tr[\s\S]{0,220}display:grid!important/);
  assert.match(stylesText,/day-editor-quick-buttons button[\s\S]{0,180}min-height:44px/);

  // Cleanup V15.45 : HTML sémantique, assets externes, CSP sans hashes inline.
  assert.match(indexText,/<title>Planning Bridge<\/title>/);
  assert.match(indexText,/nav-label-desktop/);
  assert.match(indexText,/nav-label-mobile/);
  assert.doesNotMatch(stylesText,/a\[data-admin-page="members"\]::after\{content:"Membres"/);
  assert.match(appText,/shortSide>=800&&\(uiPrecisePointerActive\(\)\|\|uiDesktopPlatformHint\(\)\)/);
  assert.match(indexText,/<link rel="stylesheet" href="\.\/styles\.css(?:\?v=[^"]+)?">/);
  assert.match(indexText,/<script src="\.\/client\.js(?:\?v=[^"]+)?"><\/script>/);
  // V15.45.7 : contrat strict de trois modes, stable en orientation.
  assert.match(appText,/UI MODE CONTRACT/);
  assert.match(appText,/UI_MODE_CLASSES=\['ui-desktop','ui-tablet','ui-mobile'\]/);
  assert.match(appText,/uiShortSide\(\)/);
  assert.match(appText,/return shortSide<600\?'mobile':'tablet'/);
  assert.match(appText,/function calendarVisibleStart\(today=parisToday\(\)\)/);
  assert.match(appText,/function monthWeekEnvelopeDates\(/);
  assert.match(serverText,/function isoWeekStart\(iso\)/);
  assert.match(appText,/if\(!uiTouchCapable\(\)\)return'desktop'/);
  assert.match(stylesText,/STRICT 3 UI MODES/);
  assert.match(stylesText,/html\.ui-tablet #adminCorrectionOverlay \.day-editor-columns/);
  assert.match(stylesText,/html\.ui-mobile #adminCorrectionOverlay \.day-editor-columns/);
  assert.match(appText,/function monthWeekEnvelopeDates\(/,'month pages must preserve complete cross-month weeks on desktop/tablet');
  assert.match(appText,/currentUiMode===\'tablet\'\|\|currentUiMode===\'mobile\'/,'mobile member quick actions must share tablet organization');
  assert.match(stylesText,/mobile direct-edit and full-day-edit lists now match tablet|Phone direct-edit and full-day-edit lists now match tablet/i);
  assert.match(indexText,/\.\/styles\.css\?v=15477-week-boundary-touch/);
  assert.match(indexText,/\.\/client\.js\?v=15477-week-boundary-touch/);
  assert.match(indexText,/\.\/admin-desktop-enhancements\.js\?v=15474-hardening/);
  assert.doesNotMatch(desktopEnhancements,/sendLinkDirect|stopImmediatePropagation/,'mail sending must have one frontend handler only');
  assert.match(desktopEnhancementsCore,/decoratePlanningRemoveButtons/);
  assert.doesNotMatch(indexText,/<style[\s>]/i);
  assert.doesNotMatch(indexText,/<script>(?:.|\n)*?<\/script>/i);
  assert.doesNotMatch(vercelText,/sha256-/i);
  assert.match(vercelText,/\/admin\/styles\.css/);
  assert.match(vercelText,/\/admin\/client\.js/);
  assert.match(vercelText,/\/admin\/admin-desktop-enhancements\.js/);
  assert.match(vercelText,/\/admin\/admin-desktop-enhancements-core\.js/);
  // V15.47.3 : les assets doivent rester dans le sous-chemin GitHub Pages /CalasOrga/.
  const ghBase='https://capgui13.github.io/CalasOrga/';
  for (const ref of ['./styles.css?v=15477-week-boundary-touch','./client.js?v=15477-week-boundary-touch','./admin-desktop-enhancements.js?v=15474-hardening']) {
    assert.ok(new URL(ref,ghBase).pathname.startsWith('/CalasOrga/'),`asset GitHub Pages hors sous-chemin: ${ref}`);
  }
  assert.match(desktopEnhancements,/import\('\.\/admin-desktop-enhancements-core\.js\?v=15473-github-pages-core'\)/);
  const cssRes=await fetch(`${origin}/styles.css`); assert.equal(cssRes.status,200); assert.match(cssRes.headers.get('content-type')||'',/text\/css/);
  const jsRes=await fetch(`${origin}/client.js`); assert.equal(jsRes.status,200); assert.match(jsRes.headers.get('content-type')||'',/text\/javascript/);
  const nestedCssRes=await fetch(`${origin}/admin/styles.css`); assert.equal(nestedCssRes.status,200);
  const nestedJsRes=await fetch(`${origin}/admin/client.js`); assert.equal(nestedJsRes.status,200);
  const enhRes=await fetch(`${origin}/admin-desktop-enhancements.js`); assert.equal(enhRes.status,200);
  const enhCoreRes=await fetch(`${origin}/admin-desktop-enhancements-core.js`); assert.equal(enhCoreRes.status,200);
  const nestedEnhRes=await fetch(`${origin}/admin/admin-desktop-enhancements.js`); assert.equal(nestedEnhRes.status,200);
  const nestedEnhCoreRes=await fetch(`${origin}/admin/admin-desktop-enhancements-core.js`); assert.equal(nestedEnhCoreRes.status,200);

  // Hotfix Vercel 2 : l'import/démarrage backend ne doit dépendre d'AUCUN fichier frontend.
  // Ce mini-bundle reproduit une fonction ne contenant que server.mjs.
  const bundleTmp=await fs.mkdtemp(path.join(os.tmpdir(),'calasorga-v1545-function-bundle-'));
  const bundlePort=42000+Math.floor(Math.random()*5000);
  await fs.copyFile(path.join(root,'server.mjs'),path.join(bundleTmp,'server.mjs'));
  const bundleChild=spawn(process.execPath,['server.mjs'],{
    cwd:bundleTmp,
    env:{
      ...process.env,
      DEMO_MODE:'1',
      ADMIN_CODE:'Ab#123',
      MEMBER_SHORT_SECRET:'test-member-short-secret-0123456789-abcdef',
      DATA_FILE:path.join(bundleTmp,'data','store.json'),
      PORT:String(bundlePort),
      LISTEN_HOST:'127.0.0.1',
      RELAXED_FSYNC:'1'
    },
    stdio:['ignore','pipe','pipe']
  });
  let bundleErr=''; bundleChild.stderr.on('data',d=>bundleErr+=d);
  try{
    let bundleHealth=null;
    for(let i=0;i<80;i++){
      try{const r=await fetch(`http://127.0.0.1:${bundlePort}/healthz`);if(r.ok){bundleHealth=await r.json();break}}catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(bundleHealth,`Le backend ne démarre pas sans assets frontend dans le bundle: ${bundleErr}`);
    assert.equal(bundleHealth.appVersion,'0.15.47.4-stabilized');
  } finally {
    bundleChild.kill('SIGTERM');
    await new Promise(r=>setTimeout(r,100));
    await fs.rm(bundleTmp,{recursive:true,force:true});
  }

  const revoke=await api(`/api/admin/members/${encodeURIComponent(aliceId)}/sessions/revoke`,{method:'POST',cookies:adminCookies,csrf:adminCsrf});
  assert.equal(revoke.r.status,200,JSON.stringify(revoke.j));
  assert.ok(revoke.j.revoked>=1);
  const meAfter=await api('/api/me',{cookies:aliceCookies2});
  assert.equal(meAfter.r.status,401);

  console.log('V15.45 tests: PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,100));
  await fs.rm(tmp,{recursive:true,force:true});
}
