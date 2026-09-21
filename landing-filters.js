(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.LandingFilters=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const PROPERTY_SUBTYPES=['1 Storey','1.5 Storey','2 Storey','2.5 Storey','3 Storey','3.5 Storey','4 Storey','5 Storey','High-rise','Corner Lot','Not Applicable'];
  const PRICE_RANGES=[
    ['Below RM100k',0,100000],
    ...Array.from({length:9},(_,index)=>[`RM${index+1}00k–<RM${index+2===10?'1m':`${index+2}00k`}`,(index+1)*100000,(index+2)*100000]),
    ['RM1m–<RM1.5m',1000000,1500000],['RM1.5m–<RM2m',1500000,2000000],
    ['RM2m–<RM2.5m',2000000,2500000],['RM2.5m–<RM3m',2500000,3000000],
    ['RM3m and above',3000000,Infinity]
  ];
  const clean=value=>String(value??'').trim().replace(/\s+/g,' ');
  const key=value=>clean(value).toLowerCase();
  const normalizeType=value=>{const normalized=key(value);return normalized==='terrace'||normalized==='terrace house'?'Terrace House':clean(value)};
  const normalizeSubtype=value=>{const normalized=key(value);if(normalized==='single storey')return'1 Storey';if(normalized==='double storey')return'2 Storey';const match=PROPERTY_SUBTYPES.find(option=>key(option)===normalized);return match||clean(value)};
  const listingSubtype=item=>key(item?.lotType)==='corner lot'?'Corner Lot':normalizeSubtype(item?.propertySubtype||item?.subtype||item?.storeys||'');
  const normalizeTenure=value=>{const normalized=key(value);if(normalized==='freehold')return'Freehold';if(/^leasehold(?:\b|\s|[-/])/.test(normalized))return'Leasehold';return''};
  const validPrice=value=>{if(value===null||value===undefined||clean(value)==='')return null;const price=Number(value);return Number.isFinite(price)&&price>=0?price:null};
  const matchesPrice=(value,rangeIndex)=>{if(rangeIndex==='')return true;const price=validPrice(value),range=PRICE_RANGES[Number(rangeIndex)];return price!==null&&Boolean(range)&&price>=range[1]&&price<range[2]};
  const filterListings=(listings,filters)=>listings.filter(item=>{
    const query=key(filters.search),type=normalizeType(item.propertyType),subtype=listingSubtype(item),tenure=normalizeTenure(item.tenure);
    return (!query||[item.title,item.location,item.deal,type,subtype].some(value=>key(value).includes(query)))
      &&(!filters.location||item.location===filters.location)
      &&(!filters.type||type===filters.type)
      &&(!filters.subtype||subtype===filters.subtype)
      &&(!filters.tenure||tenure===filters.tenure)
      &&matchesPrice(item.price,filters.price);
  });
  return {PROPERTY_SUBTYPES,PRICE_RANGES,normalizeType,normalizeSubtype,listingSubtype,normalizeTenure,validPrice,matchesPrice,filterListings};
});
