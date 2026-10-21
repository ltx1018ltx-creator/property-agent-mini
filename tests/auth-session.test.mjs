import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=await readFile(new URL('../supabase.js',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const saved={access_token:'a.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.c',refresh_token:'old',user:{id:'one'}};
const fresh={...saved,access_token:'new',refresh_token:'new'};
function setup(fetch,locks){
 const data=new Map([['mari.auth',JSON.stringify(saved)]]);
 const c=vm.createContext({fetch,AbortSignal,atob,Date,navigator:locks?{locks}:{},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});
 vm.runInContext(source+';let session=null;',c);
 return {c,run:s=>vm.runInContext(s,c),stored:()=>JSON.parse(data.get('mari.auth')||'null')};
}
const response=(status,data)=>({ok:status<400,status,text:async()=>JSON.stringify(data)});
test('temporary refresh failures preserve credentials and propagate failure',async()=>{
 for(const fail of [()=>{throw TypeError('Failed to fetch')},()=>response(503,{message:'Unavailable'}),()=>response(429,{code:'over_request_rate_limit'}),()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'})}]){
  const t=setup(fail);await assert.rejects(t.run('validSession()'));assert.equal(t.stored().refresh_token,'old');
 }
});
test('invalid refresh token clears only its own session',async()=>{
 const t=setup(()=>response(400,{error_code:'refresh_token_not_found'}));await assert.rejects(t.run('refreshSession()'),e=>e.authTerminal);assert.equal(t.stored(),null);
});
test('parallel refresh requests use one network call',async()=>{
 let calls=0;const t=setup(async()=>{calls++;await new Promise(r=>setTimeout(r,10));return response(200,fresh)});
 await Promise.all(Array.from({length:10},()=>t.run('refreshSession()')));assert.equal(calls,1);assert.equal(t.stored().refresh_token,'new');
});
test('cross-tab lock rereads rotated credentials without another refresh',async()=>{
 let calls=0,t;const locks={request:async(_,fn)=>{t.run(`authStore.set(${JSON.stringify(fresh)})`);return fn()}};
 t=setup(()=>{calls++;return response(200,fresh)},locks);assert.equal((await t.run('refreshSession()')).refresh_token,'new');assert.equal(calls,0);
});
test('late refresh cannot resurrect logout or erase a new login',async()=>{
 for(const status of [200,400]){
  let release;const t=setup(()=>new Promise(r=>release=r));const pending=t.run('refreshSession()');
  t.run('authEpoch++;authStore.set(null)');release(response(status,status===200?fresh:{code:'refresh_token_not_found'}));await assert.rejects(pending);assert.equal(t.stored(),null);
 }
});
test('401 refresh retries original request once with the new token',async()=>{
 const seen=[];const t=setup((url,options)=>{seen.push([url,options.headers.Authorization]);return response(url.includes('/token?')?200:seen.length===1?401:200,url.includes('/token?')?fresh:seen.length===1?{code:'PGRST301',message:'JWT expired'}:{ok:true})});
 const result=await t.run("sbJson('/rest/v1/example',{token:'old-access'})");assert.equal(result.ok,true);assert.equal(seen.length,3);assert.equal(seen[2][1],'Bearer new');
});
function membership(fetch){
 const t=setup(fetch);const status={textContent:'',className:''};
 Object.assign(t.c,{setInterval:()=>{},document:{hidden:false,addEventListener:()=>{}},window:{addEventListener:()=>{}},status});
 t.run(`session=${JSON.stringify(saved)};let locked=0,toasted=0;const $=()=>status;function lockWorkspace(){locked++;session=null;authStore.set(null)}function setSync(text){status.textContent=text}function toast(){toasted++}async function enterApp(s){await verifyMembership(s);session=s}`);
 t.run(app.slice(app.indexOf('async function verifyMembership'),app.indexOf('function lockWorkspace')));
 t.run(app.slice(app.indexOf('let membershipCheckRunning='),app.indexOf("$('#authForm').onsubmit")));
 return t;
}
test('heartbeat offline retains session and form state; recovery works',async()=>{
 let offline=true;const t=membership((url)=>{if(offline)throw TypeError('Failed to fetch');return response(200,url.includes('/token?')?fresh:{status:'active',role:'member'})});
 await t.run('recheckMembership()');await t.run('recheckMembership()');assert.equal(t.run('locked'),0);assert.equal(t.run('toasted'),1);assert.equal(t.stored().refresh_token,'old');
 offline=false;await t.run('recheckMembership()');assert.equal(t.run('membershipOffline'),false);assert.equal(t.run('session.refresh_token'),'new');
});
test('confirmed suspended or pending membership still locks workspace',async()=>{
 for(const status of ['suspended','pending']){const t=membership(url=>response(200,url.includes('/token?')?fresh:{status}));await t.run('recheckMembership()');assert.equal(t.run('locked'),1);assert.equal(t.stored(),null)}
});
test('server error or malformed membership does not grant or revoke access',async()=>{
 for(const body of [{},'bad']){const t=membership(url=>response(200,url.includes('/token?')?fresh:body));t.run('session=null');await t.run('recheckMembership()');assert.equal(t.run('locked'),0);assert.equal(t.run('session'),null);assert.ok(t.stored())}
});

