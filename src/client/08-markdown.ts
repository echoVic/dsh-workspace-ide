// ─── markdown preview ───────────────────────────────────────────────────────
//
// The Files tab can show a Markdown file as either editable source or a rendered
// preview. Rendering happens entirely in React nodes — no markup strings and no
// DOM HTML sinks — so the module-face audit keeps holding. Code fences
// reuse the syntax highlighter from 07-highlight.js, and every colour comes from
// the shared --dsw-alias-* tokens, so the preview follows the selected theme.

/** Inline markdown node. */
interface InlineNode {
  type: string;
  text?: string;
  children?: Array<InlineNode>;
  url?: string;
  alt?: string;
}

/** One list item (with optional task checkbox and nested block). */
interface ListItem {
  inline: Array<InlineNode>;
  task?: boolean | null;
  nested?: BlockNode | null;
}

/** Block markdown node. */
interface BlockNode {
  type: string;
  depth?: number;
  inline?: Array<InlineNode>;
  blocks?: Array<BlockNode>;
  text?: string;
  lang?: string;
  ordered?: boolean;
  items?: Array<ListItem>;
  header?: Array<Array<InlineNode>>;
  align?: Array<string | null>;
  rows?: Array<Array<Array<InlineNode>>>;
}

const MD_MAX_SOURCE_CHARS = 300 * 1024;
const MD_HEADING_SIZES = [26, 21, 17.5, 15.5, 13.5, 13.5];

