import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'calasorga-v157-'));
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
  assert.equal(health.appVersion,'0.15.7.0-device-security-performance-vercel');
  assert.equal(health.memberShortSecretMode,'dedicated');

  const adminLogin=await api('/api/session/admin',{method:'POST',body:{code:'Ab#123'}});
  assert.equal(adminLogin.r.status,200,JSON.stringify(adminLogin.j));
  const adminCookies=adminLogin.set;
  const adminCsrf=decodeURIComponent(adminCookies.club_admin_csrf);
  assert.ok(adminCookies.club_admin);

  const createdA=await api('/api/admin/members',{method:'POST',body:{name:'Alice'},cookies:adminCookies,csrf:adminCsrf});
  assert.equal(createdA.r.status,201,JSON.stringify(createdA.j));
  assert.match(createdA.j.shortToken,/^Alice\d{6}$/u);
  const aliceId=createdA.j.member.id;

  const createdB=await api('/api/admin/members',{method:'POST',body:{name:'Bob'},cookies:adminCookies,csrf:adminCsrf});
  assert.equal(createdB.r.status,201,JSON.stringify(createdB.j));
  assert.match(createdB.j.shortToken,/^Bob\d{6}$/u);

  const loginA=await api('/api/session/member-short',{method:'POST',body:{shortToken:createdA.j.shortToken}});
  assert.equal(loginA.r.status,200,JSON.stringify(loginA.j));
  const memberCookies=loginA.set;
  const meA=await api('/api/me',{cookies:memberCookies});
  assert.equal(meA.r.status,200);
  assert.equal(meA.j.me.name,'Alice');

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
  const alice=adminSnap.j.membersAdmin.find(m=>m.id===aliceId);
  assert.equal(alice.deviceCount,1,'réouvrir le lien sur le même navigateur ne doit pas créer un faux appareil');

  const indexText=await fs.readFile(path.join(root,'index.html'),'utf8');
  assert.match(indexText,/session-invalid/);
  assert.match(indexText,/memberPollDelay\(\)/);
  assert.doesNotMatch(indexText,/Choisis un membre|Ouvre ton lien|Entre ton code|Copie ce lien/);

  const revoke=await api(`/api/admin/members/${encodeURIComponent(aliceId)}/sessions/revoke`,{method:'POST',cookies:adminCookies,csrf:adminCsrf});
  assert.equal(revoke.r.status,200,JSON.stringify(revoke.j));
  assert.ok(revoke.j.revoked>=1);
  const meAfter=await api('/api/me',{cookies:aliceCookies2});
  assert.equal(meAfter.r.status,401);

  console.log('V15.7 tests: PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,100));
  await fs.rm(tmp,{recursive:true,force:true});
}
