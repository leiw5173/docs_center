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
  if(needs.preview?.result!=='success')return {status:'检查失败',message:'正文、资源、目录链接问题回业务仓库修正；分类、迁移与引用登记通过治理 Issue 补充。内容检查已运行时，在工作流摘要及 document-preview Artifact 的 report.md 查看逐项结果。'};
  if(needs['backend-preview']?.result==='success')return {status:'待文档团队确认',message:'已部署完成，请审查。'};
  return {status:'内容检查通过',message:'提醒项请由文档团队核对。'};
}
function contentReviewMarkdown(needs) {
  const content=JSON.parse(needs.preview?.outputs?.content_review||'[]');
  const sections=[];
  const text=value=>String(value).replace(/[\r\n]/g,' ').replace(/[\\`*_{}[\]<>!@|~]/g,char=>
    char==='@'?'＠':'\\'+char);
  for(const review of content) {
    const language=review.language==='zh'?'中文':'英文';
    if(review.incomplete) {
      sections.push(`**${language} · 检查未完成**。请查看工作流日志。`);
      continue;
    }
    const lines=[`**${language} · ${review.errors?'未通过':'通过'}**，阻断 ${review.errors} 项，提醒 ${review.warnings} 项。`];
    for(const [label,items,total] of [['阻断',review.blockers,review.errors],['提醒',review.reminders,review.warnings]]) {
      if(!items.length)continue;
      lines.push('');
      for(const finding of items) {
        const file=finding.file?.startsWith(finding.repo+'/')?finding.file:[finding.repo,finding.file].filter(Boolean).join(' / ');
        const location=file+
          (Number.isSafeInteger(finding.line)?`（第 ${finding.line} 行）`:'');
        lines.push('- '+[label,finding.category,location, finding.message].filter(Boolean).map(text).join(' · '));
      }
      if(total>items.length)lines.push(`- 另有 ${total-items.length} 项${label}，详见工作流中的完整报告。`);
    }
    sections.push(lines.join('\n'));
  }
  return sections.length?'\n\n### CI 内容检查结果\n\n'+sections.join('\n\n'):'';
}
async function reportStage(api,{repository,event,needs,runId}) {
  const pr=event.pull_request;if(!pr||pr.head.repo.full_name!==repository)return;
  if(!/^[\w-]+\/[\w.-]+$/.test(repository)||!/^\d+$/.test(String(runId))||!/^[a-f0-9]{40}$/.test(pr.head.sha))throw Error('Invalid status report identity');
  const current=await api(`/repos/${repository}/pulls/${pr.number}`);
  if(current.head.sha!==pr.head.sha)return; // An old run cannot overwrite the latest candidate's state.
  const result=stageStatus(event,needs);if(!result)return;
  const marker=`<!-- document-governance-stage:${pr.head.sha} -->`;
  let links='';
  const translation=JSON.parse((event.action==='closed' ? needs.publish : needs.preview)?.outputs?.translation_review||'[]');
  const reviews=(Array.isArray(translation)?translation:[translation]).filter(item=>item?.count);
  if(reviews.length) links+='\n\n### 双语差异复核';
  for(const translation of reviews) {
    links+='\n\n';
    if(translation.language) links+=translation.language==='zh'?'中文 · ':'English · ';
    if(translation.issue) links+=`${translation.count} 处单语变更的差异已记录在 [Issue #${translation.issue}](https://github.com/${repository}/issues/${translation.issue})。`;
    else if(translation.url?.startsWith(`https://github.com/${repository}/issues/new?`)) {
      links+=`${translation.count} 处单语变更需要核对另一语言。请查看 CI 摘要里的文档清单。同步修改后重新生成候选，或由文档团队[开 Issue 记录接受的差异](${translation.url})并重跑检查。`;
    }
  }
  const body=`${marker}\n### 文档维护状态：${result.status}\n\n${result.message}${contentReviewMarkdown(needs)}${links}\n\n候选修订：\`${pr.head.sha}\`\n\n[查看此次检查和执行记录](https://github.com/${repository}/actions/runs/${runId})`;
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