const MD_INLINE_ESCAPE = /[\\`*_{}[\]()#+\-.!>~|]/;

/**
 * Allow only inert URL schemes in preview links/images. `javascript:`, `data:`
 * and friends render as plain text; http(s), mailto, anchors and relative
 * workspace paths pass through.
 * @param {unknown} raw - candidate URL.
 * @returns {string|null} safe URL or null.
 */
function mdSafeUrl(raw: unknown): string|null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (url.length === 0) return null;
  if (/^(?:javascript|vbscript|data|file):/i.test(url)) return null;
  if (/^(?:https?:\/\/|mailto:|\/|\.{1,2}\/|#|[A-Za-z0-9._~-]+\/)/.test(url)) return url;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return null;
  return url;
}

function mdPlainInline(nodes: any) {
  let out = '';
  for (let index = 0; index < nodes.length; index = index + 1) {
    const node = nodes[index];
    if (node.type === 'text' || node.type === 'code') out = out + node.text;
    else if (Array.isArray(node.children)) out = out + mdPlainInline(node.children);
    else if (typeof node.alt === 'string') out = out + node.alt;
  }
  return out;
}

/**
 * Parse `[...](url "title")` starting at `start` (the `[`).
 * @param {string} text - source text.
 * @param {number} start - index of `[`.
 * @returns {{label: string, url: string, end: number}|null} parsed target.
 */
function mdParseLinkTarget(text: string, start: number): any {
  const labelEnd = text.indexOf(']', start + 1);
  if (labelEnd === -1) return null;
  if (text.charAt(labelEnd + 1) !== '(') return null;
  let depth = 1;
  let index = labelEnd + 2;
  while (index < text.length) {
    const ch = text.charAt(index);
    if (ch === '\\') {
      index += 2;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        const label = text.slice(start + 1, labelEnd);
        const target = text.slice(labelEnd + 2, index).trim();
        const url = target.split(/\s+/)[0];
        return { label: label, url: url, end: index + 1 };
      }
    }
    index += 1;
  }
  return null;
}

function mdMatchDelimited(text: any, index: any, delimiters: any) {
  for (let cursor = 0; cursor < delimiters.length; cursor = cursor + 1) {
    const delimiter = delimiters[cursor];
    if (text.indexOf(delimiter, index) !== index) continue;
    const close = text.indexOf(delimiter, index + delimiter.length);
    if (close === -1) continue;
    const inner = text.slice(index + delimiter.length, close);
    if (inner.length === 0 || inner.trim().length === 0) continue;
    return { inner: inner, end: close + delimiter.length };
  }
  return null;
}

/**
 * Inline tokenizer: escapes, code spans, images, links, strong/em/del,
 * autolinks. Everything else becomes text nodes (React escapes them).
 * @param {string} text - inline markdown.
 * @returns {Array<InlineNode>} inline nodes.
 */
function parseMarkdownInline(text: string): Array<InlineNode> {
  const nodes: any[] = [];
  let buffer = '';
  let index = 0;
  const flush = function () {
    if (buffer.length > 0) {
      nodes.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };
  while (index < text.length) {
    const ch = text.charAt(index);
    if (ch === '\\' && index + 1 < text.length && MD_INLINE_ESCAPE.test(text.charAt(index + 1))) {
      buffer = buffer + text.charAt(index + 1);
      index += 2;
      continue;
    }
    if (ch === '`') {
      let run = 1;
      while (text.charAt(index + run) === '`') run += 1;
      const fence = '`'.repeat(run);
      const close = text.indexOf(fence, index + run);
      if (close !== -1) {
        flush();
        nodes.push({ type: 'code', text: text.slice(index + run, close).replace(/\n/g, ' ') });
        index = close + run;
        continue;
      }
    }
    if (ch === '!' && text.charAt(index + 1) === '[') {
      const parsed = mdParseLinkTarget(text, index + 1);
      if (parsed !== null) {
        flush();
        nodes.push({ type: 'image', alt: parsed.label, url: parsed.url });
        index = parsed.end;
        continue;
      }
    }
    if (ch === '[') {
      const parsed = mdParseLinkTarget(text, index);
      if (parsed !== null) {
        flush();
        nodes.push({ type: 'link', url: parsed.url, children: parseMarkdownInline(parsed.label) });
        index = parsed.end;
        continue;
      }
    }
    if (ch === '~') {
      const del = mdMatchDelimited(text, index, ['~~']);
      if (del !== null) {
        flush();
        nodes.push({ type: 'del', children: parseMarkdownInline(del.inner) });
        index = del.end;
        continue;
      }
    }
    if (ch === '*') {
      const strong = mdMatchDelimited(text, index, ['**']);
      if (strong !== null) {
        flush();
        nodes.push({ type: 'strong', children: parseMarkdownInline(strong.inner) });
        index = strong.end;
        continue;
      }
      const em = mdMatchDelimited(text, index, ['*']);
      if (em !== null) {
        flush();
        nodes.push({ type: 'em', children: parseMarkdownInline(em.inner) });
        index = em.end;
        continue;
      }
    }
    if (ch === '_') {
      const strong = mdMatchDelimited(text, index, ['__']);
      if (strong !== null) {
        flush();
        nodes.push({ type: 'strong', children: parseMarkdownInline(strong.inner) });
        index = strong.end;
        continue;
      }
      const em = mdMatchDelimited(text, index, ['_']);
      if (em !== null) {
        flush();
        nodes.push({ type: 'em', children: parseMarkdownInline(em.inner) });
        index = em.end;
        continue;
      }
    }
    if (ch === '<') {
      const close = text.indexOf('>', index);
      if (close !== -1) {
        const candidate = text.slice(index, close + 1);
        if (/^<https?:\/\/[^<>\s]+>$/.test(candidate)) {
          flush();
          const url = candidate.slice(1, candidate.length - 1);
          nodes.push({ type: 'link', url: url, children: [{ type: 'text', text: url }] });
          index = close + 1;
          continue;
        }
      }
    }
    buffer = buffer + ch;
    index += 1;
  }
  flush();
  return nodes;
}

function mdSplitTableRow(line: any) {
  let text = line.trim();
  if (text.charAt(0) === '|') text = text.slice(1);
  if (text.charAt(text.length - 1) === '|') text = text.slice(0, text.length - 1);
  return text.split('|').map(function (cell: any) { return cell.trim(); });
}

function mdIsTableSeparator(line: any) {
  return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(line);
}

function mdIsFenceClose(line: any, char: any, length: any) {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return match !== null && match[1].charAt(0) === char && match[1].length >= length;
}

