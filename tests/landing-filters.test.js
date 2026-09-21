const test=require('node:test');
const assert=require('node:assert/strict');
const {
  PROPERTY_SUBTYPES,PRICE_RANGES,normalizeType,listingSubtype,normalizeTenure,
  validPrice,matchesPrice,filterListings
}=require('../landing-filters.js');

const all={search:'',location:'',type:'',subtype:'',tenure:'',price:''};

test('deduplicates Terrace spelling, case, and whitespace without changing Terrace Factory',()=>{
  assert.equal(normalizeType('  terrace  '),'Terrace House');
  assert.equal(normalizeType(' TERRACE HOUSE '),'Terrace House');
  assert.equal(normalizeType('Terrace Factory'),'Terrace Factory');
  const rows=[
    {id:1,propertyType:'Terrace'},
    {id:2,propertyType:' terrace HOUSE '},
    {id:3,propertyType:'Terrace Factory'}
  ];
  assert.deepEqual(filterListings(rows,{...all,type:'Terrace House'}).map(x=>x.id),[1,2]);
});

test('uses the admin subtype taxonomy and legacy subtype normalization',()=>{
  assert.deepEqual(PROPERTY_SUBTYPES,['1 Storey','1.5 Storey','2 Storey','2.5 Storey','3 Storey','3.5 Storey','4 Storey','5 Storey','High-rise','Corner Lot','Not Applicable']);
  assert.equal(listingSubtype({storeys:'Single Storey'}),'1 Storey');
  assert.equal(listingSubtype({propertySubtype:'Double Storey'}),'2 Storey');
  assert.equal(listingSubtype({propertySubtype:'2 Storey',lotType:'corner lot'}),'Corner Lot');
});

test('normalizes only recognizable tenure values',()=>{
  assert.equal(normalizeTenure(' freehold '),'Freehold');
  assert.equal(normalizeTenure('LEASEHOLD until 2099'),'Leasehold');
  assert.equal(normalizeTenure('Leasehold - 99 years'),'Leasehold');
  assert.equal(normalizeTenure('Malay Reserve'),'');
});

test('price bands have inclusive lower and exclusive upper bounds',()=>{
  assert.equal(PRICE_RANGES.length,15);
  assert.equal(matchesPrice(99999,0),true);
  assert.equal(matchesPrice(100000,0),false);
  assert.equal(matchesPrice(100000,1),true);
  assert.equal(matchesPrice(999999,9),true);
  assert.equal(matchesPrice(1000000,9),false);
  assert.equal(matchesPrice(1000000,10),true);
  assert.equal(matchesPrice(3000000,13),false);
  assert.equal(matchesPrice(3000000,14),true);
  for(const value of [undefined,null,'','not a price',NaN])assert.equal(validPrice(value),null);
  assert.equal(filterListings([{price:null},{price:'bad'}],{...all,price:'0'}).length,0);
});

test('combines search, location, normalized type, subtype, tenure and price',()=>{
  const rows=[
    {id:1,title:'Garden home',location:'Melaka',propertyType:' terrace ',propertySubtype:'Double Storey',tenure:'Leasehold until 2099',price:450000},
    {id:2,title:'Garden home',location:'Melaka',propertyType:'Terrace House',propertySubtype:'2 Storey',tenure:'Freehold',price:450000},
    {id:3,title:'City home',location:'Melaka',propertyType:'Terrace House',propertySubtype:'2 Storey',tenure:'Leasehold',price:450000}
  ];
  const selected={search:'garden',location:'Melaka',type:'Terrace House',subtype:'2 Storey',tenure:'Leasehold',price:'4'};
  assert.deepEqual(filterListings(rows,selected).map(x=>x.id),[1]);
  assert.equal(filterListings(rows,all).length,3);
});
