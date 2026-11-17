// Review evidence is separate from the immutable publishing manifest.
function checkReport(result) {
  const rows=[
    ['links','页内及文档链接',['broken-link','anchor','link','external-resource','external-link','reference-registration'],'外部网站有效性需人工核对。'],
    ['content','内容完整性及序号',['metadata','empty-source','incomplete','content-review','list-start'],'核对缺章、占位内容及列表是否应从 1 开始；自动检查不能证明语义完整。'],
    ['titles','标题数字',['numbered-title'],'核对标题中 6.1 等章节编号是否需要去掉。'],
    ['references','引用影响',['reference-group','cross-language'],'核对下列直接、间接引用者；自动检查只覆盖已登记来源和可解析链接。'],
    ['versions','版本与旧版归档',['version'],'逐项确认是否需要升级软件版本、保留旧版并完成归档；检查不会自动升级或归档。'],
    ['translations','中英文缺失',['translation'],'缺少对应语言仅提醒，不阻断当前语言发布。'],
    ['directories','目录介绍',['index'],'每个含文档的目录须有 index.md；介绍、目录链接及排序需人工核对。'],
    ['addresses','文档地址变更',['address-change','redirect'],'核对删除和新增地址是否为迁移，补充 redirects；不自动猜测重命名。']
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
    errors:result.errors,warnings:result.warnings,checks,referenceImpact,versionReview,
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
  lines.push('','### 引用影响','');
  for(const item of report.referenceImpact)lines.push(`- ${text(item.document)}：直接引用者 ${item.direct.map(text).join('、')||'无'}；间接引用者 ${item.indirect.map(text).join('、')||'无'}`);
  if(!report.referenceImpact.length)lines.push('无历史文档修改或删除；首次接入仍需核对登记范围外的引用。');
  lines.push('','### 版本与归档待确认','');
  for(const item of report.versionReview)lines.push(`- ${text(item.document)}（${item.change}）：${text(item.previousVersion??'未声明')} → ${text(item.candidateVersion??'未声明')}；确认是否升级及归档。`);
  lines.push('','### 地址变更','',`- 新增：${report.addresses.added.map(text).join('、')||'无'}`,`- 删除：${report.addresses.removed.map(text).join('、')||'无'}`);
  for(const [from,to]of Object.entries(report.addresses.redirects))lines.push(`- 迁移登记：${text(from)} → ${text(to)}`);
  return lines.join('\n')+'\n';
}
module.exports={checkReport,reportMarkdown};
