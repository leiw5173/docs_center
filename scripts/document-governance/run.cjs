const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {build,writePreview,validateRegistry,snapshot,sha,git,compareCandidate}=require('./core.cjs');
const {referenceGroups,selectGroup,releaseLocation,parseReleaseBranch,acceptedState,scopeFingerprint,affectedRepositories}=require('./groups.cjs');
const {registrationFromIssue}=require('./registration.cjs');
const {checkTranslationReview}=require('./translation-review.cjs');
const {onboardingFile,validateOnboarding,buildOnboarding,onboardingFiles}=require('./onboarding.cjs');
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
    const onboarding=await listOnboardingCandidates(repo,language),reserved=affectedRepositories([incoming.id],onboarding);if(onboarding.some(p=>p.manifest.scopes.some(s=>reserved.has(s.repoId))))throw Error('Related source has an onboarding PR pending; refresh that PR before generating a separate candidate');
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
      if(!existing||JSON.stringify(existing.manifest)!==JSON.stringify(selected.manifest)) {
        try{await writeCandidate(repo,location,selected.manifest,existing);}
        catch(error){if([409,422].includes(error.httpStatus)&&attempt<3)return candidate(registry,fs.mkdtempSync(path.join(temp,'retry-')),attempt+1,source);throw error;}
      }
      const migrationReport=require('./check-report.cjs').migrationMarkdown(selected,repo);
      const body=`引用关联组：${group.repositories.join(', ')}\n\n清单 SHA-256：${selected.digest}\n\n阻断问题：${selected.errors.length}；人工核对项：${selected.warnings.length}。查看检查报告和预览。\n\n${migrationReport}\n\n- [ ] 内容完整性、直接及间接引用、目录子类已核对\n- [ ] 标签、反馈、地址迁移及版本归档已核对\n- [ ] 预览通过，由文档团队手动合并\n\n同组新修订更新本 PR；未关联来源独立发布。`;
      if(existing)await api(`/repos/${repo}/pulls/${existing.pr.number}`,'PATCH',{body});
      else {const metadata=await api(`/repos/${repo}`);await api(`/repos/${repo}/pulls`,'POST',{title:`文档发布候选（${language}：${group.repositories.join(', ')}）`,head:location.branch,base:metadata.default_branch,body});}
      for(const id of group.repositories)completed.add(id);
    }
    for(const old of pending)if(old.manifest.scopes.some(s=>wanted.has(s.repoId))&&!groups.some(g=>g.groupId===old.manifest.groupId)&&old.manifest.scopes.every(s=>completed.has(s.repoId))) {
      await api(`/repos/${repo}/pulls/${old.pr.number}`,'PATCH',{state:'closed',body:old.pr.body+'\n\n此候选已由重新计算的引用关联组替代，请审核新的发布 PR。'});
    }
  }
}
function baseState(language,baseRevision) {
  const event=process.env.GITHUB_EVENT_PATH?read(process.env.GITHUB_EVENT_PATH):{};
  const ref=baseRevision||event.pull_request?.base?.sha;
  if(!ref)return acceptedState(root,language);
  if(!/^[a-f0-9]{40}$/.test(ref))throw Error('Invalid base revision');
  execFileSync('git',['-C',root,'fetch','--quiet','--no-tags','origin',ref],{stdio:'pipe'});
  const readBase=file=>{const {spawnSync}=require('node:child_process');const result=spawnSync('git',['-C',root,'show',`${ref}:${file}`],{encoding:'utf8',maxBuffer:40*1024*1024});if(result.status!==0){const error=Error('Missing base file');error.code='MISSING_BASE_FILE';throw error;}return result.stdout;};
  const listBase=dir=>git(root,'ls-tree','-r','--name-only',ref,'--',dir).toString().trim().split('\n').filter(Boolean);
  return acceptedState(root,language,readBase,listBase);
}
async function translationReview(pr,manifest,roots,baseRevision,previous=baseState(manifest.language,baseRevision)) {
  const repository=process.env.GITHUB_REPOSITORY;
  if(!/^[\w-]+\/[\w.-]+$/.test(repository||'')||!Number.isSafeInteger(pr.number)) throw Error('Invalid translation review identity');
  const peer=baseState(manifest.language==='zh'?'en':'zh',baseRevision);
  const maintainers=new Set((process.env.DOCUMENT_GOVERNANCE_MAINTAINERS||'').split(',').map(name=>name.trim()).filter(Boolean));
  const readSource=(repoId,commit)=>{
    try{git(roots[repoId],'cat-file','-e',commit+'^{commit}');}
    catch{
      const scope=manifest.scopes.find(item=>item.repoId===repoId);
      execFileSync('git',['-C',roots[repoId],'fetch','--quiet','--no-tags',`https://github.com/${scope.repository}.git`,commit],{stdio:'pipe',timeout:120000});
    }
    return snapshot(roots[repoId],commit);
  };
  return checkTranslationReview({api,repository,pr,manifest,previous,peer,readSource,maintainers});
}

