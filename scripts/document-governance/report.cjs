function stageStatus(event,needs) {
  if(event.action==='closed'&&!event.pull_request?.merged)return null;
  const merged=event.action==='closed'&&event.pull_request?.merged;
  if(merged) {
    if(needs.publish?.result==='failure'||needs.publish?.result==='cancelled')return {status:'发布状态待核对',message:'工作流未能确认最终结果。请先查看本 PR 的发布结果回报，再决定是否重试；请求超时或中断不能证明已回滚。'};
    if(needs.publish?.result==='success')return event.pull_request.head.ref.startsWith('document-registration/')
      ?{status:'接入发布任务已受理',message:'登记与首版发布统一执行，最终结果将回报到本 PR；收到最终结果前，不将受理视为发布成功。'}
      :{status:'发布任务已受理',message:'发布结果将回报到本 PR；收到最终结果前，不将任务受理视为发布成功。'};
    return null;
  }
  if(event.pull_request?.head.ref.startsWith('document-registration/')&&needs['registration-access']?.result!=='success')return {status:'接入检查失败',message:'请检查来源仓库、分支、语言和分类信息；接入检查通过后再进行首版内容检查与预览。'};
  if(needs.preview?.result!=='success')return {status:'检查失败',message:'正文、资源、目录链接问题回业务仓库修正；分类、迁移与引用登记通过治理 Issue 补充。内容检查已运行时，在工作流摘要及 document-preview Artifact 的 report.md 查看八类逐项结果。'};
  if(needs['backend-preview']?.result!=='success')return {status:'预览未通过',message:'请查看预览工作流记录并协调修正，保持此 PR 待确认。'};
  try{require('./preview-sites.cjs').previewSites(needs['backend-preview']?.outputs?.preview_sites);}catch{return {status:'测试预览未就绪',message:'尚未取得可访问的候选测试网链接，保持此 PR 待确认；不能将附件生成成功视为测试部署完成。'};}
  return {status:'待文档团队确认',message:'自动检查和预览通过，请核对内容、引用关联组、目录子类、语言及版本归档后手动合并。八类逐项结果见工作流摘要及 document-preview Artifact 的 report.md；提醒仍需人工确认。'};
}
async function reportStage(api,{repository,event,needs,runId}) {
  const pr=event.pull_request;if(!pr||pr.head.repo.full_name!==repository)return;
  if(!/^[\w-]+\/[\w.-]+$/.test(repository)||!/^\d+$/.test(String(runId))||!/^[a-f0-9]{40}$/.test(pr.head.sha))throw Error('Invalid status report identity');
  const current=await api(`/repos/${repository}/pulls/${pr.number}`);
  if(current.head.sha!==pr.head.sha)return; // An old run cannot overwrite the latest candidate's state.
  const result=stageStatus(event,needs);if(!result)return;
  const marker=`<!-- document-governance-stage:${pr.head.sha} -->`;
  let links='';
  if(result.status==='待文档团队确认') {
    const sites=require('./preview-sites.cjs').previewSites(needs['backend-preview'].outputs.preview_sites);
    const url=text=>text.replace(/[()]/g,c=>c==='('?'%28':'%29');
    const label=text=>text.replace(/[\r\n`\[\]<>*\\]/g,' ');
    const change={added:'新增',modified:'修改',moved:'迁移'};
    links='\n\n### 文档中心测试网预览\n\n以下链接直接打开本轮变更页面，包含文档中心实际侧栏和导航；尚未正式发布。\n\n'+sites.map(site=>`**${site.language==='zh'?'中文':'English'}：本次变更页面（${site.pages.length}）**\n\n`+(site.pages.length?site.pages.map(page=>`- [${label(page.title)} · ${label(page.path)}（${change[page.change]}）](${url(page.url)})`).join('\n'):'本轮无正文或路径变更。')+(site.redirects.length?'\n\n旧链接跳转测试：\n\n'+site.redirects.map(link=>`- [${label(link.from.split('/').slice(1).join('/'))}](${url(link.url)})`).join('\n'):'')).join('\n\n');
  }
  const body=`${marker}\n### 文档维护状态：${result.status}\n\n${result.message}${links}\n\n候选修订：\`${pr.head.sha}\`\n\n[查看此次检查和执行记录](https://github.com/${repository}/actions/runs/${runId})`;
  const commentsFound=[];
  for(let page=1;page<=20;page++) {
    const comments=await api(`/repos/${repository}/issues/${pr.number}/comments?per_page=100&page=${page}`);
    commentsFound.push(...comments);if(comments.length<100)break;
    if(page===20)throw Error('Status comment lookup exceeds limit');
  }
  const chunks=[''];for(const line of body.split('\n')){if(chunks.at(-1).length+line.length+1>48000)chunks.push('');chunks[chunks.length-1]+=line+'\n';}
  for(let i=0;i<chunks.length;i++) {
    const chunkMarker=i?`<!-- document-governance-stage:${pr.head.sha}:pages:${i+1} -->`:marker;
    const content=(i?`${chunkMarker}\n### 本次变更页面（续）\n\n`: '')+chunks[i].trimEnd();
    const found=commentsFound.find(c=>c.body?.startsWith(chunkMarker));if(found?.body===content)continue;
    await api(found?`/repos/${repository}/issues/comments/${found.id}`:`/repos/${repository}/issues/${pr.number}/comments`,found?'PATCH':'POST',{body:content});
  }
}
module.exports={stageStatus,reportStage};
