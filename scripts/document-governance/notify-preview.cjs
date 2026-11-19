const fs = require('node:fs');
const path = require('node:path');
const {createHmac} = require('node:crypto');
const {previewSites} = require('./preview-sites.cjs');

const text = value => ({tag:'text',text:String(value)});
const link = (label, href) => ({tag:'a',text:label,href});

function previewMessage({repository, number, revision, runId, deployment, reviewOutcome, sites, review}) {
  if(!/^[\w-]+\/[\w.-]+$/.test(repository)||!Number.isSafeInteger(number)||
      !/^[a-f0-9]{40}$/.test(revision)||!/^\d+$/.test(runId)) throw Error('Invalid preview notification identity');
  const github = `https://github.com/${repository}`;
  const status = deployment!=='success' ? '部署失败' :
    reviewOutcome==='success' ? '已部署完成，请审查' : '已部署，浏览器复检未通过或未完成';
  const paragraphs = [
    [link(`候选 PR #${number}`, `${github}/pull/${number}`),text(' · '),link('CI 记录', `${github}/actions/runs/${runId}`)],
    [text(`候选修订 ${revision.slice(0,12)}`)]
  ];
  if(review) {
    const failures = review.findings.filter(item=>item.severity==='error').length;
    paragraphs.push([text(`浏览器复检 · ${review.pageCount} 个页面，${review.redirectCount} 条旧链接，阻断 ${failures} 项，提醒 ${review.findings.length-failures} 项。`)]);
  }
  for(const site of sites) {
    paragraphs.push([link(site.language==='zh'?'中文测试网':'英文测试网',site.url)]);
    for(const page of site.pages) paragraphs.push([link(`${page.title} · ${page.path}`,page.url)]);
    for(const migration of site.redirects) {
      paragraphs.push([link(`旧地址 ${migration.sourcePath}`,migration.url),text(' → '),link(`预期新地址 ${migration.targetPath}`,migration.targetUrl)]);
      for(const failure of review?.redirectFailures||[]) {
        if(failure.language!==site.language||failure.sourcePath!==migration.sourcePath) continue;
        paragraphs.push([text(`跳转失败 · ${failure.reason}`)]);
        for(const visited of failure.path) paragraphs.push([text('实际经过 '+visited)]);
      }
      for(const ref of migration.references) {
        const title = [ref.direct?'直接引用':'间接引用',ref.title,ref.section,ref.line?`第 ${ref.line} 行`:null].filter(Boolean).join(' · ');
        paragraphs.push([ref.url?link(title,ref.url):text(title)]);
      }
    }
  }
  for(const finding of review?.findings||[]) {
    paragraphs.push([text((finding.severity==='error'?'阻断':'提醒')+' · '),
      link(finding.title,finding.url),text(' · '+finding.message)]);
  }
  return {title:'文档中心测试网 · '+status,paragraphs};
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
    sites:locations?previewSites(locations):[],review:readOptional('review.json')
  });
  await sendPreview(webhook,process.env.DOCUMENT_PREVIEW_FEISHU_SECRET,message);
  console.log('文档中心测试网结果已发送到飞书。');
}

if(require.main===module) main().catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
module.exports={previewMessage,feishuPayloads,sendPreview};
