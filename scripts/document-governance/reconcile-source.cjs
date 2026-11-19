// A recovery run accepts only GitHub-confirmed merges at the registered branch tip.
async function reconcileSource({source,api,handled,generate,notification}) {
  const route = `/repos/${source.repository}`;
  const head = (await api(`${route}/git/ref/heads/${encodeURIComponent(source.branch)}`)).object?.sha;
  if(!/^[a-f0-9]{40}$/.test(head||'')) throw Error('Source branch did not return a commit SHA');
  if(notification && notification.commit!==head) return {status:'superseded',head};
  if(!notification && await handled(head)) return {status:'current',head};
  const isMergedHead = pr=>pr.state==='closed' && pr.merged_at && pr.merge_commit_sha===head &&
    pr.base?.ref===source.branch && pr.base?.repo?.full_name===source.repository &&
    Number.isSafeInteger(pr.number) && pr.number>0;
  let merged;
  if(notification) {
    merged=await api(`${route}/pulls/${notification.pullRequest}`);
    if(merged.number!==notification.pullRequest||!isMergedHead(merged)) throw Error('Notified PR did not merge the registered branch at the stated revision');
    if(await handled(head)) return {status:'current',head,pullRequest:merged.number};
  } else {
    const associated = await api(`${route}/commits/${head}/pulls?per_page=100`);
    merged=associated.find(isMergedHead);
    if(!merged) return {status:'not-a-merge',head};
  }
  await generate({repository:source.repository,commit:head,pullRequest:merged.number,requireExactTip:true});
  return {status:'updated',head,pullRequest:merged.number};
}

module.exports={reconcileSource};
