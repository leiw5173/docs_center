const {build,validateRegistry,sha}=require('./core.cjs');
const {referenceGroups,selectGroup,releaseLocation}=require('./groups.cjs');
function onboardingFile(branch){const m=/^document-registration\/(issue-[1-9][0-9]*)$/.exec(branch||'');if(!m)throw Error('Invalid onboarding branch');return `document-center/onboarding/${m[1]}.json`;}
function validateOnboarding(registry,bundle){
 validateRegistry(registry);const id=registry.change?.repositoryId,entry=registry.repositories.find(r=>r.id===id);
 if(!entry||bundle?.schemaVersion!==1||bundle.repositoryId!==id||!Array.isArray(bundle.releases)||!bundle.releases.length)throw Error('Invalid onboarding bundle');
 const languages=new Set(),commits=new Map();
 for(const m of bundle.releases){
  if(!entry.languages.includes(m.language)||languages.has(m.language)||!Array.isArray(m.scopes)||!m.scopes.length)throw Error('Invalid onboarding language coverage');languages.add(m.language);
  const members=m.scopes.map(s=>s.repoId).sort();if(m.schemaVersion!==1||new Set(members).size!==members.length||members.some(id=>!registry.repositories.some(r=>r.id===id))||m.groupId!=='g-'+sha(members.join('\n')).slice(0,20)||JSON.stringify(m.groupRepositories)!==JSON.stringify(members))throw Error('Invalid onboarding reference group');
  const selected=m.scopes.filter(s=>s.repoId===id);if(selected.length!==1)throw Error('Onboarding source missing from release');
  const s=selected[0];for(const key of ['repository','prefix','rootDep','column','parentNavigationId','navigationPath'])if(JSON.stringify(s[key])!==JSON.stringify(entry[key]))throw Error('Onboarding scope differs from registration');
  for(const scope of m.scopes){if(!/^[a-f0-9]{40}$/.test(scope.commit)||commits.has(scope.repoId)&&commits.get(scope.repoId)!==scope.commit)throw Error('Onboarding languages must use one fixed revision');commits.set(scope.repoId,scope.commit);}
  releaseLocation(m.language,m.groupId);
 }
 if(languages.size!==entry.languages.length)throw Error('Onboarding must include every registered language');
 return entry;
}
async function buildOnboarding({registry,entry,load,previousFor,overridesFor}){
 const releases=[];
 for(const language of entry.languages){
  const previous=previousFor(language),overrides=overridesFor?overridesFor(language,previous):previous,known=new Map(previous.scopes.map(s=>[s.repoId,s]));let wanted=new Set([entry.id]);
  for(let i=0;i<=registry.repositories.length;i++){
   const selected=registry.repositories.filter(r=>wanted.has(r.id)&&r.languages.includes(language));
   const {roots,revisions}=await load(selected);
   const result=build({registry:{schemaVersion:1,repositories:selected},roots,revisions,language,previous,overrides});
   const fresh=new Map(result.manifest.scopes.map(s=>[s.repoId,s]));
   const graph={scopes:registry.repositories.filter(r=>r.languages.includes(language)).map(r=>fresh.get(r.id)||known.get(r.id)||{repoId:r.id,documents:[]}),redirects:overrides.redirects};
   const group=referenceGroups(graph,previous.scopes).find(g=>g.repositories.includes(entry.id));
   if(group.repositories.every(id=>wanted.has(id))){releases.push(selectGroup(result,group).manifest);break;}
   wanted=new Set(group.repositories);if(i===registry.repositories.length)throw Error('Onboarding reference group did not converge');
  }
 }
 const bundle={schemaVersion:1,repositoryId:entry.id,releases};validateOnboarding(registry,bundle);return bundle;
}
function onboardingFiles(registry,bundle,file){
 if(!/^document-center\/onboarding\/issue-[1-9][0-9]*\.json$/.test(file)||registry.change?.onboarding!==file)throw Error('Invalid onboarding bundle path');
 validateOnboarding(registry,bundle);const files={'document-center/registry.json':registry,[file]:bundle};
 for(const m of bundle.releases){files[releaseLocation(m.language,m.groupId).file]=m;for(const s of m.scopes)files[`document-center/state/${m.language}/${s.repoId}.json`]={repoId:s.repoId,groupId:m.groupId};}
 return Object.fromEntries(Object.entries(files).map(([k,v])=>[k,JSON.stringify(v,null,2)+'\n']));
}
module.exports={onboardingFile,validateOnboarding,buildOnboarding,onboardingFiles};
