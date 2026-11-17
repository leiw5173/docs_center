const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {build}=require('../../scripts/document-governance/core.cjs');
test('new-business-repository sample passes registration content checks with local images and Unicode anchors',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'business-example-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.cpSync(path.resolve(__dirname,'../../examples/business-repository/zh'),path.join(root,'zh'),{recursive:true});
  const git=(...args)=>execFileSync('git',['-C',root,...args]).toString().trim();git('init','--quiet','-b','main');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','-m','example');
  const registry={schemaVersion:1,repositories:[{id:'maintenance-test',repository:'example/maintenance-test',branch:'main',prefix:'maintenance-test',rootDep:1,column:'cases',navigationPath:['应用案例','教学与实践'],languages:['zh']}]};
  const result=build({registry,roots:{'maintenance-test':root},revisions:{'maintenance-test':git('rev-parse','HEAD')},language:'zh'});
  assert.deepEqual(result.errors,[]);assert.equal(result.manifest.scopes[0].documents.length,3);assert.equal(result.manifest.scopes[0].assets.length,1);assert.deepEqual(result.manifest.scopes[0].navigationPath,['应用案例','教学与实践']);
  assert(fs.readFileSync(path.join(root,'zh/guide/steps.md'),'utf8').includes('**REGISTER-V1**'));assert(!fs.readFileSync(path.join(root,'zh/guide/steps.md'),'utf8').includes('MERGE-V2'));
});
