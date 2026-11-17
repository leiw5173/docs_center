const {test}=require('node:test'),assert=require('node:assert/strict');
const {changedPages,previewSites}=require('../../scripts/document-governance/preview-sites.cjs');
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
