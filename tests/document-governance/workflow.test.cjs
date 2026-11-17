const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {build,writePreview,validateRegistry,sha,analyze,compareCandidate}=require('../../scripts/document-governance/core.cjs');
function fixture(t,files){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'governance-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args]).toString().trim();
  git('init','--quiet');
  for(const [file,text]of Object.entries(files)){const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);}
  git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','fixture');
  return {root,commit:git('rev-parse','HEAD'),git};
}
const registration={id:'test',repository:'example/docs-test',prefix:'software/test',rootDep:1,branch:'main',column:'os',languages:['zh','en']};
const registry={schemaVersion:1,repositories:[registration]};
const good={'zh/index.md':'---\nsidebar_position: 2\n---\n# 测试目录\n\n[指南](guide.md#安装)\n','zh/guide.md':'# 指南\n\n## 安装\n\n正文。![board](images/board.png)\n','zh/images/board.png':'synthetic image'};
function run(f,extra={}){return build({registry,roots:{test:f.root},revisions:{test:f.commit},language:'zh',...extra});}
test('candidate reads exact commit, preserves dirty source, checks resource and reference hashes',t=>{
  const f=fixture(t,good);fs.writeFileSync(path.join(f.root,'zh/guide.md'),'# Dirty unapproved body');
  const result=run(f);assert.deepEqual(result.errors,[]);assert.equal(result.manifest.scopes[0].documents.find(d=>d.path==='zh/guide.md').sha256,sha(good['zh/guide.md']));
  assert.equal(result.manifest.scopes[0].assets[0].sha256,sha('synthetic image'));
  assert.deepEqual(result.manifest.scopes[0].documents.find(d=>d.path==='zh/index.md').references,['test/zh/guide.md']);
  assert(result.warnings.some(w=>w.code==='translation'));assert(!fs.existsSync(path.join(f.root,'preview')));
});
test('rejects mutable refs and symlink source entries',t=>{
  const f=fixture(t,good);assert.throws(()=>run(f,{revisions:{test:'main'}}),/immutable/);
  fs.symlinkSync('/etc/passwd',path.join(f.root,'zh/secret.md'));f.git('add','.');f.git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','symlink');f.commit=f.git('rev-parse','HEAD');assert.throws(()=>run(f),/Symlink/);
});
test('checks broken images, reference-style Markdown links, and anchor targets',t=>{
  const f=fixture(t,{...good,'zh/guide.md':'# Guide\n\n[other][ref]\n\n[ref]: missing.md#part\n\n![missing](images/lost.png)\n[anchor](index.md#missing)'});
  const result=run(f);assert(result.errors.some(e=>e.code==='broken-link'&&e.message.includes('missing.md')));assert(result.errors.some(e=>e.message.includes('lost.png')));assert(result.errors.some(e=>e.code==='anchor'));
});
test('fenced examples are not links, numbered headings/lists require human review',t=>{
  const f=fixture(t,{...good,'zh/guide.md':'# 6.1 Guide\n\n3. Start here\n\n```md\n[missing](missing.md)\n```\n'});
  const r=run(f);assert(!r.errors.some(e=>e.code==='broken-link'));assert(r.warnings.some(e=>e.code==='list-start'));assert(r.warnings.some(e=>e.code==='numbered-title'));
});
test('every Markdown directory needs its own index, independent of sidebar_position',t=>{
  const f=fixture(t,{...good,'zh/development/a.md':'# A'});const r=run(f);assert(r.errors.some(e=>e.code==='index'&&e.message.includes('development/index.md')));assert(!r.warnings.some(e=>e.code==='list-start'));
});
test('invalid front matter blocks candidate',t=>{
  const f=fixture(t,{...good,'zh/guide.md':'---\nsidebar_position: wrong\n---\n# Guide'});assert(run(f).errors.some(e=>e.code==='metadata'));
});
test('Chinese translation reminders do not require an English release; explicit cross-language references block',t=>{
  const f=fixture(t,{...good,'en/index.md':'# English\n','zh/guide.md':'# 指南\n\n[English](../en/index.md)'});
  const r=run(f);assert.equal(r.manifest.scopes.length,1);assert(r.errors.some(e=>e.code==='cross-language'));
});
test('release conservatively includes all registered sources and cross-repository references',t=>{
  const a=fixture(t,{...good,'zh/guide.md':'# Guide\n\n## 安装\n\n[next](https://example.invalid/other.md)'}),b=fixture(t,{'zh/index.md':'# Other'});
  const second={...registration,id:'second',repository:'example/other',prefix:'software/other'};
  const r=build({registry:{schemaVersion:1,repositories:[registration,second]},roots:{test:a.root,second:b.root},revisions:{test:a.commit,second:b.commit},language:'zh',overrides:{references:{'test/zh/guide.md::https://example.invalid/other.md':'second/zh/index.md'}}});
  assert.equal(r.manifest.scopes.length,2);assert.deepEqual(r.errors,[]);assert.deepEqual(r.manifest.scopes[0].documents.find(d=>d.path==='zh/guide.md').references,['second/zh/index.md']);
});
test('unregistered document URLs block, ordinary external websites remain review reminders',t=>{
  const f=fixture(t,{...good,'zh/guide.md':'# Guide\n\n[doc](https://example.invalid/a.md) [site](https://example.invalid/)'});const r=run(f);assert(r.errors.some(e=>e.code==='reference-registration'));assert(r.warnings.some(e=>e.code==='external-link'));
});
test('removed addresses and version changes are reported; invalid migration mappings block',t=>{
  const f=fixture(t,good),previous=run(f).manifest;previous.scopes[0].documents[0].softwareVersion='old';previous.scopes[0].documents.push({path:'zh/removed.md'});
  const r=run(f,{previous,overrides:{redirects:{'test/zh/removed.md':'test/zh/guide.md'}}});assert(r.warnings.some(w=>w.code==='address-change'));assert(r.warnings.some(w=>w.code==='version'));assert(!r.errors.some(e=>e.code==='redirect'));
  assert(run(f,{previous,overrides:{redirects:{'test/zh/guide.md':'test/zh/missing.md'}}}).errors.some(e=>e.code==='redirect'));
});
test('static preview escapes raw HTML, uses local links/assets and matching Unicode anchor IDs',t=>{
  const f=fixture(t,{...good,'zh/guide.md':good['zh/guide.md']+'\n<script>alert(1)</script>'});const out=path.join(f.root,'preview');writePreview(run(f),out);
  const guide=fs.readFileSync(path.join(out,'test/zh/guide.md.html'),'utf8'),index=fs.readFileSync(path.join(out,'test/zh/index.md.html'),'utf8');assert(guide.includes('id="安装"'));assert(guide.includes('&lt;script&gt;'));assert(!guide.includes('<script>'));assert(index.includes('guide.md.html#%E5%AE%89%E8%A3%85'));assert(fs.existsSync(path.join(out,'test/zh/images/board.png')));
});
test('empty or unsafe registry cannot silently produce green validation',()=>{
  assert.throws(()=>validateRegistry({schemaVersion:1,repositories:[]}),/Register/);assert.throws(()=>validateRegistry({schemaVersion:1,repositories:[{...registration,id:'..'}]}),/Invalid/);
});
test('heading suffixes match duplicate anchors',()=>{const r=analyze('# Same\n\n## Same\n');assert(r.anchors.has('same'));assert(r.anchors.has('same-1'));});
test('front matter chapter numbers and empty sections are review items; code examples are not unfinished prose',t=>{
  const f=fixture(t,{...good,'zh/guide.md':'---\ntitle: "6.1"\n---\n# Guide\n\n## 安装\n\n## Empty\n\n正文\n'});
  const r=run(f);assert(r.warnings.some(w=>w.code==='numbered-title'));assert(r.warnings.some(w=>w.code==='content-review'));
  const complete=fixture(t,{...good,'zh/guide.md':'# Guide\n\n## 安装\n\n正文\n\n```\nTODO 待补充\n```\n'});
  assert(!run(complete).warnings.some(w=>w.file==='zh/guide.md'&&w.code==='content-review'));
});
test('eight-category report keeps blockers, translation reminders, and first-onboarding limits visible',t=>{
  const f=fixture(t,{...good,'zh/guide.md':'# 6.1 Guide\n\n3. 待补充\n\n[坏链接](#不存在)\n','zh/child/page.md':'# Page\n\n正文'});
  const r=run(f),out=path.join(f.root,'report');writePreview(r,out);
  const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
  assert.equal(report.checks.length,8);assert.equal(report.hasBaseline,false);
  assert.equal(report.checks.find(c=>c.id==='links').status,'blocked');
  assert.equal(report.checks.find(c=>c.id==='directories').status,'blocked');
  assert.equal(report.checks.find(c=>c.id==='translations').status,'review');
  assert(!report.errors.some(e=>e.code==='translation'));
  const summary=fs.readFileSync(path.join(out,'report.md'),'utf8');
  assert(summary.includes('无上一清单'));assert(summary.includes('零自动发现不代表人工审核通过'));
  assert(fs.readFileSync(path.join(out,'index.html'),'utf8').includes('版本与旧版归档'));
});
test('review report shows incoming transitive references including removed edges, unchanged versions, and address migrations',t=>{
  const files={'zh/index.md':'# Index\n\n[a](a.md)','zh/a.md':'# A\n\n[b](b.md)','zh/b.md':'# B\n\n正文','zh/old.md':'# Old\n\n旧文'};
  const f=fixture(t,files),previous=run(f).manifest;
  fs.writeFileSync(path.join(f.root,'zh/a.md'),'# A\n\n不再引用 B');
  fs.writeFileSync(path.join(f.root,'zh/b.md'),'# B\n\n新正文');
  fs.renameSync(path.join(f.root,'zh/old.md'),path.join(f.root,'zh/new.md'));
  f.git('add','.');f.git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','update');f.commit=f.git('rev-parse','HEAD');
  const r=run(f,{previous,overrides:{redirects:{'test/zh/old.md':'test/zh/new.md'}}});
  const {checkReport}=require('../../scripts/document-governance/check-report.cjs');
  const report=checkReport(r),impact=report.referenceImpact.find(i=>i.document==='test/zh/b.md');
  assert.deepEqual(impact.direct,['test/zh/a.md']);assert.deepEqual(impact.indirect,['test/zh/index.md']);
  assert(report.versionReview.some(v=>v.document==='test/zh/b.md'&&v.previousVersion===null&&v.candidateVersion===null));
  assert.deepEqual(report.addresses.added,['test/zh/new.md']);assert.deepEqual(report.addresses.removed,['test/zh/old.md']);
  assert.equal(report.addresses.redirects['test/zh/old.md'],'test/zh/new.md');
  const {selectGroup}=require('../../scripts/document-governance/groups.cjs');
  assert.equal(checkReport(selectGroup(r,{repositories:['test'],groupId:'test'})).hasBaseline,true);
  assert.equal(JSON.stringify(r.manifest).includes('referenceImpact'),false);
});
test('out-of-order source events cannot supersede a newer candidate; divergent histories require review',t=>{
  const f=fixture(t,good),before=f.commit;fs.writeFileSync(path.join(f.root,'zh/guide.md'),'# New body');f.git('add','.');f.git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','next');const next=f.git('rev-parse','HEAD');
  assert.equal(compareCandidate(f.root,before,next),'ahead');assert.equal(compareCandidate(f.root,next,before),'stale');assert.equal(compareCandidate(f.root,next,next),'identical');
  f.git('checkout','--quiet','-b','other',before);fs.writeFileSync(path.join(f.root,'zh/guide.md'),'# Other body');f.git('add','.');f.git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','other');assert.equal(compareCandidate(f.root,next,f.git('rev-parse','HEAD')),'diverged');
});
test('registration issue fields are typed inputs and do not require editing JSON',()=>{
  const {registrationFromIssue}=require('../../scripts/document-governance/run.cjs');
  const entry=registrationFromIssue('### 登记 ID\n\ntest\n\n### 来源仓库\n\nexample/docs-test\n\n### 分支\n\nmain\n\n### 目标路径前缀\n\nsoftware/test\n\n### 目录层级 rootDep\n\n1\n\n### 目标栏目\n\nos\n\n### 语言\n\nzh, en\n');
  assert.deepEqual(entry,registration);validateRegistry({schemaVersion:1,repositories:[entry]});
});
