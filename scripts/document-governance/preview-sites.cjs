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
function migrationPreviews(manifest,previous,siteUrl,evidence=[]) {
  const documents = scopes => new Map(scopes.flatMap(scope => scope.documents.map(doc =>
    [scope.repoId+'/'+doc.path,{...doc,sourcePath:scope.prefix+'/'+doc.path.split('/').slice(1).join('/')}]
  )));
  const before = documents(previous?.scopes||[]), after = documents(manifest.scopes);
  const prefixes = new Map([...(previous?.scopes||[]),...manifest.scopes].map(scope=>[scope.repoId,scope.prefix]));
  const pageUrl = (sourcePath,anchor) => {
    const url = new URL('/community/document/info',siteUrl);
    url.search = new URLSearchParams({preview:new URL(siteUrl).searchParams.get('preview'),lang:manifest.language,nodepath:sourcePath});
    if (anchor) url.searchParams.set('anchor',anchor);
    return url.href;
  };
  const incoming = new Map();
  for (const docs of [before,after]) for (const [id,doc] of docs) for (const target of doc.references||[]) {
    if (!incoming.has(target)) incoming.set(target,new Set());
    incoming.get(target).add(id);
  }
  for (const ref of evidence) {
    if (!after.has(ref.document) || !manifest.redirects?.[ref.target]) continue;
    if (!incoming.has(ref.target)) incoming.set(ref.target,new Set());
    incoming.get(ref.target).add(ref.document);
  }
  return Object.entries(manifest.redirects||{}).filter(([from,to]) =>
    !directoryMetadata(from)&&!directoryMetadata(to)
  ).map(([from,to]) => {
    const [repo,,...path] = from.split('/');
    const sourcePrefix = before.get(from)?.sourcePath ?? prefixes.get(repo)+'/'+path.join('/');
    const targetPath = after.get(to)?.sourcePath;
    if (!targetPath || !prefixes.has(repo)) throw Error('Migration is outside the candidate preview: '+from+' → '+to);
    const direct = incoming.get(from)||new Set(), visited = new Set([from]), queue = [...direct];
    const references = [], anchors = new Set();
    for (let index=0;index<queue.length;index++) {
      const id = queue[index];
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(...incoming.get(id)||[]);
      const candidateId = manifest.redirects?.[id] || id;
      const doc = after.get(candidateId);
      if (directoryMetadata(id) || directoryMetadata(candidateId)) continue;
      const locations = evidence.filter(ref=>ref.target===from&&ref.document===id&&Number.isSafeInteger(ref.line));
      for (const ref of locations) if (typeof ref.anchor==='string'&&ref.anchor) anchors.add(ref.anchor);
      const info={id,title:doc?.title||before.get(id)?.title||id,direct:direct.has(id)};
      if (!locations.length) references.push({...info,url:doc ? pageUrl(doc.sourcePath) : null});
      for (const ref of locations) references.push({...info,line:ref.line,
        section:typeof ref.section==='string'?ref.section:'',
        url:doc ? pageUrl(doc.sourcePath,typeof ref.sectionAnchor==='string'?ref.sectionAnchor:'') : null});
    }
    return {from,to,sourcePath:sourcePrefix,targetPath,url:pageUrl(sourcePrefix),targetUrl:pageUrl(targetPath),references,anchors:[...anchors]};
  });
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
    if(!Array.isArray(site.redirects))throw Error('Invalid migration preview links');
    for(const redirect of site.redirects) {
      const link=new URL(redirect.url);
      if(directoryMetadata(redirect.from)||directoryMetadata(redirect.to)||link.origin!==url.origin||link.hash||link.pathname!=='/community/document/info'||link.searchParams.get('preview')!==site.digest||link.searchParams.get('lang')!==site.language||link.searchParams.get('nodepath')!==redirect.sourcePath||!redirect.targetPath||!redirect.from.includes(`/${site.language}/`)||!redirect.to.includes(`/${site.language}/`))throw Error('Invalid migration preview target');
      const validPage = (value,path) => {
        const page = new URL(value);
        return page.origin===url.origin && !page.username && !page.password && !page.hash &&
          page.pathname==='/community/document/info' && page.searchParams.get('preview')===site.digest &&
          page.searchParams.get('lang')===site.language && (path===undefined || page.searchParams.get('nodepath')===path);
      };
      if (!validPage(redirect.targetUrl,redirect.targetPath) || !Array.isArray(redirect.references) || !Array.isArray(redirect.anchors) ||
          redirect.anchors.some(anchor=>typeof anchor!=='string'||!anchor) ||
          redirect.references.some(ref=>typeof ref.id!=='string'||typeof ref.title!=='string'||
            typeof ref.direct!=='boolean'||(ref.line!==undefined&&(!Number.isSafeInteger(ref.line)||typeof ref.section!=='string'))||(ref.url!==null&&!validPage(ref.url)))) throw Error('Invalid migration review links');
    }
  }
  return sites;
}
module.exports={previewSites,changedPages,directoryMetadata,migrationPreviews};
