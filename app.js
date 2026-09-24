const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let KEY='agentDaily.v1';
const seed={leads:[{id:1,name:'Jason',phone:'',property:'Double Storey Terrace · RM430k',stage:'Negotiating',followUp:new Date().toISOString().slice(0,10),note:'Owner may negotiate from RM440k'}],listings:[]};
const listingLocations=['Ayer Keroh','Alor Gajah','Ayer Molek','Ayer Pa\'abas','Bachang','Bandar Hilir','Batu Berendam','Bemban','Bertam','Bukit Baru','Bukit Beruang','Bukit Katil','Bukit Rambai','Cheng','Duyong','Durian Tunggal','Jasin','Jonker Walk','Kandang','Klebang','Krubong','Lendu','Limbongan','Lubok China','Machap','Malim Jaya','Masjid Tanah','Melaka Raya','Melaka Tengah','Merlimau','MITC','Nyalas','Padang Temu','Pantai Kundor','Paya Rumput','Pengkalan Balak','Pokok Mangga','Pulau Gadong','Pulau Sebang','Rembia','Selandar','Simpang Ampat','Sungai Udang','Taman Kota Laksamana','Tanjung Bidara','Tanjung Kling','Tanjung Minyak','Telok Mas','Ujong Pasir','Umbai'];
const locationKey=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function matchListingLocation(value){const key=locationKey(value);return listingLocations.find(v=>key===locationKey(v))||''}
const propertyTypes=['Terrace House','Semi-D / Cluster House','Bungalow','Townhouse','Condominium / Serviced Residence','Apartment / Flat','Shoplot','Warehouse / Factory','Semi-D Factory','Terrace Factory','Residential Land','Agricultural Land','Commercial Land','Industrial Land'];
const propertySubtypes=['1 Storey','1.5 Storey','2 Storey','2.5 Storey','3 Storey','3.5 Storey','4 Storey','5 Storey','High-rise','Corner Lot','Not Applicable'];
let db={updatedAt:0,leads:[],listings:[],cases:[]},session=null;
const LISTING_PAGE_SIZE=20;
let visibleListingCount=LISTING_PAGE_SIZE;
db.cases ||= [];
db.leads ||= []; db.listings ||= []; db.updatedAt ||= 0;
let caseFilter='All';
const selectedListings=new Set();
let syncTimer;
let adminAgents=[];
let apiKeyActive=false;
let isAdmin=false;
const propertyQuotes=[
 '今天不 follow up，明天客户就 follow 别人了。',
 '没有卖不掉的房，只有还没遇到对的 buyer。',
 'Location 很重要，行动力更加重要。',
 '客户说考虑一下，通常是在等你再问一下。',
 '每一个「已读不回」，都在训练你的心脏。',
 '房价会起落，佣金进袋才算真的。',
 '先开门看屋，缘分才有机会进门。',
 '不是 market 静，是你的 WhatsApp 太安静。',
 '好的 listing 会说话，好的 agent 会一直说。',
 '今天多打一个电话，月底少吃一餐泡面。',
 'Buyer 看的是房，agent 看的是 closing。',
 '钥匙不会自己转，deal 不会自己 close。',
 '房产没有捷径，除非那间屋真的有 shortcut。',
 '每一次 viewing，都是佣金在远处向你挥手。',
 '客户预算有限，梦想通常没有。',
 '有 follow up 才有故事，有 closing 才有结局。',
 '不要怕客户拒绝，bank 才是真正的大 boss。',
 '卖房靠专业，熬夜靠咖啡，成交靠缘分加追踪。',
 '今天的 cold lead，可能是下个月的 hot deal。',
 '屋主要高价，买家要低价，agent 要活下来。',
 '真正的 sea view，有时只是窗口看得到一点蓝。',
 '照片拍得好，客户先爱上；资料写得准，客户才来看。',
 '每间屋都有优点，只是有些优点躲得比较深。',
 'Prospecting 很苦，零 commission 更苦。',
 '成交前都是 maybe，签名后才是 money。',
 '不怕 listing 多，只怕照片糊、资料少。',
 '客户不是失踪，他只是在别人的 listing 出现。',
 '今天整理好资料，明天少一点手忙脚乱。',
 '房产是长期主义，佣金是短期止痛药。',
 '一个好 agent，连「再看看」都听得出机会。',
 '先做该做的，运气才知道去哪里找你。'
];
function setDailyQuote(){const d=new Date(),dayNumber=Math.floor(new Date(d.getFullYear(),d.getMonth(),d.getDate())/86400000),el=$('#dailyQuote');if(el)el.textContent=propertyQuotes[dayNumber%propertyQuotes.length]}
function setSync(label,kind='',detail=''){const el=$('#syncStatus');if(!el)return;el.textContent=label;el.className=kind;el.title=detail;el.onclick=detail?()=>alert(`Cloud error:\n${detail}`):null}
function cloudError(e,label='Cloud error'){const detail=e?.message||String(e||'Unknown cloud error');setSync(label,'error',detail);return detail}
async function syncCloud(rethrow=false){if(!session)return;setSync('Syncing…','syncing');try{const privateData={...db,listings:[]};await sbJson('/rest/v1/agent_states?on_conflict=user_id',{method:'POST',token:session.access_token,headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({user_id:session.user.id,data:privateData,updated_at:new Date().toISOString()})});setSync('Cloud saved')}catch(e){cloudError(e,'Save failed');if(rethrow)throw e}}
function cacheLocal(){
 const lightweight={...db,listings:(db.listings||[]).map(x=>{const {photos,photo,...listing}=x;return listing})};
 try{localStorage.setItem(KEY,JSON.stringify(lightweight))}
 catch(e){try{localStorage.removeItem(KEY);localStorage.setItem(KEY,JSON.stringify(lightweight))}catch{}}
}
const save=()=>{db.updatedAt=Date.now();cacheLocal();render();clearTimeout(syncTimer);syncTimer=setTimeout(syncCloud,500)};
const money=n=>'RM '+Number(n||0).toLocaleString('en-MY',{maximumFractionDigits:0});
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function go(id){$$('.page').forEach(x=>x.classList.toggle('active',x.id===id));$$('[data-go]').forEach(x=>x.classList.toggle('active',x.dataset.go===id));scrollTo(0,0)}
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
function render(){
 setDailyQuote();
 const today=new Date().toISOString().slice(0,10), due=db.leads.filter(x=>x.followUp<=today&&x.completedFollowUp!==x.followUp);
 const pendingCases=db.cases.filter(x=>x.status!=='S&P Signed and Claimed');
 $('#leadCount').textContent=db.leads.length; $('#dueCount').textContent=due.length; $('#caseCount').textContent=pendingCases.length;
 $('#dueList').innerHTML=due.length?due.slice(0,4).map(x=>leadHTML(x,true)).join(''):'<div class="empty">今天没有 overdue follow-up。难得，可以 prospect 新客户了。☺️</div>';
 filterLeads(); filterListings(); renderCases(); calcLoan(); calcCommission();
}
function itemControls(kind,id){return `<div class="item-controls" onclick="event.stopPropagation()"><button onclick="moveItem('${kind}',${Number(id)},-1)" aria-label="Move up">↑</button><button onclick="moveItem('${kind}',${Number(id)},1)" aria-label="Move down">↓</button><button class="delete-item" onclick="deleteItem('${kind}',${Number(id)})" aria-label="Delete">×</button></div>`}
function leadHTML(x,showDone=false){const due=x.followUp<=new Date().toISOString().slice(0,10)&&x.completedFollowUp!==x.followUp,matches=matchListings(x).length,summary=[x.requirement,x.preferredType,x.preferredLocation].filter(Boolean).join(' · ');return `<article class="item clickable" onclick="editLead(${Number(x.id)})"><span class="avatar">${esc(x.name[0])}</span><div class="info"><b>${esc(x.name)}</b><small>${esc(summary)}</small>${matches?`<small class="match-score">${matches} matching listing${matches>1?'s':''}</small>`:''}</div><span class="tag ${due?'due':''}">${due?'Follow up':esc(x.followUp)}</span>${showDone?`<button class="followup-done" onclick="event.stopPropagation();completeFollowUp(${Number(x.id)})">✓ Done</button>`:itemControls('leads',x.id)}</article>`}
window.completeFollowUp=id=>{const x=db.leads.find(v=>v.id===id);if(!x)return;x.completedFollowUp=x.followUp;save();toast('Follow-up done ✓')};
function canonicalPropertyType(v){return ({'Terrace / Link House':'Terrace House','Semi-D':'Semi-D / Cluster House','Semi-Detached House':'Semi-D / Cluster House','Cluster House':'Semi-D / Cluster House','Condominium':'Condominium / Serviced Residence','Serviced Residence':'Condominium / Serviced Residence','Service Residence':'Condominium / Serviced Residence','SOHO / Studio':'Condominium / Serviced Residence','SOHO':'Condominium / Serviced Residence','Studio':'Condominium / Serviced Residence','Apartment':'Apartment / Flat','Flat':'Apartment / Flat','Bungalow / Detached House':'Bungalow','Detached House':'Bungalow','Retail Lot':'Shoplot','Office':'Shoplot','Detached Factory':'Warehouse / Factory'})[v]||v}
function propertySubtypeOf(x){return normalizedSubtype(x?.propertySubtype||x?.storeys||'')}
function filterSubtypeOf(x){return x?.lotType==='Corner Lot'?'Corner Lot':propertySubtypeOf(x)}
function canManageListing(x){return Boolean(x&&x._ownerId===session?.user?.id)}
function preferredListingSize(x){return x?.landSize?['Land size',x.landSize]:x?.builtUp?['Built-up',x.builtUp]:null}
function listingHTML(x){const type=canonicalPropertyType(x.propertyType)||x.title||'Property',location=x.location||'Location not specified',details=[propertySubtypeOf(x),type,x.tenure,x.lotType].filter(v=>v&&v!=='Not Applicable'&&v!=='Not Specified').join(' · '),photos=x.photos?.length?x.photos:(x.photo?[x.photo]:[]),id=encodeURIComponent(String(x.id)),checked=[...selectedListings].some(v=>String(v)===String(x.id)),size=preferredListingSize(x),facts=[x.bedrooms&&`${x.bedrooms} Beds`,x.bathrooms&&`${x.bathrooms} Baths`,size&&`${size[1]} sqft`].filter(Boolean).join(' · '),manage=canManageListing(x);return `<article class="listing-card clickable" onclick="viewListing(decodeURIComponent('${id}'))"><label class="listing-check" onclick="event.stopPropagation()"><input type="checkbox" ${checked?'checked':''} onchange="toggleListing(decodeURIComponent('${id}'),this.checked)"></label>${photos[0]?`<div class="listing-photo-wrap"><img class="listing-thumb" src="${photos[0]}" alt="${esc(type)}" loading="lazy" decoding="async">${photos.length>1?`<span>+${photos.length-1}</span>`:''}</div>`:'<span class="listing-placeholder">⌂</span>'}<div class="listing-card-body"><span class="listing-deal">${esc(x.deal||'Listing')}</span><b class="listing-price">${money(x.price)}</b><h3>${esc(location)}</h3><p>${esc(x.locationArea||'Area needs review · 地区待确认')}</p><p>${esc(details)}</p>${facts?`<small>${esc(facts)}</small>`:''}<div class="listing-card-actions">${manage?`<button onclick="event.stopPropagation();editListing(decodeURIComponent('${id}'))">Edit</button>`:''}<button onclick="event.stopPropagation();shareListing(decodeURIComponent('${id}'))">Share</button>${manage?`<button class="delete-listing" onclick="event.stopPropagation();deleteItem('listings',decodeURIComponent('${id}'))">Delete</button>`:''}</div></div></article>`}
function filterLeads(){const q=($('#leadSearch')?.value||'').toLowerCase(),a=db.leads.filter(x=>JSON.stringify(x).toLowerCase().includes(q));$('#leadList').innerHTML=a.length?a.map(leadHTML).join(''):'<div class="empty">No leads yet.</div>'}
function normalizedSubtype(v){return v==='Single Storey'?'1 Storey':v==='Double Storey'?'2 Storey':v}
const selectedFilterValues=el=>[...el.selectedOptions].map(o=>o.value).filter(Boolean);
function enhanceListingFilter(el){
 if(!el)return;
 if(el.dataset.enhanced){el._rebuildFilterUI?.();return}
 const label=el.closest('label'),name=label?.childNodes[0]?.textContent.trim();if(!label||!name)return;
 const group=document.createElement('details'),summary=document.createElement('summary'),choices=document.createElement('div');group.className='listing-filter-group';summary.innerHTML=`<span>${esc(name)}</span><b>Any</b>`;choices.className='listing-filter-choices';
 el.dataset.enhanced='true';label.replaceWith(group);group.append(summary,choices,el);
 el._syncFilterUI=()=>{const selected=[...el.selectedOptions];[...choices.children].forEach(button=>{const option=[...el.options].find(item=>item.value===button.dataset.optionValue),on=Boolean(option?.selected);button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on))});summary.querySelector('b').textContent=selected.length?`${selected.length} selected`:'Any';group.classList.toggle('has-selection',Boolean(selected.length))};
 el._rebuildFilterUI=()=>{choices.innerHTML='';[...el.options].forEach(option=>{const button=document.createElement('button'),value=option.value;button.type='button';button.textContent=option.textContent;button.dataset.optionValue=value;button.setAttribute('aria-pressed','false');button.onclick=()=>{const liveOption=[...el.options].find(item=>item.value===value);if(!liveOption)return;liveOption.selected=!liveOption.selected;el._syncFilterUI();el.dispatchEvent(new Event('change',{bubbles:true}))};choices.append(button)});el._syncFilterUI()};
 el._rebuildFilterUI()
}
const inSelected=(values,value)=>!values.length||values.includes(value);
const inSelectedPrice=(ranges,price)=>!ranges.length||ranges.some(range=>{const [min,max]=range.split('-').map(Number);return Number(price)>=min&&Number(price)<=max});
function filterListings(){const q=$('#listingSearch').value.trim().toLowerCase(),loc=selectedFilterValues($('#listingLocationFilter')),type=selectedFilterValues($('#listingTypeFilter')),subtype=selectedFilterValues($('#listingSubtypeFilter')),tenure=selectedFilterValues($('#listingTenureFilter')),ranges=selectedFilterValues($('#listingPriceFilter'));const a=db.listings.filter(x=>{const pt=canonicalPropertyType(x.propertyType),pst=propertySubtypeOf(x),fst=filterSubtypeOf(x);return(!q||[x.location,x.locationArea,pt,pst,x.lotType,x.deal,x.price,x.tenure].some(v=>String(v||'').toLowerCase().includes(q)))&&inSelected(loc,x.locationArea||'Needs review')&&inSelected(type,pt)&&inSelected(subtype,fst)&&inSelected(tenure,x.tenure)&&inSelectedPrice(ranges,x.price)});const active=loc.length+type.length+subtype.length+tenure.length+ranges.length,visible=a.slice(0,visibleListingCount),more=a.length-visible.length;$('#listingFilterBadge').textContent=active;$('#listingFilterBadge').classList.toggle('hidden',!active);$('#listingResultCount').textContent=`${a.length} listing${a.length===1?'':'s'}`;$('#listingList').innerHTML=visible.length?visible.map(listingHTML).join(''):'<div class="empty">没有符合条件的房源。试试清除 filters。</div>';$('#loadMoreListings').textContent=more?`Load ${Math.min(LISTING_PAGE_SIZE,more)} more · ${more} remaining`:'';$('#loadMoreListings').classList.toggle('hidden',!more)}
function renderCases(){
 const counts=s=>db.cases.filter(x=>x.status===s).length;
 const claimStatuses=['Pending Loan','Pending Sign S&P','Pending Claim'],pendingCases=db.cases.filter(x=>claimStatuses.includes(x.status)),pendingCommission=pendingCases.reduce((sum,x)=>sum+Number(x.commission||0),0);
 $('#caseSummary').innerHTML=`<div><b>${counts('Pending Loan')}</b><small>Pending loan</small></div><div><b>${counts('Pending Sign S&P')}</b><small>Sign S&P</small></div><div><b>${money(pendingCommission)}</b><small>${pendingCases.length} cases · Pending claim commission</small></div>`;
 const rows=caseFilter==='All'?db.cases:db.cases.filter(x=>x.status===caseFilter);
 $('#caseList').innerHTML=rows.length?rows.map(caseHTML).join(''):'<div class="empty">这个 category 暂时没有 case。</div>';
}
function caseHTML(x){const done=x.status==='S&P Signed and Claimed',figures=[x.amount&&`Deal ${money(x.amount)}`,x.commission&&`Commission ${money(x.commission)}`].filter(Boolean).join(' · ');return `<article class="item case-item clickable ${done?'done':''}" onclick="editCase(${Number(x.id)})"><span class="avatar">${done?'✓':'◷'}</span><div class="info"><b>${esc(x.client)} · ${esc(x.property)}</b><small>${figures?esc(figures)+' · ':''}Updated ${esc(x.updated)}</small><span class="tag">${esc(x.status)}</span>${x.remark?`<small class="remark">${esc(x.remark)}</small>`:''}</div>${itemControls('cases',x.id)}</article>`}
window.moveItem=(kind,id,direction)=>{const list=db[kind];if(!Array.isArray(list))return;const from=list.findIndex(x=>x.id===id),to=from+direction;if(from<0||to<0||to>=list.length)return;[list[from],list[to]]=[list[to],list[from]];save();toast(direction<0?'Moved up':'Moved down')};
window.deleteItem=async(kind,id)=>{const labels={leads:'lead',listings:'listing',cases:'case'};if(!db[kind]||!confirm(`Delete this ${labels[kind]||'item'}?`))return;const target=String(id);if(kind==='listings'){const listing=db.listings.find(x=>String(x.id)===target);if(!canManageListing(listing))return toast('Only the uploader can delete this listing');try{await sbJson(`/rest/v1/team_listings?id=eq.${encodeURIComponent(target)}`,{method:'DELETE',token:session.access_token});db.listings=db.listings.filter(x=>String(x.id)!==target);[...selectedListings].forEach(v=>{if(String(v)===target)selectedListings.delete(v)});updateBulkBar();render();return toast('Listing deleted')}catch(e){return toast(e.message)}}db[kind]=db[kind].filter(x=>String(x.id)!==target);save();toast('Deleted')};
$('#leadSearch').oninput=filterLeads;
function resetListingPage(){visibleListingCount=LISTING_PAGE_SIZE;filterListings()}
['listingLocationFilter','listingTypeFilter','listingSubtypeFilter','listingTenureFilter','listingPriceFilter'].forEach(id=>$('#'+id).onchange=resetListingPage);
$('#listingSearch').oninput=resetListingPage;
$('#loadMoreListings').onclick=()=>{visibleListingCount+=LISTING_PAGE_SIZE;filterListings()};
$('#toggleListingFilters').onclick=()=>{const panel=$('#listingFilterPanel'),open=panel.classList.toggle('hidden')===false;$('#toggleListingFilters').setAttribute('aria-expanded',String(open))};
$('#clearListingFilters').onclick=()=>{['listingLocationFilter','listingTypeFilter','listingSubtypeFilter','listingTenureFilter','listingPriceFilter'].forEach(id=>{const el=$('#'+id);[...el.options].forEach(o=>o.selected=false);el._syncFilterUI?.()});$('#listingSearch').value='';resetListingPage()};
$('#addLeadBtn').onclick=()=>{const f=$('#leadForm');f.reset();f.elements.id.value='';f.elements.followUp.value=new Date().toISOString().slice(0,10);$('#leadDialogTitle').textContent='New Lead';$('#leadTools').classList.add('hidden');$('#leadDialog').showModal()};
$('#saveLead').onclick=e=>{e.preventDefault();const f=$('#leadForm');if(!f.reportValidity())return;const x=Object.fromEntries(new FormData(f));if(x.id){const i=db.leads.findIndex(v=>String(v.id)===x.id);db.leads[i]={...db.leads[i],...x,id:Number(x.id)}}else db.leads.unshift({...x,id:Date.now()});$('#leadDialog').close();save();toast(x.id?'Lead updated':'Lead saved')};
function matchListings(lead){const wantedDeal=lead.requirement==='WTB'?'For Sale':lead.requirement==='WTR'?'For Rent':'';return db.listings.filter(x=>!wantedDeal||x.deal===wantedDeal).map(x=>{let score=0,total=0;const test=(wanted,ok,weight=1)=>{if(wanted){total+=weight;if(ok)score+=weight}};test(lead.preferredLocation,[x.location,x.locationArea].some(v=>String(v||'').toLowerCase().includes(String(lead.preferredLocation||'').toLowerCase())),3);test(lead.preferredType,x.propertyType===lead.preferredType,3);test(lead.budgetMin,+x.price>=+lead.budgetMin,1);test(lead.budgetMax,+x.price<=+lead.budgetMax,3);return {x,score,total,percent:total?Math.round(score/total*100):50}}).filter(v=>!v.total||v.percent>=60).sort((a,b)=>b.percent-a.percent||+a.x.price-+b.x.price)}
function renderLeadTools(x){const matches=matchListings(x);$('#leadMatches').innerHTML=matches.length?`<button type="button" class="match-share" onclick="shareMatched(${Number(x.id)})">Share all ${matches.length} matches</button>`+matches.slice(0,8).map(({x:v,percent})=>`<div class="match-row"><div><b>${esc(v.title||v.propertyType)}</b><small>${esc(v.location)} · ${money(v.price)}</small></div><span class="match-score">${percent}% match</span><button type="button" class="match-share" onclick="shareListing(${Number(v.id)})">Share</button></div>`).join(''):'<div class="empty">No matching listings yet.</div>';$('#leadTools').classList.remove('hidden')}
window.editLead=id=>{const x=db.leads.find(v=>v.id===id),f=$('#leadForm');f.reset();Object.entries(x).forEach(([k,v])=>{if(f.elements[k])f.elements[k].value=v});$('#leadDialogTitle').textContent='View / Edit Lead';renderLeadTools(x);$('#leadDialog').showModal()};
$('#leadWhatsApp').onclick=()=>{const id=Number($('#leadForm').elements.id.value),x=db.leads.find(v=>v.id===id);if(!x?.phone)return toast('这个 lead 没有 phone number');const phone=x.phone.replace(/\D/g,'').replace(/^0/,'60');open(`https://wa.me/${phone}?text=${encodeURIComponent(`Hi ${x.name}, just following up with you.`)}`,'_blank')};
$$('[data-snooze]').forEach(b=>b.onclick=()=>{const f=$('#leadForm'),d=new Date();d.setDate(d.getDate()+Number(b.dataset.snooze));f.elements.followUp.value=d.toISOString().slice(0,10);toast(`Follow-up moved +${b.dataset.snooze} day`)});
$('#addListingBtn').onclick=()=>{const f=$('#listingForm');f.reset();f.elements.id.value='';$('#listingDialogTitle').textContent='New Listing';$('#listingPhotoPreview').innerHTML='';$('#listingPhotoPreview').classList.add('hidden');$('#listingDialog').showModal()};
$('#closeListingDialog').onclick=()=>$('#listingDialog').close();
$('#closeLeadDialog').onclick=()=>$('#leadDialog').close();
$('#closeCaseDialog').onclick=()=>$('#caseDialog').close();
$('#importListingBtn').onclick=()=>{$('#importListingForm').reset();$('#importListingDialog').showModal()};
const CUSTOMER_CATALOG_ORIGIN='https://mari-property.onrender.com';
$('#customerCatalogBtn').onclick=async()=>{if(!session?.user?.id)return toast('Please log in again');const url=`${CUSTOMER_CATALOG_ORIGIN}/catalog.html?agent=${encodeURIComponent(session.user.id)}`;try{await navigator.clipboard.writeText(url);toast('Customer listing link copied')}catch{prompt('Copy customer listing link:',url)}};
$('#parseListingBtn').onclick=e=>{e.preventDefault();const text=$('#whatsappListingText').value.trim();if(!text)return;const data=parseWhatsAppListing(text),f=$('#listingForm');f.reset();Object.entries(data).forEach(([k,v])=>{if(f.elements[k]&&v!==undefined)f.elements[k].value=v});f.elements.rawText.value=text;$('#listingPhotoPreview').innerHTML='';$('#listingPhotoPreview').classList.add('hidden');$('#importListingDialog').close();$('#listingDialog').showModal();toast(data.location?`已自动归类到 ${data.location}`:'Location 匹配不到，请选一个')};
function parseWhatsAppListing(text){
 const t=text.replace(/[，]/g,',').replace(/[✕✖×]/g,'x').replace(/\ufe0f/g,'').replace(/\b(?:saft|sq\.?\s*feet|square\s*feet|kps)\b|方尺/ig,'sqft'),low=t.toLowerCase(),find=re=>t.match(re)?.[1]?.trim(),pick=items=>items.find(v=>low.includes(v.toLowerCase()));
 const number=v=>{if(!v)return'';const m=String(v).replace(/,/g,'').match(/([0-9]+(?:\.[0-9]+)?)\s*(million|mil|m|k)?/i);if(!m)return'';let n=+m[1],u=(m[2]||'').toLowerCase();if(u==='k')n*=1e3;if(['m','mil','million'].includes(u))n*=1e6;return Math.round(n)};
 const dimension=v=>{if(!v)return'';const m=String(v).replace(/,/g,'').match(/([\d.]+)\s*(?:x|\*)\s*([\d.]+)/i);return m?String(Math.round(+m[1]*+m[2])):String(number(v)||'')};
 const labelled=(labels,value='([^\n|;]+)')=>find(new RegExp(`(?:^|\\n|[|;])\\s*[-•*✅📍🏠💰🌿📐]*\\s*(?:${labels})\\s*[:：=\\-]?\\s*${value}`,'im'));
 const typeRules=[['Semi-D Factory',/semi[- ]?d\s+(?:factory|warehouse)/],['Terrace Factory',/terrace(?:d)?\s+(?:factory|warehouse)/],['Warehouse / Factory',/(?:detached\s+)?(?:warehouse|factory)|kilang|独立(?:式)?工厂|工厂|货仓|厂房/],['Terrace House',/terrace|link house|rumah\s+teres|排屋/],['Semi-D / Cluster House',/semi[- ]?d(?:etached)?(?!\s*(?:factory|warehouse))|cluster house|rumah\s+berkembar|半独立/],['Bungalow',/bungalow|detached house|rumah\s+sesebuah|独立式住宅/],['Townhouse',/town\s*house|townhouse/],['Condominium / Serviced Residence',/serviced (?:residence|apartment)|condo|minium|\bsoho\b|studio unit/],['Apartment / Flat',/apartment|pangsapuri|\bflat\b|公寓|组屋/],['Shoplot',/shop ?lot|shop ?house|retail (?:lot|space)|kedai|店屋/],['Industrial Land',/industrial land|tanah industri|工业地/],['Residential Land',/residential land|tanah kediaman|住宅地/],['Commercial Land',/commercial land|tanah komersial|商业地/],['Agricultural Land',/agricultural land|agri land|tanah pertanian|农地/]];
 const propertyType=pick(propertyTypes)||typeRules.find(v=>v[1].test(low))?.[0]||'';
 let price=number(labelled('asking(?: price)?|selling(?: price)?|sale price|price|售价|卖价|租金|rental(?: per month)?|monthly rent','((?:rm\\s*)?[0-9,.]+\\s*(?:million|mil|m|k)?)'));
 if(!price){const candidates=[...t.matchAll(/rm\s*([0-9,.]+)\s*(million|mil|m|k)?/ig)].map(m=>number(m[0])).filter(n=>n>=300);price=candidates.length?Math.max(...candidates):''}
 const sizePattern='([0-9,.]+(?:\\s*(?:x|\\*)\\s*[0-9,.]+)?\\s*(?:sqft|sq\\.?\\s*ft|sf|ft²|acres?|ekar|sqm|m²)?)';
 const labelledLand=labelled('land(?: size| area)?|lot(?: size| area)?|土地(?:面积)?|地积|地段面积|keluasan tanah',sizePattern);
 const bareDimensionMatch=t.match(/(?:^|\n|\s)(\d{1,4}(?:\.\d+)?)\s*(?:x|\*)\s*(\d{1,4}(?:\.\d+)?)(?:\s*(?:ft|feet|sqft))?(?=\s|$|[,.])/im);
 const landRaw=labelledLand||(bareDimensionMatch?`${bareDimensionMatch[1]} x ${bareDimensionMatch[2]}`:'');
 const builtRaw=labelled('(?:factory\\s+)?built[ -]?up(?: size| area)?|build(?:ing)?(?: size| area)?|floor area|建筑面积|建成面积|室内面积|keluasan binaan',sizePattern);
 const sizeValue=v=>{if(!v)return'';const n=dimension(v);return /acre|ekar/i.test(v)?String(Math.round(+n*43560)):/sqm|m²/i.test(v)?String(Math.round(+n*10.7639)):n};
 const beds=find(/(\d+)(?:\s*\+\s*\d+)?\s*(?:bedrooms?|beds?|rooms?|bilik(?:\s+tidur)?|房间|睡房|房)/i)||find(/(?:bedrooms?|beds?|rooms?|bilik(?:\s+tidur)?|房间|睡房)\s*[:：\-]?\s*(\d+)(?:\s*\+\s*\d+)?/i);
 const baths=find(/(\d+)\s*(?:bathrooms?|baths?|toilets?|bilik\s+air|厕所|浴室|厕)/i)||find(/(?:bathrooms?|baths?|toilets?|bilik\s+air|厕所|浴室)\s*[:：\-]?\s*(\d+)/i);
 const leaseExpiry=find(/(?:lease\s*(?:expiry|expires?)|(?:lh|leasehold)\s*(?:until|till)|expire[sd]?)\s*[:：\-]?\s*((?:19|20|21)\d{2})/i);
 const leaseYears=find(/(?:remaining lease|lease balance|balance lease|leasehold)\s*[:：\-]?\s*(\d{1,3})\s*(?:years?|yrs?)/i)||find(/\blh\s*[:：\-]?\s*(\d{1,3})\b(?!\s*(?:until|till))/i);
 const parks=find(/(?:car ?parks?|parking|车位)\s*[:：\-]?\s*(\d+)/i)||find(/(\d+)\s*(?:car ?parks?|parking|车位)/i);
 const inlinePlace=find(/(?:📍|\b(?:at|located at|location)\s*[:\-]?)\s*((?:taman|bandar|residensi|residence|jalan|jln|kondominium|pangsapuri|menara|plaza)\b[^\n,|;]*?)(?=\s+(?:single|double|1|2|3|terrace|semi|bungalow|condo|apartment|factory|warehouse)\b|\n|$)/i);
 const typeLinePlace=t.split(/\n/).map(v=>v.replace(/for\s+sales?|for\s+rent|📍|🏡|🏠/ig,' ').replace(/\b(?:single|double|one|two|three|1|2|3)(?:\s*[-.]?\s*)(?:storeys?|stories|story|sty|tingkat)\b|\b(?:terrace|link house|semi[- ]?d(?:etached)?|bungalow|condo(?:minium)?|apartment|factory|warehouse)\b/ig,' ').replace(/\s+/g,' ').trim()).find(v=>v.length>=4&&/[a-z]/i.test(v)&&!/(?:below value|bedroom|bathroom|selling|price|furnished|renovat|land size|built.?up)/i.test(v)&&!/^\d/.test(v))||'';
 const inferredPlace=inlinePlace||typeLinePlace||t.split(/\n/).map(v=>v.replace(/^\s*[-•*📍🏠]+\s*/, '').trim()).find(v=>/^(?:taman|bandar|residensi|residence|jalan|jln|kondominium|pangsapuri|menara|plaza|lot\b)/i.test(v)&&v.length<100)||'';
 const location=inferredPlace||pick(listingLocations)||'';
 const facingMap=[['North East',/north[- ]?east|东北/],['North West',/north[- ]?west|西北/],['South East',/south[- ]?east|东南/],['South West',/south[- ]?west|西南/],['North',/facing\s+north|北向/],['South',/facing\s+south|南向/],['East',/facing\s+east|东向/],['West',/facing\s+west|西向/]];
 return {location,propertyType,deal:/for\s*rent|rental|to let|出租|租金/i.test(low)?'For Rent':'For Sale',price,
  tenure:/\b(?:lh\d*|lh\b)|leasehold|租赁|租约/i.test(low)?'Leasehold':/\bfh\b|freehold|永久/i.test(low)?'Freehold':'',leaseYears:leaseYears||'',leaseExpiry:leaseExpiry||'',
  lotType:/corner(?: lot)?|角头|角间/i.test(low)?'Corner Lot':/end(?: lot)?|尾端/i.test(low)?'End Lot':/intermediate|intermedia\b|中间/i.test(low)?'Intermediate Lot':'Not Applicable',
  propertySubtype:/(?:5|five)\s*[-.]?\s*(?:storeys?|stories|story|sty|tingkat)|五层(?:楼)?/i.test(low)?'5 Storey':/(?:4|four)\s*[-.]?\s*(?:storeys?|stories|story|sty|tingkat)|四层(?:楼)?/i.test(low)?'4 Storey':/3\.5\s*(?:storeys?|stories|story|sty)?|three and (?:a )?half|3½|三层半/i.test(low)?'3.5 Storey':/2\.5\s*(?:storeys?|stories|story|sty)?|two and (?:a )?half|2½|双层半/i.test(low)?'2.5 Storey':/1\.5\s*(?:storeys?|stories|story|sty)?|one and (?:a )?half|1½|一层半/i.test(low)?'1.5 Storey':/(?:3|three)\s*[-.]?\s*(?:storeys?|stories|story|sty|tingkat)|triple\s*storey|三层(?:楼)?/i.test(low)?'3 Storey':/(?:2|two)\s*[-.]?\s*(?:storeys?|stories|story|sty|tingkat)|double\s*[- ]?storey|双层(?:楼)?|两层(?:楼)?/i.test(low)?'2 Storey':/(?:1|one)\s*[-.]?\s*(?:storeys?|stories|story|sty|tingkat)|single\s*[- ]?storey|单层(?:楼)?|一层(?:楼)?|setingkat/i.test(low)?'1 Storey':/condo|apartment|flat|serviced residence|soho/i.test(low)?'High-rise':'Not Applicable',
  landSize:sizeValue(landRaw),builtUp:sizeValue(builtRaw),bedrooms:beds&&+beds>=6?'6+':beds||'N/A',bathrooms:baths&&+baths>=5?'5+':baths||'N/A',carParks:parks||'',
  furnishing:/full(?:y)?\s*furnish(?:ed|ing)?|fullyfurnished|full furnish|全套家具/i.test(low)?'Fully Furnished':/part(?:ly|ially)?\s*furnish(?:ed|ing)?|semi[- ]?furnish(?:ed)?|部分家具/i.test(low)?'Partly Furnished':/un[- ]?furnish(?:ed)?|bare unit|without furniture|无家具/i.test(low)?'Unfurnished':'Not Specified',
  renovation:/fully?\s*renov(?:ated|eted|ation)|full reno|newly renovated|豪华装修|全屋装修/i.test(low)?'Fully Renovated':/part(?:ly|ially)?\s*renov(?:ated|ation)|part reno|部分装修/i.test(low)?'Partly Renovated':/original condition|no renovation|未装修|原装/i.test(low)?'Original Condition':'Not Specified',
  titleType:/strata title|分层地契/i.test(low)?'Strata':/individual title|独立地契/i.test(low)?'Individual':'Not Specified',landTitle:/industrial title/i.test(low)?'Industrial':/commercial title/i.test(low)?'Commercial':/agricultural title/i.test(low)?'Agricultural':/residential title/i.test(low)?'Residential':'Not Specified',
  bumiLot:/non[- ]?bumi|open lot|international lot/i.test(low)?'No':/bumi lot|土著单位/i.test(low)?'Yes':'Not Specified',facing:facingMap.find(v=>v[1].test(low))?.[0]||'Not Specified'}
}
function normalizeImportedListing(x){
 const raw=x.rawText||x.raw_text||x.description||x.text||'',parsed=raw?parseWhatsAppListing(raw):{},aliases={
  location:['area','project','projectName','address'],propertyType:['type','property_type'],deal:['transactionType','listingType'],
  price:['sellingPrice','askingPrice','rental'],propertySubtype:['storeys','storey','stories','floors','floorCount','property_subtype'],
  landSize:['landArea','land_size','lotSize','lotArea'],builtUp:['builtUpSize','built_up','builtArea','buildingSize','floorArea'],
  bedrooms:['beds','rooms'],bathrooms:['baths','toilets'],carParks:['parking','carparks'],tenure:['titleTenure']
 };
 const explicit={...x};Object.entries(aliases).forEach(([target,keys])=>{if(!explicit[target])explicit[target]=keys.map(k=>x[k]).find(v=>v!==undefined&&v!==null&&v!=='')||''});
 const cleanSize=v=>{if(v===undefined||v===null)return'';const s=String(v).replace(/[，,]/g,'').replace(/\b(?:saft|sq\.?\s*feet|square\s*feet|kps)\b/ig,'sqft');const m=s.match(/([\d.]+)\s*(?:x|×|\*)\s*([\d.]+)/i);if(m)return String(Math.round(+m[1]*+m[2]));const n=s.match(/[\d.]+/);if(!n)return'';return /acre|ekar/i.test(s)?String(Math.round(+n[0]*43560)):/sqm|m²/i.test(s)?String(Math.round(+n[0]*10.7639)):String(Math.round(+n[0]))};
 explicit.landSize=cleanSize(explicit.landSize);explicit.builtUp=cleanSize(explicit.builtUp);
 const merged={...parsed};Object.entries(explicit).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!==''&&v!=='N/A'&&v!=='Not Specified')merged[k]=v});
 merged.location=String(merged.location||'').trim();merged.propertyType=canonicalPropertyType(merged.propertyType);merged.propertySubtype=propertySubtypeOf(merged);merged.rawText=raw;merged.title=merged.title||[merged.propertySubtype,merged.propertyType].filter(v=>v&&v!=='Not Applicable').join(' ');
 return merged;
}
$('#listingPhoto').onchange=async e=>{const files=[...e.target.files];if(files.length>10){e.target.value='';$('#listingPhotoPreview').innerHTML='';$('#listingPhotoPreview').classList.add('hidden');return toast('最多只能选 10 张照片')};const preview=$('#listingPhotoPreview');preview.innerHTML='';if(!files.length)return preview.classList.add('hidden');preview.classList.remove('hidden');for(const file of files){const photo=await compressPhoto(file);preview.insertAdjacentHTML('beforeend',`<img src="${photo}" alt="Listing photo preview">`)}};
function listingPayload(x){const {_ownerId,_createdAt,id,...payload}=x;return payload}
async function persistListing(listing){const payload=listingPayload(listing),editing=Boolean(listing.id);const [row]=await sbJson(editing?`/rest/v1/team_listings?id=eq.${encodeURIComponent(listing.id)}`:'/rest/v1/team_listings',{method:editing?'PATCH':'POST',token:session.access_token,headers:{Prefer:'return=representation'},body:JSON.stringify(editing?{listing:payload,updated_at:new Date().toISOString()}:{owner_id:session.user.id,listing:payload})});if(!row)throw Error('Listing was not saved. Refresh and try again.');return {...row.listing,id:row.id,_ownerId:row.owner_id,_createdAt:row.created_at}}
$('#saveListing').onclick=async e=>{e.preventDefault();const f=$('#listingForm');if(!f.reportValidity())return;const x=Object.fromEntries(new FormData(f));delete x.photoFile;const typedLocation=String(x.location||'').trim();x.location=typedLocation;x.locationMode=x.areaOverride?'manual':'auto';x.locationArea=x.areaOverride||'';delete x.areaOverride;if(!x.location)return toast('Please enter a location');x.title=[x.propertySubtype,x.propertyType].filter(v=>v&&v!=='Not Applicable').join(' ');const files=[...$('#listingPhoto').files];if(files.length>10)return toast('最多只能上传 10 张照片');if(files.length)x.photos=await Promise.all(files.map(compressPhoto));const isEdit=Boolean(x.id);let listing;if(isEdit){const old=db.listings.find(v=>String(v.id)===x.id);if(!old)return toast('Listing ID 找不到，请 refresh 再试');if(!canManageListing(old))return toast('Only the uploader can edit this listing');listing={...old,...x,id:old.id,shareId:''};delete listing.storeys;if(!files.length)listing.photos=old.photos||[]}else listing={...x,shareId:'',_ownerId:session.user.id};try{listing=await persistListing(listing);let memoryError='';if($('#rememberListingArea').checked&&listing.locationMode==='manual'){try{await sbJson('/rest/v1/rpc/remember_listing_area',{method:'POST',token:session.access_token,body:JSON.stringify({place:listing.location,area:listing.locationArea})});await loadCloud()}catch(error){memoryError=' · Listing saved, but area rule was not saved: '+error.message}}const i=db.listings.findIndex(v=>String(v.id)===String(listing.id));if(i>=0)db.listings[i]=listing;else db.listings.unshift(listing);cacheLocal();render();$('#listingDialog').close();toast((isEdit?'Listing updated':`Listing saved${files.length?' · '+files.length+' photos':''}`)+memoryError)}catch(err){toast(err.message||'Listing save failed')}};
window.editListing=id=>{const x=db.listings.find(v=>String(v.id)===String(id)),f=$('#listingForm');if(!x)return;if(!canManageListing(x))return toast('Only the uploader can edit this listing');f.reset();Object.entries(x).forEach(([k,v])=>{if(f.elements[k]&&!['photos','photo'].includes(k))f.elements[k].value=k==='propertyType'?canonicalPropertyType(v):v});f.elements.propertySubtype.value=propertySubtypeOf(x);f.elements.id.value=x.id;$('#listingDialogTitle').textContent='View / Edit Listing';const photos=x.photos?.length?x.photos:(x.photo?[x.photo]:[]),preview=$('#listingPhotoPreview');preview.innerHTML=photos.map(p=>`<img src="${p}" alt="Listing photo">`).join('');preview.classList.toggle('hidden',!photos.length);$('#listingDialog').showModal()};
async function publishListing(listing){const id=await publishShare(listing);listing.shareId=id;return `${location.origin}/share.html?id=${id}`}
window.closeListingView=()=>$('#listingViewDialog').close();
let listingViewPhotos=[],listingViewPhotoIndex=0;
window.changeListingViewPhoto=step=>{if(listingViewPhotos.length<2)return;listingViewPhotoIndex=(listingViewPhotoIndex+step+listingViewPhotos.length)%listingViewPhotos.length;$('#listingViewPhoto').src=listingViewPhotos[listingViewPhotoIndex];$('#listingViewPhotoCount').textContent=`${listingViewPhotoIndex+1} / ${listingViewPhotos.length}`};
window.viewListing=id=>{const x=db.listings.find(v=>String(v.id)===String(id));if(!x)return;const photos=x.photos?.length?x.photos:(x.photo?[x.photo]:[]),type=canonicalPropertyType(x.propertyType)||'Property',subtype=propertySubtypeOf(x),encoded=encodeURIComponent(String(x.id)),size=preferredListingSize(x),facts=[
 ['Property',[subtype,type].filter(Boolean).join(' · ')],
 ['Tenure',x.tenure],
 size&&[size[0],`${size[1]} sqft`],
 ['Bedrooms',x.bedrooms],
 ['Bathrooms',x.bathrooms],
 ['Car parks',x.carParks],
 ['Lot type',x.lotType]
 ].filter(v=>v&&v[1]&&v[1]!=='N/A'&&v[1]!=='Not Specified'&&v[1]!=='Not Applicable');
 listingViewPhotos=photos;listingViewPhotoIndex=0;$('#listingViewContent').innerHTML=`<button type="button" class="dialog-close listing-view-close" onclick="closeListingView()" aria-label="Close">×</button>${photos.length?`<div class="listing-view-gallery"><img id="listingViewPhoto" src="${photos[0]}" alt="${esc(type)} photo 1" decoding="async">${photos.length>1?`<button class="listing-gallery-arrow prev" onclick="changeListingViewPhoto(-1)" aria-label="Previous photo">‹</button><button class="listing-gallery-arrow next" onclick="changeListingViewPhoto(1)" aria-label="Next photo">›</button><span class="listing-gallery-count" id="listingViewPhotoCount">1 / ${photos.length}</span>`:''}</div>`:'<div class="listing-view-no-photo">⌂</div>'}<div class="listing-view-body"><span class="listing-deal">${esc(x.deal||'Listing')}</span><h2>${esc(x.location||'Location not specified')}</h2><strong>${money(x.price)}</strong><div class="listing-view-facts">${facts.map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div><div class="listing-view-actions">${canManageListing(x)?`<button onclick="closeListingView();editListing(decodeURIComponent('${encoded}'))">Edit</button>`:''}<button class="primary" onclick="shareListing(decodeURIComponent('${encoded}'))">Share</button></div></div>`;
 $('#listingViewDialog').showModal()
};
window.toggleListing=(id,on)=>{const target=String(id);if(on)selectedListings.add(target);else [...selectedListings].forEach(v=>{if(String(v)===target)selectedListings.delete(v)});updateBulkBar()};
function updateBulkBar(){const n=selectedListings.size;$('#listingSelectedCount').textContent=n;$('#listingBulkBar').classList.toggle('hidden',!n)}
$('#shareSelectedListings').onclick=async()=>{const ids=new Set([...selectedListings].map(String)),listings=db.listings.filter(x=>ids.has(String(x.id)));if(!listings.length)return;try{const id=await publishShare({collection:true,listings}),url=`${location.origin}/share.html?id=${id}`;if(navigator.share)await navigator.share({title:`${listings.length} Property Listings`,url});else{await navigator.clipboard.writeText(url);toast('Listing collection link copied')}}catch(e){if(e?.name!=='AbortError')toast('合集网址生成失败，请再试')}};
$('#deleteSelectedListings').onclick=async()=>{const ids=new Set([...selectedListings].map(String)),allowed=db.listings.filter(x=>ids.has(String(x.id))&&canManageListing(x));if(!allowed.length)return toast('No selected listings you can delete');if(!confirm(`Delete ${allowed.length} selected listing${allowed.length===1?'':'s'}? This cannot be undone.`))return;try{await sbJson(`/rest/v1/team_listings?id=in.(${allowed.map(x=>encodeURIComponent(x.id)).join(',')})`,{method:'DELETE',token:session.access_token});const removed=new Set(allowed.map(x=>String(x.id)));db.listings=db.listings.filter(x=>!removed.has(String(x.id)));selectedListings.clear();updateBulkBar();render();toast(`${allowed.length} listing${allowed.length===1?'':'s'} deleted`)}catch(e){toast(e.message)}};
window.shareMatched=async leadId=>{const lead=db.leads.find(x=>x.id===leadId),listings=lead?matchListings(lead).map(v=>v.x):[];if(!listings.length)return toast('No matching listings');try{const id=await publishShare({collection:true,listings,clientName:lead.name}),url=`${location.origin}/share.html?id=${id}`;if(navigator.share)await navigator.share({title:`Properties selected for ${lead.name}`,url});else{await navigator.clipboard.writeText(url);toast('Client shortlist link copied')}}catch(e){if(e?.name!=='AbortError')toast('Shortlist 暂时生成不到')}};
window.shareListing=async id=>{const x=db.listings.find(v=>String(v.id)===String(id));if(!x)return;try{const url=x.shareId?`${location.origin}/share.html?id=${x.shareId}`:await publishListing(x);if(canManageListing(x))await persistListing(x);cacheLocal();if(navigator.share)await navigator.share({title:x.title||x.propertyType||'Property Listing',url});else{await navigator.clipboard.writeText(url);toast('Read-only share link copied')}}catch(err){if(err?.name!=='AbortError')toast('Share link 生成失败，请再试')}};
function compressPhoto(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{const max=900,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.72))};img.src=reader.result};reader.readAsDataURL(file)})}
function openShareDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('mari-share-target',1);req.onupgradeneeded=()=>req.result.createObjectStore('shares');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function takeSharedPayload(){const shareDB=await openShareDB();return new Promise((resolve,reject)=>{const tx=shareDB.transaction('shares','readwrite'),store=tx.objectStore('shares'),req=store.get('latest');req.onsuccess=()=>{const value=req.result;store.delete('latest');resolve(value)};req.onerror=()=>reject(req.error)})}
async function importAndroidShare(){if(!new URLSearchParams(location.search).has('shared'))return;history.replaceState({},'',location.pathname);try{const payload=await takeSharedPayload();if(!payload)return toast('没有收到 WhatsApp 资料');const f=$('#listingForm'),text=(payload.text||'').trim(),files=(payload.files||[]).slice(0,10);f.reset();f.elements.id.value='';if(text){const parsed=parseWhatsAppListing(text);Object.entries(parsed).forEach(([k,v])=>{if(f.elements[k]&&v!==undefined)f.elements[k].value=v});f.elements.rawText.value=text}if(files.length){const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));$('#listingPhoto').files=transfer.files;const preview=$('#listingPhotoPreview');preview.innerHTML='';preview.classList.remove('hidden');for(const file of files){const photo=await compressPhoto(file);preview.insertAdjacentHTML('beforeend',`<img src="${photo}" alt="WhatsApp photo preview">`)}}$('#listingDialogTitle').textContent='WhatsApp Import';$('#listingDialog').showModal();toast(`收到 ${files.length} 张照片${text?'和房源资料':''}，检查后 Save`)}catch(e){toast('WhatsApp import 失败，请再 Share 一次')}}
$('#addCaseBtn').onclick=()=>{const f=$('#caseForm');f.reset();f.elements.updated.value=new Date().toISOString().slice(0,10);f.elements.id.value='';$('#caseDialogTitle').textContent='New Case';$('#caseDialog').showModal()};
$('#saveCase').onclick=e=>{e.preventDefault();const f=$('#caseForm');if(!f.reportValidity())return;const x=Object.fromEntries(new FormData(f));if(x.id){const i=db.cases.findIndex(c=>String(c.id)===x.id);db.cases[i]={...db.cases[i],...x,id:Number(x.id)}}else db.cases.unshift({...x,id:Date.now()});$('#caseDialog').close();save();toast('Case updated')};
window.editCase=id=>{const x=db.cases.find(c=>c.id===id),f=$('#caseForm');Object.entries(x).forEach(([k,v])=>{if(f.elements[k])f.elements[k].value=v});$('#caseDialogTitle').textContent='Update Case';$('#caseDialog').showModal()};
$$('[data-case-filter]').forEach(b=>b.onclick=()=>{$$('[data-case-filter]').forEach(x=>x.classList.toggle('active',x===b));caseFilter=b.dataset.caseFilter;renderCases()});
function memberContact(){
 const own=session?.user.id==='6c8e4545-3e89-40e2-b5a9-7a18475641d7';
 return {name:session?.user.user_metadata?.name||session?.user.email.split('@')[0]||'',ren:own?'REN 51905':'',phone:own?'60166286918':'',agency:own?'TheRoofRealtySdnBhd E(1)1605/5 | 03-79837798':'',...(db.profile||{})};
}
function fillMemberProfile(){const profile=memberContact();for(const [key,value] of Object.entries(profile)){const input=$('#memberProfileForm').elements[key];if(input)input.value=value}}
$('#memberProfileForm').onsubmit=e=>{e.preventDefault();if(!session)return;db.profile=Object.fromEntries(new FormData(e.target));save();toast('Your contact details saved')};
function copySignature(suffix){
 const profile=memberContact();let phone=profile.phone.replace(/\D/g,'');if(phone.startsWith('0'))phone='6'+phone;
 return [profile.name+(profile.ren?' ['+profile.ren+']':''),phone?'www.wasap.my/'+phone+'/'+suffix:'',profile.agency].filter(Boolean).join('\n');
}
function generateCopy(){
 const deal=$('#cwDeal').value,type=$('#cwType').value.trim(),loc=$('#cwLocation').value.trim(),price=Number($('#cwPrice').value),features=$('#cwFeatures').value.split('\n').map(x=>x.trim()).filter(Boolean),note=$('#cwNote').value.trim();
 if(!type||!loc||!price)return toast('Type、地点和价格先填好');
 const rent=deal==='For Rent', suffix=(loc.split(',')[0]+' '+type+' '+(rent?price:Math.round(price/1000)+'k')).toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,45);
 const icon=rent?'🔑':'🏡', action=rent?'出租':'出售';
 const text=`${icon} ${deal.toUpperCase()}｜${loc} ${type}\n\n正在寻找${rent?'舒适住家／合适单位':'自住或投资房产'}的朋友，可以看看这一间👇\n\n📍 ${loc}\n🏠 ${type}\n\nProperty Details：\n${features.map(x=>'✅ '+x).join('\n')}${note?'\n\n💡 '+note:''}\n\n💰 ${rent?'Rental':'Selling Price'}：${money(price)}${rent?' / month':''}\n\n有兴趣索取完整资料、照片或预约看房，欢迎 PM / WhatsApp 联系我。\n\n${copySignature(suffix)}\n\n#MelakaProperty #马六甲房地产 #${type.replace(/\s/g,'')} #房产${action}`;
 $('#copyOutput').textContent=text;$('#copyOutputWrap').classList.remove('hidden');$('#copyOutputWrap').scrollIntoView({behavior:'smooth'});
}
$('#generateBtn').onclick=generateCopy;
$('#analyzeCopyBtn').onclick=()=>{
 const raw=$('#cwRaw').value.trim();if(!raw)return toast('先 paste raw property info');const x=parseWhatsAppListing(raw),usable=v=>v&&v!=='N/A'&&v!=='Not Applicable'&&v!=='Not Specified';
 const type=[propertySubtypeOf(x),x.propertyType].filter(usable).join(' '),features=[[x.tenure,''],[x.landSize,'Land size ', ' sqft'],[x.builtUp,'Built-up ',' sqft'],[x.bedrooms,'',' bedrooms'],[x.bathrooms,'',' bathrooms'],[x.carParks,'',' car parks'],[x.lotType,''],[x.furnishing,''],[x.renovation,''],[x.titleType,'',' title'],[x.landTitle,'',' title'],[x.bumiLot==='Yes'?'Bumi Lot':x.bumiLot==='No'?'Non-Bumi Lot':'',''],[x.facing,'Facing ']].filter(v=>usable(v[0])).map(v=>(v[1]||'')+v[0]+(v[2]||''));
 $('#cwDeal').value=x.deal;$('#cwType').value=type;$('#cwLocation').value=x.location;$('#cwPrice').value=x.price;$('#cwFeatures').value=features.join('\n');$('#cwNote').value='';
 if(!type||!x.location||!x.price)return toast('有资料抓不到，下面补一下再 Generate');generateCopy();toast('Raw info analyzed · 文案 ready');
};
$('#copyBtn').onclick=async()=>{await navigator.clipboard.writeText($('#copyOutput').textContent);toast('文案 copied，可以开工了')};
function calcLoan(){const p=+$(`#loanPrice`).value,m=+$(`#loanMargin`).value/100,r=+$(`#loanRate`).value/1200,n=+$(`#loanYears`).value*12,L=p*m,x=r?L*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1):L/n;$('#monthlyResult').textContent=money(x);$('#loanAmountResult').textContent=`Loan amount: ${money(L)}`}
function calcCommission(){const gross=+$(`#dealPrice`).value*(+$(`#feeRate`).value/100),mine=gross*(+$(`#shareRate`).value/100),sst=gross*(+$(`#sstRate`).value/100);$('#commissionResult').textContent=money(mine);$('#sstResult').textContent=`Agency fee: ${money(gross)} · SST: ${money(sst)}`}
$$('#loanCalc input').forEach(x=>x.oninput=calcLoan);$$('#commissionCalc input').forEach(x=>x.oninput=calcCommission);
$$('[data-calc]').forEach(b=>b.onclick=()=>{$$('[data-calc]').forEach(x=>x.classList.toggle('active',x===b));$('#loanCalc').classList.toggle('hidden',b.dataset.calc!=='loan');$('#commissionCalc').classList.toggle('hidden',b.dataset.calc!=='commission')});
$('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='agent-daily-backup.json';a.click();URL.revokeObjectURL(a.href);toast('Backup downloaded')};
function toast(s){const x=$('#toast');x.textContent=s;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),1800)}
function fillListingOptions(){const replace=(el,html)=>{if(!el.multiple){el.innerHTML=html;return}const selected=new Set(selectedFilterValues(el));el.innerHTML=html;[...el.options].forEach(option=>option.selected=selected.has(option.value));el._rebuildFilterUI?.()},add=(el,items,first='')=>replace(el,(first?`<option value="">${first}</option>`:'')+items.map(x=>`<option>${esc(x)}</option>`).join('')),locations=[...new Set([...listingLocations,...(db?.listings||[]).map(x=>x.locationArea||'Needs review').filter(Boolean)])].sort(),prices=Array.from({length:20},(_,i)=>{const max=(i+1)*100000;return `<option value="${i?i*100000+1:0}-${max}">${(i+1)*100}k</option>`}).join('')+'<option value="2000001-Infinity">Above 2m</option>';$('#listingLocationOptions').innerHTML=locations.map(x=>`<option value="${esc(x)}">`).join('');add($('#listingPropertyType'),propertyTypes,'Choose property type');add($('#listingLocationFilter'),locations);add($('#listingTypeFilter'),propertyTypes);add($('#listingSubtypeFilter'),propertySubtypes);replace($('#listingPriceFilter'),prices);add($('#leadPropertyType'),propertyTypes,'Any property type');['listingLocationFilter','listingTypeFilter','listingSubtypeFilter','listingTenureFilter','listingPriceFilter'].forEach(id=>enhanceListingFilter($('#'+id)))}
async function loadTeamListings(){
 const pageSize=5,rows=[];
 for(let offset=0;;offset+=pageSize){
  const page=await sbJson(`/rest/v1/team_listings?select=id,owner_id,listing,created_at&order=created_at.desc&limit=${pageSize}&offset=${offset}`,{token:session.access_token});
  rows.push(...page);
  if(page.length<pageSize)break;
 }
 return rows;
}
async function loadCloud(){const activeUser=session?.user.id;if(!activeUser)return;try{
 const statePath=`/rest/v1/agent_states?user_id=eq.${session.user.id}&select=updatedAt:data->updatedAt,leads:data->leads,cases:data->cases,profile:data->profile`;
 const [states,rows]=await Promise.all([sbJson(statePath,{token:session.access_token}),loadTeamListings()]);
 if(session?.user.id!==activeUser)return;
 const remote=states[0]&&{updatedAt:states[0].updatedAt||0,leads:states[0].leads||[],cases:states[0].cases||[],profile:states[0].profile||{},listings:[]};
 if(remote&&remote.updatedAt>=(db.updatedAt||0))db=remote;else if(!states.length)await syncCloud(true);
 db.cases||=[];db.leads||=[];db.listings=rows.map(r=>({...r.listing,id:r.id,_ownerId:r.owner_id,_createdAt:r.created_at}));cacheLocal();fillListingOptions();fillMemberProfile();setSync('Cloud synced');render();
 }catch(e){cloudError(e);render()}}
