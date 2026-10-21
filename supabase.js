const SUPABASE_URL='https://nqruxoniebjqyegudyku.supabase.co';
const SUPABASE_KEY='sb_publishable_XN56JH2JPCjbLQYR2ejjDQ_EpP0TaDJ';
const sbHeaders=(token,extra={})=>({apikey:SUPABASE_KEY,Authorization:`Bearer ${token||SUPABASE_KEY}`,...extra});
const sbJson=async(path,options={})=>{
  const request=async token=>{
    const {timeoutMs,_retried,token:ignoredToken,...fetchOptions}=options;
    const r=await fetch(`${SUPABASE_URL}${path}`,{...fetchOptions,signal:timeoutMs?AbortSignal.timeout(timeoutMs):options.signal,headers:sbHeaders(token,{'Content-Type':'application/json',...(options.headers||{})})});
    const body=await r.text();let data=null;try{data=body?JSON.parse(body):null}catch{data=body}
    if(!r.ok){const e=Error(data?.msg||data?.message||data?.error_description||data?.hint||`Request failed (${r.status})`);e.status=r.status;e.code=data?.error_code||data?.code;throw e}
    return data;
  };
  try{return await request(options.token)}
  catch(e){
    const tokenProblem=options.token&&e.status===401&&/jwt|token|issued at future|expired/i.test(e.message);
    if(!tokenProblem||options._retried)throw e;
    const fresh=await refreshSession();
    if(!fresh?.access_token)throw sessionExpired();
    if(typeof session!=='undefined')session=fresh;
    return sbJson(path,{...options,token:fresh.access_token,_retried:true});
  }
};
const authStore={
  get(){try{return JSON.parse(localStorage.getItem('mari.auth')||'null')}catch{return null}},
  set(v){v?localStorage.setItem('mari.auth',JSON.stringify(v)):localStorage.removeItem('mari.auth')}
};
let refreshInFlight=null,authEpoch=0;
function sessionExpired(){return Object.assign(Error('Session expired. Please log in again.'),{code:'session_expired',authTerminal:true})}
function isTerminalRefresh(error){return error.status>=400&&error.status<500&&['refresh_token_not_found','refresh_token_already_used','session_expired','session_not_found','user_banned','user_not_found'].includes(error.code)}
function sessionExpiry(s){try{const raw=s.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return Number(JSON.parse(atob(raw)).exp)*1000||0}catch{return 0}}
async function refreshSession(){
 if(refreshInFlight)return refreshInFlight;
 const original=authStore.get(),epoch=authEpoch;
 if(!original)return null;
 if(!original.refresh_token)throw sessionExpired();
 const refresh=async()=>{
  const s=authStore.get();
  if(!s||s.user?.id!==original.user?.id||epoch!==authEpoch)throw Object.assign(Error('Session changed. Please retry.'),{code:'session_changed'});
  // Another tab may have already rotated this token while we waited for its lock.
  if(s.refresh_token!==original.refresh_token)return s;
  try{
   const n=await sbJson('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:s.refresh_token}),_retried:true,timeoutMs:12000});
   const latest=authStore.get();
   if(!latest||epoch!==authEpoch||latest.refresh_token!==s.refresh_token)throw Object.assign(Error('Session changed. Please retry.'),{code:'session_changed'});
   if(!n?.access_token||!n?.refresh_token||n.user?.id!==s.user?.id)throw Error('Invalid session response. Please retry.');
   authStore.set(n);return n;
  }catch(error){
   if(isTerminalRefresh(error)){
    const latest=authStore.get();
    if(latest?.refresh_token!==s.refresh_token||epoch!==authEpoch)throw Object.assign(Error('Session changed. Please retry.'),{code:'session_changed'});
    authStore.set(null);throw sessionExpired();
   }
   // Network errors, timeouts, 429 and server errors never erase a session.
   throw error;
  }
 };
 refreshInFlight=(typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request('mari-auth-refresh',refresh):refresh()).finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}
async function validSession(){const s=authStore.get();if(!s)return null;return sessionExpiry(s)<Date.now()+60000?refreshSession():s}
async function signIn(email,password){const s=await sbJson('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});authEpoch++;authStore.set(s);return s}
async function inviteSessionFromUrl(){
 const p=new URLSearchParams(location.hash.slice(1));if(p.get('type')!=='invite'||!p.get('access_token'))return null;
 const access_token=p.get('access_token'),refresh_token=p.get('refresh_token'),user=await sbJson('/auth/v1/user',{token:access_token});
 const s={access_token,refresh_token,token_type:p.get('token_type')||'bearer',expires_in:Number(p.get('expires_in')||3600),user};
 authStore.set(s);history.replaceState({},'',location.pathname+location.search);return s;
}
async function setAccountPassword(s,password){await sbJson('/auth/v1/user',{method:'PUT',token:s.access_token,body:JSON.stringify({password})});return s}
async function signOut(){
 authEpoch++;
 const s=authStore.get();
 authStore.set(null);
 if(s)try{
  await fetch(`${SUPABASE_URL}/auth/v1/logout`,{
   method:'POST',
   headers:sbHeaders(s.access_token),
   signal:AbortSignal.timeout(2500)
  });
 }catch{}
}
async function publishShare(payload){const s=await validSession();if(!s)throw Error('Please log in again');const [row]=await sbJson('/rest/v1/public_shares',{method:'POST',token:s.access_token,headers:{Prefer:'return=representation'},body:JSON.stringify({owner_id:s.user.id,payload})});return row.id}

