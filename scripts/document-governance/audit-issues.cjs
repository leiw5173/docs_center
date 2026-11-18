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
        findings.push({category:'coverage',path:manifest,code:'pinned-check-unavailable',message:'已确认清单检查未生成报告。'});
      }
      if (entry.name !== 'report.json') continue;
      const pinned = JSON.parse(fs.readFileSync(file,'utf8'));
      const manifest = JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
      const seen = new Set();
      for (const check of pinned.checks) for (const finding of [...check.errors,...check.warnings]) {
        seen.add(finding.code);
        const scope = manifest.scopes.find(scope => scope.repoId === finding.repo);
        const url = scope && finding.file?.startsWith(pinned.language + '/')
          ? 'https://github.com/' + scope.repository + '/blob/' + scope.commit + '/' + finding.file.split('/').map(encodeURIComponent).join('/')
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
const line = finding => {
  const label = plain([finding.language,finding.path].filter(Boolean).join(' '));
  const url = finding.url?.replace(/[()]/g, c => c === '(' ? '%28' : '%29');
  return `- ${url ? '['+label+']('+url+')' : label}${finding.line ? ' · 第 '+finding.line+' 行' : ''} · ${plain(finding.message).slice(0,400)}`;
};

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
    if (!rows.length) continue;
    const marker = '<!-- document-audit:' + category + ' -->';
    const signature = '<!-- findings:' + sha(rows.join('\n')) + ' -->';
    const existing = open.find(issue => issue.body?.startsWith(marker));
    if (existing?.body.includes(signature)) continue;
    const visible = rows.slice(0,30);
    const body = [marker,signature,'','共发现 '+rows.length+' 项。请核对后在来源仓库修正文档，或补齐治理映射。','',
      ...visible,'', ...(rows.length > visible.length ? ['其余问题见本次巡检附件。',''] : []),
      '[运行摘要及完整报告]('+runUrl+')','',
      '此 Issue 按检查类别汇总。确认处理完成后由文档团队关闭。'].join('\n');
    const issue = existing
      ? await api(endpoint+'/'+existing.number,'PATCH',{body})
      : await api(endpoint,'POST',{title:'[文档巡检] '+title,body});
    changed.push(issue.html_url);
  }
  return changed;
}

module.exports = {collect, reconcile};
