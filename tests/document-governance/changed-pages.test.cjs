const {test}=require('node:test'),assert=require('node:assert/strict');
const {changedPages}=require('../../scripts/document-governance/preview-sites.cjs');
const digest='b'.repeat(64),url=`https://preview.example/community/document?preview=${digest}&lang=zh`;
const doc=(path,sha256=path)=>({path,sha256,title:path,sidebarPosition:1,softwareVersion:null,references:[]});
const scope=(repoId,documents)=>({repoId,prefix:repoId,rootDep:1,column:'cases',language:'zh',documents});
test('lists each modified or moved page once and excludes unchanged related sources',()=>{
 const previous={scopes:[scope('a',[doc('zh/index.md','old'),doc('zh/guide/index.md','intro'),doc('zh/guide/steps.md','steps'),doc('zh/untouched.md')]),scope('b',[doc('zh/index.md')])],redirects:{}};
 const manifest={language:'zh',scopes:[scope('a',[doc('zh/index.md','new'),doc('zh/new/index.md','intro'),doc('zh/new/steps.md','steps'),doc('zh/untouched.md')]),scope('b',[doc('zh/index.md')])],redirects:{'a/zh/guide/index.md':'a/zh/new/index.md','a/zh/guide/steps.md':'a/zh/new/steps.md'}};
 const pages=changedPages(manifest,previous,url);
 assert.deepEqual(pages.map(page=>[page.path,page.change]),[['zh/index.md','modified'],['zh/new/index.md','moved'],['zh/new/steps.md','moved']]);
 for(const page of pages){const link=new URL(page.url);assert.equal(link.pathname,'/community/document/info');assert.equal(link.searchParams.get('nodepath'),page.sourcePath);assert.equal(link.searchParams.get('preview'),digest);assert.equal(link.searchParams.get('lang'),'zh');}
});
test('initial onboarding links every initial page; placement or labels changes link existing affected pages',()=>{
 const original=scope('a',[doc('zh/index.md'),doc('zh/steps.md')]);
 assert.equal(changedPages({language:'zh',scopes:[original]},null,url).length,2);
 assert.equal(changedPages({language:'zh',scopes:[{...original,parentNavigationId:'cases/new'}]},{scopes:[original]},url).length,2);
 const labelled=changedPages({language:'zh',scopes:[original],labels:{'a/zh/steps.md':['K3']}},{scopes:[original]},url);
 assert.deepEqual(labelled.map(page=>page.path),['zh/steps.md']);
});
