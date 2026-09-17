(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CatalogFilters=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const selectedValues=select=>Array.from(select.options).filter(option=>option.selected&&option.value).map(option=>option.value);
  const toggleOption=(select,index)=>{const option=select.options[index];if(!option)return false;option.selected=!option.selected;return option.selected};
  const clearSelect=select=>Array.from(select.options).forEach(option=>{option.selected=false});
  const includesOrAll=(values,value)=>!values.length||values.includes(value);
  const matchesPrice=(ranges,price)=>!ranges.length||ranges.some(range=>{const [min,max]=range.split('-').map(Number);return Number(price)>=min&&Number(price)<=max});
  const filterListings=(listings,filters,accessors={})=>listings.filter(listing=>{
    const type=accessors.type?accessors.type(listing):listing.propertyType;
    const subtype=accessors.subtype?accessors.subtype(listing):listing.propertySubtype;
    const searchValues=[listing.location,accessors.searchType?accessors.searchType(listing):type,listing.tenure,listing.price,listing.deal];
    return (!filters.search||searchValues.some(value=>String(value||'').toLowerCase().includes(filters.search)))
      &&(!filters.deal.length||filters.deal.some(value=>String(listing.deal||'').toLowerCase().includes(value)))
      &&includesOrAll(filters.location,listing.location)
      &&(!filters.locationQuery||String(listing.location||'').toLowerCase().includes(filters.locationQuery))
      &&includesOrAll(filters.type,type)
      &&includesOrAll(filters.subtype,subtype)
      &&includesOrAll(filters.tenure,listing.tenure)
      &&matchesPrice(filters.price,listing.price);
  });
  return {selectedValues,toggleOption,clearSelect,filterListings};
});
