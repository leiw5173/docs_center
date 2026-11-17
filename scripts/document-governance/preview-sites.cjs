const directoryMetadata=path=>/(?:^|\/)(?:index|readme)\.md$/i.test(path);
function changedPages(manifest,previous,siteUrl) {
  const before=new Map((previous?.scopes||[]).map(scope=>[scope.repoId,scope]));
  const oldDocs=new Map((previous?.scopes||[]).flatMap(scope=>scope.documents.map(doc=>[scope.repoId+'/'+doc.path,doc])));
  const moved=new Set(Object.entries(manifest.redirects||{}).filter(([from,to])=>previous?.redirects?.[from]!==to).map(([,to])=>to));
  const placement=scope=>scope&&JSON.stringify([scope.prefix,scope.rootDep,scope.column,scope.parentNavigationId,scope.navigationPath]);
  const content=doc=>doc&&JSON.stringify([doc.sha256,doc.title,doc.sidebarPosition,doc.softwareVersion,doc.references]);
  const pages=[];
  for(const scope of manifest.scopes)for(const doc of scope.documents) {
    if(directoryMetadata(doc.path))continue;
    const id=scope.repoId+'/'+doc.path,old=oldDocs.get(id);
    const labelsChanged=JSON.stringify(previous?.labels?.[id]||[])!==JSON.stringify(manifest.labels?.[id]||[]);
    const feedbackChanged=JSON.stringify((previous?.feedback||[]).filter(f=>f.document===id))!==JSON.stringify((manifest.feedback||[]).filter(f=>f.document===id));
    if(old&&content(old)===content(doc)&&placement(before.get(scope.repoId))===placement(scope)&&!labelsChanged&&!feedbackChanged&&!moved.has(id))continue;
    const sourcePath=scope.prefix+'/'+doc.path.split('/').slice(1).join('/'),url=new URL('/community/document/info',siteUrl);
    url.search=new URLSearchParams({preview:new URL(siteUrl).searchParams.get('preview'),lang:manifest.language,nodepath:sourcePath});
    pages.push({title:doc.title||doc.path,path:doc.path,sourcePath,change:moved.has(id)?'moved':old?'modified':'added',url:url.href});
  }
  return pages;
}
function previewSites(value) {
  const sites=typeof value==='string'?JSON.parse(value):value;
  if(!Array.isArray(sites)||!sites.length||sites.length>2)throw Error('Deployed preview links are required');
  const languages=new Set();
  for(const site of sites) {
    if(!['zh','en'].includes(site.language)||languages.has(site.language)||!/^[a-f0-9]{64}$/.test(site.digest))throw Error('Invalid deployed preview identity');languages.add(site.language);
    const url=new URL(site.url);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.pathname!=='/community/document'||url.searchParams.get('preview')!==site.digest||url.searchParams.get('lang')!==site.language)throw Error('Invalid deployed document center URL');
    if(!Array.isArray(site.pages))throw Error('Changed page previews are required');
    const paths=new Set();
    for(const page of site.pages) {
      const link=new URL(page.url);
      if(paths.has(page.sourcePath)||typeof page.title!=='string'||typeof page.path!=='string'||directoryMetadata(page.path)||directoryMetadata(page.sourcePath)||!page.path.startsWith(site.language+'/')||!['added','modified','moved'].includes(page.change)||link.origin!==url.origin||link.hash||link.pathname!=='/community/document/info'||link.searchParams.get('preview')!==site.digest||link.searchParams.get('lang')!==site.language||link.searchParams.get('nodepath')!==page.sourcePath)throw Error('Invalid changed page preview');
      paths.add(page.sourcePath);
    }
    if(!Array.isArray(site.redirects)||site.redirects.length>4)throw Error('Invalid migration preview links');
    for(const redirect of site.redirects) {
      const link=new URL(redirect.url);
      if(directoryMetadata(redirect.from)||directoryMetadata(redirect.to)||link.origin!==url.origin||link.hash||link.pathname!=='/community/document/info'||link.searchParams.get('preview')!==site.digest||link.searchParams.get('lang')!==site.language||link.searchParams.get('nodepath')!==redirect.sourcePath||!redirect.targetPath||!redirect.from.includes(`/${site.language}/`)||!redirect.to.includes(`/${site.language}/`))throw Error('Invalid migration preview target');
    }
  }
  return sites;
}
module.exports={previewSites,changedPages,directoryMetadata};
