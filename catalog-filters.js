(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CatalogFilters=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const selectedValues=select=>Array.from(select.options).filter(option=>option.selected&&option.value).map(option=>option.value);
  // Chips must carry the option value, rather than their display label or their
  // current position. Some labels (notably prices) deliberately differ from
  // their values, and indexes are brittle when options are populated at run time.
  const toggleOption=(select,value)=>{const option=Array.from(select.options).find(candidate=>candidate.value===value);if(!option)return false;option.selected=!option.selected;return option.selected};
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
  const activateChip=(select,chip)=>chip.dataset.clearFilter?(clearSelect(select),false):toggleOption(select,chip.dataset.value);
  return {selectedValues,toggleOption,clearSelect,activateChip,filterListings};
});
