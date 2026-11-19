const {test}=require('node:test');const assert=require('node:assert/strict');
const {stageStatus,reportStage}=require('../../scripts/document-governance/report.cjs');
const {commentDeployment}=require('../../scripts/document-governance/report-local-preview.cjs');
const sha='a'.repeat(40);
const digest='b'.repeat(64);
const sites=JSON.stringify([{language:'zh',digest,url:`https://preview.example/community/document?preview=${digest}&lang=zh`,pages:[{title:'新页面',path:'zh/new.md',sourcePath:'a/new.md',change:'moved',url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fnew.md`}],redirects:[{from:'a/zh/old.md',to:'a/zh/new.md',sourcePath:'a/old.md',targetPath:'a/new.md',anchors:[],targetUrl:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fnew.md`,references:[{id:'a/zh/ref.md',title:'引用指南',direct:true,line:9,section:'安装',url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fref.md&anchor=install`}],url:`https://preview.example/community/document/info?preview=${digest}&lang=zh&nodepath=a%2Fold.md`}]}]);
const previewJob={result:'success',outputs:{preview_sites:sites}};
const event={action:'synchronize',pull_request:{number:7,head:{sha,ref:'document-release/zh/g-01234567890123456789',repo:{full_name:'example/governance'}}}};
test('result reporting distinguishes failed checks, failed preview, pending approval, and accepted publication',()=>{
  assert.equal(stageStatus(event,{preview:{result:'failure'}}).status,'检查失败');
  assert.equal(stageStatus(event,{preview:{result:'success'},'backend-preview':{result:'failure'}}).status,'内容检查通过');
  assert.equal(stageStatus(event,{preview:{result:'success'},'backend-preview':{result:'success'}}).status,'待文档团队确认');
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
  assert(comment.body.includes('已部署完成，请审查。'));
  assert(!comment.body.includes('preview.example'));
  current='b'.repeat(40);await reportStage(api,input);assert.equal(writes.length,2);
});
test('local success comments are deduplicated and omit the local preview address',async()=>{
  const comments=[];
  let current=sha;
  const api=async(resource,data)=>{
    if (resource==='pulls/7') return {state:'open',head:{sha:current}};
    if (!data) return comments;
    comments.push({id:9,user:{login:'github-actions[bot]'},body:data.body});
  };
  await commentDeployment(api,7,sha);
  await commentDeployment(api,7,sha);
  assert.equal(comments.length,1);
  assert.match(comments[0].body,/已部署完成，请审查。/);
  assert.match(comments[0].body,/候选修订 `a{12}`/);
  assert.doesNotMatch(comments[0].body,/https?:|127\.0\.0\.1/);
  current='b'.repeat(40);
  await assert.rejects(commentDeployment(api,7,'c'.repeat(40)),/候选 PR 已变化/);
  assert.equal(comments.length,1);
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
test('failed preview details and URLs stay out of GitHub comments',async()=>{
  let comment;
  const api=async(resource,method='GET',body)=>{
    if(method==='GET'&&resource.endsWith('/pulls/7'))return {head:{sha}};
    if(method==='GET')return [];
    comment=body.body;
    return {};
  };
  await reportStage(api,{repository:'example/governance',event,runId:123,needs:{
    preview:{result:'success'},
    'backend-preview':{result:'failure',outputs:{preview_sites:sites,review_summary:'浏览器复检失败',
      redirect_failures:JSON.stringify([{path:['https://preview.example/old']}])}}
  }});
  assert(comment.includes('内容检查通过'));
  for(const excluded of ['preview.example','浏览器复检失败','跳转失败','已部署完成']) assert(!comment.includes(excluded));
});

test('a failed bilingual PR comment shows both language results and explains why preview was skipped',async()=>{
  const {commentSummary,checkReport}=require('../../scripts/document-governance/check-report.cjs');
  const result=(language,errors,warnings)=>commentSummary(checkReport({manifest:{language,scopes:[],redirects:{
    'test/zh/old.md':'test/zh/new.md'
  }},errors,warnings}));
  const reports=[
    result('en',[{repo:'test',file:'en/maintenance-guide/index.md',line:5,code:'directory-introduction',
      message:'请在 index.md 写一段目录介绍。'}],[]),
    result('zh',[],[{repo:'test',file:'test/zh/old.md',code:'address-change',message:'Removed document'}])
  ];
  let comment;
  const api=async(resource,method='GET',data)=>{
    if(method==='GET'&&resource.endsWith('/pulls/7'))return {head:{sha}};
    if(method==='GET')return [];
    comment=data.body;
    return {};
  };
  await reportStage(api,{repository:'example/governance',event,runId:123,needs:{
    preview:{result:'failure',outputs:{content_review:JSON.stringify(reports)}},'backend-preview':{result:'skipped'}
  }});
  assert.match(comment,/英文 · 未通过.*阻断 1 项/);
  assert.match(comment,/目录介绍 · test \/ en\/maintenance-guide\/index.md（第 5 行） · 请在 index.md 写一段目录介绍/);
  assert.match(comment,/中文 · 通过.*阻断 0 项，提醒 1 项/);
  assert.match(comment,/迁移到 test\/zh\/new.md/);
  assert.doesNotMatch(comment,/test \/ test\//);
  assert.doesNotMatch(comment,/测试网预览|浏览器复检/);
});
