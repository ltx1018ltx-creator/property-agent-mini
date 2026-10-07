(() => {
 const dialog=$('#listingDialog'),input=$('#listingLocation'),select=$('#listingAreaOverride'),status=$('#listingAreaStatus'),remember=$('#rememberListingArea'),form=$('#listingForm');
 let areasPromise,revision=0,timer;
 const panel=$('#newListingAreaPanel'),newName=$('#newListingAreaName'),addButton=$('#saveNewListingArea'),cancelButton=$('#cancelNewListingArea'),addStatus=$('#newListingAreaStatus');
 const customAreas=new Set();let previousArea='',adding=false;
 function closeAdder(){panel.hidden=true;newName.disabled=true;newName.value='';addStatus.textContent=''}
 function refreshSuggestions(){
  const locations=[...new Set([...listingLocations,...db.listings.map(x=>x.locationArea).filter(Boolean)])].sort();
  $('#listingLocationOptions').innerHTML=locations.map(x=>`<option value="${esc(x)}">`).join('');
  const filter=$('#listingLocationFilter'),selected=new Set(selectedFilterValues(filter));
  filter.innerHTML=[...new Set([...locations,...selected])].map(x=>`<option>${esc(x)}</option>`).join('');
  [...filter.options].forEach(x=>x.selected=selected.has(x.value));filter._rebuildFilterUI?.();
 }
 function fillAreas(names){
  const value=select.value;
  select.innerHTML='<option value="">Automatic · 自动归类</option>'+[...new Set([...names,value].filter(Boolean))].map(name=>`<option>${esc(name)}</option>`).join('');
  if(isAdmin)select.add(new Option('+ Add new location · 新增地区','__add_location__'));
  select.value=value;
 }
 fillAreas(listingLocations);
 async function areas(){
  if(!areasPromise)areasPromise=sbJson('/rest/v1/listing_areas?select=name&order=name',{timeoutMs:8000}).then(rows=>{
   const names=[...new Set([...rows.map(x=>x.name),...customAreas])].sort();fillAreas(names);listingLocations.splice(0,listingLocations.length,...names);refreshSuggestions();
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
 select.addEventListener('change',()=>{
  if(select.value==='__add_location__'){
   select.value=previousArea;revision++;panel.hidden=false;newName.disabled=false;newName.value='';addStatus.textContent='';newName.focus();return;
  }
  previousArea=select.value;closeAdder();void preview();
 });
 cancelButton.addEventListener('click',()=>{if(!adding){closeAdder();select.focus();void preview()}});
 newName.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addButton.click()}});
 addButton.addEventListener('click',async()=>{
  if(adding||form.dataset.saving==='true')return;
  const name=newName.value.replace(/\s+/g,' ').trim();
  if(name.length<3||name.length>100){addStatus.textContent='Enter 3–100 characters · 地区名称须为 3–100 个字符';newName.focus();return}
  const ticket=revision,user=session?.user.id;
  adding=true;addButton.disabled=true;cancelButton.disabled=true;newName.disabled=true;select.disabled=true;
  addStatus.textContent='Adding location… · 正在新增地区';
  try{
   const result=await sbJson('/rest/v1/rpc/add_listing_area',{method:'POST',token:session.access_token,timeoutMs:10000,body:JSON.stringify({area_name:name})});
   if(session?.user.id!==user)return;
   customAreas.add(result.name);if(!listingLocations.includes(result.name))listingLocations.push(result.name);
   fillAreas([...listingLocations].sort());refreshSuggestions();
   if(ticket===revision&&dialog.open){select.value=result.name;previousArea=result.name;closeAdder();void preview();select.focus()}
   toast(result.created?'Location added · 已新增地区':'Existing location selected · 已选用现有地区');
  }catch(error){if(ticket===revision&&dialog.open)addStatus.textContent=error?.name==='TimeoutError'?'Result not confirmed. Retry with the same name; duplicates are merged · 可用相同名称重试。':error.message||'Could not add location · 新增失败，请重试'}
  finally{adding=false;addButton.disabled=false;cancelButton.disabled=false;select.disabled=false;newName.disabled=panel.hidden}
 });
 new MutationObserver(()=>{
  revision++;clearTimeout(timer);if(!dialog.open)return;
  closeAdder();fillAreas(listingLocations);
  const listing=db.listings.find(x=>String(x.id)===form.elements.id.value);
  const value=listing?.locationMode==='manual'?listing.locationArea:'';
  if(value&&![...select.options].some(x=>x.value===value))select.add(new Option(value,value));
  select.value=value;previousArea=value;remember.checked=false;select.disabled=false;input.disabled=false;
  if(form.dataset.saving!=='true')$('#saveListing').disabled=false;
  void areas().catch(()=>{});void preview();
 }).observe(dialog,{attributes:true,attributeFilter:['open']});
})();


