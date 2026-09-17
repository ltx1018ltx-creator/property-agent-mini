const test=require('node:test');
const assert=require('node:assert/strict');
const {activateChip,selectedValues,filterListings}=require('../catalog-filters.js');

const option=(textContent,value=textContent)=>({textContent,value,selected:false});
const select=(...options)=>({options});
const chip=(option)=>({textContent:option.textContent,dataset:{value:option.value}});
const filters=overrides=>Object.assign({search:'',deal:[],location:[],locationQuery:'',type:[],subtype:[],tenure:[],price:[]},overrides);

test('DOM chip values map to the real select values, including labels that differ',()=>{
  const controls={
    deal:select(option('For Sale','sale')),
    location:select(option("Ayer Pa'abas")),
    type:select(option('Semi-D / Cluster House')),
    subtype:select(option('2 Storey')),
    price:select(option('700k','600001-700000')),
    tenure:select(option('Freehold'))
  };

  for(const control of Object.values(controls))activateChip(control,chip(control.options[0]));
  assert.deepEqual(selectedValues(controls.location),["Ayer Pa'abas"]);
  assert.deepEqual(selectedValues(controls.type),['Semi-D / Cluster House']);
  assert.deepEqual(selectedValues(controls.subtype),['2 Storey']);
  assert.deepEqual(selectedValues(controls.price),['600001-700000']);
  assert.deepEqual(selectedValues(controls.tenure),['Freehold']);

  const listings=[
    {id:1,location:"Ayer Pa'abas",propertyType:'Semi-D / Cluster House',propertySubtype:'2 Storey',tenure:'Freehold',deal:'For Sale',price:700000},
    {id:2,location:'Ayer Keroh',propertyType:'Terrace House',propertySubtype:'1 Storey',tenure:'Leasehold',deal:'For Sale',price:650000}
  ];
  const active=Object.fromEntries(Object.entries(controls).map(([key,control])=>[key,selectedValues(control)]));
  assert.deepEqual(filterListings(listings,filters(active)).map(({id})=>id),[1]);

  for(const control of Object.values(controls))activateChip(control,{dataset:{clearFilter:'true'}});
  assert.equal(Object.values(controls).flatMap(selectedValues).length,0);
  assert.equal(filterListings(listings,filters({})).length,2);
});
