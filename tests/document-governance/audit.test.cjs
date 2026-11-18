const {test} = require('node:test');
const assert = require('node:assert/strict');
const {comparePublished, documents, storageUrl} = require('../../scripts/document-governance/audit.cjs');
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

test('CDN paths encode literal plus signs without double-encoding existing escapes', () => {
  const base = 'https://cdn-resource.spacemit.com/courses/';
  assert.equal(storageUrl(base+'C++.md'),base+'C%2B%2B.md');
  assert.equal(storageUrl(base+'C%2B%2B.md#section'),base+'C%2B%2B.md');
});

test('read failures preserve diagnosis and strip CDN credentials from evidence', async () => {
  const {readText, failureDetails} = require('../../scripts/document-governance/audit.cjs');
  const url = 'https://cdn-resource.spacemit.com/C%2B%2B.md?signature=secret';
  await assert.rejects(readText(new Response('missing',{status:404}),1024), error => {
    assert.deepEqual(failureDetails(error,'读取 CDN 正文',url),{
      kind:'not-found',stage:'读取 CDN 正文',message:'服务器返回 HTTP 404。',status:404,
      checkedUrl:'https://cdn-resource.spacemit.com/C%2B%2B.md'
    });
    return true;
  });
  await assert.rejects(readText(new Response('page',{headers:{'content-type':'text/html'}}),1024),
    error => error.kind === 'unexpected-html');
  assert.equal(failureDetails(new DOMException('timed out','TimeoutError'),'读取官网目录',url).kind,'timeout');
});

test('CDN HEAD failures only become missing resource findings after GET confirms them', async () => {
  const {missingResource} = require('../../scripts/document-governance/audit.cjs');
  const url = 'https://cdn-resource.spacemit.com/C%2B%2B.png';
  for (const status of [206,403,404,410]) {
    const calls = [];
    const check = async (receivedUrl,method,headers) => {
      assert.equal(receivedUrl,url);
      calls.push(method);
      if (method === 'GET') assert.equal(headers.Range,'bytes=0-0');
      return new Response(null,{status:method === 'HEAD' ? 404 : status});
    };
    assert.equal(await missingResource(url,check),[404,410].includes(status) ? status : null);
    assert.deepEqual(calls,['HEAD','GET']);
  }
});

test('coverage issue names the failed stage and endpoint, then records recovery in the existing issue', async () => {
  const state = [], changes = [];
  const api = async (_path,method,body) => {
    if (!method) return state;
    changes.push(method);
    if (!state.length) state.push({number:15,user:{login:'github-actions[bot]'}});
    return Object.assign(state[0],body);
  };
  const url = 'https://cdn-resource.spacemit.com/C%2B%2B.md';
  const findings = [{category:'coverage',language:'zh',path:'courses/C++.md',message:'服务器返回 HTTP 404。',
    evidence:{stage:'读取 CDN 正文',status:404,kind:'not-found',checkedUrl:url}}];
  await reconcile(api,'sample/docs','https://github.com/sample/docs/actions/runs/1',findings);
  for (const expected of ['读取 CDN 正文','HTTP 404',url,'URL 编码','检查未执行完']) assert(state[0].body.includes(expected));
  await reconcile(api,'sample/docs','https://github.com/sample/docs/actions/runs/2',[]);
  assert.deepEqual(changes,['POST','PATCH']);
  assert(state[0].body.includes('本次重查未发现'));
});

test('published Issue links target the heading containing the offending source block', async () => {
  const {analyze} = require('../../scripts/document-governance/core.cjs');
  const {portalSections,sectionAt} = require('../../scripts/document-governance/audit-location.cjs');
  const {location} = require('../../scripts/document-governance/audit.cjs');
  const markdown = '---\ntitle: Test\n---\n# Test\n\n## 1. **概述**\n\n[Link](#missing)\n\n## 1. 概述\n\nTODO\n';
  const parsed = analyze(markdown);
  const sections = portalSections(parsed.headings);
  const target = sectionAt(sections,parsed.links[0].line);
  assert.equal(parsed.links[0].line,8);
  assert.equal(target.title,'1. 概述');
  assert.equal(target.anchor,'_1-概述');
  assert.equal(sections.at(-1).anchor,'_1-概述-1');

  const doc = {language:'zh',path:'ubuntu/guide.md'};
  const href = location(doc,target);
  assert.equal(new URL(href).searchParams.get('anchor'),'_1-概述');
  let issue;
  const api = async (_path,method,body) => { if (!method) return []; issue = body; return {}; };
  await reconcile(api,'sample/docs','https://github.com/sample/docs/actions/runs/1',[
    {...doc,category:'links',message:'链接目标不存在',line:8,section:target.title,url:href}
  ]);
  assert(issue.body.includes('跳到「1. 概述」'));
  assert(issue.body.includes(href));
});

test('confirmed source issues link to the exact line on the pinned GitHub revision', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const {collect} = require('../../scripts/document-governance/audit-issues.cjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'audit-source-link-'));
  try {
    const pinned = path.join(out,'pinned','zh');
    fs.mkdirSync(pinned,{recursive:true});
    fs.writeFileSync(path.join(out,'published-report.json'),JSON.stringify({findings:[]}));
    fs.writeFileSync(path.join(pinned,'report.json'),JSON.stringify({language:'zh',errors:[],checks:[
      {id:'content',errors:[],warnings:[{repo:'docs',file:'zh/guide.md',code:'content-review',line:11,message:'章节为空'}]}
    ]}));
    const commit = 'a'.repeat(40);
    fs.writeFileSync(path.join(pinned,'manifest.json'),JSON.stringify({scopes:[{repoId:'docs',repository:'example/docs',commit}]}));
    assert.equal(collect(out)[0].url,'https://github.com/example/docs/blob/'+commit+'/zh/guide.md#L11');
  } finally { fs.rmSync(out,{recursive:true,force:true}); }
});
