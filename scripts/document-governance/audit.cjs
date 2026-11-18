const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {analyze, sha} = require('./core.cjs');
const {completeness} = require('./completeness.cjs');
const {portalSections, sectionAt} = require('./audit-location.cjs');

const site = 'https://www.spacemit.com';
const cdn = 'https://cdn-resource.spacemit.com';
const categories = {
  links: '页内链接与资源', content: '内容完整性与序号', titles: '标题编号',
  references: '引用影响', versions: '版本与归档', translations: '中英文缺失',
  directories: '目录介绍', addresses: '地址变更', coverage: '目录或正文读取失败'
};

function storageUrl(value) {
  const url = new URL(value);
  if (url.origin !== cdn || url.username || url.password) throw Error('正文地址不在配置的文档 CDN');
  // The CDN treats literal plus signs in object paths as spaces.
  url.pathname = url.pathname.replace(/\+/g, '%2B');
  url.hash = '';
  return url.href;
}

class ReadFailure extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function failureDetails(error, stage, url) {
  const kind = error.kind || (error.name === 'TimeoutError' ? 'timeout' : 'network');
  const message = error.kind ? error.message : kind === 'timeout' ? '请求或读取正文超时。' : '网络请求未取得有效响应。';
  const endpoint = url ? new URL(url) : null;
  if (endpoint?.origin === cdn) endpoint.search = ''; // Do not report signed storage query strings.
  return {kind, stage, message, ...(error.status ? {status:error.status} : {}),
    ...(endpoint ? {checkedUrl:endpoint.href} : {})};
}

async function request(url, method = 'GET', headers) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {method, headers, redirect:'error', signal:AbortSignal.timeout(12000)});
      if (attempt === 0 && (response.status >= 500 || response.status === 429)) {
        await response.body?.cancel();
        continue;
      }
      return response;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function pool(items, task) {
  let index = 0;
  await Promise.all(Array.from({length: Math.min(16, items.length)}, async () => {
    while (index < items.length) await task(items[index++]);
  }));
}

function documents(nodes, language) {
  const result = [];
  for (const node of nodes) {
    if (node.isDirectory) {
      result.push(...documents(node.children || [], language));
    } else if (typeof node.path === 'string' && /\.md$/i.test(node.docName || node.path)) {
      result.push({language, path:node.path, url:node.storgeAddress});
    }
  }
  return result;
}

const identity = doc => doc.language + ':' + doc.path;
const directory = value => /(?:^|\/)(?:index|readme)\.md$/i.test(value);
function location(doc, section) {
  const query = new URLSearchParams({lang:doc.language,nodepath:doc.path});
  if (section) query.set('anchor',section.anchor);
  return site + '/community/document/info?' + query;
}

function comparePublished(previous, current, add) {
  if (!previous) return;
  const latest = new Map(current.map(doc => [identity(doc), doc]));
  const byTarget = new Map();
  for (const doc of current) for (const target of doc.references) {
    const refs = byTarget.get(target) || [];
    refs.push(doc);
    byTarget.set(target, refs);
  }
  function reportReferences(doc, key, context) {
    const visited = new Set([key]), pending = [key];
    for (let i = 0; i < pending.length; i++) {
      const target = pending[i];
      for (const ref of byTarget.get(target) || []) {
        const refKey = identity(ref);
        if (visited.has(refKey)) continue;
        visited.add(refKey);
        pending.push(refKey);
        add('references',doc,'incoming-reference',context + (i === 0 ? '直接' : '间接') + '引用：' + refKey);
      }
    }
  }
  for (const before of previous) {
    const key = identity(before), after = latest.get(key);
    if (!after) {
      add('addresses',before,'removed-address','已发布目录中不再有该地址，请核对迁移或下线。');
      reportReferences(before,key,'旧地址仍有');
    } else if (after.inspected !== false && before.inspected !== false && after.version !== before.version) {
      add('versions',after,'version-changed','版本由 ' + (before.version || '未标注') +
        ' 变为 ' + (after.version || '未标注') + '，请核对旧版归档。');
      reportReferences(after,key,'版本变更涉及');
    }
  }
}

