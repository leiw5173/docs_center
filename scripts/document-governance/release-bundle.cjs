const {sha} = require('./core.cjs');
const {releaseLocation,parseReleaseBranch} = require('./groups.cjs');

function bundleId(releases) {
  return 'g-'+sha(releases.map(release=>release.language+'/'+release.groupId).sort().join('\n')).slice(0,20);
}

function bundleLocation(id) {
  if(!/^g-[a-f0-9]{20}$/.test(id)) throw Error('Invalid bilingual release identity');
  return {branch:'document-release/bilingual/'+id,file:'document-center/bilingual/'+id+'.json',id};
}

function candidateLocation(branch) {
  const match=/^document-release\/bilingual\/(g-[a-f0-9]{20})$/.exec(branch||'');
  return match ? bundleLocation(match[1]) : parseReleaseBranch(branch);
}

function makeBundle(releases) {
  const sorted=[...releases].sort((a,b)=>a.language.localeCompare(b.language));
  const bundle={schemaVersion:1,bundleId:bundleId(sorted),releases:sorted};
  validateBundle(bundle,bundleLocation(bundle.bundleId));
  return bundle;
}

function validateBundle(bundle,location) {
  if(bundle?.schemaVersion!==1||bundle.bundleId!==location.id||!Array.isArray(bundle.releases)||
      bundle.releases.length!==2||bundleId(bundle.releases)!==location.id) throw Error('Invalid bilingual release bundle');
  const [en,zh]=bundle.releases;
  if(en.language!=='en'||zh.language!=='zh') throw Error('Bilingual release requires one English and one Chinese manifest');
  for(const release of bundle.releases) {
    if(!/^g-[a-f0-9]{20}$/.test(release.groupId)||!Array.isArray(release.scopes)||!release.scopes.length) {
      throw Error('Bilingual bundle contains an invalid release manifest');
    }
  }
  const enCommits=new Map(en.scopes.map(scope=>[scope.repoId,scope.commit]));
  const shared=zh.scopes.filter(scope=>enCommits.has(scope.repoId));
  if(!shared.length||shared.some(scope=>enCommits.get(scope.repoId)!==scope.commit)) throw Error('Bilingual manifests must share the same revision of their common sources');
  return bundle.releases;
}

function candidateFiles(location,document) {
  const files={[location.file]:document};
  const releases=location.id?validateBundle(document,location):[document];
  for(const release of releases) {
    if(location.id) files[releaseLocation(release.language,release.groupId).file]=release;
    for(const scope of release.scopes) files[`document-center/state/${release.language}/${scope.repoId}.json`]={repoId:scope.repoId,groupId:release.groupId};
  }
  return Object.fromEntries(Object.entries(files).map(([file,content])=>[file,JSON.stringify(content,null,2)+'\n']));
}

module.exports={bundleLocation,candidateLocation,makeBundle,validateBundle,candidateFiles};
