const {test} = require('node:test');
const assert = require('node:assert/strict');
const {sha} = require('../../scripts/document-governance/core.cjs');
const {translationDifferences,checkTranslationReview} = require('../../scripts/document-governance/translation-review.cjs');

function fixture({after='新内容',previousEnglish='English',currentEnglish=previousEnglish,move=false}={}) {
  const original='zh/guide.md', file=move?'zh/setup.md':original, english='en/guide.md';
  const scope=(commit,path,content)=>({repoId:'test',repository:'example/docs',commit,documents:[{path,sha256:sha(content)}]});
  const previous={scopes:[scope('before',original,'旧内容')]};
  const peer={scopes:[]};
  const manifest={language:'zh',scopes:[scope('after',file,after)],redirects:move?{'test/zh/guide.md':'test/zh/setup.md'}:{}};
  const source=value=>new Map(value?[ [english,{read:()=>Buffer.from(value)}] ]:[]);
  const readSource=(_,revision)=>source(revision==='before'?previousEnglish:currentEnglish);
  return {manifest,previous,peer,readSource};
}
const compare=options=>translationDifferences(options.manifest,options.previous,options.peer,options.readSource);

test('only an existing, unchanged counterpart requires bilingual review',()=>{
  assert.equal(compare(fixture())[0].peer,'en/guide.md');
  assert.deepEqual(compare(fixture({previousEnglish:null})),[]);
  assert.deepEqual(compare(fixture({currentEnglish:'Updated English'})),[]);
  assert.deepEqual(compare(fixture({after:'旧内容'})),[]);
  assert.deepEqual(compare(fixture({move:true})).map(({file,previousFile,peer})=>[file,previousFile,peer]),
    [['zh/setup.md','zh/guide.md','en/guide.md']]);
});

test('a maintainer issue records reason for the exact reviewed PR and hashes',async()=>{
  const repository='example/governance', pr={number:42,created_at:'2026-11-19T00:00:00Z'};
  const maintainers=new Set(['maintainer']);
  const issues=[];
  const api=async resource=>{
    assert(resource.startsWith('/repos/example/governance/issues?'));
    return issues;
  };
  const check=options=>checkTranslationReview({api,repository,pr,maintainers,...options});
  const missing=await check(fixture());
  const form=new URL(missing.issueUrl);
  const issue={number:7,title:form.searchParams.get('title'),body:form.searchParams.get('body'),
    author_association:'COLLABORATOR',user:{login:'maintainer'}};
  issues.push(issue);
  assert((await check(fixture())).issueUrl);
  issue.body+='Plan unchanged for English users pending localization.';
  assert.equal((await check(fixture())).issue,7);
  assert((await check(fixture({after:'再次修改'}))).issueUrl);
  issue.user.login='other';
  assert((await check(fixture())).issueUrl);
});
