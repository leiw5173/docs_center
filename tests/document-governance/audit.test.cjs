const {test} = require('node:test');
const assert = require('node:assert/strict');
const {comparePublished, documents} = require('../../scripts/document-governance/audit.cjs');
const {reconcile} = require('../../scripts/document-governance/audit-issues.cjs');

test('published inventory spots removed addresses, dependent documents and version changes', () => {
  const previous = [
    {language:'zh',path:'old.md',version:'1',references:[]},
    {language:'zh',path:'page.md',version:'1',references:[]}
  ];
  const current = [
    {language:'zh',path:'page.md',version:'2',references:['zh:old.md']},
    {language:'en',path:'other.md',version:'1',references:['zh:page.md']}
  ];
  const found = [];
  comparePublished(previous,current,(category,doc,code,message) => found.push({category,doc,code,message}));
  assert(found.some(item => item.category === 'addresses' && item.doc.path === 'old.md'));
  assert(found.some(item => item.category === 'versions' && item.doc.path === 'page.md'));
  assert(found.some(item => item.category === 'references' && item.message.includes('间接引用：en:other.md')));
  assert.equal(documents([{isDirectory:true,children:[{docName:'guide.md',path:'a/guide.md'},{docName:'image.png',path:'a/image.png'}]}],'zh').length,1);
});

test('repeat findings do not duplicate issues and changed findings update the existing issue', async () => {
  const state = [], changes = [];
  const api = async (path,method,body) => {
    if (!method) return state;
    changes.push(method);
    if (method === 'POST') {
      const issue = {...body,number:1,html_url:'https://example.com/issues/1',user:{login:'github-actions[bot]'}};
      state.push(issue);
      return issue;
    }
    assert(path.endsWith('/1'));
    return Object.assign(state[0],body);
  };
  const found = [{category:'content',language:'zh',path:'a/guide.md',message:'概述为空',line:11}];
  const run = (findings, id = 1) => reconcile(api,'sample/docs','https://github.com/sample/docs/actions/runs/'+id,findings);
  await run(found);
  await run(found,2);
  await run([{...found[0],message:'安装步骤为空'}],3);
  await run([],4);
  assert.deepEqual(changes,['POST','PATCH']);
  assert(state[0].body.includes('第 11 行'));
  assert(state[0].body.includes('安装步骤为空'));
});
