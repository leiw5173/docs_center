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
  if(needs.preview?.result!=='success')return {status:'检查失败',message:'正文、资源、目录链接问题回业务仓库修正；分类、迁移与引用登记通过治理 Issue 补充。'};
  if(needs['backend-preview']?.result!=='success')return {status:'预览未通过',message:'请查看预览工作流记录并协调修正，保持此 PR 待确认。'};
  return {status:'待文档团队确认',message:'自动检查和预览通过，请核对内容、引用关联组、目录子类、语言及版本归档后手动合并。'};
}
async function reportStage(api,{repository,event,needs,runId}) {
  const pr=event.pull_request;if(!pr||pr.head.repo.full_name!==repository)return;
  if(!/^[\w-]+\/[\w.-]+$/.test(repository)||!/^\d+$/.test(String(runId))||!/^[a-f0-9]{40}$/.test(pr.head.sha))throw Error('Invalid status report identity');
  const current=await api(`/repos/${repository}/pulls/${pr.number}`);
  if(current.head.sha!==pr.head.sha)return; // An old run cannot overwrite the latest candidate's state.
  const result=stageStatus(event,needs);if(!result)return;
  const marker=`<!-- document-governance-stage:${pr.head.sha} -->`;
  const body=`${marker}\n### 文档维护状态：${result.status}\n\n${result.message}\n\n候选修订：\`${pr.head.sha}\`\n\n[查看此次检查和执行记录](https://github.com/${repository}/actions/runs/${runId})`;
  let found;
  for(let page=1;page<=20;page++) {
    const comments=await api(`/repos/${repository}/issues/${pr.number}/comments?per_page=100&page=${page}`);
    found=comments.find(c=>c.body?.startsWith(marker));if(found||comments.length<100)break;
    if(page===20)throw Error('Status comment lookup exceeds limit');
  }
  if(found?.body===body)return;
  return api(found?`/repos/${repository}/issues/comments/${found.id}`:`/repos/${repository}/issues/${pr.number}/comments`,found?'PATCH':'POST',{body});
}
module.exports={stageStatus,reportStage};
