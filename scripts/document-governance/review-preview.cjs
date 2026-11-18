const fs = require('node:fs');
const {previewSites} = require('./preview-sites.cjs');

const imageOrigins = new Set(['https://cdn-resource.spacemit.com','https://raw.githubusercontent.com']);
const critical = /^(?:概述|简介|概览|前置条件|准备工作|操作步骤|安装(?:步骤)?|烧录(?:步骤)?|启动(?:步骤)?|验证(?:步骤)?|overview|introduction|prerequisites|installation|setup|steps|procedure|verification)$/i;
const placeholder = /^(?:TODO|TBD|TBA|待补充|待完善|暂缺)[：:。.!…\s]*$/i;
const label = text => text.trim().replace(/^\d+(?:\.\d+)*(?:[.、．]\s*|\s+)/,'').trim();

function sectionFindings(blocks) {
  const findings = [], stack = [], sections = [];
  const headingsByParent = new Map();
  for (const block of blocks) {
    if (block.depth) {
      while (stack.at(-1)?.depth >= block.depth) stack.pop();
      const parent = stack.at(-1);
      const siblings = headingsByParent.get(parent) || new Set();
      const heading = block.title.trim().toLowerCase();
      const key = block.depth + ':' + heading;
      if (heading && siblings.has(key)) {
        findings.push({severity:'warning',message:'同级章节标题重复：「'+block.title+'」。',anchor:block.anchor});
      }
      siblings.add(key);
      headingsByParent.set(parent,siblings);
      block.populated = false;
      sections.push(block);
      stack.push(block);
    } else if (block.content) {
      for (const section of stack) section.populated = true;
    }
  }
  for (const section of sections) {
    if (!section.populated && critical.test(label(section.title))) {
      findings.push({severity:'error',message:'预览的关键章节没有正文：「'+section.title+'」。',anchor:section.anchor});
    }
  }
  return findings;
}

function navigationFindings(nodes, prefixes, parent = '') {
  const findings = [], sources = new Set();
  for (const node of nodes) {
    const source = node.sourcePath;
    if (source && prefixes.some(prefix => source.startsWith(prefix+'/'))) {
      if (sources.has(source)) findings.push('同一目录出现重复文档入口：'+parent+' / '+source+'。');
      sources.add(source);
    }
    if (node.children?.length) findings.push(...navigationFindings(node.children,prefixes,
      [parent,node.name].filter(Boolean).join(' / ')));
  }
  return findings;
}

