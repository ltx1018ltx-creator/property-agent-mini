(() => {
 const panel=document.querySelector('#siteAnalytics'),report=document.querySelector('#analyticsReport'),status=document.querySelector('#analyticsStatus');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const count=value=>new Intl.NumberFormat('en-MY').format(Number(value)||0);
 let request=0;
 function breakdown(title,rows){return `<section class="analytics-breakdown"><h3>${title}</h3>${rows.length?rows.map(row=>`<p><span>${escape(row.label)}</span><strong>${count(row.visits)}</strong></p>`).join(''):'<p>No visits recorded yet.</p>'}</section>`}
 async function load(){
  const current=++request,user=session?.user.id;report.innerHTML='';
  if(!session||!isAdmin){status.textContent='Owner sign-in required.';return}
  status.textContent='Loading website statistics…';
  try{
   const data=await sbJson('/rest/v1/rpc/get_site_analytics',{method:'POST',token:session.access_token,body:JSON.stringify({days:Number(document.querySelector('#analyticsDays').value)})});
   if(current!==request||session?.user.id!==user||!isAdmin)return;
   const max=Math.max(1,...data.daily.map(day=>Number(day.views)));
   report.innerHTML=`<div class="analytics-metrics">${[['Visits · 访问',data.sessions],['Page views · 打开网站',data.page_views],['Property views · 房源详情',data.listing_views],['WhatsApp clicks · 联系点击',data.whatsapp_clicks]].map(([label,value])=>`<div><span>${label}</span><strong>${count(value)}</strong></div>`).join('')}</div>
    ${data.sessions===0?'<p class="analytics-empty">No visits recorded in this period yet · 这段时间暂时没有记录。 Share your website link and check back later.</p>':''}
    <h3>Daily page views · 每日浏览趋势</h3><div class="analytics-chart" role="img" aria-label="Daily page views; exact values are available in the table below.">${data.daily.map(day=>`<div class="analytics-day" title="${escape(day.day)}: ${count(day.views)} views"><i style="height:${Math.max(1,Number(day.views)/max*100)}%"></i></div>`).join('')}</div>
    <div class="analytics-chart-labels"><span>${escape(data.daily[0]?.day)}</span><span>${escape(data.daily.at(-1)?.day)}</span></div>
    <details><summary>Daily figures · 每日数字</summary><div class="analytics-table-wrap"><table><thead><tr><th>Date</th><th>Page views</th><th>WhatsApp clicks</th></tr></thead><tbody>${data.daily.map(day=>`<tr><td>${escape(day.day)}</td><td>${count(day.views)}</td><td>${count(day.enquiries)}</td></tr>`).join('')}</tbody></table></div></details>
    <h3>Most-viewed properties · 热门房源</h3>${data.listings.length?`<div class="analytics-table-wrap"><table><thead><tr><th>Property</th><th>Views</th><th>WhatsApp</th></tr></thead><tbody>${data.listings.map(row=>`<tr><td><a target="_blank" rel="noopener noreferrer" href="https://mari-property-melaka.txleong1998596286.chatgpt.site/?analytics=off&property=${encodeURIComponent(row.listing_id)}">${escape(row.title||row.listing_id)}</a></td><td>${count(row.views)}</td><td>${count(row.enquiries)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No property interactions recorded yet.</p>'}
    <div class="analytics-breakdowns">${breakdown('Devices · 设备',data.devices)}${breakdown('Sources · 来源',data.sources)}</div><p class="disclaimer">Direct includes links opened from WhatsApp or apps that hide the source. Multi-property enquiry clicks count once and are not assigned to individual listings.</p>`;
   status.textContent='Updated '+new Date(data.generated_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})+' · Malaysia time'+(data.started_at?' · First recorded visit '+new Date(data.started_at).toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):' · Tracking starts after publication');
  }catch(error){if(current===request){report.innerHTML='';status.textContent='Statistics unavailable. Please refresh or sign in again. '+error.message}}
 }
 panel.addEventListener('toggle',()=>{if(panel.open)void load()});
 document.querySelector('#refreshAnalytics').onclick=load;document.querySelector('#analyticsDays').onchange=load;
 new MutationObserver(()=>{if(!document.querySelector('#authScreen').classList.contains('ready')){request++;report.innerHTML='';panel.open=false;status.textContent='Owner sign-in required.'}}).observe(document.querySelector('#authScreen'),{attributes:true,attributeFilter:['class']});
})();
