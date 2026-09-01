import fs from 'node:fs/promises';

const filename=process.argv.find((x,i)=>i>1&&!x.startsWith('--'));
const force=process.argv.includes('--force');
if(!filename)throw new Error('Usage: node scripts/import-backup-to-supabase.mjs <backup.json> [--force]');

const supabaseUrl=String(process.env.SUPABASE_URL||'').trim().replace(/\/+$/,'');
const supabaseKey=String(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
const table=String(process.env.SUPABASE_STATE_TABLE||'calasorga_state').trim();
const rowId=String(process.env.SUPABASE_STATE_ID||'main').trim();
if(!supabaseUrl||!supabaseKey)throw new Error('SUPABASE_URL et SUPABASE_SECRET_KEY sont requis.');

const payload=JSON.parse(await fs.readFile(filename,'utf8'));
const state=payload?.format==='club-presences-backup'&&payload?.state ? payload.state : payload;
if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('Sauvegarde invalide.');

const headers={apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`,'Content-Type':'application/json',Accept:'application/json'};
const rest=(query='')=>`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}${query}`;
async function jsonFetch(url,options={}){const r=await fetch(url,options);const raw=await r.text();let body=null;if(raw){try{body=JSON.parse(raw)}catch{body=raw}}if(!r.ok)throw new Error(`Supabase ${r.status}: ${typeof body==='string'?body:JSON.stringify(body)}`);return body}
const existing=await jsonFetch(rest(`?id=eq.${encodeURIComponent(rowId)}&select=id,version&limit=1`),{headers});
if(Array.isArray(existing)&&existing.length&&!force)throw new Error(`La ligne '${rowId}' existe déjà. Utilisez --force pour l’écraser.`);
if(Array.isArray(existing)&&existing.length){const v=Number(existing[0].version)||1;const rows=await jsonFetch(rest(`?id=eq.${encodeURIComponent(rowId)}&version=eq.${v}&select=version`),{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({version:v+1,state,updated_at:new Date().toISOString()})});if(!Array.isArray(rows)||!rows.length)throw new Error('Conflit Supabase.');}
else await jsonFetch(rest('?select=version'),{method:'POST',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({id:rowId,version:1,state,updated_at:new Date().toISOString()})});
console.log(`Import vers Supabase terminé (${table}/${rowId}).`);