const text = value => String(value).replace(/[\r\n<>&\[\]*_`\\]/g,' ').slice(0,450);
const link = url => url.replace(/[()]/g,c => c === '(' ? '%28' : '%29');
const samePreview = (url, site) =>
  url.origin === new URL(site.url).origin && url.searchParams.get('preview') === site.digest;

async function catalog(site) {
  const endpoint = route => new URL('/document-previews/'+site.digest+'/api/document/'+route,site.url);
  const api = async (route, language) => {
    const url = endpoint(route);
    if (language) url.searchParams.set('language',language);
    const result = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if (!result.ok) throw Error(route+' 返回 HTTP '+result.status);
    const json = await result.json();
    if (json.code !== 200) throw Error(route+' 未返回有效预览数据');
    return json.data;
  };
  const [context, navigation, zh, en] = await Promise.all([
    api('preview-context'),api('get-navigation-tree',site.language),
    api('get-doc-tree','zh'),api('get-doc-tree','en')
  ]);
  if (context.digest !== site.digest || !Array.isArray(navigation)) throw Error('预览数据与候选清单不匹配');
  const paths = new Map();
  function visit(nodes, language) {
    for (const entry of nodes) {
      if (!entry.isDirectory) paths.set(language+':'+entry.path,true);
      if (entry.children?.length) visit(entry.children,language);
    }
  }
  visit(zh,'zh');visit(en,'en');
  return {paths,duplicates:navigationFindings(navigation,context.scopes.map(scope=>scope.prefix))};
}

async function inspectPage(browser, site, candidate, paths) {
  const origin = new URL(site.url).origin;
  const page = await browser.newPage();
  const failed = [];
  const imageStatus = new Map();
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['GET','HEAD'].includes(route.request().method()) && (url.origin === origin ||
          (route.request().resourceType() === 'image' && imageOrigins.has(url.origin)))) {
        return route.continue();
      }
      return route.abort();
    });
    page.on('response', response => {
      if (response.request().resourceType() === 'image') imageStatus.set(response.url(),response.status());
    });
    const response = await page.goto(candidate.url,{waitUntil:'domcontentloaded',timeout:30000});
    if (!response?.ok() || !samePreview(new URL(page.url()),site)) throw Error('正文预览地址不可用');
    const content = page.locator('.v-md-editor-preview');
    await content.locator("h1").first().waitFor({timeout:25000});
    if (!samePreview(new URL(page.url()),site)) throw Error('预览上下文丢失');
    // Lazy images should be checked even when they are below the initial viewport.
    await content.locator('img').evaluateAll(images => images.forEach(image => {image.loading='eager';}));
    await page.waitForFunction(() => [...document.querySelectorAll('.v-md-editor-preview img')].every(image=>image.complete),
      null,{timeout:10000}).catch(()=>{});
    const data = await content.first().evaluate((element, placeholderPattern) => {
      const headings = new Set();
      const blocks = [], images = [], links = [];
      const placeholder = new RegExp(placeholderPattern,'i');
      let heading = null, preceding = '';
      for (const item of element.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,table,li,blockquote,img,a')) {
        const title = item.textContent.trim();
        if (/^H[1-6]$/.test(item.tagName)) {
          heading = item.getAttribute('data-v-md-heading') || item.id || '';
          if (heading) headings.add(heading);
          preceding = '';
          blocks.push({title,depth:Number(item.tagName.slice(1)),anchor:heading});
        } else if (item.tagName === 'IMG') {
          images.push({src:item.currentSrc || item.src,alt:item.alt,complete:item.complete,loaded:item.naturalWidth>0,
            anchor:heading,preceding});
          blocks.push({content:true});
        } else if (item.tagName === 'A') {
          if (item.getAttribute('href')) links.push({href:item.href,anchor:heading});
        } else if (title && !placeholder.test(title)) {
          blocks.push({content:true});
          if (item.tagName === 'P' && !item.querySelector('img')) preceding = title.slice(-140);
        }
      }
      return {headings:[...headings],blocks,images,links};
    },placeholder.source);
    failed.push(...sectionFindings(data.blocks));
    for (const image of data.images) {
      if (!image.src) {
        failed.push({severity:'error',message:'预览正文的图片没有有效地址。',anchor:image.anchor});
        continue;
      }
      const source = new URL(image.src);
      if (source.protocol === 'data:' || image.loaded) continue;
      if (source.origin !== origin && !imageOrigins.has(source.origin)) {
        failed.push({severity:'warning',message:'外站图片需人工核对：'+source.hostname+'。',anchor:image.anchor});
        continue;
      }
      const status = imageStatus.get(image.src);
      const hint = image.preceding ? ' 图片前原文：「'+image.preceding+'」。' : '';
      const filename = source.pathname.split('/').at(-1) || source.hostname;
      const reason = status >= 400 ? '（HTTP '+status+'）' : image.complete ? '（浏览器无法显示）' : '（加载超时）';
      failed.push({severity:'error',message:'预览正文图片「'+(image.alt || filename)+'」加载失败'+reason+'。'+hint,anchor:image.anchor});
    }

    for (const reference of data.links) {
      const target = new URL(reference.href);
      if (target.origin !== origin || target.pathname !== '/community/document/info') continue;
      const targetPath = target.searchParams.get('nodepath');
      const language = target.searchParams.get('lang') || site.language;
      if (!targetPath) continue;
      if (!paths.has(language+':'+targetPath)) {
        failed.push({severity:'error',message:'预览内链指向不存在的文档：'+targetPath+'。',anchor:reference.anchor});
      } else if (targetPath === candidate.sourcePath && language === site.language) {
        const raw = target.searchParams.get('anchor') || target.hash.slice(1);
        let anchor = raw;
        try {anchor = decodeURIComponent(raw);} catch { /* Report the literal invalid anchor. */ }
        if (anchor && !data.headings.includes(anchor)) {
          const equivalent = value => value.replace(/^_(?=\d)/,'').replace(/_/g,'-').toLowerCase();
          if (!data.headings.some(heading=>equivalent(heading)===equivalent(anchor))) {
            failed.push({severity:'error',message:'预览同页链接指向不存在的章节：'+anchor+'。',anchor:reference.anchor});
          }
        }
      }
    }
  } finally { await page.close(); }
  return failed;
}

async function review(sites, browser) {
  const findings = [];
  let pageCount = 0;
  for (const site of sites) {
    let tree;
    try { tree = await catalog(site); }
    catch (error) {
      findings.push({severity:'error',url:site.url,title:site.language,message:'无法检查候选目录：'+error.message});
      continue;
    }
    for (const message of tree.duplicates) findings.push({severity:'error',url:site.url,title:site.language,message});
    for (const candidate of site.pages) {
      pageCount++;
      try {
        for (const item of await inspectPage(browser,site,candidate,tree.paths)) {
          const target = new URL(candidate.url);
          if (item.anchor) target.searchParams.set('anchor',item.anchor);
          findings.push({...item,url:target.href,title:candidate.title});
        }
      } catch (error) {
        const message = error.name === 'TimeoutError' ? '等待预览正文渲染超时。' : '浏览器未能完成正文预览检查。';
        findings.push({severity:'error',url:candidate.url,title:candidate.title,message});
      }
    }
  }
  return {pageCount,findings};
}

async function main() {
  const sites = previewSites(process.env.DOCUMENT_PREVIEW_SITES);
  const {chromium} = require('playwright');
  const browser = await chromium.launch({args:['--no-sandbox']});
  let result;
  try { result = await review(sites,browser); }
  finally { await browser.close(); }
  const failures = result.findings.filter(f => f.severity === 'error').length;
  const warnings = result.findings.length - failures;
  const lines = ['## 已部署预览复检','',`检查 ${result.pageCount} 个变更页面及候选目录，阻断 ${failures} 项，提醒 ${warnings} 项。`,'',
    ...result.findings.slice(0,150).map(f=>`- ${f.severity === 'error' ? '阻断' : '提醒'} · [${text(f.title)}](${link(f.url)}) · ${text(f.message)}`)];
  const file = process.argv[2];
  fs.writeFileSync(file,JSON.stringify(result,null,2));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`review_status=${failures?'failed':'passed'}\nreview_summary=${result.pageCount} 个页面，阻断 ${failures} 项，提醒 ${warnings} 项\n`);
  if (failures) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {console.error(error.message);process.exitCode=1;});
module.exports = {sectionFindings,navigationFindings,review};
