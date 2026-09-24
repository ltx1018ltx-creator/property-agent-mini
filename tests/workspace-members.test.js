const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function verifier(response){
 const start=app.indexOf('async function verifyMembership('),end=app.indexOf('function lockWorkspace(',start);
 const calls=[];const context={sbJson:async(path,options)=>{calls.push({path,options});return response}};
 vm.runInNewContext(app.slice(start,end)+';this.verify=verifyMembership',context);
 return {verify:context.verify,calls};
}
test('active members are admitted only after a token-authenticated membership check',async()=>{
 const {verify,calls}=verifier({status:'active',role:'member'});
 const result=await verify({access_token:'member-token'});
 assert.equal(result.role,'member');assert.equal(calls[0].options.token,'member-token');
 assert.equal(calls[0].path,'/rest/v1/rpc/get_workspace_membership');
});
test('pending, suspended, and malformed membership results cannot open a workspace',async()=>{
 for(const response of [{status:'pending'},{status:'suspended'},{},null]){
  const {verify}=verifier(response);await assert.rejects(()=>verify({access_token:'token'}));
 }
});
test('shared listings can be edited only by their owner, including for an admin',()=>{
 const source=app.split('\n').find(line=>line.startsWith('function canManageListing('));
 const context={isAdmin:true,session:{user:{id:'admin'}}};
 vm.runInNewContext(source+';this.canManage=canManageListing',context);
 assert.equal(context.canManage({_ownerId:'member'}),false);
 assert.equal(context.canManage({_ownerId:'admin'}),true);
 assert.equal(context.canManage(null),false);
});
test('service worker bypasses authenticated and cross-origin API requests',()=>{
 const handlers={};const context={URL,Request,Response,self:{location:{href:'https://example.test/sw.js',origin:'https://example.test'},addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8'),context);
 for(const request of [new Request('https://example.test/api/admin/invite'),new Request('https://database.test/rest/v1/agent_states'),new Request('https://example.test/app.js',{headers:{Authorization:'Bearer user-token'}})]){
  let intercepted=false;handlers.fetch({request,respondWith(){intercepted=true}});assert.equal(intercepted,false);
 }
});
