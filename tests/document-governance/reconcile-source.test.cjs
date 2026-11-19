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

test('direct dispatch is verified against the specific merge even if already handled',async()=>{
  const calls=[];
  const api=async route=>{
    calls.push(route);
    if(route.endsWith('/git/ref/heads/main'))return {object:{sha:commit}};
    assert.equal(route,'/repos/example/docs/pulls/8');
    return merged;
  };
  const result=await reconcileSource({source,api,notification:{commit,pullRequest:8},
    handled:async()=>true,generate:async()=>assert.fail('duplicate candidate')});
  assert.equal(result.status,'current');
  assert.equal(result.pullRequest,8);
  assert.equal(calls.length,2);
  const rejected=await reconcileSource({source,api,notification:{commit:'b'.repeat(40),pullRequest:7},
    handled:async()=>assert.fail('stale notification'),generate:async()=>assert.fail('stale notification')});
  assert.equal(rejected.status,'superseded');
  await assert.rejects(reconcileSource({source,notification:{commit,pullRequest:9},
    api:async route=>route.endsWith('/git/ref/heads/main')?{object:{sha:commit}}:{...merged,number:9,merged_at:null},
    handled:async()=>assert.fail('unverified notification'),generate:async()=>assert.fail('unverified notification')}),
  /did not merge/);
});
