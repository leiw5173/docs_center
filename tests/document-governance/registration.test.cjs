const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const {registrationFromIssue}=require('../../scripts/document-governance/registration.cjs');
const catalog=require('../../document-center/categories.json');
const registry=require('../../document-center/registry.json');
const body=fields=>Object.entries(fields).map(([k,v])=>`### ${k}\n\n${v}\n`).join('\n');
const fields={'来源仓库':'example/docs-new','语言':'zh','目标分类':'应用案例 / 教学与实践'};

test('new source needs no duplicate identifier, prefix, category ID or depth inputs',()=>{
  const entry=registrationFromIssue(body(fields),registry);
  assert.deepEqual(entry,{id:'docs-new',repository:'example/docs-new',branch:'main',prefix:'docs-new',rootDep:1,column:'cases',parentNavigationId:'cases/cases-teaching-practice',navigationPath:['应用案例','教学与实践'],languages:['zh']});
  assert.throws(()=>registrationFromIssue(body({...fields,'来源仓库':'https://github.com/example/docs-new'}),registry),/owner\/repository/);
  assert.throws(()=>registrationFromIssue(body({...fields,'来源标识（可选）':'unsafe/path'}),registry),/短横线/);
});
test('GitHub empty optional fields use defaults and actual source branch may be selected',()=>{
  const entry=registrationFromIssue(body({...fields,'分支':'_No response_','来源标识（可选）':'_No response_'}),registry);
  assert.equal(entry.branch,'main');assert.equal(entry.id,'docs-new');
  assert.equal(registrationFromIssue(body({...fields,'分支':'master'}),registry).branch,'master');
});
test('existing source preserves historical identity, address and non-derived depth',()=>{
  const existing=registry.repositories.find(r=>r.id==='docs-courses');assert.equal(existing.rootDep,3);assert.equal(existing.prefix,'courses');
  const entry=registrationFromIssue(body({...fields,'来源仓库':existing.repository}),registry);
  assert.equal(entry.id,'docs-courses');assert.equal(entry.prefix,'courses');assert.equal(entry.rootDep,3);
  const testSource=registrationFromIssue(body({...fields,'来源仓库':'leiw5173/docs_test'}),registry);
  assert.equal(testSource.id,'maintenance-test');assert.equal(testSource.prefix,'maintenance-test');
});
test('existing source does not lose branch, languages or placement when not supplied',()=>{
  const old={id:'old',repository:'example/old',prefix:'legacy/docs',rootDep:7,branch:'release',languages:['zh','en'],column:'os',parentNavigationId:'os',navigationPath:['操作系统']};
  const entry=registrationFromIssue(body({'来源仓库':'example/old'}),{repositories:[old]});
  assert.deepEqual(entry,old);
});
test('identifier and default prefix collisions stop instead of replacing another source',()=>{
  const before=JSON.stringify(registry);
  assert.throws(()=>registrationFromIssue(body({...fields,'来源仓库':'another/docs-courses'}),registry),/已被其他仓库/);
  assert.throws(()=>registrationFromIssue(body({...fields,'来源仓库':'another/courses'}),registry),/前缀已被占用/);
  const entry=registrationFromIssue(body({...fields,'来源仓库':'another/docs-courses','来源标识（可选）':'teaching-extra'}),registry);
  assert.equal(entry.id,'teaching-extra');assert.equal(entry.prefix,'teaching-extra');assert.equal(JSON.stringify(registry),before);
});
test('normalizing a new repository name cannot silently collide with an existing identity',()=>{
  assert.equal(registrationFromIssue(body({...fields,'来源仓库':'example/docs.new'}),registry).id,'docs-new');
  assert.throws(()=>registrationFromIssue(body({...fields,'来源仓库':'example/docs.new'}),{repositories:[{...registry.repositories[0],id:'docs-new'}]}),/已被其他仓库/);
});
test('old issue fields remain readable but cannot migrate existing identity or address',()=>{
  const old=body({'登记 ID':'legacy','来源仓库':'example/legacy','分支':'main','目标路径前缀':'software/legacy','目录层级 rootDep':'3','目标栏目':'os','语言':'zh','子类节点 ID':'_No response_','分类路径':'_No response_'});
  const entry=registrationFromIssue(old,registry);assert.equal(entry.prefix,'software/legacy');assert.equal(entry.rootDep,3);assert.equal(entry.parentNavigationId,undefined);
  const existing={repositories:[entry]};
  for(const changed of [old.replace('### 登记 ID\n\nlegacy','### 登记 ID\n\nrenamed'),old.replace('software/legacy','changed'),old.replace('rootDep\n\n3','rootDep\n\n1')])assert.throws(()=>registrationFromIssue(changed,existing),/迁移申请/);
  assert.throws(()=>registrationFromIssue(body({...fields,'来源仓库':'example/legacy','来源标识（可选）':'renamed'}),existing),/迁移申请/);
});
test('unknown or missing classification never silently falls back to a top-level column',()=>{
  assert.throws(()=>registrationFromIssue(body({...fields,'目标分类':'应用案例 / 不存在'}),registry),/分类表/);
  assert.throws(()=>registrationFromIssue(body({'来源仓库':'example/new','语言':'zh'}),registry),/请选择目标分类/);
});
test('every selectable category maps to a unique registered location and matches the handoff table',()=>{
  const root=path.resolve(__dirname,'../..');
  const form=yaml.load(fs.readFileSync(path.join(root,'.github/ISSUE_TEMPLATE/document-registration.yml'),'utf8'));
  const options=form.body.find(f=>f.id==='category').attributes.options;
  assert.deepEqual(options,catalog.categories.map(c=>c.path.join(' / ')));
  assert.equal(new Set(options).size,options.length);assert.equal(new Set(catalog.categories.map(c=>c.id)).size,options.length);
  const table=fs.readFileSync(path.join(root,'docs/category-catalog.md'),'utf8');
  for(const c of catalog.categories){const entry=registrationFromIssue(body({...fields,'目标分类':c.path.join(' / ')}),registry);assert.equal(entry.column,c.column);assert.equal(entry.parentNavigationId,c.id);assert.deepEqual(entry.navigationPath,c.path);assert.ok(table.includes(c.id));assert.ok(table.includes(c.path.join(' / ')));}
  assert.ok(catalog.categories.every(c=>c.path.length<=2));
  assert.ok(options.includes('操作系统 / Bianbu'));
  for(const label of ['登记 ID','目标路径前缀','目录层级 rootDep','子类节点 ID','分类路径','目标栏目'])assert.ok(!form.body.some(f=>f.attributes?.label===label));
});

