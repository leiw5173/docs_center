const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {build,writePreview,validateRegistry,sha,git,compareCandidate}=require('./core.cjs');
const root=path.resolve(__dirname,'../..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const encode=value=>encodeURIComponent(value);
function argument(name,fallback){const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];}
async function api(resource,method='GET',body) {
  if(!process.env.GH_TOKEN)throw Error('GH_TOKEN is required');
  const response=await fetch(`https://api.github.com${resource}`,{method,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!response.ok){const error=Error(`GitHub ${method} request failed: HTTP ${response.status}`);error.httpStatus=response.status;throw error;}
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
async function existingCandidate(repo,branch,language) {
  const prs=await api(`/repos/${repo}/pulls?state=open&head=${encode(repo.split('/')[0]+':'+branch)}&per_page=100`);
  if(!prs.length)return null;
  const content=await api(`/repos/${repo}/contents/document-center/releases/${language}.json?ref=${encode(branch)}`);
  return {pr:prs[0],content,manifest:JSON.parse(Buffer.from(content.content,'base64').toString())};
}
async function candidate(registry,temp,attempt=0) {
  const event=read(process.env.GITHUB_EVENT_PATH),source=event.client_payload;
  const incoming=registry.repositories.find(r=>r.repository===source?.repository);
  if(!incoming||!/^[a-f0-9]{40}$/.test(source.commit||''))throw Error('Unregistered or unpinned source event');
  const repo=process.env.GITHUB_REPOSITORY;
  if(!/^[\w-]+\/[\w.-]+$/.test(repo||''))throw Error('Invalid governance repository');
  // GitHub concurrency can coalesce pending events. Reconcile every language/source
  // on each wakeup, then pin the observed heads, so no repository's latest merge is lost.
  for(const language of [...new Set(registry.repositories.flatMap(r=>r.languages))]) {
    const branch=`document-release/${language}`, existing=await existingCandidate(repo,branch,language);
    const publishedFile=path.join(root,`document-center/releases/${language}.json`);
    const previous=fs.existsSync(publishedFile)?read(publishedFile):null;
    const base=existing?.manifest||previous;
    const revisions={};
    const scopeTemp=path.join(temp,language);fs.mkdirSync(scopeTemp);
    const roots=cloneSources(registry,revisions,scopeTemp);
    execFileSync('git',['-C',roots[incoming.id],'fetch','--quiet',`https://github.com/${incoming.repository}.git`,source.commit],{stdio:'pipe'});
    if(!['ahead','identical'].includes(compareCandidate(roots[incoming.id],source.commit,revisions[incoming.id])))throw Error('Source event is not in the current registered branch history');
    for(const old of base?.scopes||[])if(revisions[old.repoId]&&old.commit!==revisions[old.repoId]) {
      const registered=registry.repositories.find(r=>r.id===old.repoId);
      execFileSync('git',['-C',roots[old.repoId],'fetch','--quiet',`https://github.com/${registered.repository}.git`,old.commit],{stdio:'pipe'});
      if(compareCandidate(roots[old.repoId],old.commit,revisions[old.repoId])!=='ahead')throw Error('Source history regressed or diverged; document team must reconcile the release PR');
    }
    const result=build({registry,roots,revisions,language,previous,overrides:base||{}});
    const content=JSON.stringify(result.manifest,null,2)+'\n';
    if(existing?.content && Buffer.from(existing.content.content,'base64').toString()===content)continue;
    if(!existing) {
      const repository=await api(`/repos/${repo}`);
      const ref=await api(`/repos/${repo}/git/ref/heads/${encode(repository.default_branch)}`);
      // A merged branch may remain; reset it to current main only when no PR is open.
      const refs=await api(`/repos/${repo}/git/matching-refs/heads/${branch}`);
      if(refs.some(r=>r.ref===`refs/heads/${branch}`))await api(`/repos/${repo}/git/refs/heads/${branch}`,'PATCH',{sha:ref.object.sha,force:true});
      else await api(`/repos/${repo}/git/refs`,'POST',{ref:`refs/heads/${branch}`,sha:ref.object.sha});
    }
    let oldSha=existing?.content.sha;
    if(!oldSha && previous)oldSha=(await api(`/repos/${repo}/contents/document-center/releases/${language}.json?ref=${encode(branch)}`)).sha;
    try{await api(`/repos/${repo}/contents/document-center/releases/${language}.json`,'PUT',{message:`docs: update ${language} candidate to ${source.commit}`,branch,content:Buffer.from(content).toString('base64'),...(oldSha?{sha:oldSha}:{})});}
    catch(error){if(error.httpStatus===409&&attempt<3)return candidate(registry,fs.mkdtempSync(path.join(temp,'retry-')),attempt+1);throw error;}
    const body=`候选来源：${incoming.repository}@${source.commit}\n\n清单 SHA-256：${result.digest}\n\n阻断问题：${result.errors.length}；人工核对项：${result.warnings.length}。请查看 document-release-preview 检查和静态预览 Artifact。\n\n- [ ] 内容完整性、所有引用及目录排序已核对\n- [ ] 标签、反馈、地址迁移和版本归档已核对\n- [ ] 预览通过，由文档团队手动合并\n\n新候选会更新本 PR；禁止自动合并。正文不保存在此 PR。`;
    if(existing)await api(`/repos/${repo}/pulls/${existing.pr.number}`,'PATCH',{body});
    else {const repository=await api(`/repos/${repo}`);await api(`/repos/${repo}/pulls`,'POST',{title:`文档发布候选（${language}）`,head:branch,base:repository.default_branch,body});}
    console.log(`${language}: candidate PR updated (${result.errors.length} blocking checks)`);
  }
}
async function check(registry,temp) {
  const file=argument('--manifest');if(!file)throw Error('--manifest is required');
  const input=read(path.resolve(root,file));const revisions=Object.fromEntries(input.scopes.map(s=>[s.repoId,s.commit]));
  const roots=cloneSources(registry,revisions,temp);
  const result=build({registry,roots,revisions,language:input.language,overrides:input});
  // Warnings relative to the previous publication are informational; all fixed content must match.
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
  return {id:value('登记 ID'),repository:value('来源仓库'),branch:value('分支')||'main',prefix:value('目标路径前缀'),rootDep:Number(value('目录层级 rootDep')),column:value('目标栏目'),languages:value('语言').split(',').map(x=>x.trim()).filter(Boolean)};
}
async function registration(registry) {
  const event=read(process.env.GITHUB_EVENT_PATH),issue=event.issue,repo=process.env.GITHUB_REPOSITORY;
  if(!issue||!issue.title.startsWith('[文档接入]'))return;
  await authorizeMaintainer(repo,issue.user.login);
  const entry=registrationFromIssue(issue.body||'');
  const updated={schemaVersion:1,repositories:[...registry.repositories.filter(r=>r.id!==entry.id),entry].sort((a,b)=>a.id.localeCompare(b.id))};validateRegistry(updated);
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
  const branch=`document-release/${language}`,existing=await existingCandidate(repo,branch,language);
  if(!existing)throw Error('No pending release PR; keep this issue open until a candidate exists');
  const manifest=existing.manifest,target=value('文档标识'),content=value('调整内容');
  const documents=new Set(manifest.scopes.flatMap(s=>s.documents.map(d=>`${s.repoId}/${d.path}`)));
  switch(value('调整类型')) {
    case '地址迁移':if(content==='清除'){delete manifest.redirects[target];break;}if(documents.has(target)||!documents.has(content))throw Error('Migration must map a removed ID to an existing document ID');manifest.redirects[target]=content;break;
    case '标签调整':if(content==='清除'){delete manifest.labels[target];break;}if(!documents.has(target))throw Error('Document is outside candidate');manifest.labels[target]=content.split(/[,，]/).map(x=>x.trim()).filter(Boolean);break;
    case '引用登记':{
      const url=value('引用原地址');if(!documents.has(target)||!documents.has(content)||!url)throw Error('Reference source and target must be inside candidate');manifest.references[`${target}::${url}`]=content;
      // The CI checker regenerates references from this registration and validates closure.
      const scope=manifest.scopes.find(s=>target.startsWith(s.repoId+'/'));
      const doc=scope.documents.find(d=>`${scope.repoId}/${d.path}`===target);
      if(!doc.references.includes(content))doc.references.push(content);doc.references.sort();break;
    }
    case '文档反馈':manifest.feedback=manifest.feedback.filter(f=>f.issue!==issue.number);manifest.feedback.push({issue:issue.number,document:target,message:content});break;
    default:throw Error('Unknown governance operation');
  }
  try{await api(`/repos/${repo}/contents/document-center/releases/${language}.json`,'PUT',{branch,sha:existing.content.sha,message:`docs: apply governance issue #${issue.number}`,content:Buffer.from(JSON.stringify(manifest,null,2)+'\n').toString('base64')});}
  catch(error){if(error.httpStatus===409&&attempt<3)return governanceChange(attempt+1);throw error;}
  console.log(`Governance issue #${issue.number} applied to release PR #${existing.pr.number}; CI must rerun`);
}
async function publish() {
  const event=read(process.env.GITHUB_EVENT_PATH),pr=event.pull_request;
  if(event.action!=='closed'||!pr?.merged)throw Error('Only a merged release PR may publish');
  const expected=process.env.GITHUB_REPOSITORY;
  const registration=/^document-registration\/issue-[1-9][0-9]*$/.test(pr.head.ref);
  if(pr.base.repo.full_name!==expected||pr.head.repo.full_name!==expected||(!registration&&!/^document-release\/(zh|en)$/.test(pr.head.ref)))throw Error('Unexpected release PR origin');
  const language=pr.head.ref.split('/')[1];
  const document=registration?{registry:read(path.join(root,'document-center/registry.json'))}:{manifest:read(path.join(root,`document-center/releases/${language}.json`))};
  const base=process.env.DOCUMENT_PUBLISH_URL,token=process.env.DOCUMENT_RELEASE_TOKEN;
  if(!base||!token)throw Error('Protected release environment is not configured');
  const url=new URL(registration?'/admin/documents/governance/registration':'/admin/documents/releases',base);if(url.protocol!=='https:')throw Error('Release endpoint must use HTTPS');
  const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Document-Release-Token':token},body:JSON.stringify({governanceRepository:expected,governanceCommit:pr.merge_commit_sha,pullRequest:pr.number,...document}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error(`Release failed: HTTP ${response.status}; previous transaction preserved`);
  console.log(JSON.stringify(await response.json()));
}
async function backendPreview() {
  const event=read(process.env.GITHUB_EVENT_PATH),pr=event.pull_request,repo=process.env.GITHUB_REPOSITORY;
  if(!pr||pr.head.repo.full_name!==repo||!/^document-release\/(zh|en)$/.test(pr.head.ref)||!/^[a-f0-9]{40}$/.test(pr.head.sha))throw Error('Unexpected candidate preview origin');
  const language=pr.head.ref.split('/')[1];
  const content=await api(`/repos/${repo}/contents/document-center/releases/${language}.json?ref=${pr.head.sha}`);
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
  try{switch(process.argv[2]){case 'candidate':return await candidate(registry,temp);case 'registration':return await registration(registry);case 'governance-change':return await governanceChange();case 'validate-registry':return validateRegistry(registry);case 'check':return await check(registry,temp);case 'backend-preview':return await backendPreview();case 'publish':return await publish();default:throw Error('Use candidate, registration, governance-change, validate-registry, check --manifest FILE, backend-preview, or publish');}}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={cloneSources,registrationFromIssue};
