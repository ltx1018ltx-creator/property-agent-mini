const $=s=>document.querySelector(s),esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'RM '+Number(n||0).toLocaleString('en-MY',{maximumFractionDigits:0});
let listings=[],selected=new Set(),detailPhotos=[],detailPhotoIndex=0;
// Keep the complete taxonomy visible so customers can filter for categories
// even before the agent has an active listing in that category.
const propertyTypes=['Terrace House','Semi-D / Cluster House','Bungalow','Townhouse','Condominium / Serviced Residence','Apartment / Flat','Shoplot','Warehouse / Factory','Semi-D Factory','Terrace Factory','Residential Land','Agricultural Land','Commercial Land','Industrial Land'];
const propertySubtypes=['1 Storey','1.5 Storey','2 Storey','2.5 Storey','3 Storey','3.5 Storey','4 Storey','5 Storey','High-rise','Corner Lot'];
const listingLocations=['Ayer Keroh','Alor Gajah','Ayer Molek','Ayer Pa\'abas','Bachang','Bandar Hilir','Batu Berendam','Bemban','Bertam','Bukit Baru','Bukit Beruang','Bukit Katil','Bukit Rambai','Cheng','Duyong','Durian Tunggal','Jasin','Jonker Walk','Kandang','Klebang','Krubong','Lendu','Limbongan','Lubok China','Machap','Malim Jaya','Masjid Tanah','Melaka Raya','Melaka Tengah','Merlimau','MITC','Nyalas','Padang Temu','Pantai Kundor','Paya Rumput','Pengkalan Balak','Pokok Mangga','Pulau Gadong','Pulau Sebang','Rembia','Selandar','Simpang Ampat','Sungai Udang','Taman Kota Laksamana','Tanjung Bidara','Tanjung Kling','Tanjung Minyak','Telok Mas','Ujong Pasir','Umbai'];
const photos=x=>x.photos?.length?x.photos:(x.photo?[x.photo]:[]);
const type=x=>x.title||[x.propertySubtype,x.propertyType].filter(v=>v&&v!=='Not Applicable').join(' ')||'Property';
const canonicalPropertyType=v=>({'Terrace / Link House':'Terrace House','Semi-D':'Semi-D / Cluster House','Semi-Detached House':'Semi-D / Cluster House','Cluster House':'Semi-D / Cluster House','Condominium':'Condominium / Serviced Residence','Serviced Residence':'Condominium / Serviced Residence','Service Residence':'Condominium / Serviced Residence','SOHO / Studio':'Condominium / Serviced Residence','SOHO':'Condominium / Serviced Residence','Studio':'Condominium / Serviced Residence','Apartment':'Apartment / Flat','Flat':'Apartment / Flat','Bungalow / Detached House':'Bungalow','Detached House':'Bungalow','Retail Lot':'Shoplot','Office':'Shoplot','Detached Factory':'Warehouse / Factory'})[v]||v||'';
const propertyType=x=>canonicalPropertyType(x.propertyType);
const normalizedSubtype=v=>v==='Single Storey'?'1 Storey':v==='Double Storey'?'2 Storey':v||'';
const subtype=x=>x.lotType==='Corner Lot'?'Corner Lot':normalizedSubtype(x.propertySubtype||x.subtype||x.storeys||'');
const usable=v=>v&&v!=='N/A'&&v!=='Not Specified'&&v!=='Not Applicable';
const preferredSize=x=>usable(x.landSize)?['Land size',x.landSize]:usable(x.builtUp)?['Built-up',x.builtUp]:null;
async function loadAgentListings(owner){
  const fields=['title','location','propertyType','propertySubtype','subtype','storeys','lotType','price','deal','tenure','bedrooms','bathrooms','landSize','builtUp'];
  const select=['id','created_at',...fields.map(k=>`${k}:listing->${k}`),'cover:listing->photos->0','photo:listing->photo'].join(',');
  const rows=[],pageSize=100;
  for(let offset=0;;offset+=pageSize){
    const path=`/rest/v1/team_listings?owner_id=eq.${encodeURIComponent(owner)}&select=${encodeURIComponent(select)}&order=created_at.desc&limit=${pageSize}&offset=${offset}`;
    const r=await fetch(`${SUPABASE_URL}${path}`,{cache:'no-store',headers:{apikey:SUPABASE_KEY}});
    if(!r.ok)throw Error('catalog unavailable');
    const page=await r.json();
    rows.push(...page);
    if(page.length<pageSize)break;
  }
  return rows.map(({cover,photo,created_at,...row})=>({...row,photos:cover?[cover]:photo?[photo]:[],_createdAt:created_at,_summary:true}));
}
async function loadListingDetail(id){
  const path=`/rest/v1/team_listings?id=eq.${encodeURIComponent(id)}&select=id,listing,created_at&limit=1`;
  const r=await fetch(`${SUPABASE_URL}${path}`,{cache:'no-store',headers:{apikey:SUPABASE_KEY}});
  if(!r.ok)throw Error('listing unavailable');
  const [row]=await r.json();
  if(!row)throw Error('listing unavailable');
  return {...row.listing,id:row.id,_createdAt:row.created_at};
}
function card(x){const pics=photos(x),p=pics[0],id=esc(x.id),size=preferredSize(x),facts=[x.bedrooms&&`⌂ ${x.bedrooms} Beds`,x.bathrooms&&`◫ ${x.bathrooms} Baths`,size&&`◇ ${Number(size[1]).toLocaleString()} sqft`].filter(usable);return `<article class="listing-card" onclick="showDetail('${id}')"><div class="card-media"><span class="deal-tag">${esc(x.deal||'Listing')}</span><label class="pick" title="Save property" onclick="event.stopPropagation()"><input type="checkbox" ${selected.has(String(x.id))?'checked':''} onchange="toggleListing('${id}',this.checked)"><span>Select</span></label>${p?`<img src="${p}" alt="${esc(type(x))}" loading="lazy">`:'<div class="placeholder">⌂</div>'}${pics.length>1?`<span class="photo-count">▣ ${pics.length} photos</span>`:''}</div><div class="card-body"><div class="card-location">⌖ ${esc(x.location||'Melaka')}</div><strong>${money(x.price)}</strong><h2>${esc(type(x))}</h2>${facts.length?`<div class="card-facts">${facts.map(v=>`<span>${esc(v)}</span>`).join('')}</div>`:''}</div></article>`}
const selectedValues=el=>[...el.selectedOptions].map(o=>o.value).filter(Boolean);
function enhanceFilterSelect(el){
  if(!el||el.dataset.enhanced)return;
  const label=el.closest('label'),name=label?.childNodes[0]?.textContent.trim();
  if(!label||!name)return;
  const group=document.createElement('details'),summary=document.createElement('summary'),choices=document.createElement('div');
  group.className='filter-group';
  summary.innerHTML=`<span>${esc(name)}</span><b>Any</b>`;
  choices.className='filter-choices';
  [...el.options].forEach((option,index)=>{
    const button=document.createElement('button');
    button.type='button';button.textContent=option.textContent;button.setAttribute('aria-pressed','false');
    button.onclick=()=>{option.selected=!option.selected;el._syncFilterUI();el.dispatchEvent(new Event('change',{bubbles:true}))};
    button.dataset.optionIndex=index;choices.append(button);
  });
  el.dataset.enhanced='true';label.replaceWith(group);group.append(summary,choices,el);
  el._syncFilterUI=()=>{const selected=[...el.selectedOptions],buttons=[...choices.children];buttons.forEach((button,index)=>{const on=el.options[index].selected;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on))});summary.querySelector('b').textContent=selected.length?`${selected.length} selected`:'Any';group.classList.toggle('has-selection',Boolean(selected.length))};
  el._syncFilterUI();
}
const includesOrAll=(values,value)=>!values.length||values.includes(value);
const matchesPrice=(ranges,price)=>!ranges.length||ranges.some(range=>{const [min,max]=range.split('-').map(Number);return Number(price)>=min&&Number(price)<=max});
function render(){const q=$('#search').value.trim().toLowerCase(),deal=selectedValues($('#dealFilter')),loc=selectedValues($('#locationFilter')),pt=selectedValues($('#typeFilter')),st=selectedValues($('#subtypeFilter')),tenure=selectedValues($('#tenureFilter')),ranges=selectedValues($('#priceFilter')),rows=listings.filter(x=>(!q||[x.location,type(x),x.tenure,x.price,x.deal].some(v=>String(v||'').toLowerCase().includes(q)))&&(!deal.length||deal.some(v=>String(x.deal||'').toLowerCase().includes(v)))&&includesOrAll(loc,x.location)&&includesOrAll(pt,propertyType(x))&&includesOrAll(st,subtype(x))&&includesOrAll(tenure,x.tenure)&&matchesPrice(ranges,x.price)),active=deal.length+loc.length+pt.length+st.length+tenure.length+ranges.length;$('#filterBadge').textContent=active;$('#filterBadge').classList.toggle('hidden',!active);$('#count').textContent=`${rows.length} propert${rows.length===1?'y':'ies'}`;$('#list').innerHTML=rows.length?rows.map(card).join(''):'<div class="empty">No matching properties found.<br>Try clearing some filters.</div>'}
window.toggleListing=(id,on)=>{on?selected.add(String(id)):selected.delete(String(id));$('#selectedCount').textContent=selected.size;$('#selectionBar').classList.toggle('hidden',!selected.size);render()};
window.changeDetailPhoto=step=>{if(detailPhotos.length<2)return;detailPhotoIndex=(detailPhotoIndex+step+detailPhotos.length)%detailPhotos.length;$('#detailPhoto').src=detailPhotos[detailPhotoIndex];$('#detailPhotoCount').textContent=`${detailPhotoIndex+1} / ${detailPhotos.length}`};
window.showDetail=async id=>{let x=listings.find(v=>String(v.id)===String(id));if(!x)return;if(x._summary){try{const full=await loadListingDetail(id),i=listings.indexOf(x);listings[i]=full;x=full}catch{return}}const pics=photos(x),size=preferredSize(x);detailPhotos=pics;detailPhotoIndex=0;const facts=[['Property',type(x)],['Tenure',x.tenure],size&&[size[0],`${Number(size[1]).toLocaleString()} sqft`],['Bedrooms',x.bedrooms],['Bathrooms',x.bathrooms],['Car parks',x.carParks],['Lot type',x.lotType],['Furnishing',x.furnishing],['Renovation',x.renovation]].filter(v=>v&&usable(v[1]));$('#detail').innerHTML=`<button class="close" onclick="document.querySelector('#detailDialog').close()">×</button>${pics.length?`<div class="gallery"><img id="detailPhoto" src="${pics[0]}" alt="${esc(type(x))}">${pics.length>1?`<button class="gallery-arrow prev" onclick="changeDetailPhoto(-1)" aria-label="Previous photo">‹</button><button class="gallery-arrow next" onclick="changeDetailPhoto(1)" aria-label="Next photo">›</button><span class="gallery-count" id="detailPhotoCount">1 / ${pics.length}</span>`:''}</div>`:'<div class="detail-placeholder">⌂</div>'}<div class="detail-body"><div class="detail-top"><div><small>${esc(x.deal||'Listing')}</small><h2>${esc(x.location||'Melaka')}</h2><span>${esc(type(x))}</span></div><strong class="detail-price">${money(x.price)}</strong></div><div class="facts">${facts.map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div><button class="select-detail" onclick="toggleListing('${esc(x.id)}',true);document.querySelector('#detailDialog').close()">♡ Add to my favourites</button></div>`;$('#detailDialog').showModal()};
$('#search').oninput=render;
['dealFilter','locationFilter','typeFilter','subtypeFilter','tenureFilter','priceFilter'].forEach(id=>$('#'+id).onchange=render);
$('#filterBtn').onclick=()=>{const open=$('#filterPanel').classList.toggle('hidden')===false;$('#filterBtn').setAttribute('aria-expanded',String(open))};
$('#clearFilters').onclick=()=>{['dealFilter','locationFilter','typeFilter','subtypeFilter','tenureFilter','priceFilter'].forEach(id=>{const el=$('#'+id);[...el.options].forEach(o=>o.selected=false);el._syncFilterUI?.()});$('#search').value='';render()};
$('#clearBtn').onclick=()=>{selected.clear();$('#selectionBar').classList.add('hidden');render()};
$('#whatsappBtn').onclick=()=>{const chosen=listings.filter(x=>selected.has(String(x.id))),lines=chosen.map((x,i)=>`${i+1}. ${x.location||'Melaka'} — ${type(x)} — ${money(x.price)}`);const message=`Hi Tong Xen, I am interested in these properties:\n\n${lines.join('\n')}\n\nPlease send me more details / arrange viewing.\n${location.href}`;location.href=`https://wa.me/60166286918?text=${encodeURIComponent(message)}`};
(async()=>{const q=new URLSearchParams(location.search),agent=q.get('agent'),id=q.get('id');try{if(agent)listings=await loadAgentListings(agent);else if(id){const rows=await sbJson(`/rest/v1/public_shares?id=eq.${encodeURIComponent(id)}&select=payload`),payload=rows[0]?.payload;if(!payload?.collection)throw Error();listings=payload.listings||[]}else throw Error();const fill=(el,values)=>[...new Set(values.filter(usable))].sort().forEach(v=>el.insertAdjacentHTML('beforeend',`<option>${esc(v)}</option>`));fill($('#locationFilter'),[...listingLocations,...listings.map(x=>x.location)]);fill($('#typeFilter'),propertyTypes);fill($('#subtypeFilter'),propertySubtypes);$('#priceFilter').innerHTML=Array.from({length:20},(_,i)=>{const max=(i+1)*100000;return `<option value="${i?i*100000+1:0}-${max}">${(i+1)*100}k</option>`}).join('')+'<option value="2000001-Infinity">Above 2m</option>';['dealFilter','locationFilter','typeFilter','subtypeFilter','tenureFilter','priceFilter'].forEach(id=>enhanceFilterSelect($('#'+id)));render()}catch(e){console.error(e);$('#count').textContent='';$('#list').innerHTML='<div class="empty">This property catalog is unavailable.</div>'}})();
