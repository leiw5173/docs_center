// Review evidence is separate from the immutable publishing manifest.
function checkReport(result) {
  const rows=[
    ['links','页内及文档链接',['broken-link','anchor','link','external-resource','external-link','reference-registration'],'外部网站有效性需人工核对。'],
    ['content','内容完整性及序号',['metadata','empty-source','incomplete','content-incomplete','content-review','list-start'],'核对缺章、占位内容及列表是否应从 1 开始；自动检查不能证明语义完整。'],
    ['titles','标题数字',['numbered-title'],'核对标题中 6.1 等章节编号是否需要去掉。'],
    ['versions','版本与旧版归档',['version'],'逐项确认是否需要升级软件版本、保留旧版并完成归档；检查不会自动升级或归档。'],
    ['translations','中英文缺失',['translation'],'缺少对应语言仅提醒，不阻断当前语言发布。'],
    ['directories','目录介绍',['index','directory-introduction'],'新增或修改的 index.md 须有目录介绍段落；已发布的缺失项先提醒，介绍是否贴合本目录由人工核对。'],
    ['addresses','地址变更与旧链接跳转',['address-change','redirect','address-migration-required','redirect-anchor','reference-group','cross-language'],'在候选测试网页核对旧链接、新地址及受影响的引用文档。']
  ];
  const documents=m=>new Map((m?.scopes||[]).flatMap(s=>s.documents.map(d=>[`${s.repoId}/${d.path}`,d])));
  const before=documents(result.previous),after=documents(result.manifest);
  const added=[...after.keys()].filter(id=>!before.has(id));
  const removed=[...before.keys()].filter(id=>!after.has(id));
  const changed=[...after.keys()].filter(id=>before.has(id)&&before.get(id).sha256!==after.get(id).sha256);
  // Include old edges: removing a link must not hide its impact in this round.
  const reverse=new Map();
  for(const docs of [before,after])for(const [id,doc]of docs)for(const target of doc.references||[]) {
    if(!reverse.has(target))reverse.set(target,new Set());reverse.get(target).add(id);
  }
  const referenceImpact=[...changed,...removed].map(document=>{
    const direct=[...(reverse.get(document)||[])].sort(),seen=new Set([document]),queue=[...direct];
    for(let i=0;i<queue.length;i++) {
      const id=queue[i];if(seen.has(id))continue;seen.add(id);
      for(const parent of reverse.get(id)||[])if(!seen.has(parent))queue.push(parent);
    }
    return {document,direct:direct.filter(id=>id!==document),indirect:[...seen].filter(id=>id!==document&&!direct.includes(id)).sort()};
  });
  const versionReview=[...added,...changed,...removed].map(document=>({document,
    change:!before.has(document)?'added':!after.has(document)?'removed':'modified',
    previousVersion:before.get(document)?.softwareVersion??null,
    candidateVersion:after.get(document)?.softwareVersion??null}));
  const checks=rows.map(([id,title,codes,review])=>{
    const errors=result.errors.filter(e=>codes.includes(e.code)),warnings=result.warnings.filter(e=>codes.includes(e.code));
    return {id,title,status:errors.length?'blocked':warnings.length?'review':'no-automatic-findings',errors,warnings,review};
  });
  return {digest:result.digest,language:result.manifest.language,hasBaseline:before.size>0,
    errors:result.errors,warnings:result.warnings,checks,referenceImpact,versionReview,migrationReferences:result.migrationReferences||[],
    addresses:{added,removed,redirects:result.manifest.redirects||{}}};
}
function reportMarkdown(report) {
  const text=value=>String(value).replace(/[\r\n|]/g,' ').replace(/[<>&`\[\]\\*]/g,c=>`\\${c}`);
  const lines=[`## 文档检查（${report.language}）`,'',
    report.hasBaseline?'已对比上一已确认清单。':'首次接入，无上一清单；引用影响及地址迁移尚无历史基线。','',
    '| 检查项 | 阻断 | 提醒 | 人工核对 |','| --- | --- | --- | --- |'];
  for(const c of report.checks)lines.push(`| ${c.title} | ${c.errors.length} | ${c.warnings.length} | ${c.review} |`);
  lines.push('','零自动发现不代表人工审核通过；所有阻断错误均须处理。','');
  for(const c of report.checks)for(const [severity,issues]of [['阻断',c.errors],['提醒',c.warnings]])for(const issue of issues)
    lines.push(`- ${severity} · ${c.title} · ${text(issue.repo||'')}/${text(issue.file||'')}：${text(issue.message)}`);
  const listed=new Set(report.checks.flatMap(c=>[...c.errors,...c.warnings]));
  for(const issue of report.errors.filter(e=>!listed.has(e)))lines.push(`- 其他阻断 · ${text(issue.code)}：${text(issue.message)}`);
  lines.push('','### 地址变更与引用影响明细','');
  for(const item of report.referenceImpact)lines.push(`- ${text(item.document)}：直接引用者 ${item.direct.map(text).join('、')||'无'}；间接引用者 ${item.indirect.map(text).join('、')||'无'}`);
  if(!report.referenceImpact.length)lines.push('无历史文档修改或删除；首次接入仍需核对登记范围外的引用。');
  for(const ref of report.migrationReferences) lines.push(`- 旧链接 ${text(ref.target)}：${text(ref.document)} 第 ${ref.line??'未知'} 行${ref.section?' · '+text(ref.section):''}`);
  lines.push('',`- 新增：${report.addresses.added.map(text).join('、')||'无'}`,`- 删除：${report.addresses.removed.map(text).join('、')||'无'}`);
  for(const [from,to]of Object.entries(report.addresses.redirects))lines.push(`- 迁移登记：${text(from)} → ${text(to)}`);
  lines.push('','### 版本与归档待确认','');
  for(const item of report.versionReview)lines.push(`- ${text(item.document)}（${item.change}）：${text(item.previousVersion??'未声明')} → ${text(item.candidateVersion??'未声明')}；确认是否升级及归档。`);
  return lines.join('\n')+'\n';
}
function migrationMarkdown(result,repository) {
  const report=checkReport(result),removed=report.addresses.removed;
  if(!removed.length)return '';
  const safe=s=>String(s).replace(/[\r\n|`<>\[\]\\*]/g,' ');
  const docs=result.manifest.scopes.flatMap(s=>s.documents.map(d=>({id:`${s.repoId}/${d.path}`,title:d.title,path:d.path})));
  const lines=['### ⚠️ 文档地址变更','', '| 旧路径 | 新路径 / 处理状态 |','| --- | --- |'];
  for(const from of removed) {
    const to=report.addresses.redirects[from];
    lines.push(`| ${safe(from)} | ${to?`${safe(to)}（已登记，发布后自动跳转）`:'**未确定目标，阻断发布**'} |`);
    if(!to&&/^[\w-]+\/[\w.-]+$/.test(repository||'')) {
      const candidates=docs.filter(d=>d.id.split('/')[0]===from.split('/')[0]).sort((a,b)=>Number(b.path.split('/').at(-1)===from.split('/').at(-1))-Number(a.path.split('/').at(-1)===from.split('/').at(-1))).slice(0,8);
      for(const doc of candidates) {
        const params=new URLSearchParams({template:'document-governance.yml',title:'[文档治理] 确认旧链接的新位置',language:result.manifest.language,operation:'地址迁移',target:from,content:doc.id});
        lines.push(`\n选择新位置：[${safe(doc.title)} · ${safe(doc.path)}](https://github.com/${repository}/issues/new?${params})（已填好，核对后提交）\n`);
      }
    }
  }
  lines.push('','自动识别只登记可确定的同来源迁移；历史旧地址会继续指向最新地址。请核对表格后确认发布，无需手填文档标识。');
  return lines.join('\n');
}
module.exports={checkReport,reportMarkdown,migrationMarkdown};
