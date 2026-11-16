// Synthetic preview only. Never registers these fixtures as real document sources.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {build,writePreview}=require('./core.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'document-governance-demo-'));
const output=path.resolve(process.argv[2]||'/tmp/document-governance-preview');
try {
  const files={'zh/index.md':'---\nsidebar_position: 2\n---\n# 合成目录预览\n\n以下为测试数据，不对应真实业务仓库。\n\n[开发指南](guide.md#安装)\n','zh/guide.md':'---\nsidebar_position: 1\nsoftware_version: "demo-1.0"\n---\n# 合成开发指南\n\n这是测试正文，仅验证预览。\n\n## 安装\n\n[返回目录](index.md)\n\n![示例图片](images/board.svg)\n','zh/images/board.svg':'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#edf2ff"/><text x="20" y="45" fill="#334155">SYNTHETIC</text></svg>'};
  for(const [file,text]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);}
  const git=(...args)=>execFileSync('git',['-C',root,...args]).toString().trim();git('init','--quiet');git('add','.');git('-c','user.name=Synthetic Test','-c','user.email=test@example.invalid','commit','--quiet','-m','synthetic preview');
  const registry={schemaVersion:1,repositories:[{id:'synthetic',repository:'example/synthetic',branch:'main',prefix:'tools/synthetic',rootDep:1,column:'tools',languages:['zh']}]};
  const result=build({registry,roots:{synthetic:root},revisions:{synthetic:git('rev-parse','HEAD')},language:'zh'});
  if(result.errors.length)throw Error(JSON.stringify(result.errors));writePreview(result,output);
  console.log(`Synthetic preview written to ${output}`);
}finally{fs.rmSync(root,{recursive:true,force:true});}
