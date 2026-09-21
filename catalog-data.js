(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CatalogData=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const text=value=>typeof value==='string'?value.trim():value==null?'':String(value).trim();
  const image=value=>{
    if(typeof value!=='string')return '';
    const candidate=value.trim();
    if(/^https:\/\/[^\s]+$/i.test(candidate))return candidate;
    if(/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(candidate))return candidate;
    return '';
  };
  const images=listing=>{
    const candidates=Array.isArray(listing.photos)?listing.photos:[listing.photos];
    if(listing.cover!=null)candidates.unshift(listing.cover);
    if(listing.photo!=null)candidates.push(listing.photo);
    return [...new Set(candidates.map(image).filter(Boolean))];
  };
  const normalizeListing=(value,metadata={})=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const id=text(metadata.id??value.id);
    if(!id)return null;
    const normalized={id,_createdAt:text(metadata.created_at??value._createdAt),photos:images(value)};
    const stringFields=['title','location','propertyType','propertySubtype','subtype','storeys','lotType','deal','tenure','landSize','builtUp','carParks','furnishing','renovation'];
    stringFields.forEach(key=>{normalized[key]=text(value[key])});
    ['price','bedrooms','bathrooms'].forEach(key=>{
      const number=Number(value[key]);
      normalized[key]=Number.isFinite(number)&&number>=0?number:null;
    });
    return normalized;
  };
  const normalizeCatalogRows=(rows,onInvalid=()=>{})=>{
    if(!Array.isArray(rows))return [];
    const listings=[];
    rows.forEach(row=>{
      const validRow=row&&typeof row==='object'&&!Array.isArray(row);
      const value=validRow&&row.listing&&typeof row.listing==='object'&&!Array.isArray(row.listing)
        ?row.listing
        :validRow&&!Object.prototype.hasOwnProperty.call(row,'listing')?row:null;
      const listing=normalizeListing(value,{id:row?.id,created_at:row?.created_at});
      if(listing)listings.push(listing);else onInvalid('invalid_listing');
    });
    return listings;
  };
  return {image,images,normalizeListing,normalizeCatalogRows};
});
