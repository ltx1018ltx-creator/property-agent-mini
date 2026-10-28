const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function context(uploadOK=true){
 const calls=[];
 const ctx={session:{access_token:'test-token',user:{id:'test-owner'}},AbortSignal,
  fetch:async(url,options)=>{calls.push({url,...options});return {ok:uploadOK,json:async()=>({photos:['https://example.invalid/stored.jpg'],error:'upload failed'})}},
  sbJson:async(url,options)=>{calls.push({url,...options});const request=JSON.parse(options.body);return [{id:'new',owner_id:'test-owner',listing:request.listing}]}};
 vm.runInNewContext(source.slice(source.indexOf('function listingPayload('),source.indexOf('const listingSaveStatus'))+';this.persist=persistListing',ctx);
 return {ctx,calls};
}
test('new photo saves upload first and write URL-only listing data',async()=>{
 const {ctx,calls}=context();
 const saved=await ctx.persist({title:'Home',photos:['data:image/jpeg;base64,AAAA']});
 assert.equal(calls[0].url,'/api/listing-images');
 assert.equal(calls[0].headers.Authorization,'Bearer test-token');
 assert.ok(!calls[1].body.includes('data:image'));
 assert.equal(saved.photos[0],'https://example.invalid/stored.jpg');
});
test('failed upload does not save a listing with missing images',async()=>{
 const {ctx,calls}=context(false);
 await assert.rejects(()=>ctx.persist({photos:['data:image/jpeg;base64,AAAA']}),/upload failed/);
 assert.equal(calls.length,1);
});
