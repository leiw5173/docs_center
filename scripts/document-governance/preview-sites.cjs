function previewSites(value) {
  const sites=typeof value==='string'?JSON.parse(value):value;
  if(!Array.isArray(sites)||!sites.length||sites.length>2)throw Error('Deployed preview links are required');
  const languages=new Set();
  for(const site of sites) {
    if(!['zh','en'].includes(site.language)||languages.has(site.language)||!/^[a-f0-9]{64}$/.test(site.digest))throw Error('Invalid deployed preview identity');languages.add(site.language);
    const url=new URL(site.url),prefix=`/document-previews/${site.digest}/`;
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!==prefix+'index.html')throw Error('Invalid deployed preview URL');
    if(!Array.isArray(site.redirects)||site.redirects.length>4)throw Error('Invalid migration preview links');
    for(const redirect of site.redirects) {
      const link=new URL(redirect.url);
      if(link.origin!==url.origin||link.search||link.hash||link.pathname!==prefix+redirect.from.split('/').map(encodeURIComponent).join('/')+'.html'||!redirect.from.includes(`/${site.language}/`)||!redirect.to.includes(`/${site.language}/`))throw Error('Invalid migration preview target');
    }
  }
  return sites;
}
module.exports={previewSites};
