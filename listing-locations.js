(() => {
 const dialog=$('#listingDialog'),input=$('#listingLocation'),select=$('#listingAreaOverride'),status=$('#listingAreaStatus'),remember=$('#rememberListingArea');
 let areasPromise,revision=0,timer;
 async function areas(){
  if(!areasPromise)areasPromise=sbJson('/rest/v1/listing_areas?select=name&order=name').then(rows=>{
   select.innerHTML='<option value="">Automatic · 自动归类</option>'+rows.map(x=>`<option>${esc(x.name)}</option>`).join('');
   listingLocations.splice(0,listingLocations.length,...rows.map(x=>x.name));
  }).catch(error=>{areasPromise=null;throw error});
  return areasPromise;
 }
 async function preview(){
  const ticket=++revision;remember.disabled=!select.value;if(remember.disabled)remember.checked=false;
  if(select.value){status.textContent='Manual area · 已手动指定: '+select.value;return}
  if(!input.value.trim()){status.textContent='Enter a development or address to match an area.';return}
  status.textContent='Checking area…';
  try{const result=await sbJson('/rest/v1/rpc/preview_listing_area',{method:'POST',token:session.access_token,body:JSON.stringify({place:input.value.trim()})});
   if(ticket!==revision||!dialog.open)return;
   status.textContent=result.area?'Automatic area · 自动归类: '+result.area:'Needs confirmation · 未找到可靠匹配，请选择筛选地区。';
  }catch{if(ticket===revision)status.textContent='Area preview unavailable. You can choose an area manually or retry.'}
 }
 input.addEventListener('input',()=>{revision++;clearTimeout(timer);timer=setTimeout(preview,300)});
 select.addEventListener('change',preview);
 new MutationObserver(async()=>{
  if(!dialog.open){revision++;clearTimeout(timer);return}
  select.disabled=true;$('#saveListing').disabled=true;input.disabled=true;status.textContent='Loading areas…';
  let ready=false;
  try{await areas();if(!dialog.open)return;
   const listing=db.listings.find(x=>String(x.id)===$('#listingForm').elements.id.value);
   select.value=listing?.locationMode==='manual'?listing.locationArea:'';remember.checked=false;
   ready=true;
   await preview();
  }catch{status.textContent='Area list unavailable. Close and reopen to retry. Nothing has been saved.'}
  finally{select.disabled=!ready;input.disabled=false;$('#saveListing').disabled=!ready}
 }).observe(dialog,{attributes:true,attributeFilter:['open']});
})();