test('one bilingual onboarding PR contains registration, pinned releases and state pointers without changing other sources',async t=>{
  const os=require('node:os'),cp=require('node:child_process');const {registration}=require('../../scripts/document-governance/run.cjs');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'registration-handoff-'));const savedFetch=global.fetch;
  const keys=['GH_TOKEN','GITHUB_EVENT_PATH','GITHUB_REPOSITORY','DOCUMENT_GOVERNANCE_MAINTAINERS','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_ALLOW_PROTOCOL'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{global.fetch=savedFetch;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];fs.rmSync(temp,{recursive:true,force:true});});
  const source=path.join(temp,'source');fs.mkdirSync(source);const git=(...args)=>cp.execFileSync('git',['-C',source,...args]).toString().trim();git('init','--quiet','-b','main');
  for(const language of ['zh','en'])fs.cpSync(path.resolve(__dirname,'../../examples/business-repository/zh'),path.join(source,language),{recursive:true});
  git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','bilingual source');const revision=git('rev-parse','HEAD');
  const base=cp.execFileSync('git',['rev-parse','HEAD']).toString().trim();
  const event=path.join(temp,'event.json');fs.writeFileSync(event,JSON.stringify({issue:{number:9,title:'[文档接入] 分类调整',user:{login:'editor'},body:body({...fields,'来源仓库':'spacemit-com/docs-courses','语言':'zh, en','来源标识（可选）':'_No response_'})}}));
  Object.assign(process.env,{GH_TOKEN:'local-fixture-only',GITHUB_EVENT_PATH:event,GITHUB_REPOSITORY:'example/governance',DOCUMENT_GOVERNANCE_MAINTAINERS:'editor',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`url.file://${source}.insteadOf`,GIT_CONFIG_VALUE_0:'https://github.com/spacemit-com/docs-courses.git',GIT_ALLOW_PROTOCOL:'file'});
  let files,prBody;const original=JSON.stringify(registry);
  global.fetch=async(url,options={})=>{
    const u=new URL(url),method=options.method||'GET',payload=options.body?JSON.parse(options.body):null;
    const resource=u.pathname.replace('/repos/example/governance','');let result;
    if(resource==='/collaborators/editor/permission')result={permission:'write'};
    else if(resource==='')result={default_branch:'main'};
    else if(resource==='/pulls'&&method==='GET')result=[];
    else if(resource==='/git/ref/heads/main')result={object:{sha:base}};
    else if(resource.startsWith('/git/matching-refs/'))result=[];
    else if(resource==='/git/commits/'+base)result={tree:{sha:base}};
    else if(resource==='/git/trees'&&method==='POST'){files=Object.fromEntries(payload.tree.map(f=>[f.path,JSON.parse(f.content)]));result={sha:'b'.repeat(40)};}
    else if(resource==='/git/commits'&&method==='POST')result={sha:'c'.repeat(40)};
    else if(resource==='/git/refs'&&method==='POST')result={};
    else if(resource==='/pulls'&&method==='POST'){prBody=payload.body;result={number:10};}
    else throw Error('Unexpected fixture request '+method+' '+resource);
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  };
  await registration(registry);
  const updated=files['document-center/registry.json'],bundle=files['document-center/onboarding/issue-9.json'];
  assert.equal(updated.change.repositoryId,'docs-courses');assert.equal(updated.change.onboarding,'document-center/onboarding/issue-9.json');assert.equal(updated.repositories.length,registry.repositories.length);
  const entry=updated.repositories.find(r=>r.id==='docs-courses');assert.equal(entry.prefix,'courses');assert.equal(entry.rootDep,3);
  for(const r of registry.repositories.filter(r=>r.id!=='docs-courses'))assert.deepEqual(updated.repositories.find(n=>n.id===r.id),r);
  assert.deepEqual(bundle.releases.map(m=>m.language),['zh','en']);
  for(const m of bundle.releases){assert.equal(m.scopes[0].commit,revision);assert.deepEqual(files[`document-center/releases/${m.language}/${m.groupId}.json`],m);assert.deepEqual(files[`document-center/state/${m.language}/docs-courses.json`],{repoId:'docs-courses',groupId:m.groupId});}
  assert.match(prBody,/只合并一次/);assert.match(prBody,/地址前缀 \| courses/);assert.equal(JSON.stringify(registry),original);
});
