const {test}=require('node:test'),assert=require('node:assert/strict');
const {changedPages,previewSites,migrationPreviews}=require('../../scripts/document-governance/preview-sites.cjs');
const {analyze}=require('../../scripts/document-governance/core.cjs');
const {documentChanges,changedSections}=require('../../scripts/document-governance/document-changes.cjs');
const digest='b'.repeat(64),url=`https://preview.example/community/document?preview=${digest}&lang=zh`;
const doc=(path,sha256=path)=>({path,sha256,title:path,sidebarPosition:1,softwareVersion:null,references:[]});
const scope=(repoId,documents)=>({repoId,prefix:repoId,rootDep:1,column:'cases',language:'zh',documents});
test('lists each modified or moved page once and excludes unchanged related sources',()=>{
 const previous={scopes:[scope('a',[doc('zh/index.md','old'),doc('zh/guide/index.md','intro'),doc('zh/guide/steps.md','steps'),doc('zh/untouched.md')]),scope('b',[doc('zh/index.md')])],redirects:{}};
 const manifest={language:'zh',scopes:[scope('a',[doc('zh/index.md','new'),doc('zh/new/index.md','intro'),doc('zh/new/steps.md','steps'),doc('zh/untouched.md')]),scope('b',[doc('zh/index.md')])],redirects:{'a/zh/guide/index.md':'a/zh/new/index.md','a/zh/guide/steps.md':'a/zh/new/steps.md'}};
 const pages=changedPages(manifest,previous,url);
 assert.deepEqual(pages.map(page=>[page.path,page.change]),[['zh/new/steps.md','moved']]);
 for(const page of pages){const link=new URL(page.url);assert.equal(link.pathname,'/community/document/info');assert.equal(link.searchParams.get('nodepath'),page.sourcePath);assert.equal(link.searchParams.get('preview'),digest);assert.equal(link.searchParams.get('lang'),'zh');}
});
test('initial onboarding links every initial page; placement or labels changes link existing affected pages',()=>{
 const original=scope('a',[doc('zh/index.md'),doc('zh/steps.md')]);
 assert.equal(changedPages({language:'zh',scopes:[original]},null,url).length,1);
 assert.equal(changedPages({language:'zh',scopes:[{...original,parentNavigationId:'cases/new'}]},{scopes:[original]},url).length,1);
 const labelled=changedPages({language:'zh',scopes:[original],labels:{'a/zh/steps.md':['K3']}},{scopes:[original]},url);
 assert.deepEqual(labelled.map(page=>page.path),['zh/steps.md']);
});
test('directory metadata stays in the manifest but is never listed as an independent preview page',()=>{
 const manifest={language:'zh',scopes:[scope('a',[doc('zh/INDEX.md'),doc('zh/dir/index.md'),doc('zh/README.md'),doc('zh/root_overview.md'),doc('zh/guide.md')])]};
 assert.deepEqual(changedPages(manifest,null,url).map(page=>page.path),['zh/root_overview.md','zh/guide.md']);
 assert.equal(manifest.scopes[0].documents.length,5);
});
test('comment inputs cannot restore internal index or readme links as pages or migration tests',()=>{
 const site={language:'zh',digest,url,pages:[],redirects:[]};
 for(const name of ['index.md','README.md']) {
  const link=new URL('/community/document/info',url);link.search=new URLSearchParams({preview:digest,lang:'zh',nodepath:'a/'+name});
  assert.throws(()=>previewSites([{...site,pages:[{title:name,path:'zh/'+name,sourcePath:'a/'+name,change:'modified',url:link.href}]}]));
  assert.throws(()=>previewSites([{...site,redirects:[{from:'a/zh/'+name,to:'a/zh/new.md',sourcePath:'a/'+name,targetPath:'a/new.md',url:link.href}]}]));
 }
});

