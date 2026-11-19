const {test}=require('node:test');
const assert=require('node:assert/strict');
const {reconcileSource}=require('../../scripts/document-governance/reconcile-source.cjs');

const source={repository:'example/docs',branch:'main'};
const commit='a'.repeat(40);
const base={ref:'main',repo:{full_name:source.repository}};
const merged={number:8,state:'closed',merged_at:'2026-11-19T01:00:00Z',merge_commit_sha:commit,base};
const request=associated=>async route=>{
  if(route==='/repos/example/docs/git/ref/heads/main')return {object:{sha:commit}};
  assert.equal(route,`/repos/example/docs/commits/${commit}/pulls?per_page=100`);
  return associated;
};

test('recover one missed merge only from its registered repository and branch',async()=>{
  const processed=[];
  const result=await reconcileSource({source,api:request([
    {...merged,number:7,base:{...base,ref:'other'}},merged
  ]),handled:async()=>false,generate:async event=>processed.push(event)});
  assert.deepEqual(result,{status:'updated',head:commit,pullRequest:8});
  assert.deepEqual(processed,[{repository:source.repository,commit,pullRequest:8,requireExactTip:true}]);
});

test('leave handled heads, direct pushes and unmerged PRs alone',async()=>{
  const generate=async()=>assert.fail('candidate must not be generated');
  const current=await reconcileSource({source,api:request([]),handled:async sha=>sha===commit,generate});
  assert.equal(current.status,'current');
  const direct=await reconcileSource({source,api:request([{...merged,state:'open',merged_at:null},
    {...merged,number:9,merge_commit_sha:'b'.repeat(40)}]),handled:async()=>false,generate});
  assert.equal(direct.status,'not-a-merge');
});
