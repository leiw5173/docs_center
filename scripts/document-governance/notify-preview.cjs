const fs = require('node:fs');
const path = require('node:path');
const {createHmac} = require('node:crypto');
const {previewSites,localPreviewMode,localPreviewOrigin,localBrowserOrigin} = require('./preview-sites.cjs');

const text = value => ({tag:'text',text:String(value)});
const link = (label, href) => href ? {tag:'a',text:label,href} : text(label);

function previewMessage({repository, number, revision, runId, deployment, reviewOutcome, sites, review, local=false}) {
  if(!/^[\w-]+\/[\w.-]+$/.test(repository)||!Number.isSafeInteger(number)||
      !/^[a-f0-9]{40}$/.test(revision)||!/^\d+$/.test(runId)) throw Error('Invalid preview notification identity');
  const github = `https://github.com/${repository}`;
  const status = deployment!=='success' ? '部署失败' :
    reviewOutcome==='success' ? '已部署完成，请审查' : '已部署，浏览器复检未通过或未完成';
  const paragraphs = [
    [link(`候选 PR #${number}`, `${github}/pull/${number}`),text(' · '),link('CI 记录', `${github}/actions/runs/${runId}`)],
    [text(`候选修订 ${revision.slice(0,12)}`)]
  ];
  const section = (...heading) => paragraphs.push([text('\u00a0')],heading);
  if(local) paragraphs.push([text('本地预览链接仅可在运行测试服务的电脑打开。')]);
  if(review) {
    const failures = review.findings.filter(item=>item.severity==='error').length;
    section(text('【浏览器复检】'));
    paragraphs.push([text(`页面 ${review.pageCount} · 旧链接 ${review.redirectCount} · 阻断 ${failures} · 提醒 ${review.findings.length-failures}`)]);
  }
  const language = site => site.language==='zh'?'中文':'英文';
  const changes = {added:'新增文档',modified:'修改文档',moved:'目录路径变更'};
  const pages = sites.flatMap(site=>site.pages?.map(page=>({site,page}))||[]);
  if(pages.length) section(text(`【变更页面 · ${pages.length}】`));
  for(const {site,page} of pages) {
    const context = [language(site),changes[page.change]].filter(Boolean).join(' · ');
    paragraphs.push([text(`• ${context} · `),link(page.title || page.path,page.url)]);
    paragraphs.push([text('　'+page.path)]);
  }
  const redirects = sites.flatMap(site=>site.redirects?.map(move=>({site,move}))||[]);
  if(redirects.length) section(text(`【目录路径变更明细 · ${redirects.length}】`));
  for(const {site,move} of redirects) {
    const page = site.pages?.find(page=>page.sourcePath===move.targetPath);
    paragraphs.push([text(`• ${[language(site),page?.title].filter(Boolean).join(' · ')}`)]);
    paragraphs.push([text('　变更前路径 · '),link(move.sourcePath,move.url)]);
    paragraphs.push([text('　变更后路径 · '),link(move.targetPath,move.targetUrl)]);
    const affected = move.references.filter(ref=>ref.id!==move.from && ref.id!==move.to);
    if(!affected.length) paragraphs.push([text('　受影响的其他页面 · 无')]);
    for(const ref of affected) {
      const location = [ref.title,ref.section,ref.line?`第 ${ref.line} 行`:null].filter(Boolean).join(' · ');
      paragraphs.push([text('　受影响的其他页面 · '),link(location,ref.url)]);
    }
  }
  if(review?.findings.length) section(text('【复检发现】'));
  for(const finding of review?.findings||[]) {
    paragraphs.push([text(`• ${finding.severity==='error'?'阻断':'提醒'} · ${finding.title} · ${finding.message}`)]);
  }
  for(const failure of review?.redirectFailures||[]) {
    paragraphs.push([text(`• 跳转失败 · ${failure.sourcePath} · ${failure.reason}`)]);
    for(const visited of failure.path) paragraphs.push([text('　实际经过 '+visited)]);
  }
  if(local) {
    for(const paragraph of paragraphs) for(const item of paragraph) {
      if(item.href?.startsWith(localPreviewOrigin+'/')) item.href=localBrowserOrigin+item.href.slice(localPreviewOrigin.length);
      if(item.tag==='text') item.text=item.text.replaceAll(localPreviewOrigin+'/',localBrowserOrigin+'/');
    }
  }
  return {title:(local?'文档中心本地测试网 · ':'文档中心测试网 · ')+status,paragraphs};
}