test('a migration links current and previous reference documents, with exact sections for surviving links',()=>{
 const old='a/zh/old.md',next='a/zh/new.md',reference='a/zh/reference.md';
 const previous={scopes:[scope('a',[doc('zh/old.md'),{...doc('zh/reference.md'),references:[old]},
   {...doc('zh/indirect.md'),references:[reference]},doc('zh/index.md')])]};
 const manifest={language:'zh',scopes:[scope('a',[doc('zh/new.md'),doc('zh/reference.md'),doc('zh/indirect.md')])],
   redirects:{[old]:next}};
 const evidence=[{target:old,document:reference,anchor:'install',line:12,section:'Setup',sectionAnchor:'setup'}];
 const [move]=migrationPreviews(manifest,previous,url,evidence);
 assert.deepEqual(move.anchors,['install']);
 assert.deepEqual(move.references.map(ref=>[ref.id,ref.direct]),[[reference,true],['a/zh/indirect.md',false]]);
 assert.equal(new URL(move.references[0].url).searchParams.get('anchor'),'setup');
 assert.equal(move.references[0].line,12);
 assert.equal(new URL(move.targetUrl).searchParams.get('nodepath'),'a/new.md');
 assert.doesNotThrow(()=>previewSites([{language:'zh',digest,url,pages:[],redirects:[move]}]));
});

test('candidate preview links only documents reachable through index declarations',()=>{
 const root=doc('zh/index.md','old'), guides={...doc('zh/guides/index.md'),references:['a/zh/guides/install.md']};
 const guide={...doc('zh/guides/install.md'),references:['a/zh/draft.md']}, draft=doc('zh/draft.md');
 const previous={scopes:[scope('a',[root,guides,guide,draft])]};
 const declared={...root,sha256:'new',references:['a/zh/guides/index.md']};
 const manifest={language:'zh',scopes:[scope('a',[declared,guides,guide,{...draft,sha256:'changed'}])]};
 assert.deepEqual(changedPages(manifest,previous,url,{declaredOnly:true}).map(page=>[page.path,page.change]),
  [['zh/guides/install.md','added']]);
});

test('chapter comparisons use portal anchors and locate a removed chapter at its surviving parent',()=>{
  const original=analyze('---\nsidebar_position: 1\n---\n# 安装指南\n\n旧简介。\n\n## 安装\n\n安装说明。\n\n### 配置\n\n旧配置。\n\n### 旧命令\n\n旧命令说明。\n\n## 排错\n\n### 配置\n\n排错配置未改。\n');
  const current=analyze('---\nsidebar_position: 2\n---\n# 安装指南\n\n新简介。\n\n## 安装\n\n安装说明。\n\n### 配置\n\n新配置。\n\n### 验证\n\n验证方式。\n\n## 排错\n\n### 配置\n\n排错配置未改。\n');
  assert.deepEqual(changedSections(original,current),[
    {title:'安装指南',anchor:'安装指南',change:'modified'},
    {title:'配置',anchor:'配置',change:'modified'},
    {title:'验证',anchor:'验证',change:'added'},
    {title:'旧命令',anchor:'安装',change:'removed'}
  ]);
  assert.deepEqual(changedSections(original,{...original,data:{sidebar_position:2}}),[]);
  assert.deepEqual(changedSections(analyze('# Guide\n\n## First\n\nFirst.\n\n## Second\n\nSecond.'),
    analyze('# Guide\n\n## Second\n\nSecond.\n\n## First\n\nFirst.')).map(section=>section.change),
    ['reordered','reordered']);
});

test('a changed file at a new path carries both path and chapter changes',()=>{
  const previous={scopes:[scope('a',[doc('zh/old/steps.md','old')])],redirects:{}};
  const manifest={language:'zh',scopes:[scope('a',[doc('zh/new/steps.md','new')])],
    redirects:{'a/zh/old/steps.md':'a/zh/new/steps.md'}};
  const old=analyze('# Guide\n\n## 2. Setup\n\nOld steps.\n');
  const current=analyze('# Guide\n\n## 2. Setup\n\nNew steps.\n');
  const pages=new Map([['a/zh/new/steps.md',current]]);
  const result={manifest,previous,pages};
  const compared=documentChanges(result,(_scope,doc)=>{
    assert.equal(doc.path,'zh/old/steps.md');
    return old;
  });
  const [page]=changedPages(manifest,previous,url,{documentChanges:compared});
  assert.equal(page.change,'moved');
  assert.deepEqual(page.content,{status:'changed',sections:[{title:'2. Setup',anchor:'_2-setup',change:'modified'}]});
  assert.doesNotThrow(()=>previewSites([{language:'zh',digest,url,pages:[page],redirects:[]}]));
  assert.equal(documentChanges(result,()=>null)['a/zh/new/steps.md'].reason,'missing-baseline');
});
