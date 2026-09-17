const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

class FakeClassList{
  constructor(){this.values=new Set()}
  toggle(name,on){if(on)this.values.add(name);else this.values.delete(name)}
  contains(name){return this.values.has(name)}
}

class FakeElement{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.classList=new FakeClassList();this.attributes={};this._innerHTML=''}
  append(...children){this.children.push(...children)}
  setAttribute(name,value){this.attributes[name]=value}
  set innerHTML(value){this._innerHTML=value;if(value==='')this.children=[];if(this.tagName==='summary')this.badge={textContent:'Any'}}
  get innerHTML(){return this._innerHTML}
  querySelector(selector){return selector==='b'?this.badge:null}
}

const option=(textContent,value=textContent)=>({textContent,value,selected:false});
const makeSelect=(...options)=>{
  const label={childNodes:[{textContent:'Filter '}],replaceWith(group){this.group=group}};
  const el=new FakeElement('select');
  el.options=options;
  el.multiple=true;
  el.closest=selector=>selector==='label'?label:null;
  Object.defineProperty(el,'selectedOptions',{get(){return this.options.filter(item=>item.selected)}});
  el.dispatchEvent=()=>{el.changeCount=(el.changeCount||0)+1};
  return {el,label};
};

function loadInternalListingFilterFunctions(){
  const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const start=app.indexOf('const selectedFilterValues=');
  const end=app.indexOf('const inSelected=',start);
  assert.notEqual(start,-1,'app.js must define its internal Listing filter helpers');
  assert.notEqual(end,-1);
  const context={document:{createElement:tag=>new FakeElement(tag)},Event:class Event{},esc:value=>String(value)};
  vm.runInNewContext(`${app.slice(start,end)};this.api={selectedFilterValues,enhanceListingFilter}`,context);
  return context.api;
}

test('internal Listing chips target live options after fillListingOptions-style replacement',()=>{
  const {selectedFilterValues,enhanceListingFilter}=loadInternalListingFilterFunctions();
  const cases=[
    ['Location',"Ayer Pa'abas",undefined],
    ['Property type','Semi-D / Cluster House',undefined],
    ['Subtype','2 Storey',undefined],
    ['Price','700k','600001-700000']
  ];
  const controls=[];

  for(const [name,text,value] of cases){
    const stale=option(`Old ${name}`,`old-${name}`);
    const {el,label}=makeSelect(stale);
    enhanceListingFilter(el);

    const live=option(text,value);
    el.options=[live]; // fillListingOptions replaces the select's option objects.
    enhanceListingFilter(el); // Its final enhancement pass must rebuild existing chips.

    assert.equal(label.group.children[1].children.length,1);
    const chip=label.group.children[1].children[0];
    assert.equal(chip.dataset.optionValue,live.value);
    chip.onclick();
    assert.equal(live.selected,true,`${name} should select its new live option`);
    assert.equal(stale.selected,false,`${name} must not mutate its detached option`);
    assert.deepEqual([...selectedFilterValues(el)],[live.value]);
    assert.equal(chip.classList.contains('active'),true);
    assert.equal(label.group.children[0].badge.textContent,'1 selected');
    controls.push(el);
  }

  assert.equal(controls.flatMap(selectedFilterValues).length,4,'combined filter badge count inputs remain intact');
});

test('internal Listing Tenure chips still select and clear without option replacement',()=>{
  const {selectedFilterValues,enhanceListingFilter}=loadInternalListingFilterFunctions();
  const {el,label}=makeSelect(option('Freehold'),option('Leasehold'));
  enhanceListingFilter(el);
  label.group.children[1].children[0].onclick();
  assert.deepEqual([...selectedFilterValues(el)],['Freehold']);

  el.options.forEach(item=>item.selected=false);
  el._syncFilterUI();
  assert.deepEqual([...selectedFilterValues(el)],[]);
  assert.equal(label.group.children[0].badge.textContent,'Any');
  assert.equal(label.group.classList.contains('has-selection'),false);
});
