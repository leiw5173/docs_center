const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {build,writePreview,validateRegistry,snapshot,sha,git,compareCandidate}=require('./core.cjs');
const {referenceGroups,selectGroup,releaseLocation,parseReleaseBranch,acceptedState,scopeFingerprint,affectedRepositories}=require('./groups.cjs');
const root=path.resolve(__dirname,'../..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const encode=value=>encodeURIComponent(value);
function argument(name,fallback){const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];}
async function api(resource,method='GET',body) {
  if(!process.env.GH_TOKEN)throw Error('GH_TOKEN is required');
  const response=await fetch(`https://api.github.com${resource}`,{method,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!response.ok){const permissions=response.headers.get('x-accepted-github-permissions');const error=Error(`GitHub ${method} request failed: HTTP ${response.status}${permissions?`; required permissions: ${permissions}`:''}`);error.httpStatus=response.status;throw error;}
  return response.status===204?null:response.json();
}
async function authorizeMaintainer(repo,actor) {
  const maintainers=(process.env.DOCUMENT_GOVERNANCE_MAINTAINERS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(maintainers.includes(actor)) {
    const permission=await api(`/repos/${repo}/collaborators/${encode(actor)}/permission`);
    if(['admin','maintain','write'].includes(permission.permission))return;
  }else {
    const team=process.env.DOCUMENT_GOVERNANCE_TEAM,org=process.env.DOCUMENT_GOVERNANCE_TEAM_ORG||repo.split('/')[0];
    if(/^[\w-]+$/.test(team||'')&&/^[\w-]+$/.test(org)){const member=await api(`/orgs/${org}/teams/${team}/memberships/${encode(actor)}`);if(member.state==='active')return;}
  }
  throw Error('Only configured document maintainers or team members can update governance candidates');
}
function cloneSources(registry,revisions,temp) {
  const roots={};
  // Git credentials are supplied by the runner's credential helper, never URL arguments.
  for(const r of registry.repositories) {
    const dest=path.join(temp,r.id);execFileSync('git',['init','--bare',dest],{stdio:'ignore'});
    const ref=revisions[r.id]||r.branch;
    execFileSync('git',['-C',dest,'fetch','--quiet','--no-tags',`https://github.com/${r.repository}.git`,ref],{stdio:'pipe',timeout:120000});
    revisions[r.id]=git(dest,'rev-parse','FETCH_HEAD').toString().trim();roots[r.id]=dest;
  }
  return roots;
}
function checkRegistration(registry,temp) {
  validateRegistry(registry);const id=registry.change?.repositoryId;
  const entry=registry.repositories.find(r=>r.id===id);if(!entry)throw Error('Registration PR must identify the changed source');
  const revisions={},roots=cloneSources({repositories:[entry]},revisions,temp),files=snapshot(roots[id],revisions[id]);
  for(const language of entry.languages)if(![...files.keys()].some(file=>file.startsWith(language+'/')&&file.endsWith('.md')))throw Error(`No Markdown in registered language ${language}`);
  console.log(`Registration source is readable at fixed revision ${revisions[id]}; content and references are reviewed in the candidate PR`);
}
async function listCandidates(repo,language) {
  const results=[];
  for(let page=1;page<=20;page++) {
    const prs=await api(`/repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
    for(const pr of prs) {
      if(pr.head.repo?.full_name!==repo||!pr.head.ref.startsWith(`document-release/${language}`))continue;
      let location;try{location=parseReleaseBranch(pr.head.ref);}catch{continue;}
      const content=await api(`/repos/${repo}/contents/${location.file}?ref=${encode(pr.head.sha)}`);
      results.push({pr,location,content,manifest:JSON.parse(Buffer.from(content.content,'base64').toString())});
    }
    if(prs.length<100)return results;
  }
  throw Error('Too many pending release PRs');
}
async function writeCandidate(repo,location,manifest,existing) {
  let head,base;
  if(existing) {
    head=(await api(`/repos/${repo}/git/ref/heads/${encode(location.branch)}`)).object.sha;base=head;
    if(head!==existing.pr.head.sha){const error=Error('Candidate advanced concurrently; reload before writing');error.httpStatus=409;throw error;}
  }else {
    const metadata=await api(`/repos/${repo}`);base=(await api(`/repos/${repo}/git/ref/heads/${encode(metadata.default_branch)}`)).object.sha;
    try {
      head=(await api(`/repos/${repo}/git/ref/heads/${encode(location.branch)}`)).object.sha;
      const opened=await api(`/repos/${repo}/pulls?state=open&head=${encode(repo.split('/')[0]+':'+location.branch)}`);
      if(opened.length){const error=Error('Candidate opened concurrently');error.httpStatus=409;throw error;}
    }catch(error){if(error.httpStatus!==404)throw error;await api(`/repos/${repo}/git/refs`,'POST',{ref:`refs/heads/${location.branch}`,sha:base});head=base;}
  }
  const parent=await api(`/repos/${repo}/git/commits/${base}`);
  const files={[location.file]:JSON.stringify(manifest,null,2)+'\n'};
  for(const scope of manifest.scopes)files[`document-center/state/${manifest.language}/${scope.repoId}.json`]=JSON.stringify({repoId:scope.repoId,groupId:manifest.groupId},null,2)+'\n';
  const tree=await api(`/repos/${repo}/git/trees`,'POST',{base_tree:parent.tree.sha,tree:Object.entries(files).map(([file,content])=>({path:file,mode:'100644',type:'blob',content}))});
  const commit=await api(`/repos/${repo}/git/commits`,'POST',{message:`docs: update ${manifest.language} reference group ${manifest.groupId}`,tree:tree.sha,parents:head===base?[head]:[head,base]});
  await api(`/repos/${repo}/git/refs/heads/${location.branch}`,'PATCH',{sha:commit.sha,force:false});
}
async function candidate(registry,temp,attempt=0,sourceOverride=null) {
  validateRegistry(registry);
  const event=read(process.env.GITHUB_EVENT_PATH),source=sourceOverride||event.client_payload;
  const incoming=registry.repositories.find(r=>r.repository===source?.repository);
  if(!incoming||!/^[a-f0-9]{40}$/.test(source.commit||''))throw Error('Unregistered or unpinned source event');
  const repo=process.env.GITHUB_REPOSITORY;
  if(!/^[\w-]+\/[\w.-]+$/.test(repo||''))throw Error('Invalid governance repository');
  for(const language of incoming.languages) {
    const previous=acceptedState(root,language),pending=await listCandidates(repo,language);
    const overrides={references:{...previous.references},redirects:{...previous.redirects},labels:{...previous.labels},feedback:[...previous.feedback]};
    for(const p of [...pending].sort((a,b)=>a.pr.number-b.pr.number)) {
      for(const key of ['references','redirects','labels'])Object.assign(overrides[key],p.manifest[key]||{});
      overrides.feedback.push(...(p.manifest.feedback||[]));
    }
    let wanted=affectedRepositories([incoming.id],pending),result,groups;
    const roots={},revisions={},known=new Map(previous.scopes.map(s=>[s.repoId,s]));
    for(const p of pending)for(const scope of p.manifest.scopes)known.set(scope.repoId,scope);
    for(let expansion=0;expansion<=registry.repositories.length;expansion++) {
      const missing=registry.repositories.filter(r=>wanted.has(r.id)&&!roots[r.id]);
      const sourceDir=fs.mkdtempSync(path.join(temp,'sources-'));Object.assign(roots,cloneSources({repositories:missing},revisions,sourceDir));
      const selected=registry.repositories.filter(r=>wanted.has(r.id)&&r.languages.includes(language));
      result=build({registry:{schemaVersion:1,repositories:selected},roots,revisions,language,previous,overrides});
      const fresh=new Map(result.manifest.scopes.map(s=>[s.repoId,s]));
      const graphScopes=registry.repositories.filter(r=>r.languages.includes(language)).map(r=>fresh.get(r.id)||known.get(r.id)||{repoId:r.id,documents:[]});
      groups=referenceGroups({scopes:graphScopes,redirects:overrides.redirects},previous.scopes).filter(g=>g.repositories.some(id=>wanted.has(id)));
      const expanded=new Set(groups.flatMap(g=>g.repositories));
      const next=affectedRepositories([...expanded],pending);
      if([...next].every(id=>wanted.has(id)))break;
      wanted=next;if(expansion===registry.repositories.length)throw Error('Reference group did not converge');
    }
    execFileSync('git',['-C',roots[incoming.id],'fetch','--quiet',`https://github.com/${incoming.repository}.git`,source.commit],{stdio:'pipe'});
    if(!['ahead','identical'].includes(compareCandidate(roots[incoming.id],source.commit,revisions[incoming.id])))throw Error('Source event is outside registered branch history');
    for(const old of known.values())if(roots[old.repoId]&&old.commit!==revisions[old.repoId]) {
      const registered=registry.repositories.find(r=>r.id===old.repoId);execFileSync('git',['-C',roots[old.repoId],'fetch','--quiet',`https://github.com/${registered.repository}.git`,old.commit],{stdio:'pipe'});
      if(compareCandidate(roots[old.repoId],old.commit,revisions[old.repoId])!=='ahead')throw Error('Source history regressed or diverged');
    }
    const completed=new Set();
    for(const group of groups) {
      const selected=selectGroup(result,group),location=releaseLocation(language,group.groupId);
      const existing=pending.find(p=>p.location.branch===location.branch);
      const unchanged=group.repositories.every(id=>scopeFingerprint(selected.manifest.scopes.find(s=>s.repoId===id))===scopeFingerprint(previous.scopes.find(s=>s.repoId===id)));
      if(!existing&&unchanged){for(const id of group.repositories)completed.add(id);continue;}
      if(existing&&JSON.stringify(existing.manifest)===JSON.stringify(selected.manifest)){for(const id of group.repositories)completed.add(id);continue;}
      try{await writeCandidate(repo,location,selected.manifest,existing);}
      catch(error){if([409,422].includes(error.httpStatus)&&attempt<3)return candidate(registry,fs.mkdtempSync(path.join(temp,'retry-')),attempt+1,source);throw error;}
      const body=`引用关联组：${group.repositories.join(', ')}\n\n清单 SHA-256：${selected.digest}\n\n阻断问题：${selected.errors.length}；人工核对项：${selected.warnings.length}。查看检查报告和预览。\n\n- [ ] 内容完整性、直接及间接引用、目录子类已核对\n- [ ] 标签、反馈、地址迁移及版本归档已核对\n- [ ] 预览通过，由文档团队手动合并\n\n同组新修订更新本 PR；未关联来源独立发布。`;
      if(existing)await api(`/repos/${repo}/pulls/${existing.pr.number}`,'PATCH',{body});
      else {const metadata=await api(`/repos/${repo}`);await api(`/repos/${repo}/pulls`,'POST',{title:`文档发布候选（${language}：${group.repositories.join(', ')}）`,head:location.branch,base:metadata.default_branch,body});}
      for(const id of group.repositories)completed.add(id);
    }
    for(const old of pending)if(old.manifest.scopes.some(s=>wanted.has(s.repoId))&&!groups.some(g=>g.groupId===old.manifest.groupId)&&old.manifest.scopes.every(s=>completed.has(s.repoId))) {
      await api(`/repos/${repo}/pulls/${old.pr.number}`,'PATCH',{state:'closed',body:old.pr.body+'\n\n此候选已由重新计算的引用关联组替代，请审核新的发布 PR。'});
    }
  }
}
function baseState(language) {
  const event=process.env.GITHUB_EVENT_PATH?read(process.env.GITHUB_EVENT_PATH):{};
  const ref=event.pull_request?.base?.sha;
  if(!ref)return acceptedState(root,language);
  if(!/^[a-f0-9]{40}$/.test(ref))throw Error('Invalid base revision');
  execFileSync('git',['-C',root,'fetch','--quiet','--no-tags','origin',ref],{stdio:'pipe'});
  const readBase=file=>{const {spawnSync}=require('node:child_process');const result=spawnSync('git',['-C',root,'show',`${ref}:${file}`],{encoding:'utf8',maxBuffer:40*1024*1024});if(result.status!==0){const error=Error('Missing base file');error.code='MISSING_BASE_FILE';throw error;}return result.stdout;};
  const listBase=dir=>git(root,'ls-tree','-r','--name-only',ref,'--',dir).toString().trim().split('\n').filter(Boolean);
  return acceptedState(root,language,readBase,listBase);
}
async function check(registry,temp) {
  const file=argument('--manifest');if(!file)throw Error('--manifest is required');
  const input=read(path.resolve(root,file)),selectedIds=new Set(input.scopes.map(s=>s.repoId));
  const selectedRegistry={schemaVersion:1,repositories:registry.repositories.filter(r=>selectedIds.has(r.id))};
  if(selectedRegistry.repositories.length!==selectedIds.size||input.scopes.length!==selectedIds.size)throw Error('Duplicate or unregistered scope');
  const revisions=Object.fromEntries(input.scopes.map(s=>[s.repoId,s.commit]));const roots=cloneSources(selectedRegistry,revisions,temp);
  const previous=baseState(input.language);
  let result=build({registry:selectedRegistry,roots,revisions,language:input.language,previous,overrides:input});
  if(input.groupId) {
    const fresh=new Map(result.manifest.scopes.map(s=>[s.repoId,s])),old=new Map(previous.scopes.map(s=>[s.repoId,s]));
    const graph={scopes:registry.repositories.filter(r=>r.languages.includes(input.language)).map(r=>fresh.get(r.id)||old.get(r.id)||{repoId:r.id,documents:[]}),redirects:input.redirects};
    const expected=referenceGroups(graph,previous.scopes).find(g=>g.repositories.includes(input.scopes[0].repoId));
    if(expected.groupId!==input.groupId||JSON.stringify(expected.repositories)!==JSON.stringify(input.groupRepositories)||expected.repositories.length!==selectedIds.size)throw Error('Reference group changed; regenerate the candidate PR');
    result=selectGroup(result,expected);
    for(const repoId of expected.repositories){const pointer=read(path.join(root,`document-center/state/${input.language}/${repoId}.json`));if(pointer.repoId!==repoId||pointer.groupId!==input.groupId)throw Error('Accepted revision pointer differs from candidate group');}
  }
  const stable=m=>{const {warnings,...rest}=m;return rest;};
  if(JSON.stringify(stable(input))!==JSON.stringify(stable(result.manifest)))result.errors.push({code:'manifest-mismatch',message:'Registry or immutable source differs from reviewed manifest'});
  const out=path.resolve(argument('--output',path.join(os.tmpdir(),'document-preview')));writePreview(result,out);
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(input,null,2));
  for(const error of result.errors)console.error(JSON.stringify(error));
  console.log(JSON.stringify({manifestDigest:sha(JSON.stringify(input)),errors:result.errors.length,warnings:input.warnings.length,preview:out}));
  if(result.errors.length)process.exitCode=1;
}
function registrationFromIssue(body) {
  const fields={};let name=null;
  for(const line of body.split('\n')){if(line.startsWith('### ')){name=line.slice(4).trim();fields[name]='';}else if(name)fields[name]+=line+'\n';}
  const value=name=>(fields[name]||'').trim();
  const optional=name=>{const text=value(name);return text==='_No response_'?'':text;};
  return {id:value('登记 ID'),repository:value('来源仓库'),branch:value('分支')||'main',prefix:value('目标路径前缀'),rootDep:Number(value('目录层级 rootDep')),column:value('目标栏目'),...(optional('子类节点 ID')?{parentNavigationId:optional('子类节点 ID')}:{}),...(optional('分类路径')?{navigationPath:optional('分类路径').split('/').map(p=>p.trim()).filter(Boolean)}:{}),languages:value('语言').split(',').map(x=>x.trim()).filter(Boolean)};
}
async function registration(registry) {
  const event=read(process.env.GITHUB_EVENT_PATH),issue=event.issue,repo=process.env.GITHUB_REPOSITORY;
  if(!issue||!issue.title.startsWith('[文档接入]'))return;
  await authorizeMaintainer(repo,issue.user.login);
  const entry=registrationFromIssue(issue.body||'');
  const updated={schemaVersion:1,change:{repositoryId:entry.id},repositories:[...registry.repositories.filter(r=>r.id!==entry.id),entry].sort((a,b)=>a.id.localeCompare(b.id))};validateRegistry(updated);
  const branch=`document-registration/issue-${issue.number}`,repository=await api(`/repos/${repo}`);
  const prs=await api(`/repos/${repo}/pulls?state=open&head=${encode(repo.split('/')[0]+':'+branch)}`);
  if(!prs.length){
    const ref=await api(`/repos/${repo}/git/ref/heads/${encode(repository.default_branch)}`);
    const refs=await api(`/repos/${repo}/git/matching-refs/heads/${branch}`);
    if(refs.some(r=>r.ref===`refs/heads/${branch}`))await api(`/repos/${repo}/git/refs/heads/${branch}`,'PATCH',{sha:ref.object.sha,force:true});
    else await api(`/repos/${repo}/git/refs`,'POST',{ref:`refs/heads/${branch}`,sha:ref.object.sha});
  }
  const previous=await api(`/repos/${repo}/contents/document-center/registry.json?ref=${encode(branch)}`);
  await api(`/repos/${repo}/contents/document-center/registry.json`,'PUT',{branch,message:`docs: register ${entry.repository}`,sha:previous.sha,content:Buffer.from(JSON.stringify(updated,null,2)+'\n').toString('base64')});
  const body=`来自接入申请 #${issue.number}。\n\n请核对来源、语言、目标路径、排序层级和后端注册 ID。该 PR 仅登记来源，不发布正文。\n\nCloses #${issue.number}`;
  if(prs.length)await api(`/repos/${repo}/pulls/${prs[0].number}`,'PATCH',{body});
  else await api(`/repos/${repo}/pulls`,'POST',{title:`登记文档仓库 ${entry.repository}`,head:branch,base:repository.default_branch,body});
}
async function governanceChange(attempt=0) {
  const event=read(process.env.GITHUB_EVENT_PATH),issue=event.issue,repo=process.env.GITHUB_REPOSITORY;
  if(!issue?.title.startsWith('[文档治理]'))return;
  await authorizeMaintainer(repo,issue.user.login);
  const fields={};let name=null;
  for(const line of (issue.body||'').split('\n'))if(line.startsWith('### ')){name=line.slice(4).trim();fields[name]='';}else if(name)fields[name]+=line+'\n';
  const value=name=>(fields[name]||'').trim();const language=value('发布语言');
  if(!['zh','en'].includes(language))throw Error('Invalid release language');
  const target=value('文档标识');
  const choices=(await listCandidates(repo,language)).filter(p=>p.manifest.scopes.some(s=>s.repoId===target.split('/')[0]));
  if(choices.length>1)throw Error('Multiple pending groups contain this repository; regenerate candidates first');
  const existing=choices[0],branch=existing?.location.branch;
  if(!existing)throw Error('No pending release PR; keep this issue open until a candidate exists');
  const manifest=existing.manifest,content=value('调整内容');
  const documents=new Set(manifest.scopes.flatMap(s=>s.documents.map(d=>`${s.repoId}/${d.path}`)));
  switch(value('调整类型')) {
    case '地址迁移':if(content==='清除'){delete manifest.redirects[target];break;}if(documents.has(target)||!documents.has(content))throw Error('Migration must map a removed ID to an existing document ID');manifest.redirects[target]=content;break;
    case '标签调整':if(content==='清除'){delete manifest.labels[target];break;}if(!documents.has(target))throw Error('Document is outside candidate');manifest.labels[target]=content.split(/[,，]/).map(x=>x.trim()).filter(Boolean);break;
    case '引用登记':{
      const url=value('引用原地址'),registry=read(path.join(root,'document-center/registry.json'));if(!documents.has(target)||!registry.repositories.some(r=>r.id===content.split('/')[0])||!content.includes(`/${language}/`)||!content.endsWith('.md')||!url)throw Error('Reference target must be a registered document in this language');manifest.references[`${target}::${url}`]=content;
      // The CI checker regenerates references from this registration and validates closure.
      const scope=manifest.scopes.find(s=>target.startsWith(s.repoId+'/'));
      const doc=scope.documents.find(d=>`${scope.repoId}/${d.path}`===target);
      if(!doc.references.includes(content))doc.references.push(content);doc.references.sort();break;
    }
    case '文档反馈':manifest.feedback=manifest.feedback.filter(f=>f.issue!==issue.number);manifest.feedback.push({issue:issue.number,document:target,message:content});break;
    default:throw Error('Unknown governance operation');
  }
  try{await api(`/repos/${repo}/contents/${existing.location.file}`,'PUT',{branch,sha:existing.content.sha,message:`docs: apply governance issue #${issue.number}`,content:Buffer.from(JSON.stringify(manifest,null,2)+'\n').toString('base64')});}
  catch(error){if(error.httpStatus===409&&attempt<3)return governanceChange(attempt+1);throw error;}
  if(value('调整类型')==='引用登记'){const scope=manifest.scopes.find(s=>s.repoId===target.split('/')[0]);const temp=fs.mkdtempSync(path.join(os.tmpdir(),'governance-regroup-'));try{await candidate(read(path.join(root,'document-center/registry.json')),temp,0,{repository:scope.repository,commit:scope.commit});}finally{fs.rmSync(temp,{recursive:true,force:true});}}
  console.log(`Governance issue #${issue.number} applied to release PR #${existing.pr.number}; CI must rerun`);
}
async function publish() {
  const event=read(process.env.GITHUB_EVENT_PATH),pr=event.pull_request;
  if(event.action!=='closed'||!pr?.merged)throw Error('Only a merged release PR may publish');
  const expected=process.env.GITHUB_REPOSITORY;
  const registration=/^document-registration\/issue-[1-9][0-9]*$/.test(pr.head.ref);
  if(pr.base.repo.full_name!==expected||pr.head.repo.full_name!==expected)throw Error('Unexpected release PR origin');
  const location=registration?null:parseReleaseBranch(pr.head.ref);
  const document=registration?{registry:read(path.join(root,'document-center/registry.json'))}:{manifest:read(path.join(root,location.file))};
  const base=process.env.DOCUMENT_PUBLISH_URL,token=process.env.DOCUMENT_RELEASE_TOKEN;
  if(!base||!token)throw Error('Protected release environment is not configured');
  const url=new URL(registration?'/admin/documents/governance/registration':'/admin/documents/releases',base);if(url.protocol!=='https:')throw Error('Release endpoint must use HTTPS');
  const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Document-Release-Token':token},body:JSON.stringify({governanceRepository:expected,governanceCommit:pr.merge_commit_sha,pullRequest:pr.number,...document}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error(`Release request failed: HTTP ${response.status}; check the PR result before retrying`);
  console.log(JSON.stringify(await response.json()));
}
async function backendPreview() {
  const event=read(process.env.GITHUB_EVENT_PATH),pr=event.pull_request,repo=process.env.GITHUB_REPOSITORY;
  if(!pr||pr.head.repo.full_name!==repo||!/^[a-f0-9]{40}$/.test(pr.head.sha))throw Error('Unexpected candidate preview origin');
  const location=parseReleaseBranch(pr.head.ref);
  const content=await api(`/repos/${repo}/contents/${location.file}?ref=${pr.head.sha}`);
  const manifest=JSON.parse(Buffer.from(content.content,'base64').toString());
  const base=process.env.DOCUMENT_PREVIEW_URL,token=process.env.DOCUMENT_PREVIEW_TOKEN;
  if(!base||!token)throw Error('Backend candidate preview environment is not configured');
  const url=new URL('/admin/documents/previews',base);if(url.protocol!=='https:')throw Error('Preview endpoint must use HTTPS');
  const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Document-Preview-Token':token},body:JSON.stringify(manifest),signal:AbortSignal.timeout(120000)});
  if(!response.ok||!response.headers.get('content-type')?.includes('application/zip'))throw Error(`Backend preview failed: HTTP ${response.status}`);
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>128*1024*1024)throw Error('Preview exceeds 128 MiB');chunks.push(chunk);}
  const out=argument('--output',path.join(os.tmpdir(),'backend-preview.zip'));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,Buffer.concat(chunks));
  console.log(`Backend preview created for PR head ${pr.head.sha}`);
}
async function main(){
  const registry=read(path.join(root,'document-center/registry.json'));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'document-governance-'));
  try{switch(process.argv[2]){case 'candidate':return await candidate(registry,temp);case 'registration':return await registration(registry);case 'governance-change':return await governanceChange();case 'validate-registry':return validateRegistry(registry);case 'check-registration':return checkRegistration(registry,temp);case 'check':return await check(registry,temp);case 'backend-preview':return await backendPreview();case 'publish':return await publish();case 'report-stage':return await require('./report.cjs').reportStage(api,{repository:process.env.GITHUB_REPOSITORY,event:read(process.env.GITHUB_EVENT_PATH),needs:JSON.parse(process.env.DOCUMENT_JOB_RESULTS||'{}'),runId:process.env.GITHUB_RUN_ID});default:throw Error('Use candidate, registration, governance-change, validate-registry, check-registration, check --manifest FILE, backend-preview, publish, or report-stage');}}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={cloneSources,registrationFromIssue,candidate,writeCandidate,checkRegistration};
