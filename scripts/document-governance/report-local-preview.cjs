const {previewSites,localBrowserOrigin} = require('./preview-sites.cjs');
const {previewMessage,sendPreview} = require('./notify-preview.cjs');

async function commentDeployment(api, number, revision) {
  const marker = `<!-- document-local-preview:${revision} -->`;
  const body = `${marker}\n已部署完成，请审查。\n\n候选修订 \`${revision.slice(0,12)}\``;
  for (let page=1; page<=20; page++) {
    const comments = await api(`issues/${number}/comments?per_page=100&page=${page}`);
    const current = comments.find(item=>item.user?.login==='github-actions[bot]' && item.body?.startsWith(marker));
    if (current) {
      if (current.body!==body) await api(`issues/comments/${current.id}`,{body},'PATCH');
      return;
    }
    if (comments.length<100) {
      const pr = await api(`pulls/${number}`);
      if (pr.state!=='open' || pr.head.sha!==revision) throw Error('候选 PR 已变化，请按当前修订重新检查');
      await api(`issues/${number}/comments`,{body});
      return;
    }
  }
  throw Error('预览回报查找 PR 评论超出页数限制');
}

async function main() {
  const {GITHUB_REPOSITORY:repository,GITHUB_RUN_ID:runId,GH_TOKEN:token,
    DOCUMENT_PREVIEW_FEISHU_WEBHOOK:webhook,DOCUMENT_PREVIEW_FEISHU_SECRET:secret} = process.env;
  const {number,revision,sites:locations,review} = JSON.parse(process.env.DOCUMENT_LOCAL_PREVIEW_REPORT);
  if (!Number.isSafeInteger(number) || number<1 || !/^[a-f0-9]{40}$/.test(revision)) {
    throw Error('本地预览缺少候选 PR 和完整修订号');
  }
  const sites = previewSites(locations);
  if (sites.some(site=>new URL(site.url).origin!==localBrowserOrigin)) throw Error('本地回报只接受本机地址');
  if (!Number.isSafeInteger(review?.pageCount) || review.pageCount<0 ||
      !Number.isSafeInteger(review?.redirectCount) || review.redirectCount<0 ||
      !Array.isArray(review?.findings) || !Array.isArray(review?.redirectFailures) ||
      review.findings.some(item=>!['error','warning'].includes(item.severity))) {
    throw Error('本地浏览器复检报告无效');
  }
  const failed = review.findings.some(item=>item.severity==='error') || review.redirectFailures.length>0;
  const expectedPages = sites.reduce((count,site)=>count+site.pages.length,0);
  const expectedRedirects = sites.reduce((count,site)=>count+site.redirects.reduce((total,move)=>total+1+move.anchors.length,0),0);
  if ((!failed && review.pageCount!==expectedPages) || review.redirectCount!==expectedRedirects) {
    throw Error('浏览器复检未覆盖候选变更页');
  }
  const github = `https://github.com/${repository}`;
  const api = async (path,body,method=body?'POST':'GET') => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`,{
      method,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},
      body:body&&JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error(`GitHub 回报请求失败（${method} ${path.split('?')[0]}，HTTP ${response.status}）`);
    return response.json();
  };
  const pr = await api(`pulls/${number}`);
  if (pr.state!=='open' || pr.head.sha!==revision || pr.head.repo.full_name!==repository ||
      !pr.head.ref.startsWith('document-release/')) throw Error('候选 PR 已变化，请按当前修订重新检查');
  const {check_runs:checks} = await api(`commits/${revision}/check-runs?check_name=document-release-checks&filter=latest`);
  if (!checks.some(check=>check.app?.slug==='github-actions' && check.conclusion==='success')) {
    throw Error('当前候选修订的内容检查尚未通过');
  }
  await api(`statuses/${revision}`,{
    context:'document-local-preview',state:failed?'failure':'success',
    description:failed?'本地部署完成，浏览器复检失败':'本地部署及浏览器复检通过',
    target_url:`${github}/actions/runs/${runId}`
  });
  if (!failed) await commentDeployment(api,number,revision);
  if (!webhook) throw Error('未配置飞书机器人 Webhook');
  await sendPreview(webhook,secret,previewMessage({repository,number,revision,runId,
    deployment:'success',reviewOutcome:failed?'failure':'success',sites,review,local:true}));
  console.log('本地预览检查已回报，飞书已接收通知。');
  if (failed) process.exitCode=1;
}

if (require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = {commentDeployment};