async function readText(response, limit) {
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    const kind = [404,410].includes(status) ? 'not-found'
      : [401,403].includes(status) ? 'access-denied'
      : status === 429 || status >= 500 ? 'service-error' : 'http-error';
    throw new ReadFailure(kind, '服务器返回 HTTP ' + status + '。', status);
  }
  if (response.headers.get('content-type')?.includes('text/html')) {
    await response.body?.cancel();
    throw new ReadFailure('unexpected-html','服务器返回 HTML，预期为 Markdown 正文或目录数据。');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw new ReadFailure('size-limit','响应超过本次巡检的读取容量上限。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function missingResource(url, fetcher = request) {
  const head = await fetcher(url,'HEAD');
  if (![404,410,405,501].includes(head.status)) return null;
  // Confirm via GET. Some storage origins reject HEAD for a readable object.
  const probe = await fetcher(url,'GET',{Range:'bytes=0-0'});
  await probe.body?.cancel();
  return [404,410].includes(probe.status) ? probe.status : null;
}

async function audit(out, baseline, pinnedOut) {
  const findings = [], inventory = [], catalog = [], parsed = new Map();
  const add = (category, doc, code, message, line, evidence) => {
    const section = sectionAt(parsed.get(identity(doc))?.sections || [],line);
    findings.push({
      category, language:doc.language, path:doc.path,
      url:category === 'coverage' && !doc.url ? '' : location(doc,section),
      code, message, ...(line ? {line} : {}), ...(section ? {section:section.title} : {}),
      ...(evidence ? {evidence} : {})
    });
  };
  const unread = (doc, code, error, stage, url) => {
    const details = failureDetails(error, stage, url);
    add('coverage',doc,code,details.message,null,details);
  };
  for (const language of ['zh','en']) {
    const url = site + '/api-server/document/get-doc-tree?language=' + language;
    try {
      const response = await request(url);
      let data;
      const text = await readText(response, 12 * 1024 * 1024);
      try { data = JSON.parse(text); }
      catch { throw new ReadFailure('invalid-catalog','响应不是有效的目录 JSON。'); }
      if (![200,20000].includes(data.code) || !Array.isArray(data.data)) {
        throw new ReadFailure('invalid-catalog','接口未返回成功状态或有效的目录数据。');
      }
      const entries = documents(data.data, language);
      if (!entries.length) throw new ReadFailure('empty-catalog','目录中没有返回任何已发布 Markdown。');
      catalog.push(...entries);
    } catch (error) {
      unread({language,path:'已发布目录'},'catalog-unavailable',error,'读取官网目录',url);
    }
  }
  const catalogComplete = !findings.length;
  console.log('Published catalog lists ' + catalog.length + ' Markdown pages');
  const byUrl = new Map(), byPath = new Set(catalog.map(identity));
  for (const doc of catalog) {
    try {
      doc.url = storageUrl(doc.url);
      const entries = byUrl.get(doc.url) || [];
      entries.push(doc);
      byUrl.set(doc.url,entries);
    }
    catch {
      unread(doc,'unsupported-source',new ReadFailure('unsupported-source','目录未提供有效的文档 CDN 地址。'),
        '解析目录记录的正文地址');
    }
  }
  await pool([...byUrl], async ([url, entries]) => {
    try {
      const response = await request(url);
      const content = await readText(response, 4 * 1024 * 1024);
      let data;
      try { data = analyze(content); }
      catch { throw new ReadFailure('invalid-markdown','正文已下载，但 Markdown 文档元数据无法解析。'); }
      const sections = portalSections(data.headings);
      for (const doc of entries) parsed.set(identity(doc), {doc, data, sections});
    } catch (error) {
      const stage = error.kind === 'invalid-markdown' ? '解析正文元数据' : '读取 CDN 正文';
      for (const doc of entries) unread(doc,'body-unavailable',error,stage,url);
    }
  });

  console.log('Read ' + parsed.size + ' Markdown bodies');
  const resources = new Map();
  const hasAnchor = (item, anchor) => item.data.anchors.has(anchor) || item.sections.some(section => section.anchor === anchor);
  const languages = new Set(catalog.map(doc => doc.language));
  for (const {doc, data} of parsed.values()) {
    const references = new Set();
    if (!directory(doc.path)) {
      if (!data.body.trim() || !data.headings.some(heading => heading.level === 'h1')) {
        add('content',doc,'incomplete','正文为空或缺少一级标题。');
      }
      for (const finding of completeness(data.body, data.firstLine, doc.path)) {
        add('content',doc,finding.blocking ? 'content-incomplete' : 'content-review',finding.message,finding.line);
      }
      const numbered = /^\d+(?:\.\d+)*(?:[.、\s]|$)/;
      for (const heading of data.headings.filter(h => numbered.test(h.title))) {
        add('titles',doc,'numbered-title','请核对标题开头的章节编号。',heading.line);
      }
      if (numbered.test(data.data.title || '') && !data.headings.some(h => h.title === data.data.title)) {
        add('titles',doc,'numbered-title','请核对文档元数据 title 中的章节编号。');
      }
      for (const token of data.tokens.filter(t => t.type === 'ordered_list_open' && Number(t.attrGet('start') || 1) !== 1)) {
        add('content',doc,'list-start','有序列表从非 1 开始，请核对编号。',data.firstLine+token.map[0]);
      }
      for (const token of data.tokens.filter(t => t.type === 'inline' &&
          /^(?:TODO|TBD|TBA|待补充|待完善|暂缺)[：:。.!…\s]*$/i.test(t.content.trim()))) {
        add('content',doc,'placeholder','检测到单独的占位文字，请核对。',token.map ? data.firstLine+token.map[0] : undefined);
      }
      const peer = doc.language === 'zh' ? 'en' : 'zh';
      if (languages.has(peer) && !byPath.has(peer + ':' + doc.path)) {
        add('translations',doc,'translation-review','未找到同路径的对应语言，请确认翻译是否使用不同地址。');
      }
      const parent = path.posix.dirname(doc.path);
      if (!byPath.has(doc.language + ':' + parent + '/index.md')) {
        add('directories',doc,'index','已发布目录未看到对应目录的 index.md，请核对来源。');
      }
    }

    for (const link of data.links) {
      let target;
      try {
        target = new URL(link.href,doc.url);
        if (target.origin === cdn) {
          const hash = target.hash;
          target = new URL(storageUrl(target.href));
          target.hash = hash;
        }
      }
      catch { add('links',doc,'invalid-url','链接格式无法解析。',link.line); continue; }
      const hash = target.hash;
      target.hash = '';
      if (target.origin === site && target.pathname === '/community/document/info') {
        const targetPath = target.searchParams.get('nodepath');
        if (!targetPath) continue;
        const key = (target.searchParams.get('lang') || doc.language) + ':' + targetPath;
        references.add(key);
        if (!byPath.has(key)) {
          add('references',doc,'unknown-reference','目标文档未在当前目录中找到：' + targetPath,link.line);
        } else {
          const anchor = target.searchParams.get('anchor');
          if (anchor && parsed.has(key) && !hasAnchor(parsed.get(key),anchor)) {
            add('links',doc,'missing-anchor','目标章节不存在：' + targetPath + '#' + anchor,link.line);
          }
        }
        continue;
      }
      if (target.origin !== cdn || target.username || target.password) continue;
      const known = byUrl.get(target.href)?.[0];
      if (known) {
        references.add(identity(known));
        if (!hash || !parsed.has(identity(known))) continue;
        try {
          if (!hasAnchor(parsed.get(identity(known)),decodeURIComponent(hash.slice(1)))) {
            add('links',doc,'missing-anchor','目标章节不存在：' + known.path + hash,link.line);
          }
        } catch {add('links',doc,'invalid-anchor','链接锚点编码无效。',link.line);}
      } else if (!target.search) {
        const owners = resources.get(target.href) || [];
        owners.push({doc,line:link.line});
        resources.set(target.href, owners);
      }
    }
    inventory.push({language:doc.language,path:doc.path,version:data.data.software_version || null,references:[...references].sort()});
  }
  console.log('Found ' + resources.size + ' CDN link targets to verify');
  await pool([...resources], async ([url, owners]) => {
    try {
      const status = await missingResource(url);
      if (status) {
        for (const owner of owners) add('links',owner.doc,'missing-resource','正文引用的资源无法找到。',owner.line,
          {stage:'核验正文内资源',kind:'not-found',status,checkedUrl:url});
      }
    } catch {
      // Transient failures and HEAD denials do not establish a broken link.
    }
  });

  const complete = !findings.some(f => f.category === 'coverage');
  const inspected = new Set(inventory.map(identity));
  for (const doc of catalog) {
    if (!inspected.has(identity(doc))) inventory.push({
      language:doc.language,path:doc.path,inspected:false,version:null,references:[]
    });
  }
  const baselineCompared = catalogComplete && baseline?.catalogComplete === true;
  if (baselineCompared) comparePublished(baseline.documents,inventory,add);
  const checks = {
    ...categories,
    references: '引用影响（已发布内部直接及间接引用）',
    versions: '版本与归档（对比最近完整基线；归档由团队确认）',
    addresses: '地址变更（对比最近完整基线；治理清单保留迁移核对）'
  };
  const report = {complete,catalogComplete,baselineCompared,
    listed:catalog.length, inspected:parsed.size, checks, findings};
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'published-report.json'),JSON.stringify(report,null,2));
  // Only a complete catalog can establish that an old address disappeared.
  if (catalogComplete) fs.writeFileSync(path.join(out,'published-inventory.json'),JSON.stringify({catalogComplete,documents:inventory}));
  const summary = ['## 已发布文档巡检','',
    `已检查 ${parsed.size}/${catalog.length} 篇。历史对比：${report.baselineCompared ? '已执行' : '等待可用的完整基线'}。`,
    '', ...Object.entries(checks).map(([key,title]) => `- ${title}：${findings.filter(f=>f.category===key).length} 项`),
    '', '外部站点、翻译配对和版本归档需要人工确认。逐项结果见巡检附件。'];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary.join('\n')+'\n');
  if (pinnedOut) auditPinned(pinnedOut);
}

