/* Independent photo-only draft: never saves stale property details. */
(() => {
 const dialog=document.createElement('dialog');
 dialog.id='listingPhotoEditor';dialog.setAttribute('aria-labelledby','photoEditorTitle');
 dialog.innerHTML=`<div class="photo-editor-shell"><header><h2 id="photoEditorTitle">Edit photos · 编辑照片</h2><button type="button" data-close aria-label="Close photo editor">×</button></header><p>新增照片会保留原图。可调整顺序或设为封面；按 Save 才会生效。</p><label class="photo-editor-upload">Add photos · 增加照片<input type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="photo-editor-status" role="status" aria-live="polite"></p><div class="photo-editor-grid"></div><footer><button type="button" data-undo>Undo last change · 撤销</button><button type="button" data-close>Cancel</button><button type="button" class="primary" data-save>Save photos · 保存照片</button></footer></div>`;
 document.body.append(dialog);
 const grid=dialog.querySelector('.photo-editor-grid'),status=dialog.querySelector('[role=status]'),input=dialog.querySelector('input');
 let current=null,photos=[],original=[],undo=[],dirty=false,busy=false,revision='',generation=0,manual=false;
 const validSource=s=>typeof s==='string'&&(/^(https?:\/\/)/.test(s)||/^data:image\/(jpeg|png|webp);base64,/i.test(s));
 const gallery=x=>Array.isArray(x.photos)?x.photos.filter(validSource):validSource(x.photo)?[x.photo]:[];
 const setBusy=value=>{busy=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('button,input').forEach(el=>el.disabled=value);if(!value)dialog.querySelector('[data-undo]').disabled=!undo.length;};
 function draw(){
  grid.replaceChildren();
  photos.forEach((src,index)=>{
   const card=document.createElement('div');card.className='photo-editor-card';
   const image=document.createElement('img');image.src=src;image.alt=`Property photo ${index+1}`;image.loading='lazy';image.decoding='async';card.append(image);
   const label=document.createElement('strong');label.textContent=index===0?'1 · Cover / 封面':String(index+1);card.append(label);
   const actions=document.createElement('div');actions.className='photo-editor-actions';
   const button=(text,action,disabled=false)=>{const el=document.createElement('button');el.type='button';el.textContent=text;el.disabled=disabled||busy;el.onclick=()=>{if(busy)return;undo.push({photos:[...photos],manual});action();dirty=true;draw();};actions.append(el);};
   button('← 前移',()=>{[photos[index-1],photos[index]]=[photos[index],photos[index-1]];manual=true;},index===0);
   button('后移 →',()=>{[photos[index+1],photos[index]]=[photos[index],photos[index+1]];manual=true;},index===photos.length-1);
   button('Set cover · 封面',()=>{photos.unshift(...photos.splice(index,1));manual=true;});
   button('Remove · 移除',()=>{photos.splice(index,1);manual=true;});
   card.append(actions);grid.append(card);
  });
  status.textContent=`${photos.length} photos${dirty?' · Unsaved changes / 尚未保存':''}`;
  dialog.querySelector('[data-undo]').disabled=!undo.length||busy;
 }
 function close(){if(busy)return;if(dirty&&!confirm('Discard unsaved photo changes? 放弃尚未保存的照片修改？'))return;generation++;dialog.close();}
 dialog.querySelectorAll('[data-close]').forEach(el=>el.onclick=close);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.querySelector('[data-undo]').onclick=()=>{if(busy||!undo.length)return;const previous=undo.pop();photos=previous.photos;manual=previous.manual;dirty=manual||JSON.stringify(photos)!==JSON.stringify(original);draw();};
 window.editListingPhotos=async id=>{
  const item=db.listings.find(x=>String(x.id)===String(id));
  if(!item||!canManageListing(item))return toast('Only the uploader can edit these photos');
  current=item;photos=[];original=[];undo=[];dirty=false;manual=false;input.value='';grid.replaceChildren();
  const run=++generation;dialog.showModal();setBusy(true);status.textContent='Loading current photos… 正在读取照片';
  try{
   const rows=await sbJson(`/rest/v1/team_listings?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(session.user.id)}&select=id,listing,updated_at`,{token:session.access_token,timeoutMs:20000});
   if(run!==generation)return;
   if(!rows?.length)throw Error('Listing not found or access denied');
   original=gallery(rows[0].listing);photos=[...original];revision=rows[0].updated_at;draw();
  }catch(error){status.textContent=error.message||'Unable to load photos';current=null;}
  finally{if(run===generation){setBusy(false);dialog.querySelector('[data-save]').disabled=!current;input.disabled=!current;}}
 };
 input.onchange=async()=>{
  const files=[...input.files];input.value='';if(!files.length||busy||!current)return;
  if(files.length>10)return status.textContent='Please add up to 10 photos at a time · 每次最多增加 10 张';
  if(photos.length+files.length>Math.max(40,original.length))return status.textContent='Maximum 40 photos · 最多 40 张';
  setBusy(true);status.textContent='Preparing photos… 正在处理照片';
  try{
   const added=[];for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Please use JPEG, PNG or WebP photos');added.push(await compressPhoto(file));}
   undo.push({photos:[...photos],manual});photos.push(...added);dirty=true;draw();
  }catch(error){status.textContent=error.message||'Unable to prepare photos';}
  finally{setBusy(false);}
 };
 dialog.querySelector('[data-save]').onclick=async()=>{
  if(busy||!current)return;if(!dirty){dialog.close();return;}
  if(!photos.length&&!confirm('Remove all photos from this listing? Originals remain in cloud storage. 确定移除全部照片？'))return;
  setBusy(true);status.textContent='Saving photos… 正在保存照片';
  const id=current.id,user=session?.user.id;
  try{
   // Upload only new data images, in bounded batches; keep existing URLs intact.
   const pending=photos.map((src,index)=>({src,index})).filter(x=>x.src.startsWith('data:'));
   for(let offset=0;offset<pending.length;offset+=10){
    const batch=pending.slice(offset,offset+10);
    const response=await fetch('/api/listing-images',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({photos:batch.map(x=>x.src)}),signal:AbortSignal.timeout(120000)});
    const result=await response.json();if(!response.ok||!Array.isArray(result.photos)||result.photos.length!==batch.length||!result.photos.every(validSource))throw Error(result.error||'Photo upload failed. Please retry.');
    batch.forEach((item,i)=>photos[item.index]=result.photos[i]);
   }
   const changes={photos,shareId:''};if(manual){changes.coverMode='manual';changes.coverIndex=0;}
   const row=await sbJson('/rest/v1/rpc/update_listing_photos',{method:'POST',token:session.access_token,timeoutMs:30000,body:JSON.stringify({listing_id:id,expected_revision:revision,changes})});
   if(session?.user.id!==user)throw Error('Account changed. Reopen the listing to check saved photos.');
   const item=db.listings.find(x=>String(x.id)===String(id));if(item){Object.assign(item,changes);delete item.photo;}
   revision=row.updated_at;dirty=false;undo=[];original=[...photos];cacheLocal();render();dialog.close();toast('Photos saved · 照片已保存');
  }catch(error){status.textContent=error.message||'Unable to save photos. Your changes are kept here.';}
  finally{setBusy(false);}
 };
})();