function reportTranslationReview(review,prNumber) {
  if(!review.differences.length) return;
  const escape=value=>value.replace(/[\r\n<>&`\[\]\\]/g,' ');
  const sourceLink=(repository,revision,path)=>{
    const title=escape(path),ref=encodeURIComponent(revision);
    return `[${title}](https://github.com/${repository}/blob/${ref}/${path.split('/').map(segment=>encodeURIComponent(segment).replace(/[()]/g,char=>char==='('?'%28':'%29')).join('/')})`;
  };
  const lines=['','### 双语差异复核','',...review.differences.map(item=>
    `- ${escape(item.repository)} · ${sourceLink(item.repository,item.revision,item.candidateHash?item.file:item.previousFile)} ↔ ${sourceLink(item.repository,item.peerRevision,item.peer)}`)];
  if(review.issue) lines.push('',`已由文档团队通过 Issue #${review.issue} 记录接受的差异。`);
  else lines.push('',`发布 PR #${prNumber} 有单语修改，且另一语言有未同步的对应页面。请同步修改，或由文档团队 [记录接受的差异](${review.issueUrl}) 后重跑检查。`);
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
  if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`translation_review=${JSON.stringify({count:review.differences.length,issue:review.issue,url:review.issueUrl})}\n`);
}

async function check(registry,temp,fileOverride=null,outputOverride=null) {
  const file=fileOverride||argument('--manifest');if(!file)throw Error('--manifest is required');
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
  const out=path.resolve(outputOverride||argument('--output',path.join(os.tmpdir(),'document-preview')));writePreview(result,out);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,fs.readFileSync(path.join(out,'report.md')));
  if(process.env.GITHUB_ACTIONS==='true') {
    const commandText=s=>String(s).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
    for(const warning of result.warnings.filter(w=>w.code==='address-change')) {
      const from=warning.file,to=result.manifest.redirects[from];
      console.log(`::warning title=文档地址变更::${commandText(`${from} → ${to||'目标未确定，阻断发布'}${to?'；发布后旧链接自动跳转':''}`)}`);
    }
  }
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(input,null,2));
  const event=process.env.GITHUB_EVENT_PATH?read(process.env.GITHUB_EVENT_PATH):{};
  const pr=event.pull_request;
  if (process.env.GITHUB_EVENT_NAME==='pull_request' && pr?.head.ref.startsWith('document-release/')) {
    const review=await translationReview(pr,input,roots,undefined,previous);
    reportTranslationReview(review,pr.number);
    if(review.issueUrl) process.exitCode=1;
  }
  for(const error of result.errors)console.error(JSON.stringify(error));
  console.log(JSON.stringify({manifestDigest:sha(JSON.stringify(input)),errors:result.errors.length,warnings:input.warnings.length,preview:out}));
  if(result.errors.length)process.exitCode=1;
}
async function registration(registry,options={}) {
  const event=read(process.env.GITHUB_EVENT_PATH),issue=options.issue||event.issue,repo=process.env.GITHUB_REPOSITORY;
  if(!issue||!issue.title.startsWith('[文档接入]'))return;
  await authorizeMaintainer(repo,issue.user.login);
  const entry=options.entry||registrationFromIssue(issue.body||'',registry);
  if(registry.repositories.some(r=>r.id===entry.id&&r.repository!==entry.repository))throw Error('Source identity is already owned by another repository');
  const branch=`document-registration/issue-${issue.number}`,file=onboardingFile(branch);
  const updated={schemaVersion:1,change:{repositoryId:entry.id,onboarding:file},repositories:[...registry.repositories.filter(r=>r.id!==entry.id),entry].sort((a,b)=>a.id.localeCompare(b.id))};validateRegistry(updated);
  const repository=await api(`/repos/${repo}`),base=(await api(`/repos/${repo}/git/ref/heads/${encode(repository.default_branch)}`)).object.sha;
  if(base!==git(root,'rev-parse','HEAD').toString().trim())throw Error('主分支已更新，请重试接入申请');
  const prs=await api(`/repos/${repo}/pulls?state=open&head=${encode(repo.split('/')[0]+':'+branch)}`);
  let priorBundle=options.bundle;
  if(!priorBundle&&prs.length){try{const old=await api(`/repos/${repo}/contents/${file}?ref=${prs[0].head.sha}`);priorBundle=JSON.parse(Buffer.from(old.content,'base64').toString());}catch(error){if(error.httpStatus!==404)throw error;}}
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'document-onboarding-'));
  let bundle;
  try{
    const roots={},revisions={};
    bundle=await buildOnboarding({registry:updated,entry,previousFor:language=>acceptedState(root,language),overridesFor:(language,previous)=>{const pending=priorBundle?.releases.find(m=>m.language===language);if(!pending)return previous;return {...previous,references:{...previous.references,...pending.references},redirects:{...previous.redirects,...pending.redirects},labels:{...previous.labels,...pending.labels},feedback:pending.feedback||previous.feedback};},load:async selected=>{
      const missing=selected.filter(r=>!roots[r.id]);if(missing.length)Object.assign(roots,cloneSources({repositories:missing},revisions,fs.mkdtempSync(path.join(temp,'sources-'))));
      return {roots,revisions};
    }});
    for(const manifest of bundle.releases){const previous=acceptedState(root,manifest.language);for(const old of [...previous.scopes,...(priorBundle?.releases.find(m=>m.language===manifest.language)?.scopes||[])]){const fresh=manifest.scopes.find(s=>s.repoId===old.repoId);if(!fresh||old.commit===fresh.commit)continue;const registered=updated.repositories.find(r=>r.id===old.repoId);execFileSync('git',['-C',roots[old.repoId],'fetch','--quiet',`https://github.com/${registered.repository}.git`,old.commit],{stdio:'pipe'});if(compareCandidate(roots[old.repoId],old.commit,fresh.commit)!=='ahead')throw Error('Source history regressed or diverged');}}
    for(const language of entry.languages){const pending=[...await listCandidates(repo,language),...await listOnboardingCandidates(repo,language)].filter(p=>p.pr.head.ref!==branch);if(pending.some(p=>p.manifest.scopes.some(s=>bundle.releases.find(m=>m.language===language).scopes.some(n=>n.repoId===s.repoId))))throw Error('关联来源已有待审核 PR，请先处理或关闭该候选后重试接入');}
    const currentBase=await api(`/repos/${repo}/git/ref/heads/${encode(repository.default_branch)}`);if(currentBase.object.sha!==base)throw Error('主分支已更新，请重试接入申请');
    const refs=await api(`/repos/${repo}/git/matching-refs/heads/${branch}`),ref=refs.find(r=>r.ref===`refs/heads/${branch}`);
    if(prs.length&&ref?.object.sha!==prs[0].head.sha)throw Error('接入 PR 已被并发更新，请重试');
    const parent=await api(`/repos/${repo}/git/commits/${base}`);
    const tree=await api(`/repos/${repo}/git/trees`,'POST',{base_tree:parent.tree.sha,tree:Object.entries(onboardingFiles(updated,bundle,file)).map(([file,content])=>({path:file,mode:'100644',type:'blob',content}))});
    const commit=await api(`/repos/${repo}/git/commits`,'POST',{message:`docs: onboard ${entry.repository} with reviewed initial releases`,tree:tree.sha,parents:[...new Set([...(ref?[ref.object.sha]:[]),base])]});
    if(ref)await api(`/repos/${repo}/git/refs/heads/${branch}`,'PATCH',{sha:commit.sha,force:false});
    else await api(`/repos/${repo}/git/refs`,'POST',{ref:`refs/heads/${branch}`,sha:commit.sha});
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  const body=`来自接入申请 #${issue.number}。\n\n| 核对项 | 申请结果 |\n| --- | --- |\n| 来源 | ${entry.repository} |\n| 来源标识 | ${entry.id} |\n| 分支 / 语言 | ${entry.branch} / ${entry.languages.join(', ')} |\n| 目标分类 | ${(entry.navigationPath||[entry.column]).join(' / ')} |\n| 地址前缀 | ${entry.prefix} |\n\n新来源标识和地址前缀默认自动生成；已有来源自动沿用原值。请按[接入填写指南](https://github.com/${repo}/blob/main/docs/repository-registration.md)核对分类与地址。该 PR 同时包含来源登记与首版固定清单。接入检查、内容检查和预览通过后，由文档团队确认并只合并一次；合并后统一登记和发布，最终结果回报到本 PR。\n\nCloses #${issue.number}`;
  if(prs.length)await api(`/repos/${repo}/pulls/${prs[0].number}`,'PATCH',{body});
  else await api(`/repos/${repo}/pulls`,'POST',{title:`接入并首次发布 ${entry.repository}`,head:branch,base:repository.default_branch,body});
}
async function checkOnboarding(registry,temp){
 const event=read(process.env.GITHUB_EVENT_PATH),file=onboardingFile(event.pull_request.head.ref);
 if(registry.change?.onboarding!==file)throw Error('Onboarding file differs from registration branch');
 const bundle=read(path.join(root,file));validateOnboarding(registry,bundle);
 const out=path.resolve(argument('--output',path.join(os.tmpdir(),'document-preview')));
 for(const manifest of bundle.releases){const canonical=releaseLocation(manifest.language,manifest.groupId).file;if(JSON.stringify(read(path.join(root,canonical)))!==JSON.stringify(manifest))throw Error('Onboarding manifest differs from canonical release');await check(registry,temp,canonical,path.join(out,manifest.language));}
}
async function listOnboardingCandidates(repo,language){
 const result=[];
 for(let page=1;page<=20;page++){
  const prs=await api(`/repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
  for(const pr of prs){if(pr.head.repo?.full_name!==repo||!/^document-registration\/issue-[1-9][0-9]*$/.test(pr.head.ref))continue;
   const load=async file=>{const c=await api(`/repos/${repo}/contents/${file}?ref=${pr.head.sha}`);return JSON.parse(Buffer.from(c.content,'base64').toString());};
   const registration=await load('document-center/registry.json'),file=onboardingFile(pr.head.ref);if(registration.change?.onboarding!==file)continue;
   const bundle=await load(file);validateOnboarding(registration,bundle);const manifest=bundle.releases.find(m=>m.language===language);if(manifest)result.push({pr,registration,bundle,manifest,location:{branch:pr.head.ref,file:releaseLocation(language,manifest.groupId).file}});
  }
  if(prs.length<100)return result;
 }
 throw Error('Too many open onboarding PRs');
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
  const choices=[...await listCandidates(repo,language),...await listOnboardingCandidates(repo,language)].filter(p=>p.manifest.scopes.some(s=>s.repoId===target.split('/')[0]));
  if(choices.length>1)throw Error('Multiple pending groups contain this repository; regenerate candidates first');
  const existing=choices[0],branch=existing?.location.branch;
  if(!existing)throw Error('No pending release PR; keep this issue open until a candidate exists');
  const manifest=existing.manifest,content=value('调整内容');
  const documents=new Set(manifest.scopes.flatMap(s=>s.documents.map(d=>`${s.repoId}/${d.path}`)));
  switch(value('调整类型')) {
    case '地址迁移':if(content==='清除'){delete manifest.redirects[target];break;}if(documents.has(target)||!documents.has(content))throw Error('Migration must map a removed ID to an existing document ID');manifest.redirects[target]=content;break;
    case '标签调整':if(content==='清除'){delete manifest.labels[target];break;}if(!documents.has(target))throw Error('Document is outside candidate');manifest.labels[target]=content.split(/[,，]/).map(x=>x.trim()).filter(Boolean);break;
    case '引用登记':{
      const url=value('引用原地址'),registry=existing.registration||read(path.join(root,'document-center/registry.json'));if(!documents.has(target)||!registry.repositories.some(r=>r.id===content.split('/')[0])||!content.includes(`/${language}/`)||!content.endsWith('.md')||!url)throw Error('Reference target must be a registered document in this language');manifest.references[`${target}::${url}`]=content;
      // The CI checker regenerates references from this registration and validates closure.
      const scope=manifest.scopes.find(s=>target.startsWith(s.repoId+'/'));
      const doc=scope.documents.find(d=>`${scope.repoId}/${d.path}`===target);
      if(!doc.references.includes(content))doc.references.push(content);doc.references.sort();break;
    }
    case '文档反馈':manifest.feedback=manifest.feedback.filter(f=>f.issue!==issue.number);manifest.feedback.push({issue:issue.number,document:target,message:content});break;
    default:throw Error('Unknown governance operation');
  }
  if(existing.bundle){
    const entry=existing.registration.repositories.find(r=>r.id===existing.bundle.repositoryId);
    await registration(read(path.join(root,'document-center/registry.json')),{entry,bundle:existing.bundle,issue:{number:Number(branch.split('issue-')[1]),title:'[文档接入] 治理补充',user:issue.user}});
    console.log(`Governance issue #${issue.number} applied atomically to onboarding PR #${existing.pr.number}; CI must rerun`);return;
  }
  try{await api(`/repos/${repo}/contents/${existing.location.file}`,'PUT',{branch,sha:existing.content.sha,message:`docs: apply governance issue #${issue.number}`,content:Buffer.from(JSON.stringify(manifest,null,2)+'\n').toString('base64')});}
  catch(error){if(error.httpStatus===409&&attempt<3)return governanceChange(attempt+1);throw error;}
  if(['引用登记','地址迁移'].includes(value('调整类型'))){const scope=manifest.scopes.find(s=>s.repoId===target.split('/')[0]);const temp=fs.mkdtempSync(path.join(os.tmpdir(),'governance-regroup-'));try{await candidate(read(path.join(root,'document-center/registry.json')),temp,0,{repository:scope.repository,commit:scope.commit});}finally{fs.rmSync(temp,{recursive:true,force:true});}}
  console.log(`Governance issue #${issue.number} applied to release PR #${existing.pr.number}; CI must rerun`);
}
async function publish(registry,temp) {
  const event=read(process.env.GITHUB_EVENT_PATH),pr=event.pull_request;
  if(event.action!=='closed'||!pr?.merged)throw Error('Only a merged release PR may publish');
  const expected=process.env.GITHUB_REPOSITORY;
  const registration=/^document-registration\/issue-[1-9][0-9]*$/.test(pr.head.ref);
  if(pr.base.repo.full_name!==expected||pr.head.repo.full_name!==expected)throw Error('Unexpected release PR origin');
  const location=registration?null:parseReleaseBranch(pr.head.ref);
  const document=registration?{registry:read(path.join(root,'document-center/registry.json')),onboarding:read(path.join(root,onboardingFile(pr.head.ref)))}:{manifest:read(path.join(root,location.file))};
  if(!registration) {
    const baseRevision=git(root,'rev-parse','HEAD^1').toString().trim();
    const revisions=Object.fromEntries(document.manifest.scopes.map(scope=>[scope.repoId,scope.commit]));
    const roots=cloneSources({repositories:registry.repositories.filter(source=>Object.hasOwn(revisions,source.id))},revisions,temp);
    const review=await translationReview(pr,document.manifest,roots,baseRevision);
    reportTranslationReview(review,pr.number);
    if(review.issueUrl) throw Error('Publication blocked: document maintainer must record acceptance of the bilingual difference');
  }
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
  const remoteFile=async file=>{const content=await api(`/repos/${repo}/contents/${file}?ref=${pr.head.sha}`);return JSON.parse(Buffer.from(content.content,'base64').toString());};
  const onboarding=pr.head.ref.startsWith('document-registration/');let registration,manifests;
  if(onboarding){registration=await remoteFile('document-center/registry.json');const file=onboardingFile(pr.head.ref);if(registration.change?.onboarding!==file)throw Error('Unexpected onboarding preview path');const bundle=await remoteFile(file);validateOnboarding(registration,bundle);manifests=bundle.releases;}
  else manifests=[await remoteFile(parseReleaseBranch(pr.head.ref).file)];
  const base=process.env.DOCUMENT_PREVIEW_URL,token=process.env.DOCUMENT_PREVIEW_TOKEN;
  if(!base||!token)throw Error('Backend candidate preview environment is not configured');
  const url=new URL('/admin/documents/previews',base);if(url.protocol!=='https:')throw Error('Preview endpoint must use HTTPS');
  const sites=[],previews=require('./preview-sites.cjs');
  for(const manifest of manifests){
    const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Document-Preview-Token':token},body:JSON.stringify(onboarding?{registration,manifest}:manifest),signal:AbortSignal.timeout(120000)});
    if(!response.ok||!response.headers.get('content-type')?.includes('application/zip'))throw Error(`Backend preview failed: HTTP ${response.status}`);
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>128*1024*1024)throw Error('Preview exceeds 128 MiB');chunks.push(chunk);}
    const configured=argument('--output',path.join(os.tmpdir(),'backend-preview.zip'));const out=onboarding?path.join(path.dirname(path.resolve(configured)),`onboarding-${manifest.language}.zip`):configured;
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,Buffer.concat(chunks));
    const digest=sha(JSON.stringify(manifest)),siteUrl=response.headers.get('x-document-preview-url');
    if(!siteUrl)throw Error('Candidate artifact exists but test site was not deployed');
    const previous=baseState(manifest.language);
    const reportDirectory=argument('--check-report');
    const report=reportDirectory ? read(path.join(reportDirectory,...(onboarding?[manifest.language]:[]),'report.json')) : null;
    if(report && (report.language!==manifest.language || !Array.isArray(report.migrationReferences))) throw Error('Invalid candidate migration report');
    const redirects=previews.migrationPreviews(manifest,previous,siteUrl,report?.migrationReferences);
    const pages=previews.changedPages(manifest,previous,siteUrl,{declaredOnly:true});
    const site={language:manifest.language,digest,url:siteUrl,pages,redirects};previews.previewSites([site]);
    const deployed=await fetch(siteUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!deployed.ok||!deployed.headers.get('content-type')?.includes('text/html')||!(await deployed.text()).includes('id="app"'))throw Error('Deployed preview is not the document center application');
    const contextUrl=new URL(`/document-previews/${digest}/api/document/preview-context`,siteUrl);
    const contextResponse=await fetch(contextUrl,{signal:AbortSignal.timeout(30000)}),context=contextResponse.ok?await contextResponse.json():null;
    if(context?.data?.digest!==digest||manifest.scopes.some(scope=>!context.data.scopes.some(s=>s.repoId===scope.repoId&&s.commit===scope.commit&&s.language===scope.language)))throw Error('Document center is not deployed with the reviewed source revisions');
    const treeUrl=new URL(`/document-previews/${digest}/api/document/get-doc-tree`,siteUrl);
    treeUrl.searchParams.set('language',manifest.language);
    const treeResponse=await fetch(treeUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});
    const tree=treeResponse.ok?(await treeResponse.json()).data:null;
    if(!Array.isArray(tree)) throw Error('Candidate document catalog is unavailable');
    const visible=new Set();
    const visit=nodes=>{for(const node of nodes){if(!node.isDirectory)visible.add(node.path);visit(node.children||[]);}};
    visit(tree);
    for(const scope of manifest.scopes) {
      const declared=previews.declaredDocuments(scope,manifest.language);
      const mismatches=scope.documents.filter(doc=>!declared.has(doc.path)&&visible.has(scope.prefix+'/'+doc.path.split('/').slice(1).join('/')));
      if(mismatches.length) throw Error('预览目录与 index.md 声明不一致：'+mismatches.slice(0,12).map(doc=>scope.repoId+'/'+doc.path).join('、'));
    }
    sites.push({...site,pages:pages.filter(page=>visible.has(page.sourcePath))});
  }
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`preview_sites=${JSON.stringify(sites)}\n`);
  console.log(`Backend preview created for PR head ${pr.head.sha}`);
}
async function main(){
  const registry=read(path.join(root,'document-center/registry.json'));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'document-governance-'));
  try{switch(process.argv[2]){case 'candidate':return await candidate(registry,temp);case 'registration':return await registration(registry);case 'governance-change':return await governanceChange();case 'validate-registry':return validateRegistry(registry);case 'check-registration':return checkRegistration(registry,temp);case 'check-onboarding':return checkOnboarding(registry,temp);case 'check':return await check(registry,temp);case 'backend-preview':return await backendPreview();case 'publish':return await publish(registry,temp);case 'report-stage':return await require('./report.cjs').reportStage(api,{repository:process.env.GITHUB_REPOSITORY,event:read(process.env.GITHUB_EVENT_PATH),needs:JSON.parse(process.env.DOCUMENT_JOB_RESULTS||'{}'),runId:process.env.GITHUB_RUN_ID});default:throw Error('Use candidate, registration, governance-change, validate-registry, check-registration, check --manifest FILE, backend-preview, publish, or report-stage');}}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={cloneSources,registrationFromIssue,registration,candidate,writeCandidate,checkRegistration};
