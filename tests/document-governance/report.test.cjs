const {test}=require('node:test');const assert=require('node:assert/strict');
const {stageStatus,reportStage}=require('../../scripts/document-governance/report.cjs');
const sha='a'.repeat(40);
const digest='b'.repeat(64);
const sites=JSON.stringify([{language:'zh',digest,url:`https://preview.example/community/document?preview=${digest}&lang=zh`,pages:[{title:'新页面',path:'zh/new.md',sourcePath:'a/new.md',change:'moved',url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fnew.md`}],redirects:[{from:'a/zh/old.md',to:'a/zh/new.md',sourcePath:'a/old.md',targetPath:'a/new.md',url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fold.md`}]}]);
const previewJob={result:'success',outputs:{preview_sites:sites}};
const event={action:'synchronize',pull_request:{number:7,head:{sha,ref:'document-release/zh/g-01234567890123456789',repo:{full_name:'example/governance'}}}};
test('result reporting distinguishes failed checks, failed preview, pending approval, and accepted publication',()=>{
  assert.equal(stageStatus(event,{preview:{result:'failure'}}).status,'检查失败');
  assert.equal(stageStatus(event,{preview:{result:'success'},'backend-preview':{result:'failure'}}).status,'预览未通过');
  assert.equal(stageStatus(event,{preview:{result:'success'},'backend-preview':{result:'success'}}).status,'测试预览未就绪');
  assert.equal(stageStatus(event,{preview:{result:'success'},'backend-preview':previewJob}).status,'待文档团队确认');
  const merged={...event,action:'closed',pull_request:{...event.pull_request,merged:true}};
  assert.equal(stageStatus(merged,{publish:{result:'success'}}).status,'发布任务已受理');
  assert.equal(stageStatus(merged,{publish:{result:'failure'}}).status,'发布状态待核对');
  assert.equal(stageStatus({...event,action:'closed'},{}),null);
});
test('retries update one status comment and stale heads do not mutate the PR',async()=>{
  let comment=null,current=sha;const writes=[];
  const api=async(url,method='GET',body)=>{if(method==='GET'&&url.endsWith('/pulls/7'))return {head:{sha:current}};if(method==='GET')return comment?[comment]:[];writes.push({url,method,body});comment={id:9,body:body.body};return comment;};
  const input={repository:'example/governance',event,needs:{preview:{result:'failure'}},runId:123};
  await reportStage(api,input);await reportStage(api,input);assert.equal(writes.length,1);assert.equal(writes[0].method,'POST');
  await reportStage(api,{...input,needs:{preview:{result:'success'},'backend-preview':previewJob}});assert.equal(writes.length,2);assert.equal(writes[1].method,'PATCH');
  assert(comment.body.includes('测试网预览'));assert(comment.body.includes('旧链接跳转测试'));assert(comment.body.includes('新页面 · zh/new.md（迁移）'));assert(comment.body.includes(`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fnew.md`));
  current='b'.repeat(40);await reportStage(api,input);assert.equal(writes.length,2);
});
test('deployed links must be HTTPS, bound to the candidate digest, and share the site origin',()=>{
  const {previewSites}=require('../../scripts/document-governance/preview-sites.cjs');
  assert.equal(previewSites(sites)[0].language,'zh');
  for(const mutate of [s=>s.url=s.url.replace('https:','http:'),s=>s.url=s.url.replace(digest,'c'.repeat(64)),s=>s.redirects[0].url=s.redirects[0].url.replace('preview.example','other.example')]) {
    const invalid=JSON.parse(sites);mutate(invalid[0]);assert.throws(()=>previewSites(invalid));
  }
});
test('fork PR cannot use repository status writing',async()=>{
  let called=false;await reportStage(async()=>{called=true;},{repository:'example/governance',event:{pull_request:{head:{repo:{full_name:'external/fork'}}}},needs:{},runId:1});assert.equal(called,false);
});
test('many changed pages remain individually linked across idempotent continuation comments',async()=>{
 const large=JSON.parse(sites);large[0].pages=Array.from({length:400},(_,index)=>({title:'Changed page '+index,path:`zh/page-${index}.md`,sourcePath:`a/page-${index}.md`,change:'modified',url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fpage-${index}.md`}));
 const comments=[];let writes=0;
 const api=async(path,method='GET',data)=>{
  if(method==='GET'&&path.endsWith('/pulls/7'))return {head:{sha}};
  if(method==='GET')return comments;
  writes++;if(method==='POST'){const comment={id:comments.length+1,body:data.body};comments.push(comment);return comment;}
  const comment=comments.find(c=>path.endsWith('/'+c.id));comment.body=data.body;return comment;
 };
 const input={repository:'example/governance',event,needs:{preview:{result:'success'},'backend-preview':{result:'success',outputs:{preview_sites:JSON.stringify(large)}}},runId:123};
 await reportStage(api,input);assert(comments.length>1);assert(comments.every(comment=>comment.body.length<60000));
 const all=comments.map(comment=>comment.body).join('\n');for(let i=0;i<400;i++)assert(all.includes('Changed page '+i+' ·'));
 const before=writes;await reportStage(api,input);assert.equal(writes,before);
});
