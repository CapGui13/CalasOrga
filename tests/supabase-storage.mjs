import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const server=await fs.readFile(path.join(root,'server.mjs'),'utf8');
const rows=new Map();
let requests=[];

function send(res,status,body){res.statusCode=status;res.setHeader('content-type','application/json');res.end(body===null?'':JSON.stringify(body))}
async function readJson(req){let raw='';for await(const chunk of req)raw+=chunk;return raw?JSON.parse(raw):null}

const supa=http.createServer(async(req,res)=>{
  try{
    requests.push({method:req.method,url:req.url});
    assert.equal(req.headers.apikey,'test-secret-key');
    const u=new URL(req.url,'http://127.0.0.1');
    assert.equal(u.pathname,'/rest/v1/calasorga_state');
    const idFilter=u.searchParams.get('id')||'';
    const id=idFilter.startsWith('eq.')?idFilter.slice(3):'';
    const versionFilter=u.searchParams.get('version')||'';
    const expected=versionFilter.startsWith('eq.')?Number(versionFilter.slice(3)):null;
    if(req.method==='GET'){
      const row=rows.get(id);
      return send(res,200,row?[{version:row.version,state:row.state,id}]:[]);
    }
    if(req.method==='POST'){
      const body=await readJson(req);
      const onConflict=u.searchParams.get('on_conflict');
      if(rows.has(body.id)&&!onConflict)return send(res,409,{message:'duplicate key'});
      rows.set(body.id,{version:Number(body.version),state:body.state,updated_at:body.updated_at});
      const prefer=String(req.headers.prefer||'');
      return send(res,prefer.includes('return=minimal')?204:201,prefer.includes('return=minimal')?null:[{version:Number(body.version)}]);
    }
    if(req.method==='PATCH'){
      const body=await readJson(req);
      const row=rows.get(id);
      if(!row||row.version!==expected)return send(res,200,[]);
      rows.set(id,{version:Number(body.version),state:body.state,updated_at:body.updated_at});
      return send(res,200,[{version:Number(body.version)}]);
    }
    send(res,405,{message:'method'});
  }catch(err){send(res,500,{message:err.message})}
});

await new Promise((resolve,reject)=>{supa.once('error',reject);supa.listen(0,'127.0.0.1',resolve)});
const supaPort=supa.address().port;
const supaUrl=`http://127.0.0.1:${supaPort}`;
const appPort=46000+Math.floor(Math.random()*3000);
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'calasorga-supabase-test-'));

