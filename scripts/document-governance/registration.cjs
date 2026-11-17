const {validateRegistry}=require('./core.cjs');
const catalog=require('../../document-center/categories.json');

function registrationFromIssue(body,registry={repositories:[]}) {
  const fields={};let name=null;
  for(const line of body.split('\n'))if(line.startsWith('### ')){name=line.slice(4).trim();fields[name]='';}else if(name)fields[name]+=line+'\n';
  const value=name=>{const text=(fields[name]||'').trim();return text==='_No response_'?'':text;};
  const inputRepository=value('来源仓库');
  if(!/^[\w-]+\/[\w-][\w.-]*$/.test(inputRepository))throw Error('来源仓库请填写 owner/repository，不要填写完整网址');
  const existing=registry.repositories.find(r=>r.repository.toLowerCase()===inputRepository.toLowerCase());
  const requestedId=value('来源标识（可选）')||value('登记 ID');
  if(existing&&requestedId&&requestedId!==existing.id)throw Error('已有来源的登记 ID 不可在接入表单中修改，请提交单独的迁移申请');
  const id=existing?.id||requestedId||inputRepository.split('/').pop().replace(/[^A-Za-z0-9_-]/g,'-');
  if(!existing&&!value('登记 ID')&&!/^[A-Za-z0-9_-]+$/.test(id))throw Error('请使用字母、数字、下划线或短横线填写来源标识');
  const prefix=value('目标路径前缀')||existing?.prefix||id;
  const rootDep=value('目录层级 rootDep')?Number(value('目录层级 rootDep')):(existing?.rootDep||prefix.split('/').length);
  if(existing&&(prefix!==existing.prefix||rootDep!==existing.rootDep))throw Error('已有来源的地址前缀和目录层级不可在接入表单中修改，请提交单独的迁移申请');
  const conflict=registry.repositories.find(r=>r.id===id&&r.repository!==existing?.repository);
  if(conflict)throw Error('来源标识已被其他仓库使用，请在“来源标识（可选）”中填写其他名称');
  if(!existing&&registry.repositories.some(r=>r.prefix===prefix))throw Error('默认地址前缀已被占用，请填写其他来源标识');
  const selected=value('目标分类');
  let placement;
  if(selected) {
    const matches=catalog.categories.filter(c=>c.path.join(' / ')===selected);
    if(matches.length!==1)throw Error('目标分类不在当前分类表中，请重新选择；新增分类需先提交分类申请');
    const c=matches[0];placement={column:c.column,parentNavigationId:c.id,navigationPath:[...c.path]};
  }else if(value('目标栏目')) {
    // Old submitted issues remain readable; new forms never ask for these internals.
    placement={column:value('目标栏目'),...(value('子类节点 ID')?{parentNavigationId:value('子类节点 ID')}:{}),...(value('分类路径')?{navigationPath:value('分类路径').split('/').map(p=>p.trim()).filter(Boolean)}:{})};
  }else if(existing) {
    placement={column:existing.column,...(existing.parentNavigationId?{parentNavigationId:existing.parentNavigationId}:{}),...(existing.navigationPath?{navigationPath:[...existing.navigationPath]}:{})};
  }else throw Error('请选择目标分类');
  const entry={id,repository:existing?.repository||inputRepository,branch:value('分支')||existing?.branch||'main',prefix,rootDep,...placement,languages:value('语言')?value('语言').split(',').map(x=>x.trim()).filter(Boolean):[...(existing?.languages||[])]};
  validateRegistry({schemaVersion:1,repositories:[entry]});return entry;
}
module.exports={registrationFromIssue};
