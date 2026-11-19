const {completeness,hasDirectoryIntroduction} = require('./completeness.cjs');
// No network or production writes: read immutable Git blobs, check, and build previews.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MarkdownIt = require('markdown-it');
const yaml = require('js-yaml');
const {checkReport,reportMarkdown}=require('./check-report.cjs');
const {migrations}=require('./migrations.cjs');
const {directoryMetadata}=require('./preview-sites.cjs');
const md = new MarkdownIt({html: false, linkify: false});
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {maxBuffer: 40*1024*1024});
function compareCandidate(root,before,incoming) {
  if(before===incoming)return 'identical';
  const {spawnSync}=require('node:child_process');
  const ancestor=(a,b)=>{const result=spawnSync('git',['-C',root,'merge-base','--is-ancestor',a,b]);if(result.error||![0,1].includes(result.status))throw Error('Unable to compare source revisions');return result.status===0;};
  if(ancestor(before,incoming))return 'ahead';
  if(ancestor(incoming,before))return 'stale';
  return 'diverged';
}
function validateRegistry(registry) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.repositories) || !registry.repositories.length) throw Error('Register at least one repository first');
  const ids = new Set(), repos = new Set();
  for (const r of registry.repositories) {
    if (!/^[\w-][\w.-]*$/.test(r.id || '') || !/^[\w-]+\/[\w-][\w.-]*$/.test(r.repository || '') || !/^[\w/-]+$/.test(r.prefix || '') || r.prefix.split('/').some(x=>!x||x==='..')) throw Error('Invalid repository registration');
    if (ids.has(r.id) || repos.has(r.repository)) throw Error('Duplicate repository registration');
    ids.add(r.id); repos.add(r.repository);
    if (!Array.isArray(r.languages) || !r.languages.length || r.languages.some(l=>!['zh','en'].includes(l)) || new Set(r.languages).size!==r.languages.length) throw Error('Invalid registered languages');
    if (!['hardware','os','ai','cases','tools'].includes(r.column) || !r.branch || !Number.isInteger(r.rootDep) || r.rootDep<1) throw Error('Missing column, branch or rootDep');
    if(!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(r.branch)||r.branch.includes('..')||r.branch.includes('//')||r.branch.endsWith('/'))throw Error('Invalid source branch');
    if(r.parentNavigationId!==undefined && (typeof r.parentNavigationId!=='string'||!r.parentNavigationId||r.parentNavigationId.length>256||!/^[\w/-]+$/.test(r.parentNavigationId)||r.parentNavigationId.split('/').some(p=>!p||p==='..')))throw Error('Invalid target category ID');
    if(r.navigationPath!==undefined && (!Array.isArray(r.navigationPath)||!r.navigationPath.length||r.navigationPath.length>12||r.navigationPath.some(p=>typeof p!=='string'||!p.trim()||p.length>100||/[\x00-\x1f]/.test(p))))throw Error('Invalid target category path');
  }
  if(registry.change && !ids.has(registry.change.repositoryId))throw Error('Registration change must identify a registered repository');
}
function snapshot(root, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('A full immutable commit SHA is required');
  const actual = git(root, 'rev-parse', '--verify', `${revision}^{commit}`).toString().trim();
  if (actual !== revision) throw Error('Revision is not an exact commit');
  const files = new Map();
  for (const row of git(root, 'ls-tree', '-rz', '--full-tree', revision).toString().split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!match || match[2] !== 'blob') continue;
    const [,mode,,object,file] = match;
    if (mode !== '100644' && mode !== '100755') throw Error(`Symlink or unsupported source entry: ${file}`);
    files.set(file, {object, read: () => git(root,'cat-file','blob',object)});
  }
  return files;
}
function metadata(text) {
  const normalized = text.replace(/\r\n/g,'\n');
  if (!normalized.startsWith('---\n')) return {data:{}, body:normalized, firstLine:1};
  const end = normalized.indexOf('\n---\n',4);
  if (end < 0) throw Error('Unclosed front matter');
  const data = yaml.load(normalized.slice(4,end),{schema:yaml.JSON_SCHEMA}) || {};
  if (typeof data !== 'object' || Array.isArray(data)) throw Error('Front matter must be a mapping');
  if(data.title!==undefined && typeof data.title!=='string')throw Error('title must be text');
  if (data.sidebar_position !== undefined && (!Number.isSafeInteger(data.sidebar_position) || data.sidebar_position<0)) throw Error('sidebar_position must be a nonnegative integer');
  if (data.software_version !== undefined && typeof data.software_version !== 'string') throw Error('software_version must be quoted text');
  const bodyStart = end + 5;
  return {data,body:normalized.slice(bodyStart),firstLine:normalized.slice(0,bodyStart).split('\n').length};
}
function tokensOf(tokens) { return tokens.flatMap(t=>[t,...tokensOf(t.children||[])]); }
const sentenceBoundary = new Intl.Segmenter(undefined,{granularity:'sentence'});