function spawnApp(port){
  return spawn(process.execPath,['server.mjs'],{
    cwd:root,
    env:{
      ...process.env,
      NODE_ENV:'test',
      DEMO_MODE:'1',
      ADMIN_CODE:'Ab#123',
      MEMBER_SHORT_SECRET:'test-member-short-secret-0123456789-abcdef',
      CALASORGA_STORAGE:'supabase',
      SUPABASE_URL:supaUrl,
      SUPABASE_SECRET_KEY:'test-secret-key',
      SUPABASE_ALLOW_EMPTY_INIT:'1',
      STORAGE_REFRESH_TTL_MS:'0',
      DATA_FILE:path.join(tmp,'unused.json'),
      PORT:String(port),
      LISTEN_HOST:'127.0.0.1',
      RELAXED_FSYNC:'1'
    },
    stdio:['ignore','pipe','pipe']
  });
}
async function waitReady(port,child){
  let err='';child.stderr.on('data',d=>err+=d);
  for(let i=0;i<100;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/healthz`);if(r.ok)return await r.json()}catch{}
    await new Promise(r=>setTimeout(r,40));
  }
  throw new Error(`app not ready: ${err}`);
}
function cookiesFrom(res){const list=typeof res.headers.getSetCookie==='function'?res.headers.getSetCookie():[res.headers.get('set-cookie')].filter(Boolean);return Object.fromEntries(list.map(x=>x.split(';',1)[0].split(/=(.*)/s).slice(0,2)))}
function cookieHeader(jar){return Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; ')}
async function api(port,pathname,{method='GET',body,cookies={},csrf}={}){const origin=`http://127.0.0.1:${port}`;const headers={Origin:origin};if(Object.keys(cookies).length)headers.Cookie=cookieHeader(cookies);if(body!==undefined)headers['Content-Type']='application/json';if(csrf)headers['X-CSRF-Token']=csrf;const r=await fetch(origin+pathname,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});let j={};try{j=await r.json()}catch{}return{r,j,set:cookiesFrom(r)}}

let child=spawnApp(appPort);
try{
  const health=await waitReady(appPort,child);
  assert.equal(health.storage,'supabase-postgres');
  assert.equal(health.appVersion,'0.15.47.4-stabilized');
  assert.ok(rows.has('main'),'main row must be created');
  assert.ok(rows.has('main.good'),'good snapshot must be created');
  const initialVersion=rows.get('main').version;

  const login=await api(appPort,'/api/session/admin',{method:'POST',body:{code:'Ab#123'}});
  assert.equal(login.r.status,200,JSON.stringify(login.j));
  const cookies=login.set; const csrf=decodeURIComponent(cookies.club_admin_csrf);
  const created=await api(appPort,'/api/admin/members',{method:'POST',body:{name:'Supabase Test',email:'supabase@example.invalid'},cookies,csrf});
  assert.equal(created.r.status,201,JSON.stringify(created.j));
  assert.ok(rows.get('main').version>initialVersion,'mutation must CAS-update version');
  assert.ok(rows.get('main').state.members.some(m=>m.displayName==='Supabase Test'));

  child.kill('SIGTERM'); await new Promise(r=>setTimeout(r,100));
  requests=[];
  child=spawnApp(appPort+1);
  const health2=await waitReady(appPort+1,child);
  assert.equal(health2.storage,'supabase-postgres');
  assert.ok(requests.some(x=>x.method==='GET'&&x.url.includes('id=eq.main')),'restart must read main from Supabase');

  // V15.47.4 : un appel sync anonyme est rejeté avant toute lecture Supabase.
  const beforeAnonymousSync=requests.length;
  const anonymousSync=await api(appPort+1,'/api/sync?view=admin&since=');
  assert.equal(anonymousSync.r.status,401,JSON.stringify(anonymousSync.j));
  assert.equal(requests.length,beforeAnonymousSync,'anonymous sync must not touch Supabase');

  const login2=await api(appPort+1,'/api/session/admin',{method:'POST',body:{code:'Ab#123'}});
  const snap=await api(appPort+1,'/api/admin',{cookies:login2.set});
  assert.ok(snap.j.membersAdmin.some(m=>m.name==='Supabase Test'),'state must persist across restart');

  // V15.47.4 : vraie synchro entre deux instances partageant le même Supabase.
  const peerPort=appPort+2;
  let peer=spawnApp(peerPort);
  try{
    await waitReady(peerPort,peer);
    const memberLogin=await api(peerPort,'/api/session/member-short',{method:'POST',body:{shortToken:created.j.shortToken}});
    assert.equal(memberLogin.r.status,200,JSON.stringify(memberLogin.j));
    const memberCookies=memberLogin.set;
    const before=await api(peerPort,'/api/me',{cookies:memberCookies});
    assert.equal(before.r.status,200,JSON.stringify(before.j));
    assert.ok(before.j.syncVersion,'member snapshot must expose syncVersion');
    const since=before.j.syncVersion;

    const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
    const parts=fmt.formatToParts(new Date());
    const get=t=>parts.find(x=>x.type===t)?.value;
    let d=new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
    while(![1,2,4].includes(d.getUTCDay()))d=new Date(d.getTime()+86400000);
    const date=d.toISOString().slice(0,10);

    const csrf2=decodeURIComponent(login2.set.club_admin_csrf);
    const changed=await api(appPort+1,'/api/admin/assignment',{
      method:'POST',
      body:{memberId:created.j.member.id,date,role:'accueil',present:true},
      cookies:login2.set,
      csrf:csrf2
    });
    assert.equal(changed.r.status,200,JSON.stringify(changed.j));

    await new Promise(r=>setTimeout(r,850));
    requests=[];
    const synced=await api(peerPort,`/api/sync?view=member&since=${encodeURIComponent(since)}`,{cookies:memberCookies});
    assert.equal(synced.r.status,200,JSON.stringify(synced.j));
    assert.equal(synced.j.changed,true,JSON.stringify(synced.j));
    assert.ok(synced.j.snapshot?.assignments?.[date]?.accueil?.includes(created.j.member.id),'peer snapshot must contain remote role update');

    const current=synced.j.version;
    requests=[];
    const noChange1=await api(peerPort,`/api/sync?view=member&since=${encodeURIComponent(current)}`,{cookies:memberCookies});
    const noChange2=await api(peerPort,`/api/sync?view=member&since=${encodeURIComponent(current)}`,{cookies:memberCookies});
    assert.equal(noChange1.r.status,200);
    assert.equal(noChange2.r.status,200);
    assert.equal(noChange1.j.changed,false);
    assert.equal(noChange2.j.changed,false);
    const versionReads=requests.filter(x=>x.method==='GET'&&x.url.includes('select=version')).length;
    assert.ok(versionReads<=1,`sync version cache should coalesce reads, got ${versionReads}`);
  } finally {
    peer.kill('SIGTERM');
    await new Promise(r=>setTimeout(r,80));
  }
  
assert(server.includes("SUPABASE_ALLOW_EMPTY_INIT"), 'Supabase empty-store guard is present');
assert(server.includes("SUPABASE_EMPTY"), 'Supabase empty-store failure code is present');

console.log('Supabase storage tests: PASS');
} finally {
  child?.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,80));
  await fs.rm(tmp,{recursive:true,force:true});
  await new Promise(r=>supa.close(r));
}
