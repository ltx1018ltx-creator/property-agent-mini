(()=>{'use strict';
const $=selector=>document.querySelector(selector);
const agent=new URLSearchParams(location.search).get('agent');
const state={rows:[],cursor:null,loading:false};
const WHATSAPP='60166286918';
const filters=window.LandingFilters;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const has=value=>value!==undefined&&value!==null&&!(typeof value==='string'&&value.trim()==='');
const listingTitle=item=>item.title||[item.propertySubtype,item.propertyType].filter(has).join(' ')||'Property listing';
const money=value=>has(value)&&Number.isFinite(Number(value))?'RM '+Number(value).toLocaleString('en-MY',{maximumFractionDigits:0}):'Price on request';
const display=value=>typeof value==='boolean'?(value?'Yes':'No'):String(value);

async function api(path){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const response=await fetch(path,{signal:controller.signal,headers:{Accept:'application/json'}});let data;try{data=await response.json()}catch{throw Error('unavailable')}if(!response.ok)throw Error(data.error||'unavailable');return data}finally{clearTimeout(timer)}}

function card(item){
  const image=item.cover||item.photos?.[0];
  const facts=[has(item.bedrooms)&&`${display(item.bedrooms)} bed`,has(item.bathrooms)&&`${display(item.bathrooms)} bath`,has(item.landSize)&&`Land ${display(item.landSize)}`].filter(Boolean);
  return `<button class="card" data-id="${esc(item.id)}" aria-label="View ${esc(listingTitle(item))}"><div class="media">${image?`<img src="${esc(image)}" alt="${esc(listingTitle(item))}" loading="lazy">`:'<span class="placeholder">MP</span>'}<span class="tag">${esc(item.deal||'Available')}</span><span class="view">View home <b>↗</b></span></div><div class="body"><small class="card-location"><span aria-hidden="true">⌖</span> ${esc(item.location||'Location on request')}</small><h3>${esc(listingTitle(item))}</h3><div class="price">${esc(money(item.price))}</div>${facts.length?`<div class="facts">${facts.map(fact=>`<span>${esc(fact)}</span>`).join('')}</div>`:''}</div></button>`;
}

function currentFilters(){return{search:$('#search').value,location:$('#location').value,type:$('#type').value,subtype:$('#subtype').value,tenure:$('#tenure').value,price:$('#price').value}}
function filtered(){return filters.filterListings(state.rows,currentFilters())}
function render(){const rows=filtered();$('#grid').innerHTML=rows.length?rows.map(card).join(''):'<div class="state empty"><b>No perfect matches yet.</b><span>Try widening your search or changing a filter.</span></div>';$('#count').textContent=`${rows.length} loaded ${rows.length===1?'property':'properties'}`;$('#more').hidden=!state.cursor}
function addOptions(id,values){const select=$(id),current=new Set([...select.options].map(option=>option.value));[...new Set(values.filter(has))].sort().forEach(value=>{if(!current.has(String(value)))select.add(new Option(value,value))})}
async function load(){if(state.loading||!agent)return;state.loading=true;$('#more').disabled=true;try{const query=new URLSearchParams({agent,limit:'24'});if(state.cursor)query.set('cursor',state.cursor);const data=await api('/api/public/catalog?'+query);state.rows.push(...data.listings);state.cursor=data.nextCursor;addOptions('#location',state.rows.map(item=>item.location));addOptions('#type',state.rows.map(item=>filters.normalizeType(item.propertyType)));render()}catch{$('#grid').innerHTML='<div class="state error"><b>We couldn’t open the collection.</b><span>Please try again in a little while.</span></div>';$('#more').hidden=true}finally{state.loading=false;$('#more').disabled=false}}

const detailFields=[['Property type','propertyType'],['Property subtype','propertySubtype'],['Deal','deal'],['Tenure','tenure'],['Lease years','leaseYears'],['Lease expiry','leaseExpiry'],['Lot type','lotType'],['Land size','landSize'],['Built-up','builtUp'],['Bedrooms','bedrooms'],['Bathrooms','bathrooms'],['Car parks','carParks'],['Furnishing','furnishing'],['Renovation','renovation'],['Title type','titleType'],['Land title','landTitle'],['Bumi lot','bumiLot'],['Facing','facing']];
function gallery(item){const photos=(item.photos||[]).filter(has);if(!photos.length)return '<div class="detail-placeholder"><span>MP</span><small>Home imagery coming soon</small></div>';return `<div class="gallery"><div class="main-photo"><img id="main-photo" src="${esc(photos[0])}" alt="${esc(listingTitle(item))}"><span id="photo-count">1 / ${photos.length}</span></div>${photos.length>1?`<div class="thumbs" aria-label="Property photos">${photos.map((photo,index)=>`<button class="thumb${index===0?' active':''}" data-photo="${esc(photo)}" data-index="${index}" aria-label="View photo ${index+1}"><img src="${esc(photo)}" alt="" loading="lazy"></button>`).join('')}</div>`:''}</div>`}
async function detail(id){const dialog=$('#dialog');$('#detail').innerHTML='<div class="state"><span class="spinner"></span>Opening property details…</div>';dialog.showModal();try{const {listing:item}=await api(`/api/public/catalog/${encodeURIComponent(id)}?agent=${encodeURIComponent(agent)}`);const facts=detailFields.filter(([,key])=>has(item[key]));$('#detail').innerHTML=`${gallery(item)}<div class="detail-copy"><p class="detail-location">⌖ ${esc(item.location||'Location on request')}</p><div class="detail-title"><div><span class="detail-tag">${esc(item.deal||'Available')}</span><h2>${esc(listingTitle(item))}</h2></div><div class="detail-price"><small>ASKING PRICE</small><strong>${esc(money(item.price))}</strong></div></div>${facts.length?`<div class="detail-grid">${facts.map(([label,key])=>`<div><small>${esc(label)}</small><b>${esc(display(item[key]))}</b></div>`).join('')}</div>`:''}<div class="detail-cta"><div><small>INTERESTED IN THIS PROPERTY?</small><strong>Let’s arrange a viewing.</strong></div><a class="whatsapp" target="_blank" rel="noopener" href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi Tong Xen, I am interested in ${listingTitle(item)} (${item.id}).`)}">Ask on WhatsApp <span>↗</span></a></div></div>`}catch{$('#detail').innerHTML='<div class="state error"><b>This listing is temporarily unavailable.</b><span>Please close this window and try again.</span></div>'}}

$('#grid').addEventListener('click',event=>{const item=event.target.closest('[data-id]');if(item)detail(item.dataset.id)});
$('#detail').addEventListener('click',event=>{const thumb=event.target.closest('[data-photo]');if(!thumb)return;$('#main-photo').src=thumb.dataset.photo;$('#photo-count').textContent=`${Number(thumb.dataset.index)+1} / ${$('#detail').querySelectorAll('.thumb').length}`;$('#detail').querySelectorAll('.thumb').forEach(button=>button.classList.toggle('active',button===thumb))});
$('#more').onclick=load;$('#dialog .close').onclick=()=>$('#dialog').close();$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog'))$('#dialog').close()});
filters.PROPERTY_SUBTYPES.forEach(value=>$('#subtype').add(new Option(value,value)));
filters.PRICE_RANGES.forEach(([label],index)=>$('#price').add(new Option(label,String(index))));
['#search','#location','#type','#subtype','#tenure','#price'].forEach(id=>$(id).addEventListener(id==='#search'?'input':'change',render));
$('#clear').onclick=()=>{['#search','#location','#type','#subtype','#tenure','#price'].forEach(id=>$(id).value='');render()};
$('#year').textContent=new Date().getFullYear();
if(!agent||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agent)){$('#grid').innerHTML='<div class="state error"><b>This collection link isn’t valid.</b><span>Please ask Tong Xen for a new link.</span></div>'}else load();
})();
