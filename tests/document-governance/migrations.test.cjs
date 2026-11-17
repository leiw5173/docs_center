const {test}=require('node:test'),assert=require('node:assert/strict');
const {migrations}=require('../../scripts/document-governance/migrations.cjs');
const {migrationMarkdown}=require('../../scripts/document-governance/check-report.cjs');
const scope=docs=>({repoId:'a',language:'zh',commit:'a'.repeat(40),documents:docs.map(([path,sha256])=>({path,sha256,title:path}))});
test('exact directory moves generate aliases automatically and flatten previous migrations to the latest path',()=>{
  const old=scope([['zh/guide/index.md','intro'],['zh/guide/steps.md','steps']]);
  const next=scope([['zh/new/index.md','intro'],['zh/new/steps.md','steps']]);
  const previous={scopes:[old],redirects:{'a/zh/original.md':'a/zh/guide/steps.md'}};
  const result=migrations([next],previous,{},{});
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.redirects,{'a/zh/original.md':'a/zh/new/steps.md','a/zh/guide/index.md':'a/zh/new/index.md','a/zh/guide/steps.md':'a/zh/new/steps.md'});
});
test('ambiguous copies and unmatched deletions block instead of silently choosing a destination',()=>{
  const old=scope([['zh/old.md','same'],['zh/deleted.md','deleted']]),next=scope([['zh/one.md','same'],['zh/two.md','same']]);
  const result=migrations([next],{scopes:[old]}, {},{});
  assert.equal(result.errors.filter(e=>e.code==='address-migration-required').length,2);assert.deepEqual(result.redirects,{});
  const fixed=migrations([next],{scopes:[old]},{'a/zh/old.md':'a/zh/one.md','a/zh/deleted.md':'a/zh/two.md'},{});
  assert.deepEqual(fixed.errors,[]);
});
test('redirect cycles, live source aliases, and missing destinations cannot be published',()=>{
  const current=scope([['zh/live.md','x']]);
  for(const redirects of [{'a/zh/one.md':'a/zh/two.md','a/zh/two.md':'a/zh/one.md'},{'a/zh/live.md':'a/zh/live.md'},{'a/zh/old.md':'a/zh/missing.md'}])
    assert(migrations([current],null,redirects,{}).errors.some(e=>e.code==='redirect'));
});
test('PR shows migration table and provides prefilled target choices only when manual resolution is needed',()=>{
  const previous={scopes:[scope([['zh/old.md','old']])]},next=scope([['zh/new.md','new']]);
  const result={manifest:{language:'zh',scopes:[next],redirects:{}},previous,errors:[],warnings:[]};
  const body=migrationMarkdown(result,'leiw5173/docs_center');
  assert(body.includes('阻断发布'));assert(body.includes('已填好'));
  const link=body.match(/https:\/\/github.com\/[^)]+/)[0],params=new URL(link).searchParams;
  assert.equal(params.get('target'),'a/zh/old.md');assert.equal(params.get('content'),'a/zh/new.md');assert.equal(params.get('operation'),'地址迁移');
  result.manifest.redirects['a/zh/old.md']='a/zh/new.md';
  const automatic=migrationMarkdown(result,'leiw5173/docs_center');assert(automatic.includes('发布后自动跳转'));assert(!automatic.includes('issues/new'));
});
