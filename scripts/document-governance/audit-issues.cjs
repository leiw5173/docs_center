const fs = require('node:fs');
const path = require('node:path');
const {categories, sha} = require('./audit.cjs');

function collect(out) {
  const report = JSON.parse(fs.readFileSync(path.join(out,'published-report.json'),'utf8'));
  const findings = [...report.findings];
  const visit = folder => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder,{withFileTypes:true})) {
      const file = path.join(folder,entry.name);
      if (entry.isDirectory()) {visit(file);continue;}
      if (entry.name === 'coverage-error.json') {
        const {manifest} = JSON.parse(fs.readFileSync(file,'utf8'));
        findings.push({category:'coverage',path:manifest,code:'pinned-check-unavailable',message:'已确认清单检查未生成报告。',evidence:{stage:'重放已确认发布清单',kind:'pinned-check-unavailable'}});
      }
      if (entry.name !== 'report.json') continue;
      const pinned = JSON.parse(fs.readFileSync(file,'utf8'));
      const manifest = JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
      const seen = new Set();
      for (const check of pinned.checks) for (const finding of [...check.errors,...check.warnings]) {
        seen.add(finding.code);
        const scope = manifest.scopes.find(scope => scope.repoId === finding.repo);
        const url = scope && finding.file?.startsWith(pinned.language + '/')
          ? 'https://github.com/' + scope.repository + '/blob/' + scope.commit + '/' + finding.file.split('/').map(encodeURIComponent).join('/') + (finding.line ? '#L' + finding.line : '')
          : '';
        findings.push({...finding,category:check.id,language:pinned.language,path:finding.file || finding.repo,url});
      }
      for (const finding of pinned.errors.filter(f => !seen.has(f.code))) {
        findings.push({...finding,category:'coverage',path:finding.file || path.relative(out,folder),language:pinned.language});
      }
    }
  };
  visit(path.join(out,'pinned'));
  return findings;
}

