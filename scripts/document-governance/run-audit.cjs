const fs = require('node:fs');
const path = require('node:path');
const {audit} = require('./audit.cjs');
const {collect, reconcile} = require('./audit-issues.cjs');

async function main() {
  const [mode, target, baselineFile] = process.argv.slice(2);
  if (!target) throw Error('Audit output directory is required');
  const out = path.resolve(target);
  if (mode === 'scan') {
    const baseline = baselineFile && fs.existsSync(baselineFile)
      ? JSON.parse(fs.readFileSync(baselineFile,'utf8')) : null;
    await audit(out,baseline,path.join(out,'pinned'));
    return;
  }
  if (mode !== 'issues') throw Error('Expected scan or issues');
  const repository = process.env.GITHUB_REPOSITORY, run = process.env.GITHUB_RUN_ID;
  if (!/^[\w-]+\/[\w.-]+$/.test(repository || '') || !/^\d+$/.test(run || '') || !process.env.GH_TOKEN) {
    throw Error('Audit Issue sync requires GitHub Actions context');
  }
  const api = async (resource, method = 'GET', body) => {
    const response = await fetch('https://api.github.com'+resource,{method,redirect:'error',
      signal:AbortSignal.timeout(30000),headers:{
        Authorization:'Bearer '+process.env.GH_TOKEN, Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'
      },...(body ? {body:JSON.stringify(body)} : {})});
    if (!response.ok) throw Error(`GitHub Issue ${method} failed (HTTP ${response.status})`);
    return response.json();
  };
  const runUrl = `https://github.com/${repository}/actions/runs/${run}`;
  const links = await reconcile(api,repository,runUrl,collect(out));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### 巡检 Issue\n\n'+
    (links.length ? links.map(url => '- '+url).join('\n') : '本次无新增或需要更新的 Issue。')+'\n');
}

main().catch(error => {console.error(error.message); process.exitCode = 1;});
