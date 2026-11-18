// Match the VuePress heading slugs emitted by the document center's Markdown renderer.
function portalSlug(title) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’–—<>,.?/]+/g, '-')
    .replace(/^-+|-+$/g, '').replace(/^(\d)/, '_$1').toLowerCase();
}

function portalSections(headings) {
  const used = new Set();
  return headings.map(heading => {
    const title = (heading.displayTitle || heading.title).trim();
    const base = portalSlug(title);
    if (!base) return {...heading, title, anchor:''};
    let anchor = base;
    for (let suffix = 1; used.has(anchor); suffix++) anchor = base + '-' + suffix;
    used.add(anchor);
    return {...heading, title, anchor};
  });
}

function sectionAt(sections, line) {
  if (!line) return null;
  return sections.findLast(section => section.line <= line && section.anchor) || null;
}

module.exports = {portalSections, sectionAt};