const plain = text => String(text || '').replace(/[\r\n]/g,' ').replace(/[<>&\[\]*_~`\\]/g,c=>'\\'+c).replace(/@/g,'＠');
const categoryAdvice = {
  links:'以下问题发生在文档的章节链接或引用资源。先定位文档中引用的位置，再检查目标地址。',
  content:'按文件和章节、行号核对原文，补齐缺失内容或移除无用空标题。',
  titles:'核对标题中的章节编号是否有意保留。',
  references:'核对受影响的引文和目标。目标改名时同步修正文档引用或迁移映射。',
  versions:'确认本次版本变化与旧版本归档是否符合发布计划。',
  translations:'核对对应语言是否在不同地址，确认缺失后再安排翻译。',
  directories:'核对目录索引文件和导航配置。',
  addresses:'核对旧地址是迁移还是下线，并验证应保留的旧址是否可跳转。'
};
const readAdvice = {
  'image-not-found':'检查 Markdown 图片地址、文件名大小写及图片是否随文档发布。修正图片引用或补发图片。',
  'link-target-not-found':'核对链接目标地址和发布状态。目标已迁移时，改用有效地址。',
  'not-found':'先核对已发布目录记录的地址与 CDN 对象路径是否一致，特别是 URL 编码。确认对象缺失后检查发布产物或撤下失效入口。',
  'access-denied':'核对 CDN 读取权限和访问规则。当前证据无法判断正文是否存在。',
  'service-error':'检查接口或 CDN 的可用性和限流情况，恢复后复跑。',
  timeout:'检查请求链路和响应耗时，恢复后复跑。',
  network:'检查巡检运行环境到接口或 CDN 的网络链路，再复跑。',
  'unexpected-html':'核对接口或 CDN 路由是否返回了网页回退页。',
  'invalid-catalog':'核对目录接口的响应结构。',
  'empty-catalog':'核对对应语言的目录是否正常发布。没有数据时无法判断哪些文档已经下线。',
  'unsupported-source':'核对官网目录记录的正文地址和来源配置。',
  'invalid-markdown':'检查原文的 Markdown 元数据和 front matter 格式。',
  'size-limit':'核对文件或目录响应大小是否符合预期。',
  'pinned-check-unavailable':'查阅该次运行中的固定清单和源提交，确认检查过程是否完成。'
};

const link = url => url.replace(/[()]/g, c => c === '(' ? '%28' : '%29');
function line(finding) {
  const label = plain([finding.language,finding.path,finding.section && '跳到「'+finding.section+'」'].filter(Boolean).join(' · '));
  const document = finding.url ? '['+label+']('+link(finding.url)+')' : label;
  const result = document + (finding.line ? ' · 第 '+finding.line+' 行' : '') + ' · ' + plain(finding.message).slice(0,400);
  const evidence = finding.evidence;
  if (!evidence && finding.category !== 'coverage') return '- ' + result;
  const fields = ['- '+result];
  if (evidence?.stage) fields.push('  - 失败环节：'+plain(evidence.stage));
  if (evidence?.checkedUrl) fields.push('  - 实际请求：[查看目标地址]('+link(evidence.checkedUrl)+')');
  if (evidence?.status && !finding.message.includes('HTTP '+evidence.status)) fields.push('  - 响应：HTTP '+evidence.status);
  if (finding.category === 'coverage') fields.push('  - 影响：该项目的对应检查未执行完。');
  if (readAdvice[evidence?.kind]) fields.push('  - 排查：'+readAdvice[evidence.kind]);
  return fields.join('\n');
}

async function reconcile(api, repository, runUrl, findings) {
  const endpoint = '/repos/' + repository + '/issues';
  const open = [];
  for (let page = 1; ; page++) {
    const items = await api(endpoint+'?state=open&creator=github-actions%5Bbot%5D&per_page=100&page='+page);
    open.push(...items.filter(issue => !issue.pull_request && issue.user?.login === 'github-actions[bot]'));
    if (items.length < 100) break;
  }
  const changed = [];
  for (const [category,title] of Object.entries(categories)) {
    const priorities = new Set(['content-incomplete','incomplete','missing-anchor','missing-resource','removed-address']);
    const relevant = findings.filter(f => f.category === category)
      .map(f => ({priority:priorities.has(f.code) ? 0 : 1, text:line(f)}))
      .sort((a,b) => a.priority - b.priority || a.text.localeCompare(b.text));
    const rows = [...new Set(relevant.map(item => item.text))];
    const marker = '<!-- document-audit:' + category + ' -->';
    const existing = open.find(issue => issue.body?.startsWith(marker));
    const coverageRecovered = category === 'coverage' && existing && !rows.length;
    if (!rows.length && !coverageRecovered) continue;
    const signature = '<!-- findings:' + sha('issue-format-v2\n'+rows.join('\n')) + ' -->';
    if (existing?.body.includes(signature)) continue;
    const visible = rows.slice(0,30);
    const intro = coverageRecovered ? '本次重查未发现目录、正文或清单检查未完成项。请核对最新报告后关闭本 Issue。'
      : category === 'coverage' ? '共 '+rows.length+' 个项目未完成检查。下方列出失败环节、响应和排查方式。'
        : '共发现 '+rows.length+' 项。'+categoryAdvice[category];
    const body = [marker,signature,'',intro,'',
      ...visible,'', ...(rows.length > visible.length ? ['其余问题见本次巡检附件。',''] : []),
      '[运行摘要及完整报告]('+runUrl+')','',
      '此 Issue 按检查类别汇总。确认处理完成后由文档团队关闭。'].join('\n');
    const payload = {title:'[文档巡检] '+title,body};
    const issue = existing
      ? await api(endpoint+'/'+existing.number,'PATCH',payload)
      : await api(endpoint,'POST',payload);
    changed.push(issue.html_url);
  }
  return changed;
}

module.exports = {collect, reconcile};
