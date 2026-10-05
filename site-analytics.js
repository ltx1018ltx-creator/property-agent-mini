(() => {
 const panel=document.querySelector('#siteAnalytics'),report=document.querySelector('#analyticsReport'),status=document.querySelector('#analyticsStatus');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const count=value=>new Intl.NumberFormat('en-MY').format(Number(value)||0);
 let request=0;
 function breakdown(title,rows){return `<section class="analytics-breakdown"><h3>${title}</h3>${rows.length?rows.map(row=>`<p><span>${escape(row.label)}</span><strong>${count(row.visits)}</strong></p>`).join(''):'<p>No visits recorded yet.</p>'}</section>`}
 const pct=(part,total)=>total?`${(100*part/total).toFixed(1)}%`:'—';
 const budget=(min,max,purpose)=>`${purpose==='rent'?'Rent / month':'Buy'} · ${min==null&&max==null?'Any budget':min!=null&&max==null?'RM '+count(min)+'+':min==null?'Up to RM '+count(max):'RM '+count(min)+' – '+count(max)}`;
 function criteriaText(c){return [c.areas?.join(' / ')||'Any location',c.type||'Any type',budget(c.min_price,c.max_price,c.purpose),c.bedrooms?c.bedrooms+'+ beds':'',c.min_size!=null||c.max_size!=null?`Size ${c.min_size??0} – ${c.max_size??'any'} sqft`:'',c.tenure,c.furnishing].filter(Boolean).join(' · ')}
 function propertyRows(rows,sort='views'){
  return [...rows].sort((a,b)=>(Number(b[sort])-Number(a[sort]))||b.views-a.views||a.property_id.localeCompare(b.property_id)).map(row=>`<tr><td><a target="_blank" rel="noopener noreferrer" href="https://mari-property-melaka.txleong1998596286.chatgpt.site/?analytics=off&property=${encodeURIComponent(row.property_id)}">${escape(row.title||row.property_id)}</a></td><td>${count(row.views)}</td><td>${count(row.shortlists)}</td><td>${count(row.contacts)}</td><td>${count(row.converted)} / ${count(row.views)}<small>${row.views>=10?pct(row.converted,row.views):'样本不足 · Under 10 visits'}</small></td><td>${count(row.photo_errors)}</td></tr>`).join('');
 }
 function renderInsights(data){
  const s=data.summary,notes=[];
  if(s.visits<10)notes.push('目前访问样本不足 10 次，先累积数据再判断哪一步需要改善。');
  else {
   if(s.details/s.visits<.3)notes.push(`${count(s.visits-s.details)} 次访问没有打开房源详情。可先检查首页房源封面、价格与筛选入口是否清楚；这只是待验证方向。`);
   if(s.details>=10&&s.after_detail/s.details<.1)notes.push('看详情后的联系点击比例低于 10%。可检查照片、资料完整度、价格和看房邀请；不能仅凭点击判断原因。');
  }
  if(s.zero_results)notes.push(`${count(s.zero_results)} 次访问遇到无结果筛选。查看下方组合，检查缺少的房源或地区归类。`);
  if(s.photo_errors)notes.push(`${count(s.photo_errors)} 次访问遇到照片加载失败。按“Photo errors”排序检查；网络问题也可能造成失败。`);
  if(!notes.length)notes.push('暂时没有达到提示条件的问题。继续比较房源表现与推广来源，并结合实际咨询判断。');
  const stages=[['进入网站 · Visits',s.visits,s.visits],['打开详情 · Viewed details',s.details,s.visits],['看详情后联系 · Contact after detail',s.after_detail,s.details]];
  const demand=(dimension,title)=>breakdown(title,data.demand.filter(r=>r.dimension===dimension).map(r=>({...r,label:dimension==='budget'?(()=>{const[p,min,max]=r.label.split('|');return budget(min===''?null:Number(min),max===''?null:Number(max),p)})():dimension==='purpose'?(r.label==='sale'?'Buy · 买房':'Rent · 租房'):r.label})));
  return `<section class="analytics-insights" aria-labelledby="insightsTitle"><h2 id="insightsTitle">网站表现与顾客需求 <span>Website insights</span></h2><p class="disclaimer">${data.started_at?'新指标开始于 '+escape(new Date(data.started_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))+' (MYT)。':'新指标等待更新后的首次访问。'} 本区按浏览会话去重，同一浏览器标签闲置 30 分钟后算新访问；不代表真实人数。旧记录仍在下方。</p>
   <div class="analytics-funnel">${stages.map(([label,value,base],i)=>`<div><span>${label}</span><strong>${count(value)}</strong><progress value="${Number(value)}" max="${Math.max(1,Number(s.visits))}" aria-label="${escape(label)}"></progress><small>${i===0?'本期记录的访问':pct(value,base)+' of previous stage · 上一步比例'}</small></div>`).join('')}</div>
   <p class="disclaimer">顾客可以跳过筛选或收藏，直接联系。全部 WhatsApp 联系意向：<strong>${count(s.contacts)} 次访问</strong>；未记录到先看详情：${count(s.contacts-s.after_detail)}。点击不代表消息已发送。</p>
   <div class="analytics-metrics">${[['用过筛选',s.filtered],['加入收藏',s.shortlisted],['遇到无结果',s.zero_results],['照片加载失败',s.photo_errors]].map(([label,value])=>`<div><span>${label} · 访问次数</span><strong>${count(value)}</strong></div>`).join('')}</div>
   <section class="analytics-next"><h3>现在值得检查什么</h3><ul>${notes.map(note=>`<li>${escape(note)}</li>`).join('')}</ul><p>提示阈值用于排查，不是行业标准，也不证明访客离开的原因。</p></section>
   <div class="analytics-section-head"><h3>房源表现 · Property performance</h3><label>Sort by <select id="insightsSort"><option value="views">Detail views</option><option value="contacts">WhatsApp interest</option><option value="shortlists">Shortlists</option><option value="photo_errors">Photo errors</option></select></label></div>
   <p class="disclaimer">每列按房源＋访问去重。多人房源询问在总联系次数算一次，并分别归入选中的房源，所以各房源联系数不能相加。联系比例只计算同次访问先看这间房源、再点击询问这间房源的情况。</p>
   ${data.properties.length?`<div class="analytics-table-wrap" tabindex="0" role="region" aria-label="Property performance table"><table class="insights-properties"><thead><tr><th scope="col">Property</th><th scope="col">Detail visits</th><th scope="col">Shortlisted</th><th scope="col">WhatsApp intent</th><th scope="col">After viewing / Views</th><th scope="col">Photo errors</th></tr></thead><tbody id="insightsPropertyRows">${propertyRows(data.properties)}</tbody></table></div>`:'<p class="analytics-empty">暂时没有新版本的房源互动，顾客浏览后会开始显示。</p>'}
   <h3>顾客在找什么 · Search demand</h3><p class="disclaimer">只统计实际使用筛选的访问。同一访问可以选择多个地区或预算，不能将这些数字相加当作人数。手动输入或新增地区汇总为 Other area，不储存输入原文。</p>
   <div class="analytics-breakdowns">${demand('area','热门地区 · Locations')}${demand('budget','预算 · Budgets')}${demand('type','房产类型 · Property types')}${demand('purpose','买房 / 租房 · Purpose')}</div>
   <h3>找不到房源的需求 · Unmatched searches</h3>${data.unmatched.length?`<div class="analytics-table-wrap" tabindex="0" role="region" aria-label="Unmatched searches"><table><thead><tr><th scope="col">Filters used</th><th scope="col">No-result visits</th><th scope="col">All visits using this combination</th></tr></thead><tbody>${data.unmatched.map(row=>`<tr><td>${escape(criteriaText(row.criteria))}</td><td>${count(row.zero_visits)}</td><td>${count(row.visits)}${row.visits<10?'<small>样本不足 · Under 10 visits</small>':''}</td></tr>`).join('')}</tbody></table></div>`:'<p>暂时没有记录到无结果筛选。</p>'}
   <p class="disclaimer">这些数据反映匿名需求，无法知道访客姓名或电话号码。真实客户身份仍来自顾客主动发出的 WhatsApp 咨询。</p></section>`;
 }
 async function load(){
  const current=++request,user=session?.user.id;report.innerHTML='';
  if(!session||!isAdmin){status.textContent='Owner sign-in required.';return}
  status.textContent='Loading website statistics…';
  try{
   const days=Number(document.querySelector('#analyticsDays').value);
   const [data,visits,campaigns,insights]=await Promise.all([
    sbJson('/rest/v1/rpc/get_site_analytics',{method:'POST',token:session.access_token,body:JSON.stringify({days})}),
    sbJson('/rest/v1/rpc/get_recent_site_visits',{method:'POST',token:session.access_token,body:JSON.stringify({days})}),
    sbJson('/rest/v1/rpc/get_site_campaigns',{method:'POST',token:session.access_token,body:JSON.stringify({days})}),
    sbJson('/rest/v1/rpc/get_site_insights',{method:'POST',token:session.access_token,body:JSON.stringify({days})}).catch(()=>null)
   ]);
   if(current!==request||session?.user.id!==user||!isAdmin)return;
   const max=Math.max(1,...data.daily.map(day=>Number(day.views)));
   report.innerHTML=`${insights?renderInsights(insights):'<p class="analytics-empty" role="alert">新指标暂时无法载入，请稍后刷新。下方旧统计仍可查看。</p>'}<details class="analytics-history"><summary>基础统计与历史记录 · Traffic & history</summary><div class="analytics-metrics">${[['Visits · 访问',data.sessions],['Page views · 打开网站',data.page_views],['Property views · 房源详情',data.listing_views],['WhatsApp clicks · 联系点击',data.whatsapp_clicks]].map(([label,value])=>`<div><span>${label}</span><strong>${count(value)}</strong></div>`).join('')}</div>
    ${data.sessions===0?'<p class="analytics-empty">No visits recorded in this period yet · 这段时间暂时没有记录。 Share your website link and check back later.</p>':''}
    <h3>Daily page views · 每日浏览趋势</h3><div class="analytics-chart" role="img" aria-label="Daily page views; exact values are available in the table below.">${data.daily.map(day=>`<div class="analytics-day" title="${escape(day.day)}: ${count(day.views)} views"><i style="height:${Math.max(1,Number(day.views)/max*100)}%"></i></div>`).join('')}</div>
    <div class="analytics-chart-labels"><span>${escape(data.daily[0]?.day)}</span><span>${escape(data.daily.at(-1)?.day)}</span></div>
    <details><summary>Daily figures · 每日数字</summary><div class="analytics-table-wrap"><table><thead><tr><th>Date</th><th>Page views</th><th>WhatsApp clicks</th></tr></thead><tbody>${data.daily.map(day=>`<tr><td>${escape(day.day)}</td><td>${count(day.views)}</td><td>${count(day.enquiries)}</td></tr>`).join('')}</tbody></table></div></details>
    <h3>Most-viewed properties · 热门房源</h3>${data.listings.length?`<div class="analytics-table-wrap"><table><thead><tr><th>Property</th><th>Views</th><th>WhatsApp</th></tr></thead><tbody>${data.listings.map(row=>`<tr><td><a target="_blank" rel="noopener noreferrer" href="https://mari-property-melaka.txleong1998596286.chatgpt.site/?analytics=off&property=${encodeURIComponent(row.listing_id)}">${escape(row.title||row.listing_id)}</a></td><td>${count(row.views)}</td><td>${count(row.enquiries)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No property interactions recorded yet.</p>'}
    <div class="analytics-breakdowns">${breakdown('Devices · 设备',data.devices)}${breakdown('Sources · 来源',data.sources)}</div>
    <h3>Campaigns · 推广效果</h3>
    ${campaigns.length?`<div class="analytics-table-wrap"><table><thead><tr><th>Campaign / Source</th><th>Visits</th><th>WhatsApp clicks</th></tr></thead><tbody>${campaigns.map(row=>`<tr><td>${escape(row.campaign)} · ${escape(row.source)}</td><td>${count(row.visits)}</td><td>${count(row.enquiries)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Share a tagged link below to compare your promotions.</p>'}
    <h3>Recent anonymous visits · 近期匿名访问</h3>
    ${visits.length?`<div class="analytics-table-wrap"><table><thead><tr><th>Last seen (MYT)</th><th>Device / Source</th><th>Property viewed</th><th>Pages</th><th>WhatsApp</th></tr></thead><tbody>${visits.map(visit=>`<tr><td>${escape(new Date(visit.last_seen).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))}</td><td>${escape(visit.device)} · ${escape(visit.source)}</td><td>${escape(visit.properties.join(', ')||'—')}</td><td>${count(visit.page_views)}</td><td>${count(visit.whatsapp_clicks)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No recent visits recorded.</p>'}
    <p class="disclaimer">These are browser visits, not identified people. No name, phone number, exact address or IP is collected. Sources may be imprecise: Direct includes untagged WhatsApp links and apps that hide the source. This historical property table excludes multi-property enquiries; the new performance table above includes them. · 历史房源表不包含多选询问，上方新房源表现表包含。</p></details>`;
   const sort=document.querySelector('#insightsSort');if(sort)sort.onchange=()=>{const rows=document.querySelector('#insightsPropertyRows');if(rows)rows.innerHTML=propertyRows(insights.properties,sort.value)};
   status.textContent='Updated '+new Date(data.generated_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})+' · Malaysia time'+(data.started_at?' · First recorded visit '+new Date(data.started_at).toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):' · Tracking starts after publication');
  }catch(error){if(current===request){report.innerHTML='';status.textContent='Statistics unavailable. Please refresh or sign in again. '+error.message}}
 }
 panel.addEventListener('toggle',()=>{if(panel.open)void load()});
 document.querySelector('#refreshAnalytics').onclick=load;document.querySelector('#analyticsDays').onchange=load;
 new MutationObserver(()=>{if(!document.querySelector('#authScreen').classList.contains('ready')){request++;report.innerHTML='';panel.open=false;status.textContent='Owner sign-in required.'}}).observe(document.querySelector('#authScreen'),{attributes:true,attributeFilter:['class']});

 const source=document.querySelector('#campaignSource'),name=document.querySelector('#campaignName'),link=document.querySelector('#campaignLink'),copyStatus=document.querySelector('#campaignCopyStatus');
 function campaignLink(){const slug=name.value.trim();const valid=/^[a-zA-Z0-9_-]{0,60}$/.test(slug);name.setCustomValidity(valid?'':'Use letters, numbers, hyphens or underscores (up to 60 characters).');if(!valid){link.value='';return}const url=new URL('https://mari-property-melaka.txleong1998596286.chatgpt.site/');url.searchParams.set('utm_source',source.value);url.searchParams.set('utm_medium',source.value==='whatsapp'?'message':'social');if(slug)url.searchParams.set('utm_campaign',slug);link.value=url.href;copyStatus.textContent=''}
 source.addEventListener('change',campaignLink);name.addEventListener('input',campaignLink);campaignLink();
 document.querySelector('#copyCampaignLink').onclick=async()=>{if(!link.value){name.reportValidity();return}try{await navigator.clipboard.writeText(link.value);copyStatus.textContent='Copied · 已复制'}catch{link.focus();link.select();copyStatus.textContent='Select and copy the link · 请手动复制'}};

})();
