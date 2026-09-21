const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {image,normalizeListing,normalizeCatalogRows}=require('../catalog-data.js');

test('public catalog query uses flattened fields instead of selecting listing JSON',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','catalog.js'),'utf8');
  assert.match(source,/const catalogSelect=\['id','created_at',\.\.\.catalogFields\]\.join\(','\)/);
  assert.doesNotMatch(source,/select=id,listing,created_at/);
});

test('normalizes current published records and public HTTPS photos',()=>{
  const [listing]=normalizeCatalogRows([{id:'new-1',created_at:'2026-09-18',listing:{title:'Home',location:'Bachang',price:'450000',photos:['https://cdn.example/home.jpg']}}]);
  assert.equal(listing.id,'new-1');
  assert.equal(listing.price,450000);
  assert.deepEqual(listing.photos,['https://cdn.example/home.jpg']);
});

test('normalizes the flattened public catalog response shape',()=>{
  const [listing]=normalizeCatalogRows([{
    id:'flat-1',created_at:'2026-09-21T10:00:00Z',title:'Flattened home',location:'Klebang',
    propertyType:'Terrace House',propertySubtype:'2 Storey',price:'525000',
    cover:'https://cdn.example/cover.jpg',photo:null
  }]);
  assert.deepEqual(listing,{
    id:'flat-1',_createdAt:'2026-09-21T10:00:00Z',photos:['https://cdn.example/cover.jpg'],
    title:'Flattened home',location:'Klebang',propertyType:'Terrace House',propertySubtype:'2 Storey',
    subtype:'',storeys:'',lotType:'',deal:'',tenure:'',landSize:'',builtUp:'',carParks:'',furnishing:'',renovation:'',
    price:525000,bedrooms:null,bathrooms:null
  });
});

test('supports legacy photo and data image records',()=>{
  const listing=normalizeListing({id:'legacy-1',photo:'data:image/jpeg;base64,YWJjZA==',storeys:'Double Storey'});
  assert.deepEqual(listing.photos,['data:image/jpeg;base64,YWJjZA==']);
  assert.equal(listing.storeys,'Double Storey');
});

test('turns nullable and missing fields into safe catalog values',()=>{
  const listing=normalizeListing({id:9,title:null,location:null,price:null,photos:null});
  assert.equal(listing.title,'');
  assert.equal(listing.location,'');
  assert.equal(listing.price,0);
  assert.deepEqual(listing.photos,[]);
});

test('drops malformed photos without dropping their listing',()=>{
  const listing=normalizeListing({id:'photos',photos:[null,{},'javascript:alert(1)','data:text/html;base64,YQ==','https://cdn.example/ok.webp']});
  assert.deepEqual(listing.photos,['https://cdn.example/ok.webp']);
  assert.equal(image('not a url'),'');
});

test('keeps valid listings in a mixed response and reports only invalid categories',()=>{
  const categories=[];
  const listings=normalizeCatalogRows([
    {id:'legacy',listing:{photo:'data:image/png;base64,YQ=='}},
    {id:'current',listing:{photos:['https://cdn.example/current.jpg']}},
    {id:'broken',listing:'not-an-object'},
    null,
    {listing:{title:'missing id'}}
  ],category=>categories.push(category));
  assert.deepEqual(listings.map(({id})=>id),['legacy','current']);
  assert.deepEqual(categories,['invalid_listing','invalid_listing','invalid_listing']);
});
