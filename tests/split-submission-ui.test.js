const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');

test('split control is limited to draft-free submissions with at least two items',()=>{
  assert.match(app,/splitable=selectable&&s\.messages\.length>=2/);
  assert.match(app,/Split Submission/);
});

test('split dialog validates both sides and requires confirmation',()=>{
  assert.match(html,/id="splitSubmissionDialog"/);
  assert.match(app,/Select at least one item/);
  assert.match(app,/Leave at least one item in the original submission/);
  assert.match(app,/if\(!confirm\(`/);
  assert.match(app,/message_timestamp/);
});
