const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {referenceGroups,selectGroup,releaseLocation,parseReleaseBranch,acceptedState,affectedRepositories,scopeFingerprint}=require('../../scripts/document-governance/groups.cjs');
const {registrationFromIssue}=require('../../scripts/document-governance/run.cjs');
const {validateRegistry}=require('../../scripts/document-governance/core.cjs');
const scope=(id,refs=[])=>({repoId:id,column:'cases',language:'zh',commit:'a'.repeat(40),documents:[{path:'zh/index.md',sha256:id,references:refs}]});
test('direct, indirect, reverse and cyclic references share one PR; unrelated repository stays independent',()=>{
  const current={scopes:[scope('a',['b/zh/index.md']),scope('b',['c/zh/index.md']),scope('c',['a/zh/index.md']),scope('d')]};
  const groups=referenceGroups(current);assert.deepEqual(groups.map(g=>g.repositories),[['a','b','c'],['d']]);
  assert.deepEqual(referenceGroups({scopes:[...current.scopes].reverse()}),groups);
});
test('removing a published reference cannot split its repositories in the removal release',()=>{
  const previous=[scope('a',['b/zh/index.md']),scope('b')],current={scopes:[scope('a'),scope('b')]};
  assert.deepEqual(referenceGroups(current,previous)[0].repositories,['a','b']);
  assert.deepEqual(referenceGroups(current,current.scopes).map(g=>g.repositories),[['a'],['b']]);
});
test('redirect across repositories is part of the reference group',()=>{
  assert.deepEqual(referenceGroups({scopes:[scope('a'),scope('b')],redirects:{'a/zh/old.md':'b/zh/index.md'}})[0].repositories,['a','b']);
});
test('a new PR replaces all affected old candidates when groups merge or split',()=>{
  const pending=[{manifest:{scopes:[scope('a'),scope('b')]}},{manifest:{scopes:[scope('b'),scope('c')]}},{manifest:{scopes:[scope('d')]}}];
  assert.deepEqual([...affectedRepositories(['a'],pending)].sort(),['a','b','c']);
});
test('unrelated repository check errors do not block a selected group; subcategory remains in its manifest',()=>{
  const a={...scope('a'),parentNavigationId:'cases/cases-teaching-practice',navigationPath:['应用案例','教学与实践']};
  const source={manifest:{language:'zh',scopes:[a,scope('b')],references:{},redirects:{},labels:{},feedback:[]},errors:[{repo:'a',code:'anchor'},{repo:'b',code:'index'}],warnings:[{repo:'b',code:'translation'}],pages:new Map([['a/zh/index.md',{}],['b/zh/index.md',{}]])};
  const selected=selectGroup(source,referenceGroups(source.manifest).find(g=>g.repositories.includes('a')));
  assert.deepEqual(selected.errors,[{repo:'a',code:'anchor'}]);assert.deepEqual(selected.warnings,[]);assert.equal(selected.pages.size,1);assert.deepEqual(selected.manifest.scopes[0].navigationPath,['应用案例','教学与实践']);
});
test('accepted pointers select the right source revision after a former group splits',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'accepted-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const oldGroup=referenceGroups({scopes:[scope('a',['b/zh/index.md']),scope('b')]})[0];
  const newGroup=referenceGroups({scopes:[scope('a')]})[0];
  const write=(file,value)=>{const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(value));};
  write(releaseLocation('zh',oldGroup.groupId).file,{scopes:[scope('a',['b/zh/index.md']),scope('b')],labels:{'a/zh/index.md':['old'],'b/zh/index.md':['keep']}});
  write(releaseLocation('zh',newGroup.groupId).file,{scopes:[{...scope('a'),commit:'b'.repeat(40)}],labels:{'a/zh/index.md':['new']}});
  write('document-center/state/zh/a.json',{repoId:'a',groupId:newGroup.groupId});write('document-center/state/zh/b.json',{repoId:'b',groupId:oldGroup.groupId});
  const state=acceptedState(root,'zh');assert.equal(state.scopes.find(s=>s.repoId==='a').commit,'b'.repeat(40));assert.deepEqual(state.labels,{'a/zh/index.md':['new'],'b/zh/index.md':['keep']});
});
test('release locations cannot escape their language/group namespace',()=>{
  const group=referenceGroups({scopes:[scope('a')]})[0];const location=releaseLocation('zh',group.groupId);assert.deepEqual(parseReleaseBranch(location.branch),{language:'zh',groupId:group.groupId,...location});
  assert.throws(()=>parseReleaseBranch('document-release/zh/../../main'));assert.throws(()=>releaseLocation('zh','../other'));
});
test('unmodified content does not republish just because unrelated source commits advanced',()=>{
  assert.equal(scopeFingerprint(scope('a')),scopeFingerprint({...scope('a'),commit:'b'.repeat(40)}));
  assert.notEqual(scopeFingerprint(scope('a')),scopeFingerprint({...scope('a'),parentNavigationId:'cases/teaching'}));
});
test('registration form retains subcategory, and rejects malformed category metadata',()=>{
  const body='### 登记 ID\nnew\n### 来源仓库\nexample/new\n### 分支\nmain\n### 目标路径前缀\ncourses\n### 目录层级 rootDep\n1\n### 目标栏目\ncases\n### 语言\nzh\n### 子类节点 ID\ncases/cases-teaching-practice\n### 分类路径\n应用案例 / 教学与实践\n';
  const entry=registrationFromIssue(body);validateRegistry({schemaVersion:1,change:{repositoryId:'new'},repositories:[entry]});assert.deepEqual(entry.navigationPath,['应用案例','教学与实践']);
  assert.throws(()=>validateRegistry({schemaVersion:1,repositories:[{...entry,parentNavigationId:'cases/../other'}]}),/category/);
});