async function claimImport(){
 const q=new URLSearchParams(location.search),token=q.get('claim');if(!token)return;
 try{
  const r=await fetch(`/api/imports/${encodeURIComponent(token)}`,{cache:'no-store'});if(!r.ok)throw Error();
  const payload=await r.json(),incoming=Array.isArray(payload.listings)?payload.listings.map(normalizeImportedListing):[];
  const fingerprints=new Set(db.listings.map(x=>`${x.rawText||''}|${x.price||''}`));
  const fresh=incoming.filter(x=>!fingerprints.has(`${x.rawText||''}|${x.price||''}`)).map((x,i)=>({...x,id:Date.now()+i,shareId:''}));
  for(const item of fresh){delete item.id;const saved=await persistListing(item);db.listings.unshift(saved)}
  cacheLocal();await fetch(`/api/imports/${encodeURIComponent(token)}`,{method:'DELETE'});
  history.replaceState({},'',location.pathname);render();go('listings');toast(`${fresh.length} listing 已安全导入 Cloud`);
 }catch(e){toast('一次性导入链接无效或已经使用')}
}
function adminDate(v){return v?new Intl.DateTimeFormat('en-MY',{dateStyle:'medium'}).format(new Date(v)):'Never'}
function renderAdminAgents(){
 const q=($('#adminSearch').value||'').toLowerCase(),rows=adminAgents.filter(x=>`${x.name} ${x.email}`.toLowerCase().includes(q));
 $('#adminAgentList').innerHTML=rows.length?rows.map(x=>`<article class="item agent-item"><span class="avatar">${esc((x.name||x.email||'?')[0]).toUpperCase()}</span><div class="info"><b>${esc(x.name||'Unnamed member')}</b><small>${esc(x.email)}</small><small>${x.role==='admin'?'Admin':'Member'} · ${esc(x.status)}${x.invitation_pending?' · Invitation pending':''}</small><small>Joined ${adminDate(x.created_at)} · Last login ${adminDate(x.last_sign_in_at)}</small></div>${x.role!=='admin'?`<button type="button" data-member="${esc(x.user_id)}" data-status="${x.status==='active'?'suspended':'active'}">${x.status==='active'?'Suspend':x.status==='pending'?'Approve':'Reactivate'}</button>`:''}</article>`).join(''):'<div class="empty">No matching members.</div>';
 $('#adminSummary').innerHTML=`<article><b>${adminAgents.length}</b><span>Accounts</span></article><article><b>${adminAgents.filter(x=>x.status==='active').length}</b><span>Active</span></article><article><b>${adminAgents.filter(x=>x.status!=='active').length}</b><span>Pending / suspended</span></article>`;
}
$('#adminAgentList').onclick=async event=>{
 const button=event.target.closest('button[data-member]');if(!button)return;
 const member=adminAgents.find(x=>x.user_id===button.dataset.member);if(!member)return;
 const status=button.dataset.status;
 if(!confirm(`${status==='suspended'?'Suspend access for':'Activate access for'} ${member.name||member.email}?`))return;
 button.disabled=true;
 try{await sbJson('/rest/v1/rpc/set_workspace_member_status',{method:'POST',token:session.access_token,body:JSON.stringify({target_user_id:member.user_id,new_status:status})});await loadAdmin();toast('Member access updated')}
 catch(e){toast(e.message);button.disabled=false}
};
async function loadAdmin(){try{adminAgents=await sbJson('/rest/v1/rpc/get_workspace_accounts',{method:'POST',token:session.access_token,body:'{}'});isAdmin=true;$('#adminBtn').classList.remove('hidden');renderAdminAgents();render();await loadDraftInbox();return true}catch(e){isAdmin=false;$('#adminBtn').classList.add('hidden');return false}}
$('#inviteAgentForm').onsubmit=async e=>{
 e.preventDefault();
 const msg=$('#inviteAgentMessage'),button=e.submitter,email=$('#inviteAgentEmail').value.trim(),name=$('#inviteAgentName').value.trim();
 msg.textContent='Sending invite…';button.disabled=true;
 try{
  const r=await fetch('/api/admin/invite',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({email,name})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Invite failed');
  msg.textContent=`Invite sent to ${email}`;e.target.reset();toast('Member invite sent');await loadAdmin();
 }catch(err){msg.textContent=err.message}finally{button.disabled=false}
};
async function loadApiKeyStatus(){
 try{
  const s=await sbJson('/rest/v1/rpc/get_agent_api_key_status',{method:'POST',token:session.access_token,body:'{}'});
  apiKeyActive=Boolean(s?.active);$('#apiKeyStatus').textContent=apiKeyActive?'OpenClaw key active':'Not connected yet';
  $('#apiKeyMeta').textContent=apiKeyActive?`Key ${s.key_prefix}… · ${s.last_used_at?'Last used '+adminDate(s.last_used_at):'Not used yet'}`:'Generate a private key to connect your AI.';
  $('#apiKeyDot').classList.toggle('active',apiKeyActive);$('#revokeApiKeyBtn').classList.toggle('hidden',!apiKeyActive);
  $('#generateApiKeyBtn').textContent=apiKeyActive?'Replace API key':'Generate API key';
 }catch(e){$('#apiKeyStatus').textContent='Database setup needed';$('#apiKeyMeta').textContent='Run the latest supabase-setup.sql first.'}
}
$('#connectAiBtn').onclick=async()=>{go('ai-connect');await loadApiKeyStatus()};
$('#generateApiKeyBtn').onclick=async()=>{
 if(apiKeyActive&&!confirm('Replace the current key? The old OpenClaw connection will stop working.'))return;
 try{const s=await sbJson('/rest/v1/rpc/create_agent_api_key',{method:'POST',token:session.access_token,body:'{}'});$('#apiKeyValue').textContent=s.api_key;$('#apiKeyReveal').classList.remove('hidden');await loadApiKeyStatus();toast('New private API key generated')}catch(e){toast(e.message)}
};
$('#revokeApiKeyBtn').onclick=async()=>{if(!confirm('Revoke this key? OpenClaw uploads will stop immediately.'))return;try{await sbJson('/rest/v1/rpc/revoke_agent_api_key',{method:'POST',token:session.access_token,body:'{}'});$('#apiKeyReveal').classList.add('hidden');await loadApiKeyStatus();toast('API key revoked')}catch(e){toast(e.message)}};
$('#copyApiKeyBtn').onclick=async()=>{await navigator.clipboard.writeText($('#apiKeyValue').textContent);toast('API key copied — keep it private')};
$('#copyInstructionBtn').onclick=async()=>{await navigator.clipboard.writeText($('#openClawInstruction').textContent);toast('Connection instruction copied')};


$('#adminBtn').onclick=async()=>{go('admin');await loadAdmin()};$('#refreshAdminBtn').onclick=loadAdmin;$('#adminSearch').oninput=renderAdminAgents;
const DRAFT_FIELDS=['location','propertyType','propertySubtype','tenure','leaseYears','leaseExpiry','lotType','deal','price','landSize','builtUp','bedrooms','bathrooms','carParks','furnishing','renovation','titleType','landTitle','bumiLot','facing'];
let draftSubmissions=[];
const selectedDraftSubmissions=new Set();
let splitSubmission=null,splitOperationId=null;
async function adminApi(path,options={}){const r=await fetch(path,{...options,headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',...(options.headers||{})}});const data=await r.json();if(!r.ok)throw Error(data.error||data.code||'Request failed');return data}
function updateDraftMergeControls(){const count=selectedDraftSubmissions.size;$('#draftMergeCount').textContent=`${count} submission${count===1?'':'s'} selected`;$('#mergeDraftSubmissions').disabled=count<2}
function renderDraftInbox(aiEnabled){$('#draftInbox').innerHTML=draftSubmissions.length?draftSubmissions.map(s=>{const d=s.draft||{},facts=d.structured_data||{};const texts=s.messages.filter(m=>m.message_type==='text'&&m.message_text);const images=s.messages.filter(m=>m.image_url);const selectable=!d.id,splitable=selectable&&s.messages.length>=2;return `<article class="card draft-card" data-submission="${esc(s.id)}">${selectable?`<label class="draft-select"><input type="checkbox" class="merge-select" ${selectedDraftSubmissions.has(s.id)?'checked':''}> Select for merge</label>`:''}<header><div><b>Received ${esc(adminDate(s.started_at))}</b><small>${texts.length} text message${texts.length===1?'':'s'} · ${images.length} image${images.length===1?'':'s'}</small></div><span class="draft-status">${esc(d.published_listing_id?'published':d.status||'not generated')}</span></header>${texts.map(m=>`<div class="draft-message">${esc(m.message_text)}</div>`).join('')}${images.length?`<div class="draft-images">${images.map(m=>`<img src="${esc(m.image_url)}" alt="Private submission image">`).join('')}</div>`:''}<div class="draft-actions"><button class="generate" ${aiEnabled&&!d.published_listing_id?'':'disabled'}>${d.id?'Regenerate AI Draft':'Generate AI Draft'}</button>${splitable?'<button class="split-button">Split Submission</button>':''}</div>${d.id?`<div class="draft-fields">${DRAFT_FIELDS.map(k=>`<label>${esc(k)}<input data-field="${esc(k)}" value="${esc(facts[k]??'')}" ${d.published_listing_id?'disabled':''}></label>`).join('')}</div><textarea class="draft-copy" aria-label="Chinese marketing copy" ${d.published_listing_id?'disabled':''}>${esc(d.marketing_copy||'')}</textarea><div class="draft-actions"><button class="approve" ${d.published_listing_id?'disabled':''}>Approve</button><button class="reject" ${d.published_listing_id?'disabled':''}>Reject</button>${d.status==='approved'?`<button class="publish primary" ${d.published_listing_id?'disabled':''}>${d.published_listing_id?'Published':'Publish Listing'}</button>`:''}</div>`:''}</article>`}).join(''):'<div class="empty">No WhatsApp submissions yet.</div>';$$('.merge-select').forEach(b=>b.onchange=()=>{const id=b.closest('.draft-card').dataset.submission;b.checked?selectedDraftSubmissions.add(id):selectedDraftSubmissions.delete(id);updateDraftMergeControls()});$$('.draft-card .generate').forEach(b=>b.onclick=()=>generateDraft(b));$$('.draft-card .split-button').forEach(b=>b.onclick=()=>openSplitSubmission(b));$$('.draft-card .approve').forEach(b=>b.onclick=()=>reviewDraft(b,'approved'));$$('.draft-card .reject').forEach(b=>b.onclick=()=>reviewDraft(b,'rejected'));$$('.draft-card .publish').forEach(b=>b.onclick=()=>publishDraft(b));updateDraftMergeControls()}
function closeSplitSubmission(){splitSubmission=null;splitOperationId=null;$('#splitSubmissionDialog').close()}
function openSplitSubmission(button){splitSubmission=draftSubmissions.find(s=>s.id===button.closest('.draft-card').dataset.submission);splitOperationId=crypto.randomUUID();$('#splitSubmissionError').textContent='';$('#confirmSplitSubmission').disabled=false;$('#confirmSplitSubmission').textContent='Review split';$('#splitSubmissionItems').innerHTML=splitSubmission.messages.map((m,i)=>`<label class="split-item"><input type="checkbox" value="${Number(m.id)}"><span><time>${esc(new Date(m.message_timestamp).toLocaleString())} · ${esc(m.message_type||'message')}</time>${m.message_text?`<p>${esc(m.message_text)}</p>`:''}${m.image_url?`<img src="${esc(m.image_url)}" alt="Private submission image ${i+1}" loading="lazy">`:(!m.message_text?'<p>Preview unavailable</p>':'')}</span></label>`).join('');$('#splitSubmissionDialog').showModal()}
$('#closeSplitSubmissionDialog').onclick=$('#cancelSplitSubmission').onclick=closeSplitSubmission;
$('#splitSubmissionForm').onsubmit=async e=>{e.preventDefault();const selected=[...$('#splitSubmissionItems').querySelectorAll('input:checked')].map(x=>Number(x.value)),total=splitSubmission?.messages.length||0,error=$('#splitSubmissionError');if(!selected.length||selected.length>=total){error.textContent=!selected.length?'Select at least one item.':'Leave at least one item in the original submission.';return}if(!confirm(`Create a new submission with ${selected.length} selected item${selected.length===1?'':'s'}? The other ${total-selected.length} will remain in the original.`))return;const button=$('#confirmSplitSubmission');button.disabled=true;button.textContent='Splitting…';try{await adminApi(`/api/admin/listing-submissions/${encodeURIComponent(splitSubmission.id)}/split`,{method:'POST',body:JSON.stringify({message_ids:selected,operation_id:splitOperationId})});closeSplitSubmission();await loadDraftInbox();toast('Submission split')}catch(err){error.textContent=err.message;button.disabled=false;button.textContent='Review split'}};
async function loadDraftInbox(){if(!isAdmin)return;try{const data=await adminApi('/api/admin/listing-submissions');draftSubmissions=data.submissions||[];const eligible=new Set(draftSubmissions.filter(s=>!s.draft).map(s=>s.id));for(const id of selectedDraftSubmissions)if(!eligible.has(id))selectedDraftSubmissions.delete(id);renderDraftInbox(data.ai_enabled)}catch(e){$('#draftInbox').innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
async function mergeDraftSubmissions(){const ids=[...selectedDraftSubmissions];if(ids.length<2||!confirm(`Merge ${ids.length} submissions? All messages and images will be moved into the first selected submission.`))return;const button=$('#mergeDraftSubmissions');button.disabled=true;button.textContent='Merging…';try{await adminApi('/api/admin/listing-submissions/merge',{method:'POST',body:JSON.stringify({submission_ids:ids})});selectedDraftSubmissions.clear();await loadDraftInbox();toast('Submissions merged')}catch(e){button.disabled=false;toast(e.message)}finally{button.textContent='Merge Submissions';updateDraftMergeControls()}}
async function generateDraft(button){const card=button.closest('.draft-card'),submission=draftSubmissions.find(x=>x.id===card.dataset.submission),regenerate=Boolean(submission?.draft);if(regenerate&&!confirm('Regenerate this draft? This may incur another AI charge.'))return;button.disabled=true;button.textContent='Generating…';try{await adminApi(`/api/admin/listing-submissions/${encodeURIComponent(card.dataset.submission)}/generate`,{method:'POST',body:JSON.stringify({regenerate})});await loadDraftInbox();toast('Draft ready for review')}catch(e){button.disabled=false;button.textContent=regenerate?'Regenerate AI Draft':'Generate AI Draft';toast(e.message)}}
async function reviewDraft(button,status){const card=button.closest('.draft-card'),submission=draftSubmissions.find(x=>x.id===card.dataset.submission),structured_data={};card.querySelectorAll('[data-field]').forEach(input=>{const v=input.value.trim();structured_data[input.dataset.field]=v===''?null:(['leaseYears','leaseExpiry','price','landSize','builtUp','carParks'].includes(input.dataset.field)&&!Number.isNaN(Number(v))?Number(v):v)});structured_data.missingFields=DRAFT_FIELDS.filter(k=>structured_data[k]===null);try{await adminApi(`/api/admin/listing-submission-drafts/${encodeURIComponent(submission.draft.id)}`,{method:'PATCH',body:JSON.stringify({structured_data,marketing_copy:card.querySelector('.draft-copy').value,status})});await loadDraftInbox();toast(status==='approved'?'Draft approved — not published':'Draft rejected')}catch(e){toast(e.message)}}
async function publishDraft(button){const card=button.closest('.draft-card'),submission=draftSubmissions.find(x=>x.id===card.dataset.submission);if(!submission?.draft||!confirm('Publish this approved draft and its stored images to the property website?'))return;button.disabled=true;button.textContent='Publishing…';try{const result=await adminApi(`/api/admin/listing-submission-drafts/${encodeURIComponent(submission.draft.id)}/publish`,{method:'POST',body:'{}'});await Promise.all([loadDraftInbox(),loadCloud()]);toast(result.duplicate?'Listing was already published':'Listing published')}catch(e){button.disabled=false;button.textContent='Publish Listing';toast(e.message)}}
$('#refreshDraftInbox').onclick=loadDraftInbox;
$('#mergeDraftSubmissions').onclick=mergeDraftSubmissions;
async function verifyMembership(s){
 const member=await sbJson('/rest/v1/rpc/get_workspace_membership',{method:'POST',token:s.access_token,body:'{}'});
 if(member?.status!=='active')throw Error(member?.status==='suspended'?'Your access has been suspended. Contact Tong Xen.':'This workspace is invitation only. Contact Tong Xen for access.');
 return member;
}
function lockWorkspace(message){
 clearTimeout(syncTimer);session=null;isAdmin=false;adminAgents=[];selectedListings.clear();
 db={updatedAt:0,leads:[],listings:[],cases:[]};authStore.set(null);
 $$('dialog[open]').forEach(el=>el.close());
 $('#adminBtn').classList.add('hidden');$('#adminAgentList').innerHTML='';$('#adminSummary').innerHTML='';
 $('#draftInbox').innerHTML='';$('#apiKeyValue').textContent='';$('#apiKeyReveal').classList.add('hidden');
 $('#memberProfileForm').reset();$('#copyOutput').textContent='';$('#copyOutputWrap').classList.add('hidden');$('#userLabel').textContent='';$('#authScreen').classList.remove('ready');$('#authMessage').textContent=message;
 render();go('dashboard');
}
async function enterApp(s){
 const member=await verifyMembership(s);
 session=s;isAdmin=member.role==='admin';KEY=`agentDaily.v2.${s.user.id}`;
 db=JSON.parse(localStorage.getItem(KEY)||'null')||{updatedAt:0,leads:[],listings:[],cases:[]};
 db.cases||=[];db.leads||=[];db.listings||=[];
 $('#userLabel').textContent=s.user.user_metadata?.name||s.user.email.split('@')[0];
 $('#dashboard .hero h2').textContent=`Welcome, ${s.user.user_metadata?.name||s.user.email.split('@')[0]}.`;
 fillMemberProfile();$('#authScreen').classList.add('ready');render();await Promise.all([loadCloud(),loadAdmin()]);await claimImport();
}
let membershipCheckRunning=false;
async function recheckMembership(){
 if(!session||membershipCheckRunning)return;membershipCheckRunning=true;const current=session;
 try{await verifyMembership(current)}catch(e){if(session?.user.id===current.user.id)lockWorkspace(e.message)}
 finally{membershipCheckRunning=false}
}
setInterval(recheckMembership,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void recheckMembership()});
$('#authForm').onsubmit=async e=>{e.preventDefault();const msg=$('#authMessage');msg.textContent='Logging in…';try{await enterApp(await signIn($('#authEmail').value.trim(),$('#authPassword').value));msg.textContent=''}catch(err){msg.textContent=err.message}}

let pendingInviteSession=null;
async function handleInvite(){
 try{
  pendingInviteSession=await inviteSessionFromUrl();if(!pendingInviteSession)return false;
  $$('#authForm>label,#loginBtn,#authForm>p:not(#authMessage)').forEach(x=>x.classList.add('hidden'));
  $('#invitePasswordPanel').classList.remove('hidden');$('#authMessage').textContent='Invitation verified. Choose your password.';
  return true;
 }catch(err){$('#authMessage').textContent=err.message;return false}
}
$('#setInvitePasswordBtn').onclick=async()=>{
 const password=$('#invitePassword').value,msg=$('#authMessage');if(password.length<6)return msg.textContent='Password must be at least 6 characters.';
 msg.textContent='Activating account…';
 try{await setAccountPassword(pendingInviteSession,password);await enterApp(pendingInviteSession);toast('Account activated')}catch(err){msg.textContent=err.message}
};
$('#logoutBtn').onclick=async()=>{await signOut();location.reload()};
fillListingOptions();$('#todayLabel').textContent=new Intl.DateTimeFormat('en-MY',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
(async()=>{try{if(!await handleInvite()){const s=await validSession();if(s)await enterApp(s)}}catch(e){lockWorkspace(e.message)}})();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').then(()=>navigator.serviceWorker.ready).then(importAndroidShare);

