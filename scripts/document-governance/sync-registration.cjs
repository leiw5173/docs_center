const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.resolve(__dirname,'../..');
const catalog=require('../../document-center/categories.json');
const names={hardware:'硬件',os:'操作系统',ai:'AI软件栈',cases:'应用案例',tools:'常用工具'};
const ids=new Set(),labels=new Set();
if(catalog.schemaVersion!==1||!Array.isArray(catalog.categories)||!catalog.categories.length)throw Error('Missing category catalog');
for(const c of catalog.categories){
  if(!names[c.column]||typeof c.id!=='string'||!/^[\w/-]+$/.test(c.id)||c.id.split('/').some(p=>!p||p==='..')||!Array.isArray(c.path)||!c.path.length||c.path.length>2||c.path[0]!==names[c.column]||c.path.some(p=>typeof p!=='string'||!p.trim()||/[|\r\n]/.test(p)))throw Error('Invalid category: use a top-level column or its direct subcategory');
  const label=c.path.join(' / ');if(ids.has(c.id)||labels.has(label))throw Error('Duplicate category');ids.add(c.id);labels.add(label);
}
const formFile=path.join(root,'.github/ISSUE_TEMPLATE/document-registration.yml');
const formText=fs.readFileSync(formFile,'utf8'),form=yaml.load(formText);
const field=form.body.find(f=>f.id==='category');if(!field||field.type!=='dropdown')throw Error('Missing category selector');
field.attributes.options=[...labels];
const nextForm=yaml.dump(form,{lineWidth:120,noRefs:true});
const docFile=path.join(root,'docs/category-catalog.md'),doc=fs.readFileSync(docFile,'utf8');
const start='<!-- categories:start -->',end='<!-- categories:end -->';
if(doc.split(start).length!==2||doc.split(end).length!==2||doc.indexOf(start)>doc.indexOf(end))throw Error('Missing category table markers');
const table='| 目标分类（表单显示） | 栏目 | 子类节点 ID（自动填写，无需抄写） |\n| --- | --- | --- |\n'+catalog.categories.map(c=>`| ${c.path.join(' / ')} | ${names[c.column]} | \`${c.id}\` |`).join('\n');
const nextDoc=doc.slice(0,doc.indexOf(start)+start.length)+'\n\n'+table+'\n\n'+doc.slice(doc.indexOf(end));
const changed=[[formFile,formText,nextForm],[docFile,doc,nextDoc]].filter(([,old,next])=>old!==next);
if(process.argv.includes('--check')){if(changed.length)throw Error('分类表或表单未同步，请运行 npm run sync:categories');}
else for(const [file,,next] of changed)fs.writeFileSync(file,next);
console.log(`Category catalog ${process.argv.includes('--check')?'checked':'synchronized'}: ${catalog.categories.length} locations`);
