/**
 * Convert a Quill Delta (the editor's document model) to Markdown.
 *
 * Pure and dependency-free so it can be unit-tested outside the app.
 * Works from the Delta rather than from HTML, so nothing here ever parses
 * or emits note markup.
 *
 * Supported: headings, bold / italic / strikethrough / underline, inline
 * code, links, bulleted / numbered / check lists (nested), blockquotes,
 * code blocks, horizontal rules, images.
 */

// Outermost first. Each mark knows how it opens and closes in Markdown.
const MARKS = [
  { key: 'bold', open: '**', close: '**' },
  { key: 'italic', open: '*', close: '*' },
  { key: 'strike', open: '~~', close: '~~' },
  { key: 'underline', open: '<u>', close: '</u>' } // Markdown has no underline
];

/**
 * Escape characters that Markdown would otherwise treat as formatting.
 * Underscores inside a word (snake_case) are left alone — they never
 * start emphasis, and escaping them only makes the output harder to read.
 * @param {string} text
 * @returns {string}
 */
function escapeInline(text) {
  return text
    .replace(/[\\`*[\]<~]/g, '\\$&')
    .replace(/(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, '\\_');
}

/**
 * Escape a leading token that would turn a paragraph into another block
 * ("# ", "> ", "- ", "+ ", "1. ", "---").
 * @param {string} line - Already inline-escaped paragraph text
 * @returns {string}
 */
function escapeBlockStart(line) {
  return line
    .replace(/^(\s*)(#{1,6}\s)/, '$1\\$2')
    .replace(/^(\s*)>/, '$1\\>')
    .replace(/^(\s*)([-+])(\s)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s)/, '$1$2\\$3$4')
    .replace(/^(\s*)(-{3,}|={3,}|_{3,})\s*$/, '$1\\$2');
}

/**
 * Wrap code in a backtick run longer than any run it contains.
 * @param {string} code
 * @returns {string}
 */
function inlineCode(code) {
  const longest = (code.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${code}${pad}${fence}`;
}

/**
 * Format a link destination, bracketing it when it contains characters
 * that would end a bare destination early.
 * @param {string} url
 * @returns {string}
 */
function linkDestination(url) {
  const clean = String(url).replace(/[\r\n]/g, '');
  return /[\s()<>]/.test(clean) ? `<${clean.replace(/[<>]/g, encodeURIComponent)}>` : clean;
}

/**
 * Render one line's inline segments.
 *
 * Marks stay open across neighbouring segments that share them (so bold
 * text containing an italic word comes out as `**bold *both* bold**`, not
 * as separately wrapped fragments), and whitespace is always kept OUTSIDE
 * the markers, because `**bold **` is not emphasis in Markdown.
 * @param {Array<{text?: string, image?: string, attrs: Object}>} segments
 * @returns {string}
 */
function renderInline(segments) {
  let out = '';
  let open = [];        // marks currently open, outermost first
  let pendingSpace = ''; // trailing whitespace held back until marks close

  const closeDownTo = (keep) => {
    while (open.length > keep) out += open.pop().close;
  };
  const flushSpace = () => {
    out += pendingSpace;
    pendingSpace = '';
  };

  for (const segment of segments) {
    const attrs = segment.attrs || {};

    // Atomic pieces: nothing stays open across them
    if (segment.image !== undefined) {
      closeDownTo(0);
      flushSpace();
      out += `![](${linkDestination(segment.image)})`;
      continue;
    }
    if (attrs.code) {
      closeDownTo(0);
      flushSpace();
      out += inlineCode(segment.text);
      continue;
    }
    if (attrs.link) {
      closeDownTo(0);
      flushSpace();
      const inner = renderInline([{ text: segment.text, attrs: { ...attrs, link: undefined } }]);
      out += `[${inner}](${linkDestination(attrs.link)})`;
      continue;
    }

    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(segment.text);
    const lead = match[1];
    const core = match[2];
    const trail = match[3];

    if (core === '') {
      // Whitespace only: it carries no visible formatting of its own
      pendingSpace += segment.text;
      continue;
    }

    const wanted = MARKS.filter(mark => attrs[mark.key]);

    // Keep the marks both the open stack and this segment agree on (as a
    // prefix, so nesting stays well-formed); close the rest, innermost first
    let keep = 0;
    while (keep < open.length && keep < wanted.length && open[keep] === wanted[keep]) {
      keep += 1;
    }
    closeDownTo(keep);
    flushSpace();
    out += lead;

    for (const mark of wanted.slice(open.length)) {
      out += mark.open;
      open.push(mark);
    }

    out += escapeInline(core);
    pendingSpace = trail;
  }

  closeDownTo(0);
  flushSpace();
  return out;
}

/**
 * Split a Delta's ops into lines, the way Quill models a document: text
 * ops carry inline formats, and each "\n" carries the block formats of
 * the line it ends.
 * @param {Array} ops
 * @returns {Array<{segments?: Array, attrs?: Object, divider?: boolean}>}
 */
function toLines(ops) {
  const lines = [];
  let segments = [];

  const endLine = (attrs) => {
    lines.push({ segments, attrs: attrs || {} });
    segments = [];
  };

  for (const op of ops || []) {
    if (!op || op.insert === undefined || op.insert === null) continue;
    const attrs = op.attributes || {};

    if (typeof op.insert === 'string') {
      const parts = op.insert.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) endLine(attrs);
        if (part !== '') segments.push({ text: part, attrs });
      });
    } else if (typeof op.insert === 'object') {
      if (op.insert.divider !== undefined) {
        // A block embed is a line of its own
        if (segments.length > 0) endLine({});
        lines.push({ divider: true });
      } else if (typeof op.insert.image === 'string') {
        segments.push({ image: op.insert.image, attrs });
      }
      // Other embeds (video, formula) have no Markdown form and are skipped
    }
  }

  if (segments.length > 0) endLine({});
  return lines;
}

