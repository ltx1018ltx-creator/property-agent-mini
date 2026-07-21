const SUPABASE_URL='https://nqruxoniebjqyegudyku.supabase.co';
const SUPABASE_KEY='sb_publishable_XN56JH2JPCjbLQYR2ejjDQ_EpP0TaDJ';
const sbHeaders=(token,extra={})=>({apikey:SUPABASE_KEY,Authorization:`Bearer ${token||SUPABASE_KEY}`,...extra});
const sbJson=async(path,options={})=>{
  const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:sbHeaders(options.token,{'Content-Type':'application/json',...(options.headers||{})})});
  const body=await r.text(),data=body?JSON.parse(body):null;
  if(!r.ok)throw Error(data?.msg||data?.message||data?.error_description||data?.hint||`Request failed (${r.status})`);
  return data;
};
const authStore={
  get(){try{return JSON.parse(localStorage.getItem('mari.auth')||'null')}catch{return null}},
  set(v){v?localStorage.setItem('mari.auth',JSON.stringify(v)):localStorage.removeItem('mari.auth')}
};
async function refreshSession(){const s=authStore.get();if(!s?.refresh_token)return null;try{const n=await sbJson('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:s.refresh_token})});authStore.set(n);return n}catch{authStore.set(null);return null}}
async function validSession(){let s=authStore.get();if(!s)return null;const exp=JSON.parse(atob(s.access_token.split('.')[1])).exp*1000;if(exp<Date.now()+60000)s=await refreshSession();return s}
async function signIn(email,password){const s=await sbJson('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});authStore.set(s);return s}
async function signUp(email,password,name){return sbJson('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password,data:{name}})})}
async function signOut(){const s=authStore.get();if(s)try{await sbJson('/auth/v1/logout',{method:'POST',token:s.access_token})}catch{}authStore.set(null)}
async function publishShare(payload){const s=await validSession();if(!s)throw Error('Please log in again');const [row]=await sbJson('/rest/v1/public_shares',{method:'POST',token:s.access_token,headers:{Prefer:'return=representation'},body:JSON.stringify({owner_id:s.user.id,payload})});return row.id}
