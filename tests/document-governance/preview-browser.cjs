// Run after `npm run demo`; accepts the existing acceptance browser image.
const {chromium}=require('/opt/playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'/preview');
const backend=process.argv[3]==='backend';
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+'/')){res.writeHead(404).end();return;}
    try{res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.getByRole('link',{name:backend?'合成目录':'synthetic/zh/index.md',exact:true}).click();
    await page.getByRole('link',{name:backend?'指南':'开发指南',exact:true}).click();
    assert.match(decodeURIComponent(page.url()),/guide\.md\.html#安装$/);
    await page.locator('h2#安装').waitFor();
    assert.equal(await page.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await page.reload();await page.getByRole('heading',{name:backend?'合成指南':'合成开发指南',exact:true}).waitFor();
    await page.getByRole('link',{name:'返回目录',exact:true}).click();
    await page.getByRole('heading',{name:backend?'合成目录':'合成目录预览',exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log('Preview browser PASS: navigation, Unicode anchor, local resource, refresh, return link, no page errors');
  } finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