function feishuPayloads(message, secret, timestamp) {
  const signature = secret ? {timestamp,sign:createHmac('sha256',timestamp+'\n'+secret).digest('base64')} : {};
  const encode = (title, content) => JSON.stringify({...signature,msg_type:'post',content:{post:{zh_cn:{title,content}}}});
  const result = [];
  let current = [];
  const title = () => message.title+(result.length?'（续）':'');
  for(const line of message.paragraphs) {
    if(Buffer.byteLength(encode(title(),[...current,line]))>18000) {
      if(!current.length) throw Error('Feishu preview message contains an oversized line');
      result.push(encode(title(),current));
      current = [];
      if(Buffer.byteLength(encode(title(),[line]))>18000) throw Error('Feishu preview message contains an oversized line');
    }
    current.push(line);
  }
  if(current.length) result.push(encode(title(),current));
  return result;
}

async function sendPreview(webhook, secret, message, request=fetch) {
  if(!/^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(webhook)) {
    throw Error('Feishu preview webhook must be a Feishu custom bot URL');
  }
  const payloads = feishuPayloads(message,secret,String(Math.floor(Date.now()/1000)));
  for(const [index,body] of payloads.entries()) {
    const response = await request(webhook,{method:'POST',redirect:'error',
      headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(10000)}).catch(()=>{
      throw Error('Feishu preview notification request failed');
    });
    if(!response.ok) throw Error(`Feishu preview notification returned HTTP ${response.status}`);
    const result = await response.json().catch(()=>null);
    const code = result?.code??result?.StatusCode;
    if(code!==0) throw Error(Number.isSafeInteger(code)?`Feishu preview notification was rejected (code ${code})`:'Feishu preview notification returned an invalid response');
    if(index+1<payloads.length) await new Promise(resolve=>setTimeout(resolve,300));
  }
}

async function main() {
  const webhook = process.env.DOCUMENT_PREVIEW_FEISHU_WEBHOOK;
  const secret = process.env.DOCUMENT_PREVIEW_FEISHU_SECRET;
  if(process.argv[2]==='--test') {
    if(!webhook) throw Error('未配置飞书机器人 Webhook。');
    await sendPreview(webhook,secret,{title:'文档中心测试网 · 飞书通知验证',
      paragraphs:[[text('这是一条机器人验证消息。')]]});
    console.log('飞书接口已接受验证消息。');
    return;
  }
  if(!webhook) {
    console.log('未配置飞书机器人，已跳过通知。');
    return;
  }
  const directory = process.argv[2];
  const readOptional = file => {
    try {return JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));}
    catch(error) {if(error.code!=='ENOENT') throw error;}
  };
  const pr = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')).pull_request;
  const locations = readOptional('sites.json');
  const message = previewMessage({
    repository:process.env.GITHUB_REPOSITORY,number:pr.number,revision:pr.head.sha,runId:process.env.GITHUB_RUN_ID,
    deployment:process.env.DOCUMENT_PREVIEW_DEPLOYMENT_OUTCOME,reviewOutcome:process.env.DOCUMENT_PREVIEW_REVIEW_OUTCOME,
    sites:locations?previewSites(locations):[],review:readOptional('review.json'),local:localPreviewMode()
  });
  await sendPreview(webhook,secret,message);
  console.log('文档中心测试网结果已发送到飞书。');
}

if(require.main===module) main().catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
module.exports={previewMessage,feishuPayloads,sendPreview};
