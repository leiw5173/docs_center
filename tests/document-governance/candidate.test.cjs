const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {execFileSync}=require('node:child_process');
const {sha}=require('../../scripts/document-governance/core.cjs');const {candidate,writeCandidate,checkRegistration}=require('../../scripts/document-governance/run.cjs');
test('source notification creates one isolated group PR, merges linked candidates and reuses the resulting PR',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-integration-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const originalFetch=global.fetch,envKeys=['GH_TOKEN','GITHUB_REPOSITORY','GITHUB_EVENT_PATH','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_ALLOW_PROTOCOL'];const before=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
  t.after(()=>{global.fetch=originalFetch;for(const k of envKeys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];});
  const reposRoot=path.join(temp,'repos');fs.mkdirSync(reposRoot);
  const makeRepo=(id,text)=>{const dir=path.join(reposRoot,id+'.git');fs.mkdirSync(dir);const git=(...args)=>execFileSync('git',['-C',dir,...args]).toString().trim();git('init','--quiet','-b','main');fs.mkdirSync(path.join(dir,'zh'));fs.writeFileSync(path.join(dir,'zh/index.md'),text);git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','source');return {git,dir,commit:git('rev-parse','HEAD')};};
  const a=makeRepo('a','# A\n\n[peer](https://example.invalid/b.md)'),b=makeRepo('b','# B\n\nContent');
  // No repository c exists on disk. An unrelated source must never be fetched.
  const registration=id=>({id,repository:'source-test/'+id,branch:'main',prefix:'courses/'+id,rootDep:1,column:'cases',languages:['zh'],parentNavigationId:'cases/cases-teaching-practice',navigationPath:['应用案例','教学与实践']});
  const registry={schemaVersion:1,repositories:['a','b','c'].map(registration)};
  const event=path.join(temp,'event.json');fs.writeFileSync(event,'{}');Object.assign(process.env,{GH_TOKEN:'synthetic-only',GITHUB_REPOSITORY:'example/governance',GITHUB_EVENT_PATH:event,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`url.file://${reposRoot}/.insteadOf`,GIT_CONFIG_VALUE_0:'https://github.com/source-test/',GIT_ALLOW_PROTOCOL:'file'});
  let counter=1;const oid=()=>String(counter++).padStart(40,'0');const main=oid(),commits=new Map([[main,{files:{}}]]),trees=new Map(),refs=new Map([['main',main]]),prs=[];
  const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  global.fetch=async(url,options={})=>{
    const u=new URL(url),resource=decodeURIComponent(u.pathname).replace('/repos/example/governance',''),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    if(resource===''&&method==='GET')return response({default_branch:'main'});
    if(resource==='/pulls'&&method==='GET')return response(prs.filter(p=>p.state==='open'&&(!u.searchParams.get('head')||u.searchParams.get('head')==='example:'+p.branch)).map(p=>({...p,head:{ref:p.branch,sha:refs.get(p.branch),repo:{full_name:'example/governance'}}})));
    if(resource.startsWith('/git/ref/heads/')&&method==='GET'){const branch=resource.slice('/git/ref/heads/'.length);return refs.has(branch)?response({object:{sha:refs.get(branch)}}):response({},404);}
    if(resource==='/git/refs'&&method==='POST'){refs.set(body.ref.replace('refs/heads/',''),body.sha);return response({},201);}
    if(resource.startsWith('/git/refs/heads/')&&method==='PATCH'){refs.set(resource.slice('/git/refs/heads/'.length),body.sha);return response({});}
    if(resource.startsWith('/git/commits/')&&method==='GET')return response({tree:{sha:resource.split('/').pop()}});
    if(resource==='/git/trees'&&method==='POST'){const id=oid(),files={...commits.get(body.base_tree).files};for(const file of body.tree)files[file.path]=file.content;trees.set(id,files);return response({sha:id},201);}
    if(resource==='/git/commits'&&method==='POST'){const id=oid();commits.set(id,{files:trees.get(body.tree)});return response({sha:id},201);}
    if(resource==='/pulls'&&method==='POST'){const pr={number:prs.length+1,state:'open',branch:body.head,body:body.body};prs.push(pr);return response(pr,201);}
    if(/^\/pulls\/\d+$/.test(resource)&&method==='PATCH'){Object.assign(prs.find(p=>p.number===Number(resource.split('/').pop())),body);return response({});}
    if(resource.startsWith('/contents/')&&method==='GET'){const value=commits.get(u.searchParams.get('ref')).files[resource.slice('/contents/'.length)];if(!value)return response({},404);return response({sha:sha(value),content:Buffer.from(value).toString('base64')});}
    throw Error('Unexpected simulated GitHub request '+method+' '+resource);
  };
  const run=()=>{const dir=fs.mkdtempSync(path.join(temp,'run-'));return candidate(registry,dir,0,{repository:'source-test/a',commit:a.commit});};
  checkRegistration({...registry,change:{repositoryId:'a'}},fs.mkdtempSync(path.join(temp,'register-')));
  assert.throws(()=>checkRegistration({...registry,change:{repositoryId:'c'}},fs.mkdtempSync(path.join(temp,'register-missing-'))));
  await run();assert.equal(prs.length,1);const first=prs[0],firstFiles=commits.get(refs.get(first.branch)).files;
  const firstPath=Object.keys(firstFiles).find(f=>f.startsWith('document-center/releases/'));let manifest=JSON.parse(firstFiles[firstPath]);
  assert.deepEqual(manifest.groupRepositories,['a']);assert.equal(manifest.scopes[0].parentNavigationId,'cases/cases-teaching-practice');assert(firstFiles['document-center/state/zh/a.json']);assert(!Object.keys(firstFiles).some(f=>f.includes('/b.json')));
  await run();assert.equal(prs.length,1);
  // The document team registers a cross-repository reference on the pending PR.
  manifest.references['a/zh/index.md::https://example.invalid/b.md']='b/zh/index.md';firstFiles[firstPath]=JSON.stringify(manifest);
  await run();assert.equal(prs.filter(p=>p.state==='open').length,1);assert.equal(first.state,'closed');const combined=prs.find(p=>p.state==='open');
  const combinedFiles=commits.get(refs.get(combined.branch)).files,combinedPath=Object.keys(combinedFiles).find(f=>f.startsWith('document-center/releases/'));
  assert.deepEqual(JSON.parse(combinedFiles[combinedPath]).groupRepositories,['a','b']);assert(combinedFiles['document-center/state/zh/b.json']);
  await run();assert.equal(prs.length,2);assert.equal(prs.find(p=>p.state==='open').number,combined.number);
  const beforeHead=refs.get(combined.branch);await assert.rejects(()=>writeCandidate('example/governance',{branch:combined.branch,file:combinedPath},JSON.parse(combinedFiles[combinedPath]),{pr:{head:{sha:'f'.repeat(40)}}}),error=>error.httpStatus===409);assert.equal(refs.get(combined.branch),beforeHead);
});
