const MarkdownIt = require('markdown-it');

// HTML tokens help distinguish comments from content. This parser never renders them.
const markdown = new MarkdownIt({html: true});
const revisionTitle = /^(?:修订(?:记录|历史|说明)|版本(?:记录|历史)|变更(?:记录|历史)|revision (?:history|log|record)|version history|change\s*log)$/i;
const coreTitle = /^(?:概述|简介|概览|前置条件|准备工作|操作步骤|安装(?:步骤)?|烧录(?:步骤)?|启动(?:步骤)?|验证(?:步骤)?|overview|introduction|prerequisites|installation|setup|steps|procedure|verification)$/i;
const placeholder = /^(?:TODO|TBD|TBA|待补充|待完善|暂缺|敬请期待|coming soon)(?:\s*[:：.!。…-]+)?$/i;
const label = value => value.trim().replace(/^\d+(?:\.\d+)*(?:[.、．]\s*|\s+)/, '').trim();
const prose = value => /[\p{L}\p{N}]/u.test(value);

function isContent(token) {
  if (token.type === 'inline') {
    if (token.children.some(child => child.type === 'image')) return true;
    const text = token.children
      .filter(child => child.type === 'text' || child.type === 'code_inline')
      .map(child => child.content).join(' ').trim();
    return prose(text) && !placeholder.test(text);
  }
  if (token.type === 'fence' || token.type === 'code_block') return Boolean(token.content.trim());
  if (token.type === 'html_block' || token.type === 'html_inline') {
    const html = token.content.replace(/<!--[\s\S]*?-->/g, '');
    return /<(?:img|video|iframe|svg)\b/i.test(html) || prose(html.replace(/<[^>]*>/g, ''));
  }
  return false;
}

function completeness(body, firstLine, file) {
  const sections = [], open = [];
  let hasBody = false, hasRevisionSection = false;
  const tokens = markdown.parse(body, {});
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const heading = tokens[++i];
      if (token.level !== 0) continue;
      const level = Number(token.tag.slice(1));
      while (open.at(-1)?.level >= level) open.pop();
      const title = label(heading.children.filter(child => child.type !== 'html_inline')
        .map(child => child.content).join(''));
      const revision = Boolean(open.at(-1)?.revision) ||
        ((level > 1 || sections.length > 0) && revisionTitle.test(title));
      hasRevisionSection ||= revision;
      const section = {title, level, revision, populated: false, line: firstLine + token.map[0]};
      open.push(section);
      sections.push(section);
      continue;
    }
    // Some legacy sources write the sidebar position on a bare first line.
    if (token.type === 'inline' && token.map?.[0] === 0 &&
        /^sidebar_position:\s*\d+\s*$/.test(token.content)) continue;
    if (open.at(-1)?.revision || !isContent(token)) continue;
    hasBody = true;
    for (const section of open) section.populated = true;
  }

  const directoryFile = /(?:^|\/)(?:index|readme)\.md$/i.test(file);
  const findings = sections.filter(section => !section.revision && !section.populated).map(section => ({
    line: section.line,
    blocking: !directoryFile && coreTitle.test(section.title),
    message: `第 ${section.line} 行「${section.title || '未命名章节'}」没有正文。请补充内容，或删除空标题。`
  }));
  if (!hasBody && hasRevisionSection && !directoryFile) {
    const line = sections.find(section => section.revision).line;
    findings.unshift({
      line,
      blocking: true,
      message: `第 ${line} 行起只有修订记录，文档缺少可供读者使用的正文。请补齐说明或操作步骤。`
    });
  }
  return findings;
}

module.exports = {completeness};