function analyze(text) {
  const {data,body,firstLine} = metadata(text), tokens = md.parse(body,{}), links=[];
  const lastSentence = text => {
    const visible = text.replace(/\s+/g,' ').trim();
    if (!/[\p{L}\p{N}]/u.test(visible)) return '';
    const sentence = Array.from(sentenceBoundary.segment(visible)).at(-1).segment.trim();
    return sentence.length > 160 ? '…' + sentence.slice(-159).trimStart() : sentence;
  };
  let previousProse = '';
  for (const [index,token] of tokens.entries()) {
    if (['heading_open','fence','code_block','hr','table_open'].includes(token.type)) previousProse = '';
    const prose = token.type === 'inline' && !['heading_open','th_open','td_open'].includes(tokens[index-1]?.type);
    let textBefore = '';
    for (const t of token.children || [token]) {
      if (prose && (t.type === 'text' || t.type === 'code_inline')) textBefore += t.content;
      if (prose && (t.type === 'softbreak' || t.type === 'hardbreak')) textBefore += ' ';
      if (t.type !== 'link_open' && t.type !== 'image') continue;
      const image = t.type === 'image';
      links.push({
        href: t.attrGet(image ? 'src' : 'href'), image,
        ...(image ? {alt:t.content.trim(), precedingText:prose ? lastSentence(textBefore) || previousProse : ''} : {}),
        line: token.map ? firstLine + token.map[0] : undefined
      });
    }
    if (prose) previousProse = lastSentence(textBefore) || previousProse;
  }
  const anchors = new Set(), counts = new Map(), headings=[];
  for(let i=0;i<tokens.length;i++) if(tokens[i].type==='heading_open') {
    const title=tokens[i+1].content, base=title.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu,'').replace(/\s/g,'-');
    const n=counts.get(base)||0;counts.set(base,n+1);anchors.add(base+(n?`-${n}`:''));headings.push({title,level:tokens[i].tag,line:firstLine+tokens[i].map[0],
      displayTitle:tokens[i+1].children.map(t=>t.type==='softbreak'?' ':['text','code_inline'].includes(t.type)?t.content:'').join('')});
    tokens[i].attrSet('id',base+(n?`-${n}`:''));
  }
  return {data,body,firstLine,tokens,links,anchors,headings,html:md.renderer.render(tokens,md.options,{})};
}
function localTarget(file, href) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
  const [url,fragment] = href.split('#',2);
  if (url.startsWith('/')) throw Error('Absolute site link requires an explicit reference registration');
  let decoded;try{decoded=decodeURIComponent(url.split('?')[0]);}catch{throw Error('Invalid URL encoding');}
  if (decoded.includes('\\') || decoded.includes('\0')) throw Error('Invalid local path');
  const target = decoded ? path.posix.normalize(path.posix.join(path.posix.dirname(file),decoded)) : file;
  if (target.startsWith('../') || target.startsWith('/')) throw Error('Link escapes repository');
  return {path:target,anchor:fragment?decodeURIComponent(fragment):null};
}
function build({registry,roots,revisions,language,previous=null,overrides={}}) {
  validateRegistry(registry); if(!['zh','en'].includes(language))throw Error('Invalid language');
  const errors=[], warnings=[], scopes=[], pages=new Map(), pendingReferences=[];
  const oldDocs=new Map((previous?.scopes||[]).flatMap(s=>s.documents.map(d=>[`${s.repoId}/${d.path}`,d])));
  const issue=(list,repo,file,code,message,line)=>list.push({repo,file,code,message,...(line ? {line} : {})});
  for(const r of registry.repositories.filter(r=>r.languages.includes(language))) {
    const revision=revisions[r.id], source=snapshot(roots[r.id],revision), parsed=new Map();
    const files=[...source.keys()].filter(f=>f.startsWith(`${language}/`)&&f.endsWith('.md')&&!f.split('/').some(p=>p.startsWith('.'))).sort();
    if(!files.length)issue(errors,r.id,'','empty-source','No Markdown in selected language');
    for(const f of files)try{parsed.set(f,analyze(source.get(f).read().toString('utf8')));}catch(e){issue(errors,r.id,f,'metadata',e.message);}
    const docs=[], assets=new Map();
    for(const [file,a] of parsed) {
      const h1=a.headings.filter(h=>h.level==='h1');
      if(!h1.length||!a.body.trim())issue(errors,r.id,file,'incomplete','Missing H1 or empty body');
      const visibleText=tokensOf(a.tokens).filter(t=>t.type==='text').map(t=>t.content).join('\n');
      const fileHash = sha(source.get(file).read());
      const changed = oldDocs.get(`${r.id}/${file}`)?.sha256 !== fileHash;
      if (path.posix.basename(file)==='index.md' && !hasDirectoryIntroduction(a.body)) {
        issue(changed?errors:warnings,r.id,file,'directory-introduction',
          '请在 index.md 写一段目录介绍，说明本目录涵盖哪些主题、适合什么任务。标题、链接列表或占位文字不能代替介绍。',
          h1[0]?.line || a.firstLine);
      }
      for (const finding of completeness(a.body, a.firstLine, file)) {
        const blocking = finding.blocking && changed;
        (blocking ? errors : warnings).push({
          repo:r.id, file, line:finding.line, code:blocking?'content-incomplete':'content-review',
          message:finding.message
        });
      }
      if (/\b(?:TODO|TBD)\b|待补充|待完善/.test(visibleText)) {
        issue(warnings,r.id,file,'content-review','Content contains a placeholder; document team must review completeness');
      }
      const numberedTitle = /^\d+(?:\.\d+)*(?:[.、\s]|$)/;
      const numberedHeading = a.headings.find(heading => numberedTitle.test(heading.title));
      if (numberedHeading || numberedTitle.test(a.data.title || '')) {
        issue(warnings,r.id,file,'numbered-title','Review numeric chapter prefix',numberedHeading?.line);
      }
      for(const t of a.tokens)if(t.type==='ordered_list_open' && t.attrGet('start') && t.attrGet('start')!=='1')issue(warnings,r.id,file,'list-start','Ordered list does not start at 1',t.map ? a.firstLine+t.map[0] : undefined);
      if(!source.has(file.replace(new RegExp(`^${language}/`),language==='zh'?'en/':'zh/')))issue(warnings,r.id,file,'translation','Other language counterpart is missing; release remains independent');
      let dir=path.posix.dirname(file);while(dir!=='.') {if(!source.has(`${dir}/index.md`))issue(errors,r.id,file,'index',`Missing ${dir}/index.md`);if(dir===language)break;dir=path.posix.dirname(dir);}
      const references=[];
      for (const link of a.links) {
        const report = (list, code, message) => issue(list,r.id,file,code,message,link.line);
        try {
          const registered=(overrides.references||{})[`${r.id}/${file}::${link.href}`];
          if(registered){
            const url=new URL(link.href,'https://document-center.invalid');
            const anchor=url.searchParams.get('anchor')||decodeURIComponent(url.hash.slice(1));
            pendingReferences.push({repo:r.id,file,target:registered,anchor,line:link.line,registered:true});
            continue;
          }
          const target=localTarget(file,link.href);
          if(!target){if(link.image)report(errors,'external-resource','External images must be moved into the pinned business source');else if(/^https?:/i.test(link.href)){if(/\.md(?:[?#]|$)|\/community\/document\//i.test(link.href))report(errors,'reference-registration',`Register document reference: ${link.href}`);else report(warnings,'external-link',`Review external link: ${link.href}`);}continue;}
          if(!link.image&&!source.has(target.path)&&!target.path.endsWith('.md')) {
            const directoryIndex=target.path.replace(/\/$/,'')+'/index.md';
            if(source.has(directoryIndex)) target.path=directoryIndex;
          }
          if(!source.has(target.path)) {
            if(!link.image&&target.path.endsWith('.md')) {
              pendingReferences.push({repo:r.id,file,target:r.id+'/'+target.path,anchor:target.anchor,line:link.line});
            } else report(errors,'broken-link',`Missing ${target.path}`);
            continue;
          }
          if(target.path.endsWith('.md')) {
            references.push(`${r.id}/${target.path}`);
            if(!target.path.startsWith(`${language}/`))report(errors,'cross-language','Referenced language must be released in the same group; independent release cannot resolve this link');
            if(target.anchor && !parsed.get(target.path)?.anchors.has(target.anchor))report(errors,'anchor',`Missing anchor ${target.path}#${target.anchor}`);
          } else {const bytes=source.get(target.path).read();assets.set(target.path,{path:target.path,sha256:sha(bytes)});}
        } catch (error) { report(errors,'link',error.message); }
      }
      const doc={path:file,sha256:fileHash,title:a.data.title||h1[0]?.title||path.posix.basename(file),sidebarPosition:a.data.sidebar_position??null,softwareVersion:a.data.software_version??null,references:[...new Set(references)].sort()};
      docs.push(doc);pages.set(`${r.id}/${file}`,{...a,source,repo:r,revision,file});
    }
    scopes.push({repoId:r.id,repository:r.repository,prefix:r.prefix,rootDep:r.rootDep,column:r.column,...(r.parentNavigationId?{parentNavigationId:r.parentNavigationId}:{}),...(r.navigationPath?{navigationPath:r.navigationPath}:{}),language,commit:revision,documents:docs,assets:[...assets.values()].sort((a,b)=>a.path.localeCompare(b.path))});
  }
  if(!scopes.length)throw Error('No repositories registered for selected language');
  const newDocs=new Map(scopes.flatMap(s=>s.documents.map(d=>[`${s.repoId}/${d.path}`,d])));
  const migration=migrations(scopes,previous,overrides.redirects,roots);errors.push(...migration.errors);
  const migrationReferences=[];
  for(const reference of pendingReferences) {
    const {repo,file,target,anchor,line,registered}=reference;
    const id=repo+'/'+file, moved=migration.redirects[target], resolved=moved||target;
    const doc=newDocs.get(id);
    if (registered || newDocs.has(resolved)) doc.references=[...new Set([...doc.references,resolved])].sort();
    if(!newDocs.has(resolved)) {
      if (!registered) issue(errors,repo,file,'broken-link',`Missing referenced document: ${target}`,line);
      continue;
    }
    if (!moved) continue;
    const sourcePage=pages.get(id);
    const headingIndex=sourcePage.headings.findLastIndex(heading=>heading.line<=line);
    migrationReferences.push({document:id,target,anchor,line,section:sourcePage.headings[headingIndex]?.displayTitle,
      sectionAnchor:[...sourcePage.anchors][headingIndex]});
    if(anchor&&!pages.get(resolved)?.anchors.has(anchor)) {
      issue(directoryMetadata(target)||directoryMetadata(resolved)?errors:warnings,repo,file,'redirect-anchor',`Missing migrated anchor: ${target}#${anchor} → ${resolved}#${anchor}`,line);
    }
  }
  for(const scope of scopes)for(const doc of scope.documents)for(const target of doc.references)if(!newDocs.has(target))issue(errors,scope.repoId,doc.path,'reference-group',`Reference outside complete release group: ${target}`);
  for(const [id,old]of oldDocs)if(!newDocs.has(id))issue(warnings,id.split('/')[0],id,'address-change','Removed document: review redirects, references and archive');else if(old.softwareVersion!==newDocs.get(id).softwareVersion)issue(warnings,id.split('/')[0],id,'version','Version changed: review old version archive');
  for(const [id,labels]of Object.entries(overrides.labels||{}))if(!newDocs.has(id)||!Array.isArray(labels)||labels.some(x=>typeof x!=='string'||!x.trim()||x.length>100))issue(errors,'',id,'labels','Labels must belong to a released document and be a list of text values');
  const manifest={schemaVersion:1,language,scopes,references:overrides.references||{},redirects:migration.redirects,labels:overrides.labels||{},feedback:overrides.feedback||[],reviewRequired:['content-completeness','references','version-archive','translations','directory-order','address-migration'],warnings};
  return {manifest,digest:sha(JSON.stringify(manifest)),errors,warnings,pages,previous,migrationReferences};
}
function writePreview(result,out) {
  fs.mkdirSync(out,{recursive:true});
  const items=[];
  for(const [key,p]of result.pages) {
    const tokens=md.parse(p.body,{});
    for(const t of tokensOf(tokens))if(t.type==='link_open'||t.type==='image') {
      const href=t.attrGet(t.type==='image'?'src':'href');
      const registered=(result.manifest.references||{})[`${key}::${href}`];
      if(registered){t.attrSet('href',path.posix.relative(path.posix.dirname(`${key}.html`),`${result.manifest.redirects[registered]||registered}.html`));continue;}
      const attr=t.type==='image'?'src':'href';let target;try{target=localTarget(p.file,t.attrGet(attr));}catch{continue;}if(!target)continue;
      if(t.type==='link_open'&&!p.source.has(target.path)&&!target.path.endsWith('.md')) {
        const directoryIndex=target.path.replace(/\/$/,'')+'/index.md';
        if(p.source.has(directoryIndex)) target.path=directoryIndex;
      }
      if(target.path.endsWith('.md'))t.attrSet(attr,path.posix.relative(path.posix.dirname(`${key}.html`),`${result.manifest.redirects[p.repo.id+'/'+target.path]||p.repo.id+'/'+target.path}.html`)+(target.anchor?`#${encodeURIComponent(target.anchor)}`:''));
      else {
        const asset=path.posix.join(p.repo.id,target.path), dest=path.join(out,asset);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,p.source.get(target.path)?.read()||'');
        t.attrSet(attr,path.posix.relative(path.posix.dirname(`${key}.html`),asset));
      }
    }
    // Apply the same heading IDs used by the anchor checker.
    const a=analyze(p.body);let heading=0;const opens=a.tokens.filter(t=>t.type==='heading_open');
    for(const t of tokens)if(t.type==='heading_open')t.attrSet('id',opens[heading++].attrGet('id'));
    const dest=path.join(out,`${key}.html`);fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,`<!doctype html><html lang="${result.manifest.language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(p.data.title||key)}</title><p>候选预览 · ${escape(p.revision)}</p><article>${md.renderer.render(tokens,md.options,{})}</article></html>`);
    items.push(`<li><a href="${escape(`${key}.html`)}">${escape(key)}</a></li>`);
  }
  const report=checkReport(result),markdown=reportMarkdown(report);
  fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>文档候选预览</title><h1>文档候选预览</h1><p>清单 ${result.digest}</p><p><a href="report.md">检查报告</a> · <a href="report.json">结构化检查结果</a></p>${md.render(markdown)}<ul>${items.join('')}</ul>`);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'report.md'),markdown);
  return report;
}
module.exports={build,writePreview,validateRegistry,snapshot,analyze,sha,git,compareCandidate};
