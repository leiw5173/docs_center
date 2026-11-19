const {portalSections} = require('./audit-location.cjs');
const {directoryMetadata} = require('./preview-sites.cjs');

function sections(document) {
  const headings = portalSections(document.headings);
  const lines = document.body.split('\n');
  const result = new Map();
  const firstHeading = headings.length ? headings[0].line - document.firstLine : lines.length;
  result.set('', {title:'开头正文',anchor:'',text:lines.slice(0,firstHeading).join('\n').trim(),parents:[]});
  const stack = [], occurrences = new Map();
  for (const [index,heading] of headings.entries()) {
    const level = Number(heading.level.slice(1));
    while (stack.at(-1)?.level >= level) stack.pop();
    const parent = stack.at(-1)?.key || '';
    const identity = JSON.stringify([parent,level,heading.title]);
    const count = (occurrences.get(identity)||0)+1;
    occurrences.set(identity,count);
    const key = JSON.stringify([parent,level,heading.title,count]);
    const end = headings[index+1]?.line;
    result.set(key,{
      title:heading.title || '未命名章节',anchor:heading.anchor,
      text:lines.slice(heading.line-document.firstLine,end===undefined?lines.length:end-document.firstLine).join('\n').trim(),
      parents:stack.map(item=>item.key).reverse()
    });
    stack.push({key,level});
  }
  return result;
}

function changedSections(previous, candidate) {
  const before = sections(previous), after = sections(candidate);
  const oldOrder = [...before.keys()].filter(key=>after.has(key));
  const newOrder = [...after.keys()].filter(key=>before.has(key));
  const reordered = new Set(newOrder.filter((key,index)=>key!==oldOrder[index]));
  const changes = [];
  for (const [key,section] of after) {
    const old = before.get(key);
    if (section.text!==old?.text) {
      changes.push({title:section.title,anchor:section.anchor,change:old?'modified':'added'});
    } else if (reordered.has(key)) {
      changes.push({title:section.title,anchor:section.anchor,change:'reordered'});
    }
  }
  for (const [key,section] of before) {
    if (after.has(key)) continue;
    const parent = section.parents.map(id=>after.get(id)).find(Boolean);
    changes.push({title:section.title,anchor:parent?.anchor||'',change:'removed'});
  }
  return changes;
}

function documentChanges({manifest,previous,pages},readPrevious) {
  const documents = scopes => new Map(scopes.flatMap(scope=>scope.documents.map(doc=>[
    scope.repoId+'/'+doc.path,{scope,doc}
  ])));
  const before = documents(previous?.scopes||[]), after = documents(manifest.scopes);
  const movedFrom = new Map();
  for (const [from,to] of Object.entries(manifest.redirects||{})) {
    if (!before.has(from) || after.has(from) || previous.redirects?.[from]===to) continue;
    if (!movedFrom.has(to)) movedFrom.set(to,[]);
    movedFrom.get(to).push(before.get(from));
  }

  const changes = {};
  for (const [id,{doc}] of after) {
    if (directoryMetadata(doc.path) || !pages.has(id)) continue;
    const moved = movedFrom.get(id)||[];
    const old = before.get(id) || (moved.length===1 ? moved[0] : null);
    if (!old) {
      if (moved.length>1) changes[id]={status:'unavailable',reason:'multiple-previous-pages'};
      continue;
    }
    if (old.doc.sha256===doc.sha256) continue;
    const baseline = readPrevious(old.scope,old.doc);
    if (!baseline) {
      changes[id]={status:'unavailable',reason:'missing-baseline'};
      continue;
    }
    const edits = changedSections(baseline,pages.get(id));
    if (edits.length) changes[id]={status:'changed',sections:edits};
  }
  return changes;
}

module.exports = {changedSections,documentChanges};
