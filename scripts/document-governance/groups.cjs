const {sha}=require('./core.cjs');
const fs=require('node:fs');
const path=require('node:path');

// A repository is the smallest publication unit. Document references connect units.
function referenceGroups(current,previous=[]) {
  const ids=current.scopes.map(s=>s.repoId).sort(), adjacency=new Map(ids.map(id=>[id,new Set()]));
  for(const scope of [...previous,...current.scopes])for(const doc of scope.documents||[])for(const target of doc.references||[]) {
    const other=target.split('/')[0];if(!adjacency.has(scope.repoId)||!adjacency.has(other)||other===scope.repoId)continue;
    adjacency.get(scope.repoId).add(other);adjacency.get(other).add(scope.repoId);
  }
  for(const [from,to]of Object.entries(current.redirects||{})){const a=from.split('/')[0],b=to.split('/')[0];if(a!==b&&adjacency.has(a)&&adjacency.has(b)){adjacency.get(a).add(b);adjacency.get(b).add(a);}}
  const seen=new Set(),groups=[];
  for(const id of ids) {
    if(seen.has(id))continue;const members=[],queue=[id];seen.add(id);
    while(queue.length){const next=queue.shift();members.push(next);for(const peer of adjacency.get(next))if(!seen.has(peer)){seen.add(peer);queue.push(peer);}}
    members.sort();groups.push({groupId:'g-'+sha(members.join('\n')).slice(0,20),repositories:members});
  }
  return groups;
}
function selectGroup(result,group) {
  const selected=new Set(group.repositories),belongs=key=>selected.has(key.split('/')[0]);
  const entries=(value,predicate)=>Object.fromEntries(Object.entries(value||{}).filter(([k,v])=>predicate(k,v)));
  const manifest={...result.manifest,groupId:group.groupId,groupRepositories:[...group.repositories],scopes:result.manifest.scopes.filter(s=>selected.has(s.repoId)),
    references:entries(result.manifest.references,k=>belongs(k)),redirects:entries(result.manifest.redirects,(k,v)=>belongs(k)||belongs(v)),
    labels:entries(result.manifest.labels,k=>belongs(k)),feedback:(result.manifest.feedback||[]).filter(f=>belongs(f.document||'')),warnings:result.warnings.filter(w=>selected.has(w.repo)||(!w.repo&&belongs(w.file||'')))};
  return {manifest,digest:sha(JSON.stringify(manifest)),errors:result.errors.filter(e=>selected.has(e.repo)||(!e.repo&&belongs(e.file||''))),warnings:manifest.warnings,pages:new Map([...result.pages].filter(([key])=>belongs(key)))};
}
function releaseLocation(language,groupId) {
  if(!['zh','en'].includes(language)||(groupId&&!/^g-[a-f0-9]{20}$/.test(groupId)))throw Error('Invalid release identity');
  return {branch:`document-release/${language}${groupId?'/'+groupId:''}`,file:`document-center/releases/${language}${groupId?'/'+groupId:''}.json`};
}
function parseReleaseBranch(branch) {
  const match=/^document-release\/(zh|en)(?:\/(g-[a-f0-9]{20}))?$/.exec(branch||'');
  if(!match)throw Error('Unexpected release branch');return {language:match[1],groupId:match[2]||null,...releaseLocation(match[1],match[2])};
}
function acceptedScopes(root,language,readFile=file=>fs.readFileSync(path.join(root,file),'utf8'),listFiles=null) {
  const dir=`document-center/state/${language}`;
  const files=listFiles?listFiles(dir):(fs.existsSync(path.join(root,dir))?fs.readdirSync(path.join(root,dir)).map(f=>`${dir}/${f}`):[]);
  const scopes=new Map();
  try{const legacy=JSON.parse(readFile(`document-center/releases/${language}.json`));for(const s of legacy.scopes||[])scopes.set(s.repoId,s);}catch(error){if(error.code!=='ENOENT'&&error.code!=='MISSING_BASE_FILE')throw error;}
  for(const file of files.filter(f=>f.endsWith('.json'))) {
    const pointer=JSON.parse(readFile(file));if(!/^[\w-][\w.-]*$/.test(pointer.repoId))throw Error('Invalid accepted source pointer');
    const release=JSON.parse(readFile(releaseLocation(language,pointer.groupId).file));
    const scope=release.scopes.find(s=>s.repoId===pointer.repoId);if(!scope)throw Error('Accepted source points outside release');scopes.set(scope.repoId,scope);
  }
  return [...scopes.values()].sort((a,b)=>a.repoId.localeCompare(b.repoId));
}
function acceptedState(root,language,readFile=file=>fs.readFileSync(path.join(root,file),'utf8'),listFiles=null) {
  const scopes=acceptedScopes(root,language,readFile,listFiles),state={schemaVersion:1,language,scopes,references:{},redirects:{},labels:{},feedback:[]};
  const dir=`document-center/state/${language}`,files=listFiles?listFiles(dir):(fs.existsSync(path.join(root,dir))?fs.readdirSync(path.join(root,dir)).map(f=>`${dir}/${f}`):[]);
  for(const file of files.filter(f=>f.endsWith('.json'))) {
    const pointer=JSON.parse(readFile(file)),manifest=JSON.parse(readFile(releaseLocation(language,pointer.groupId).file));
    for(const key of ['references','redirects','labels'])Object.assign(state[key],Object.fromEntries(Object.entries(manifest[key]||{}).filter(([id])=>id.split('/')[0]===pointer.repoId)));
    state.feedback.push(...(manifest.feedback||[]).filter(f=>(f.document||'').split('/')[0]===pointer.repoId));
  }
  return state;
}
function scopeFingerprint(scope){if(!scope)return null;const {commit,...content}=scope;return sha(JSON.stringify(content));}
function affectedRepositories(seeds,pending) {
  const affected=new Set(seeds);let changed=true;
  while(changed){changed=false;for(const p of pending){const members=p.manifest.scopes.map(s=>s.repoId);if(members.some(id=>affected.has(id)))for(const id of members)if(!affected.has(id)){affected.add(id);changed=true;}}}
  return affected;
}
module.exports={referenceGroups,selectGroup,releaseLocation,parseReleaseBranch,acceptedScopes,acceptedState,scopeFingerprint,affectedRepositories};
