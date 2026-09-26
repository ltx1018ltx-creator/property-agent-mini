(() => {
 const dialog=$('#listingDialog'),input=$('#listingLocation'),select=$('#listingAreaOverride'),status=$('#listingAreaStatus'),remember=$('#rememberListingArea'),form=$('#listingForm');
 let areasPromise,revision=0,timer;
 function fillAreas(names){
  const value=select.value;
  select.innerHTML='<option value="">Automatic · 自动归类</option>'+[...new Set([...names,value].filter(Boolean))].map(name=>`<option>${esc(name)}</option>`).join('');
  select.value=value;
 }
 fillAreas(listingLocations);
 async function areas(){
  if(!areasPromise)areasPromise=sbJson('/rest/v1/listing_areas?select=name&order=name',{timeoutMs:8000}).then(rows=>{
   const names=rows.map(x=>x.name);fillAreas(names);listingLocations.splice(0,listingLocations.length,...names);
  }).catch(error=>{areasPromise=null;throw error});
  return areasPromise;
 }
 async function preview(){
  if(form.dataset.saving==='true')return;
  const ticket=++revision;remember.disabled=!select.value;if(remember.disabled)remember.checked=false;
  if(select.value){status.textContent='Manual area · 已手动指定: '+select.value;return}
  if(!input.value.trim()){status.textContent='Enter a development or address to match an area.';return}
  status.textContent='Checking area… You can save while this loads.';
  try{const result=await sbJson('/rest/v1/rpc/preview_listing_area',{method:'POST',token:session.access_token,timeoutMs:6000,body:JSON.stringify({place:input.value.trim()})});
   if(ticket!==revision||!dialog.open)return;
   status.textContent=result.area?'Automatic area · 自动归类: '+result.area:'Needs confirmation · 未找到可靠匹配，请选择筛选地区。';
  }catch{if(ticket===revision&&dialog.open)status.textContent='Preview unavailable. You can still save; the area is assigned when saved · 可继续保存。'}
 }
 input.addEventListener('input',()=>{revision++;clearTimeout(timer);timer=setTimeout(preview,300)});
 select.addEventListener('change',preview);
 new MutationObserver(()=>{
  revision++;clearTimeout(timer);if(!dialog.open)return;
  const listing=db.listings.find(x=>String(x.id)===form.elements.id.value);
  const value=listing?.locationMode==='manual'?listing.locationArea:'';
  if(value&&![...select.options].some(x=>x.value===value))select.add(new Option(value,value));
  select.value=value;remember.checked=false;select.disabled=false;input.disabled=false;
  if(form.dataset.saving!=='true')$('#saveListing').disabled=false;
  void areas().catch(()=>{});void preview();
 }).observe(dialog,{attributes:true,attributeFilter:['open']});
})();