function mdIsBlockStart(line: any) {
  return (
    /^ {0,3}(?:#{1,6})\s+/.test(line) ||
    /^ {0,3}(?:`{3,}|~{3,})/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line) ||
    /^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(line)
  );
}

/**
 * Recursive block parser for the preview. Supports headings (ATX + setext),
 * fenced code, blockquotes, nested ordered/unordered lists with task boxes,
 * GFM tables, horizontal rules and paragraphs. Raw HTML is kept as text.
 * @param {string} source - markdown source.
 * @returns {Array<BlockNode>} block nodes.
 */
function parseMarkdown(source: string): Array<BlockNode> {
  if (typeof source !== 'string' || source.length === 0) return [];
  if (source.length > MD_MAX_SOURCE_CHARS) {
    return [{ type: 'paragraph', inline: [{ type: 'text', text: source }] }];
  }
  const text = source.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks: any[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      blocks.push({ type: 'heading', depth: heading[1].length, inline: parseMarkdownInline(heading[2]) });
      index += 1;
      continue;
    }

    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence !== null) {
      const char = fence[1].charAt(0);
      const length = fence[1].length;
      const info = fence[2].trim().split(/\s+/)[0];
      const codeLines: any[] = [];
      index += 1;
      while (index < lines.length && mdIsFenceClose(lines[index], char, length) === false) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', lang: info.toLowerCase(), text: codeLines.join('\n') });
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoteLines: any[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^ {0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', blocks: parseMarkdown(quoteLines.join('\n')) });
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && mdIsTableSeparator(lines[index + 1])) {
      const header = mdSplitTableRow(line).map(parseMarkdownInline);
      const align = mdSplitTableRow(lines[index + 1]).map(function (cell: any) {
        const value = cell.trim();
        if (/^:-+:$/.test(value)) return 'center';
        if (/^:-+$/.test(value)) return 'left';
        if (/^-+:$/.test(value)) return 'right';
        return null;
      });
      index += 2;
      const rows: any[] = [];
      while (index < lines.length) {
        const rowLine = lines[index];
        if (/^\s*$/.test(rowLine) || rowLine.includes('|') === false) break;
        if (/^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(rowLine)) break;
        rows.push(mdSplitTableRow(rowLine).map(parseMarkdownInline));
        index += 1;
      }
      blocks.push({ type: 'table', header: header, align: align, rows: rows });
      continue;
    }

    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (/^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const parsedList = mdParseList(lines, index);
      blocks.push(parsedList.block);
      index = parsedList.nextIndex;
      continue;
    }

    const paragraphLines: any[] = [];
    let setext = 0;
    while (index < lines.length && /^\s*$/.test(lines[index]) === false) {
      if (paragraphLines.length > 0 && /^ {0,3}=+\s*$/.test(lines[index])) {
        setext = 1;
        index += 1;
        break;
      }
      if (paragraphLines.length > 0 && /^ {0,3}-+\s*$/.test(lines[index])) {
        setext = 2;
        index += 1;
        break;
      }
      if (paragraphLines.length > 0 && mdIsBlockStart(lines[index])) break;
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (setext > 0) blocks.push({ type: 'heading', depth: setext, inline: parseMarkdownInline(paragraphLines.join('\n')) });
    else blocks.push({ type: 'paragraph', inline: parseMarkdownInline(paragraphLines.join('\n')) });
  }

  return blocks;
}

/**
 * Parse one list (including nested lists and continuation lines) starting at
 * `startIndex`. Returns the list block and the first unconsumed line index.
 * @param {Array<string>} lines - document lines.
 * @param {number} startIndex - index of the first marker line.
 * @returns {{block: BlockNode, nextIndex: number}} parsed list.
 */
function mdParseList(lines: Array<string>, startIndex: number): any {
  const first = /^(\s*)([-*+]|\d+[.)])\s+/.exec(lines[startIndex]);
  if (first === null) return { block: { type: 'list', ordered: false, items: [] }, nextIndex: startIndex };
  const baseIndent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const items: any[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const marker = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
    if (marker === null) break;
    const indent = marker[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent + 1) break;

    let itemText = marker[3];
    let task: boolean | null = null;
    const taskMatch = /^\[([ xX])\]\s*(.*)$/.exec(itemText);
    if (taskMatch !== null) {
      task = taskMatch[1].toLowerCase() === 'x';
      itemText = taskMatch[2];
    }
    const bodyLines = [itemText];
    let nested: any = null;
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (/^\s*$/.test(next)) break;
      const markerNext = /^(\s*)([-*+]|\d+[.)])\s+/.exec(next);
      const indentMatch = /^\s*/.exec(next);
      const indentNext = indentMatch === null ? 0 : indentMatch[0].length;
      if (markerNext !== null && indentNext <= baseIndent + 1) break;
      if (markerNext !== null && indentNext > baseIndent + 1) {
        const parsedNested = mdParseList(lines, index);
        nested = parsedNested.block;
        index = parsedNested.nextIndex;
        continue;
      }
      if (indentNext > baseIndent) {
        bodyLines.push(next.trim());
        index += 1;
        continue;
      }
      break;
    }
    items.push({ inline: parseMarkdownInline(bodyLines.join('\n')), task: task, nested: nested });
  }

  return { block: { type: 'list', ordered: ordered, items: items }, nextIndex: index };
}

const MD_STYLE = {
  scroll: {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    background: C.base,
  },
  inner: {
    maxWidth: '880px',
    margin: '0 auto',
    padding: '22px 30px 48px',
    color: C.text,
    fontFamily: S.FONT_UI,
    fontSize: '13.5px',
    lineHeight: '1.75',
    overflowWrap: 'break-word',
  },
  heading: function (depth: any) {
    return {
      margin: depth <= 2 ? '22px 0 10px' : '18px 0 8px',
      fontSize: String(MD_HEADING_SIZES[depth - 1]) + 'px',
      fontWeight: depth <= 2 ? '700' : '600',
      lineHeight: '1.35',
      color: C.text,
      paddingBottom: depth <= 2 ? '6px' : '0',
      borderBottom: depth === 1 ? '1px solid ' + C.border1 : 'none',
    };
  },
  paragraph: { margin: '0 0 12px' },
  codeBlock: {
    margin: '0 0 14px',
    padding: '10px 14px',
    background: C.layer1,
    border: '1px solid ' + C.border1,
    borderRadius: '6px',
    overflow: 'auto',
    fontFamily: S.FONT_MONO,
    fontSize: '12px',
    lineHeight: '20px',
    whiteSpace: 'pre',
    color: C.text,
  },
  inlineCode: {
    padding: '1px 5px',
    background: C.layer2,
    border: '1px solid ' + C.border1,
    borderRadius: '4px',
    fontFamily: S.FONT_MONO,
    fontSize: '12px',
    color: C.text,
  },
  blockquote: {
    margin: '0 0 14px',
    padding: '2px 0 2px 14px',
    borderLeft: '3px solid ' + C.border2,
    color: C.textSecondary,
  },
  list: { margin: '0 0 12px', paddingLeft: '24px' },
  listItem: { margin: '2px 0' },
  nestedList: { margin: '2px 0 0', paddingLeft: '22px' },
  taskBox: { marginRight: '6px', verticalAlign: 'middle' },
  link: { color: C.accent, textDecoration: 'underline' },
  image: { maxWidth: '100%', borderRadius: '6px', margin: '6px 0', display: 'block' },
  table: { width: '100%', borderCollapse: 'collapse', margin: '0 0 14px', fontSize: '12.5px', lineHeight: '1.6' },
  tableCell: { border: '1px solid ' + C.border1, padding: '5px 10px', textAlign: 'left', verticalAlign: 'top' },
  tableHeadCell: { border: '1px solid ' + C.border1, padding: '5px 10px', textAlign: 'left', background: C.layer1, fontWeight: '600' },
  hr: { border: 'none', borderTop: '1px solid ' + C.border1, margin: '18px 0' },
};

/**
 * Render inline nodes to React elements.
 * @param {Array<InlineNode>} nodes - inline nodes.
 * @param {string} keyPrefix - stable key prefix.
 * @returns {Array} React children.
 */
function renderMarkdownInline(nodes: Array<InlineNode>, keyPrefix: string): any[] {
  const out: any[] = [];
  for (let index = 0; index < nodes.length; index = index + 1) {
    const node = nodes[index];
    const key = keyPrefix + '-' + String(index);
    if (node.type === 'text') {
      const parts = String(node.text).split('\n');
      for (let part = 0; part < parts.length; part = part + 1) {
        if (part > 0) out.push(h('br', { key: key + '-br-' + String(part) }));
        if (parts[part].length > 0) out.push(h('span', { key: key + '-t-' + String(part) }, parts[part]));
      }
      continue;
    }
    if (node.type === 'code') {
      out.push(h('code', { key: key, style: MD_STYLE.inlineCode }, String(node.text)));
      continue;
    }
    if (node.type === 'strong') {
      out.push(h('strong', { key: key }, renderMarkdownInline(node.children || [], key)));
      continue;
    }
    if (node.type === 'em') {
      out.push(h('em', { key: key }, renderMarkdownInline(node.children || [], key)));
      continue;
    }
    if (node.type === 'del') {
      out.push(h('del', { key: key }, renderMarkdownInline(node.children || [], key)));
      continue;
    }
    if (node.type === 'link') {
      const url = mdSafeUrl(node.url);
      if (url === null) out.push(h('span', { key: key }, renderMarkdownInline(node.children || [], key)));
      else
        out.push(
          h(
            'a',
            { key: key, href: url, target: '_blank', rel: 'noreferrer noopener', style: MD_STYLE.link },
            renderMarkdownInline(node.children || [], key),
          ),
        );
      continue;
    }
    if (node.type === 'image') {
      const url = mdSafeUrl(node.url);
      if (url === null) out.push(h('span', { key: key, style: MD_STYLE.link }, String(node.alt)));
      else out.push(h('img', { key: key, src: url, alt: String(node.alt), style: MD_STYLE.image, loading: 'lazy' }));
      continue;
    }
  }
  return out;
}

function renderMarkdownCode(block: any, key: any) {
  let lines: any = null;
  try {
    if (typeof S.highlightLines === 'function' && block.text.length <= MD_MAX_SOURCE_CHARS) {
      lines = S.highlightLines(block.text, block.lang);
    }
  } catch (error) {
    lines = null;
  }
  if (lines === null) {
    return h('pre', { key: key, style: MD_STYLE.codeBlock }, h('code', null, block.text));
  }
  const children: any[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex = lineIndex + 1) {
    const segments = lines[lineIndex];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex = segmentIndex + 1) {
      children.push(
        h(
          'span',
          { key: 'c' + String(lineIndex) + '-' + String(segmentIndex), style: { color: S.highlightColor(segments[segmentIndex][0]) } },
          segments[segmentIndex][1],
        ),
      );
    }
    if (lineIndex < lines.length - 1) children.push('\n');
  }
  return h('pre', { key: key, style: MD_STYLE.codeBlock }, h('code', null, children));
}

/**
 * Render block nodes to React elements.
 * @param {Array<BlockNode>} blocks - block nodes.
 * @param {string} keyPrefix - stable key prefix.
 * @returns {Array} React children.
 */
function renderMarkdownBlocks(blocks: Array<BlockNode>, keyPrefix: string): any[] {
  const out: any[] = [];
  for (let index = 0; index < blocks.length; index = index + 1) {
    const block = blocks[index];
    const key = keyPrefix + '-' + String(index);
    if (block.type === 'heading') {
      out.push(h('h' + String(block.depth), { key: key, style: MD_STYLE.heading(block.depth) }, renderMarkdownInline(block.inline || [], key)));
      continue;
    }
    if (block.type === 'paragraph') {
      out.push(h('p', { key: key, style: MD_STYLE.paragraph }, renderMarkdownInline(block.inline || [], key)));
      continue;
    }
    if (block.type === 'code') {
      out.push(renderMarkdownCode(block, key));
      continue;
    }
    if (block.type === 'blockquote') {
      out.push(h('blockquote', { key: key, style: MD_STYLE.blockquote }, renderMarkdownBlocks(block.blocks || [], key)));
      continue;
    }
    if (block.type === 'list') {
      const items = (block.items || []).map(function (item, itemIndex) {
        const itemKey = key + '-i' + String(itemIndex);
        const children: any[] = [];
        if (item.task !== null && item.task !== undefined) {
          children.push(
            h('input', {
              key: itemKey + '-task',
              type: 'checkbox',
              checked: item.task === true,
              readOnly: true,
              disabled: true,
              style: MD_STYLE.taskBox,
            }),
          );
        }
        children.push.apply(children, renderMarkdownInline(item.inline, itemKey));
        if (item.nested !== null && item.nested !== undefined) {
          children.push(
            h(
              item.nested.ordered ? 'ol' : 'ul',
              { key: itemKey + '-nested', style: MD_STYLE.nestedList },
              renderMarkdownListItems(item.nested, itemKey + '-nested'),
            ),
          );
        }
        return h('li', { key: itemKey, style: MD_STYLE.listItem }, children);
      });
      out.push(h(block.ordered ? 'ol' : 'ul', { key: key, style: MD_STYLE.list }, items));
      continue;
    }
    if (block.type === 'table') {
      const align = block.align || [];
      const headerCells = (block.header || []).map(function (cell, cellIndex) {
        return h(
          'th',
          { key: key + '-h' + String(cellIndex), style: Object.assign({}, MD_STYLE.tableHeadCell, align[cellIndex] ? { textAlign: align[cellIndex] } : null) },
          renderMarkdownInline(cell, key + '-h' + String(cellIndex)),
        );
      });
      const bodyRows = (block.rows || []).map(function (row, rowIndex) {
        const rowKey = key + '-r' + String(rowIndex);
        const cells = row.map(function (cell, cellIndex) {
          return h(
            'td',
            { key: rowKey + '-c' + String(cellIndex), style: Object.assign({}, MD_STYLE.tableCell, align[cellIndex] ? { textAlign: align[cellIndex] } : null) },
            renderMarkdownInline(cell, rowKey + '-c' + String(cellIndex)),
          );
        });
        return h('tr', { key: rowKey }, cells);
      });
      out.push(
        h(
          'table',
          { key: key, style: MD_STYLE.table },
          h('thead', null, h('tr', null, headerCells)),
          bodyRows.length > 0 ? h('tbody', null, bodyRows) : null,
        ),
      );
      continue;
    }
    if (block.type === 'hr') {
      out.push(h('hr', { key: key, style: MD_STYLE.hr }));
      continue;
    }
  }
  return out;
}

/** Shallow helper so nested lists reuse the item renderer without duplication. */
function renderMarkdownListItems(listBlock: any, keyPrefix: any) {
  return listBlock.items.map(function (item: any, itemIndex: any) {
    const itemKey = keyPrefix + '-' + String(itemIndex);
    return h(
      'li',
      { key: itemKey, style: MD_STYLE.listItem },
      renderMarkdownInline(item.inline, itemKey),
      item.nested ? h(item.nested.ordered ? 'ol' : 'ul', { style: MD_STYLE.nestedList }, renderMarkdownListItems(item.nested, itemKey + '-n')) : null,
    );
  });
}

/**
 * Render Markdown source to React children (no HTML strings involved).
 * @param {unknown} source - markdown source.
 * @returns {Array} React children for the preview body.
 */
function renderMarkdown(source: unknown): any[] {
  const text = typeof source === 'string' ? source : '';
  return renderMarkdownBlocks(parseMarkdown(text), 'md');
}

S.MD_MAX_SOURCE_CHARS = MD_MAX_SOURCE_CHARS;
S.MD_STYLE = MD_STYLE;
S.parseMarkdown = parseMarkdown;
S.parseMarkdownInline = parseMarkdownInline;
S.renderMarkdown = renderMarkdown;