/**
 * Convert a Quill Delta to Markdown.
 * @param {Array|{ops: Array}} delta - Delta object or its ops array
 * @returns {string} Markdown text, ending with a single newline
 *          (an empty document gives an empty string)
 */
export function deltaToMarkdown(delta) {
  const ops = Array.isArray(delta) ? delta : (delta && delta.ops) || [];
  const lines = toLines(ops);

  const blocks = [];      // finished Markdown blocks (joined by blank lines)
  let group = null;       // block being accumulated: { kind, rows: [] }
  let counters = [];      // numbered-list counters per indent level
  let listTypes = [];     // list type last seen at each indent level

  const closeGroup = () => {
    if (!group) return;
    if (group.kind === 'code') {
      const body = group.rows.join('\n');
      const longest = (body.match(/`{3,}/g) || []).reduce((max, run) => Math.max(max, run.length), 2);
      const fence = '`'.repeat(longest + 1);
      blocks.push(`${fence}${group.language}\n${body}\n${fence}`);
    } else if (group.kind === 'quote') {
      blocks.push(group.rows.map(row => (row ? `> ${row}` : '>')).join('\n>\n'));
    } else {
      blocks.push(group.rows.join('\n'));
    }
    group = null;
  };

  const openGroup = (kind, extra) => {
    if (!group || group.kind !== kind) {
      closeGroup();
      group = { kind, rows: [], ...(extra || {}) };
    }
    return group;
  };

  for (const line of lines) {
    if (line.divider) {
      closeGroup();
      counters = [];
      listTypes = [];
      blocks.push('---');
      continue;
    }

    const attrs = line.attrs;

    if (attrs['code-block']) {
      const language = typeof attrs['code-block'] === 'string' && attrs['code-block'] !== 'plain'
        ? attrs['code-block']
        : '';
      if (group && group.kind === 'code' && group.language !== language) closeGroup();
      // Code is literal: no escaping, formatting ignored
      openGroup('code', { language }).rows.push(
        line.segments.map(segment => segment.text || '').join('')
      );
      counters = [];
      listTypes = [];
      continue;
    }

    const text = renderInline(line.segments);

    if (attrs.list) {
      const indent = Math.max(0, Math.min(8, Number(attrs.indent) || 0));
      // Deeper levels restart when we come back up to this one
      counters.length = indent + 1;
      listTypes.length = indent + 1;
      if (listTypes[indent] !== attrs.list) {
        counters[indent] = 0;
        listTypes[indent] = attrs.list;
      }

      let marker;
      if (attrs.list === 'ordered') {
        counters[indent] = (counters[indent] || 0) + 1;
        marker = `${counters[indent]}.`;
      } else if (attrs.list === 'checked') {
        marker = '- [x]';
      } else if (attrs.list === 'unchecked') {
        marker = '- [ ]';
      } else {
        marker = '-';
      }
      openGroup('list').rows.push(`${'    '.repeat(indent)}${marker} ${text}`);
      continue;
    }

    counters = [];
    listTypes = [];

    if (attrs.header) {
      closeGroup();
      const level = Math.max(1, Math.min(6, Number(attrs.header) || 1));
      blocks.push(`${'#'.repeat(level)} ${text.trim()}`);
      continue;
    }

    if (attrs.blockquote) {
      openGroup('quote').rows.push(escapeBlockStart(text));
      continue;
    }

    // Plain paragraph. Empty ones are just vertical space in the editor;
    // Markdown already separates blocks with a blank line.
    closeGroup();
    if (text.trim() !== '') {
      blocks.push(escapeBlockStart(text));
    }
  }

  closeGroup();
  return blocks.length > 0 ? blocks.join('\n\n') + '\n' : '';
}
