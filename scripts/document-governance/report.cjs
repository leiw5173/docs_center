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
  const staging=needs['backend-preview'];
  if(staging?.result!=='success' && staging?.outputs?.preview_sites) {
    try {
      require('./preview-sites.cjs').previewSites(staging.outputs.preview_sites);
      const details = staging.outputs.review_summary;
      return {status:'测试预览复检未通过',message:(details ? '复检结果：'+details+'。' : '测试网页已部署，未取得完整复检结果。')+'请打开下方预览，并在工作流摘要查看具体问题。'};
    } catch { /* Invalid deployment links are handled as a preview failure. */ }
  }
  if(staging?.result!=='success')return {status:'预览未通过',message:'请查看预览工作流记录并协调修正，保持此 PR 待确认。'};
  try{require('./preview-sites.cjs').previewSites(needs['backend-preview']?.outputs?.preview_sites);}catch{return {status:'测试预览未就绪',message:'尚未取得可访问的候选测试网链接，保持此 PR 待确认；不能将附件生成成功视为测试部署完成。'};}
  return {status:'待文档团队确认',message:(staging.outputs?.review_summary ? '预览复检：'+staging.outputs.review_summary+'。' : '')+'自动检查和预览通过，请核对内容、引用关联组、目录子类、语言及版本归档后手动合并。逐项结果见工作流摘要及 document-preview Artifact 的 report.md；提醒仍需人工确认。'};
}
async function reportStage(api,{repository,event,needs,runId}) {
  const pr=event.pull_request;if(!pr||pr.head.repo.full_name!==repository)return;
  if(!/^[\w-]+\/[\w.-]+$/.test(repository)||!/^\d+$/.test(String(runId))||!/^[a-f0-9]{40}$/.test(pr.head.sha))throw Error('Invalid status report identity');
  const current=await api(`/repos/${repository}/pulls/${pr.number}`);
  if(current.head.sha!==pr.head.sha)return; // An old run cannot overwrite the latest candidate's state.
  const result=stageStatus(event,needs);if(!result)return;
  const marker=`<!-- document-governance-stage:${pr.head.sha} -->`;
  let links='';
  if(['待文档团队确认','测试预览复检未通过'].includes(result.status)) {
    const sites=require('./preview-sites.cjs').previewSites(needs['backend-preview'].outputs.preview_sites);
    const url=text=>text.replace(/[()]/g,c=>c==='('?'%28':'%29');
    const label=text=>text.replace(/[\r\n`\[\]<>*\\]/g,' ');
    const change={added:'新增',modified:'修改',moved:'迁移'};
    const failures=JSON.parse(needs['backend-preview'].outputs.redirect_failures||'[]');
    const previewSections=sites.map(site=>{
      const lines=[`**${site.language==='zh'?'中文':'English'}：本次变更页面（${site.pages.length}）**`,''];
      if (!site.pages.length) lines.push('本轮没有独立正文页面需要预览。');
      for (const page of site.pages) lines.push(`- [${label(page.title)} · ${label(page.path)}（${change[page.change]}）](${url(page.url)})`);
      if (site.redirects.length) lines.push('','**地址变更与旧链接跳转**','');
      for (const move of site.redirects) {
        lines.push(`- [旧地址 ${label(move.sourcePath)}](${url(move.url)}) → [预期新地址 ${label(move.targetPath)}](${url(move.targetUrl)})`);
        for (const failure of failures.filter(item=>item.language===site.language&&item.sourcePath===move.sourcePath)) {
          lines.push(`  - **跳转失败**${failure.anchor?' · 章节 '+label(failure.anchor):''} · ${label(failure.reason)}`);
          lines.push('  - 浏览器实际经过的地址：');
          for (const observed of failure.path) lines.push(`    - <code>${label(observed).replace(/&/g,'&amp;')}</code>`);
        }
        if (!move.references.length) lines.push('  - 已登记来源中未找到旧地址的引用文档。');
        for (const ref of move.references) {
          const title=label(ref.title)+' · '+label(ref.id)+(ref.section?' · '+label(ref.section):'')+(ref.line?' · 第 '+ref.line+' 行':'');
          lines.push(`  - ${ref.direct?'直接引用':'间接引用'}：${ref.url?`[${title}](${url(ref.url)})`:title+'（候选中无页面）'}`);
        }
      }
      if (site.redirects.some(move=>move.references.some(ref=>ref.url))) {
        lines.push('','请打开上述引用文档，在测试网页中核对原链接附近的内容。');
      }
      return lines.join('\n');
    });
    links='\n\n### 文档中心测试网预览\n\n'+previewSections.join('\n\n');
  }
  const translation=JSON.parse((event.action==='closed' ? needs.publish : needs.preview)?.outputs?.translation_review||'null');
  if(translation?.count) {
    links+='\n\n### 双语差异复核\n\n';
    if(translation.issue) links+=`${translation.count} 处单语变更的差异已记录在 [Issue #${translation.issue}](https://github.com/${repository}/issues/${translation.issue})。`;
    else if(translation.url?.startsWith(`https://github.com/${repository}/issues/new?`)) {
      links+=`${translation.count} 处单语变更需要核对另一语言。请查看 CI 摘要里的文档清单。同步修改后重新生成候选，或由文档团队[开 Issue 记录接受的差异](${translation.url})并重跑检查。`;
    }
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
