import { get } from '@vercel/blob';

const supabaseUrl=String(process.env.SUPABASE_URL||'').trim().replace(/\/+$/,'');
const supabaseKey=String(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
const table=String(process.env.SUPABASE_STATE_TABLE||'calasorga_state').trim();
const rowId=String(process.env.SUPABASE_STATE_ID||'main').trim();
const blobPath=String(process.env.BLOB_STATE_PATH||'calasorga/store.json').replace(/^\/+/, '');
const blobToken=process.env.BLOB_READ_WRITE_TOKEN||undefined;
const force=process.argv.includes('--force');

if(!supabaseUrl||!supabaseKey)throw new Error('SUPABASE_URL et SUPABASE_SECRET_KEY sont requis.');
if(!process.env.BLOB_READ_WRITE_TOKEN&&!process.env.BLOB_STORE_ID)throw new Error('Le stockage Blob source n’est pas configuré.');

const headers={apikey:supabaseKey,'Content-Type':'application/json',Accept:'application/json'};
if(!/^sb_(?:secret|publishable)_/i.test(supabaseKey))headers.Authorization=`Bearer ${supabaseKey}`;
const rest=(query='')=>`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}${query}`;

async function jsonFetch(url,options={}){
  const r=await fetch(url,options); const raw=await r.text(); let body=null;
  if(raw){try{body=JSON.parse(raw)}catch{body=raw}}
  if(!r.ok)throw new Error(`Supabase ${r.status}: ${typeof body==='string'?body:JSON.stringify(body)}`);
  return body;
}

const existing=await jsonFetch(rest(`?id=eq.${encodeURIComponent(rowId)}&select=id,version&limit=1`),{headers});
if(Array.isArray(existing)&&existing.length&&!force){
  throw new Error(`La ligne Supabase '${rowId}' existe déjà. Relancez avec --force uniquement si vous voulez l’écraser.`);
}

const source=await get(blobPath,{access:'private',useCache:false,token:blobToken});
if(!source||source.statusCode!==200||!source.stream)throw new Error('Impossible de lire le Blob source.');
const raw=await new Response(source.stream).text();
const state=JSON.parse(raw);
if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('État Blob invalide.');

if(Array.isArray(existing)&&existing.length){
  const currentVersion=Number(existing[0].version)||1;
  const body=await jsonFetch(rest(`?id=eq.${encodeURIComponent(rowId)}&version=eq.${currentVersion}&select=version`),{
    method:'PATCH',headers:{...headers,Prefer:'return=representation'},
    body:JSON.stringify({version:currentVersion+1,state,updated_at:new Date().toISOString()})
  });
  if(!Array.isArray(body)||!body.length)throw new Error('Conflit lors de l’écrasement Supabase.');
}else{
  await jsonFetch(rest('?select=version'),{
    method:'POST',headers:{...headers,Prefer:'return=representation'},
    body:JSON.stringify({id:rowId,version:1,state,updated_at:new Date().toISOString()})
  });
}

console.log(`Migration Blob -> Supabase terminée (${blobPath} -> ${table}/${rowId}).`);