function auditPinned(out) {
  const root = path.resolve(__dirname,'../..');
  const releases = path.join(root,'document-center/releases');
  const manifests = new Set();
  for (const language of ['zh','en']) {
    const state = path.join(root,'document-center/state',language);
    if (!fs.existsSync(state)) continue;
    for (const entry of fs.readdirSync(state).filter(name => name.endsWith('.json'))) {
      const {groupId} = JSON.parse(fs.readFileSync(path.join(state,entry),'utf8'));
      if (typeof groupId === 'string' && /^g-[0-9a-f]+$/.test(groupId)) manifests.add(path.join(releases,language,groupId+'.json'));
    }
  }
  for (const manifest of manifests) {
    const output = path.join(out,path.relative(releases,manifest).replace(/\.json$/,''));
    const result = spawnSync(process.execPath,[path.join(__dirname,'run.cjs'),'check','--manifest',manifest,'--output',output],
      {env:{...process.env,GITHUB_STEP_SUMMARY:''},encoding:'utf8',timeout:180000});
    if (result.status !== 0 && !fs.existsSync(path.join(output,'report.json'))) {
      fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,'coverage-error.json'),JSON.stringify({manifest:path.relative(root,manifest)}));
    }
  }
}

module.exports = {audit, categories, comparePublished, documents, identity, sha, storageUrl, readText, failureDetails, missingResource, location};
