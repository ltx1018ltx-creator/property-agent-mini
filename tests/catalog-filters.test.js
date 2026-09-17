const test=require('node:test');
const assert=require('node:assert/strict');
const {selectedValues,toggleOption,clearSelect,filterListings}=require('../catalog-filters.js');

const select=(...values)=>({options:values.map(value=>({value,selected:false}))});
const filters=overrides=>Object.assign({search:'',deal:[],location:[],locationQuery:'',type:[],subtype:[],tenure:[],price:[]},overrides);

test('selects and deselects an option while exposing its selected value',()=>{
  const element=select('Freehold','Leasehold');
  assert.equal(toggleOption(element,'Freehold'),true);
  assert.deepEqual(selectedValues(element),['Freehold']);
  assert.equal(toggleOption(element,'Freehold'),false);
  assert.deepEqual(selectedValues(element),[]);
});

test('supports multiple selections and Any clears its filter group',()=>{
  const element=select('Ayer Keroh','Bachang','Klebang');
  toggleOption(element,'Ayer Keroh');toggleOption(element,'Klebang');
  assert.deepEqual(selectedValues(element),['Ayer Keroh','Klebang']);
  clearSelect(element);
  assert.deepEqual(selectedValues(element),[]);
});

test('combines filter groups and allows multiple values within a group',()=>{
  const listings=[
    {id:1,location:'Ayer Keroh',propertyType:'Condominium',propertySubtype:'High-rise',tenure:'Freehold',deal:'For Sale',price:350000},
    {id:2,location:'Bachang',propertyType:'Terrace House',propertySubtype:'2 Storey',tenure:'Freehold',deal:'For Sale',price:450000},
    {id:3,location:'Klebang',propertyType:'Terrace House',propertySubtype:'2 Storey',tenure:'Leasehold',deal:'For Rent',price:1800}
  ];
  const result=filterListings(listings,filters({location:['Ayer Keroh','Bachang'],tenure:['Freehold'],price:['300001-500000']}));
  assert.deepEqual(result.map(listing=>listing.id),[1,2]);
  assert.deepEqual(filterListings(listings,filters({location:['Bachang'],type:['Terrace House'],tenure:['Freehold']})).map(listing=>listing.id),[2]);
});
