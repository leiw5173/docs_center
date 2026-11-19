const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {previewMessage,feishuPayloads,sendPreview}=require('../../scripts/document-governance/notify-preview.cjs');
const options={repository:'example/governance',number:16,revision:'a'.repeat(40),runId:'123',
  deployment:'success',reviewOutcome:'success',sites:[]};

test('test addresses are included in a signed group notification, with clickable page links',async()=>{
  const address='https://preview.example/test/changed-page';
  const sites=[{language:'zh',url:'https://preview.example',pages:[{title:'变更正文',path:'zh/a.md',url:address}],redirects:[]}];
  const message=previewMessage({...options,sites,review:{pageCount:1,redirectCount:0,findings:[],redirectFailures:[]}});
  const hook='https://open.feishu.cn/open-apis/bot/v2/hook/test-only';
  await sendPreview(hook,'sample-private-key',message,async(url,request)=>{
    const payload=JSON.parse(request.body);
    assert.equal(url,hook);
    assert.equal(request.redirect,'error');
    assert.equal(payload.sign,createHmac('sha256',payload.timestamp+'\nsample-private-key').digest('base64'));
    const post=payload.content.post.zh_cn;
    assert.match(post.title,/已部署完成，请审查/);
    assert(post.content.flat().some(item=>item.tag==='a'&&item.href===address));
    return Response.json({code:0});
  });
});

test('failed deployments can notify without a test link and large previews split by Feishu byte limit',async()=>{
  const failed=previewMessage({...options,deployment:'failure'});
  assert.match(failed.title,/部署失败/);
  assert(failed.paragraphs.flat().every(item=>!item.href||item.href.startsWith('https://github.com/')));
  const message={title:'测试',paragraphs:Array.from({length:100},()=>[{tag:'text',text:'中'.repeat(200)}])};
  const payloads=feishuPayloads(message,'','0');
  assert(payloads.length>1);
  assert(payloads.every(payload=>Buffer.byteLength(payload)<=18000));
  assert.equal(payloads.reduce((n,payload)=>n+JSON.parse(payload).content.post.zh_cn.content.length,0),100);
  await assert.rejects(sendPreview('https://unrelated.example/hook','',failed,()=>assert.fail('unexpected request')),/Feishu custom bot URL/);
});

test('local notifications give the host browser address instead of the runner network address',()=>{
  const url='http://document-review-preview-gateway/community/document?lang=zh';
  const page='http://document-review-preview-gateway/community/document/info?lang=zh';
  const sites=[{language:'zh',url,pages:[{title:'变更正文',path:'zh/a.md',url:page}],redirects:[]}];
  const message=previewMessage({...options,sites,local:true});
  assert.match(message.title,/本地测试网.*已部署完成/);
  assert(message.paragraphs.flat().some(item=>item.href==='http://127.0.0.1:18098/community/document/info?lang=zh'));
  assert(!JSON.stringify(message).includes('document-review-preview-gateway'));
});
