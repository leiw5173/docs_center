const {sha} = require('./core.cjs');

function translationDifferences(manifest, previous, peer, readSource) {
  const other = manifest.language === 'zh' ? 'en' : 'zh';
  const differences = [];
  const documents = scope => new Map((scope?.documents || []).map(doc => [doc.path,doc.sha256]));
  for (const scope of manifest.scopes) {
    const baseline = previous.scopes.find(item=>item.repoId===scope.repoId);
    if (!baseline) continue;
    const before = documents(baseline), after = documents(scope);
    const changed = [...new Set([...before.keys(),...after.keys()])].filter(file=>before.get(file)!==after.get(file));
    if (!changed.length) continue;
    const priorSource = readSource(scope.repoId,baseline.commit);
    const currentSource = readSource(scope.repoId,scope.commit);
    const peerScope = peer.scopes.find(item=>item.repoId===scope.repoId);
    const publishedPeer = documents(peerScope);
    const paths = new Set(changed);
    const peerPath = file => other+'/'+file.split('/').slice(1).join('/');
    const hashAt = (source,file) => source.has(file) ? sha(source.get(file).read()) : null;
    for (const file of changed) {
      const movedTo = manifest.redirects?.[scope.repoId+'/'+file];
      if (movedTo?.startsWith(scope.repoId+'/') && paths.has(movedTo.slice(scope.repoId.length+1))) continue;
      const oldPath = Object.entries(manifest.redirects||{}).find(([from,to])=>
        to===scope.repoId+'/'+file && from.startsWith(scope.repoId+'/') && before.has(from.slice(scope.repoId.length+1))
      )?.[0].slice(scope.repoId.length+1) || file;
      const oldPeer = peerPath(oldPath), newPeer = peerPath(file);
      const priorHash = hashAt(priorSource,oldPeer), currentHash = hashAt(currentSource,newPeer);
      const retainedHash = currentHash || hashAt(currentSource,oldPeer);
      const existingPath = currentHash || (!retainedHash && !publishedPeer.has(oldPeer)) ? newPeer : oldPeer;
      const existingHash = retainedHash || publishedPeer.get(existingPath);
      if (!existingHash) continue;
      if (currentHash && (oldPeer!==newPeer || currentHash!==priorHash)) continue;
      if (!after.has(file) && priorHash && !retainedHash) continue;
      differences.push({repository:scope.repository,file,previousFile:oldPath,
        peer:existingPath,previousHash:before.get(oldPath)||null,candidateHash:after.get(file)||null,peerHash:existingHash,
        revision:after.has(file)?scope.commit:baseline.commit,peerRevision:retainedHash?scope.commit:peerScope?.commit});
    }
  }
  return differences.sort((a,b)=>a.repository.localeCompare(b.repository)||a.file.localeCompare(b.file));
}

const issueTitle = '[双语差异]';
const fingerprint = (number,language,differences) => sha(JSON.stringify([number,language,differences.map(
  ({revision,peerRevision,...document})=>document
)]));
const releaseMarker = (number,key) => `<!-- document-translation-review:pr-${number}:${key} -->`;

function reviewIssueUrl(repository,number,language,differences) {
  const key = fingerprint(number,language,differences);
  const list = differences.map(item=>'- `'+item.repository+'/'+item.file+'` ↔ `'+item.peer+'`').join('\n');
  const params = new URLSearchParams({title:`${issueTitle} 发布 PR #${number}（${language}）`,body:
    `关联发布 PR：#${number}\n\n${releaseMarker(number,key)}\n\n${list.length<1200?list:'完整受影响文档清单见发布 PR 的 CI 摘要。'}\n\n### 接受差异的原因\n\n<!-- 请说明为什么接受当前不一致，是否需要后续补翻译。 -->\n`});
  return `https://github.com/${repository}/issues/new?${params}`;
}

function acceptedIssue(issues,number,language,differences,maintainers) {
  const marker = releaseMarker(number,fingerprint(number,language,differences));
  return issues.find(issue=>!issue.pull_request && issue.title?.startsWith(issueTitle) &&
    ['OWNER','MEMBER','COLLABORATOR'].includes(issue.author_association) && maintainers.has(issue.user?.login) &&
    issue.body?.split(/\r?\n/).includes(marker) &&
    Boolean(issue.body.split(/^### 接受差异的原因\s*$/m)[1]?.split(/^#{1,6} /m)[0]
      .replace(/<!--[\s\S]*?-->/g,'').trim()));
}

async function checkTranslationReview({api,repository,pr,manifest,previous,peer,readSource,maintainers}) {
  const differences = translationDifferences(manifest,previous,peer,readSource);
  if (!differences.length) return {differences};
  const since = new URLSearchParams({state:'all',since:pr.created_at,per_page:'100'});
  for (let page=1;page<=20;page++) {
    const issues = await api(`/repos/${repository}/issues?${since}&page=${page}`);
    const accepted = acceptedIssue(issues,pr.number,manifest.language,differences,maintainers);
    if (accepted) return {differences,issue:accepted.number};
    if (issues.length<100) break;
  }
  return {differences,issueUrl:reviewIssueUrl(repository,pr.number,manifest.language,differences)};
}

module.exports = {translationDifferences,checkTranslationReview};
