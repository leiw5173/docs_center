const {execFileSync}=require('node:child_process');

// Infer only unambiguous moves within the same registered source and language.
// Git supplies rename evidence for pages edited during a move; hashes cover exact moves.
function migrations(scopes,previous,overrides,roots) {
  const redirects={...(previous?.redirects||{}),...(overrides||{})},errors=[],moves=[];
  for(const scope of scopes) {
    const old=previous?.scopes?.find(s=>s.repoId===scope.repoId);if(!old)continue;
    const before=new Map(old.documents.map(d=>[d.path,d])),after=new Map(scope.documents.map(d=>[d.path,d]));
    const removed=old.documents.filter(d=>!after.has(d.path)),added=scope.documents.filter(d=>!before.has(d.path));
    const matches=new Map(),used=new Set();
    const unique=(list,hash)=>list.filter(d=>d.sha256===hash).length===1;
    for(const doc of removed) {
      const choices=added.filter(d=>d.sha256&&d.sha256===doc.sha256);
      if(choices.length===1&&unique(removed,doc.sha256)){matches.set(doc.path,choices[0].path);used.add(choices[0].path);}
    }
    if(old.commit!==scope.commit&&roots[scope.repoId])try {
      const entries=execFileSync('git',['-C',roots[scope.repoId],'diff','--name-status','-z','--find-renames=90%',old.commit,scope.commit,'--',`${scope.language}/`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:40*1024*1024}).split('\0');
      for(let i=0;i<entries.length&&entries[i];) {
        const status=entries[i++],from=entries[i++];
        if(!status.startsWith('R'))continue;
        const to=entries[i++],a=removed.find(d=>d.path===from),b=added.find(d=>d.path===to);
        if(a&&b&&!matches.has(from)&&!used.has(to)&&unique(removed,a.sha256)&&unique(added,b.sha256)) {matches.set(from,to);used.add(to);}
      }
    }catch { /* Missing history is not proof of a move; unresolved removals block below. */ }
    for(const doc of removed) {
      const from=`${scope.repoId}/${doc.path}`,to=matches.get(doc.path);
      if(!redirects[from]&&to)redirects[from]=`${scope.repoId}/${to}`;
      moves.push({from,to:redirects[from]||null});
    }
  }
  const live=new Set(scopes.flatMap(s=>s.documents.map(d=>`${s.repoId}/${d.path}`)));
  const selected=new Set(scopes.map(s=>s.repoId));
  // Flatten A→B→C to A→C. Never allow a cycle, live source alias, or dead target.
  for(const from of Object.keys(redirects)) {
    if(!selected.has(from.split('/')[0]))continue;
    let to=redirects[from];const seen=new Set([from]);
    while(redirects[to]&&!live.has(to)&&!seen.has(to)){seen.add(to);to=redirects[to];}
    if(live.has(from)||seen.has(to)||!live.has(to))errors.push({repo:from.split('/')[0],file:from,code:'redirect',message:`Invalid migration: ${from} → ${to}`});
    else redirects[from]=to;
  }
  for(const move of moves) {
    move.to=redirects[move.from]||null;
    if(!move.to)errors.push({repo:move.from.split('/')[0],file:move.from,code:'address-migration-required',message:`旧地址已移除但无法唯一确定新地址：${move.from}。请在候选 PR 的地址迁移区选择目标；完成前不得发布。`});
  }
  return {redirects,errors,moves};
}
module.exports={migrations};
