const {test}=require('node:test');const assert=require('node:assert/strict');
const {stageStatus,reportStage}=require('../../scripts/document-governance/report.cjs');
const sha='a'.repeat(40);
const digest='b'.repeat(64);
const sites=JSON.stringify([{language:'zh',digest,url:`https://preview.example/community/document?preview=${digest}&lang=zh`,pages:[{title:'新页面',path:'zh/new.md',sourcePath:'a/new.md',change:'moved',url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fnew.md`}],redirects:[{from:'a/zh/old.md',to:'a/zh/new.md',sourcePath:'a/old.md',targetPath:'a/new.md',anchors:[],targetUrl:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fnew.md`,references:[{id:'a/zh/ref.md',title:'引用指南',direct:true,line:9,section:'安装',url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fref.md&anchor=install`}],url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fold.md`}]}]);
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
  assert(comment.body.includes('测试网预览'));assert(comment.body.includes('地址变更与旧链接跳转'));assert(comment.body.includes('新页面 · zh/new.md（迁移）'));assert(comment.body.includes(`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fnew.md`));
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

test('a deployed preview stays linked when browser review fails',async()=>{
  let comment;
  const api=async(resource,method='GET',body)=>{
    if(method==='GET'&&resource.endsWith('/pulls/7'))return {head:{sha}};
    if(method==='GET')return [];
    comment=body.body;
    return {};
  };
  await reportStage(api,{repository:'example/governance',event,runId:123,needs:{
    preview:{result:'success'},
    'backend-preview':{result:'failure',outputs:{preview_sites:sites,review_status:'failed',review_summary:'1 个页面，阻断 1 项，提醒 0 项',
      redirect_failures:JSON.stringify([{language:'zh',sourcePath:'a/old.md',targetPath:'a/new.md',reason:'跳错页面',path:['/old','/wrong']}])}}
  }});
  assert(comment.includes('测试预览复检未通过'));
  assert(comment.includes('阻断 1 项'));
  assert(comment.includes('nodepath=a%2Fnew.md'));
  assert(comment.includes('浏览器实际经过的地址'));
  assert(comment.includes('<code>/wrong</code>'));
  assert(comment.includes('直接引用'));
  assert(comment.includes('安装 · 第 9 行'));
  assert(comment.includes('nodepath=a%2Fref.md&anchor=install'));
});
