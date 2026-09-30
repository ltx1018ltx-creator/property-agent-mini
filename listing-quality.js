// Helpful, non-blocking completeness reminders. No new required fields.
(() => {
 const form=document.querySelector('#listingForm'),dialog=document.querySelector('#listingDialog');
 if(!form||!dialog)return;
 const note=document.createElement('p');note.id='listingQualityNote';note.className='disclaimer listing-quality-note';note.setAttribute('role','status');note.setAttribute('aria-live','polite');
 form.querySelector('.photo-upload').before(note);
 const value=name=>String(form.elements.namedItem(name)?.value||'').trim();
 const missing=name=>!value(name)||/^(n\/a|not specified|0)$/i.test(value(name));
 function update(){
  const gaps=[];
  if(missing('landSize')&&missing('builtUp'))gaps.push('Size · 面积');
  if(/condo|landed|terrace house|semi-d \/ cluster house|bungalow|townhouse|apartment|flat|serviced residence/i.test(value('propertyType'))){if(missing('bedrooms'))gaps.push('Bedrooms · 房间');if(missing('bathrooms'))gaps.push('Bathrooms · 浴室')}
  note.hidden=!gaps.length;note.textContent=gaps.length?'Optional details to improve your listing: '+gaps.join(', ')+'. You can still save · 可先保存，之后再补齐。':'';
 }
 form.addEventListener('input',update);form.addEventListener('change',update);
 new MutationObserver(()=>{if(dialog.open)update()}).observe(dialog,{attributes:true,attributeFilter:['open']});
})();

