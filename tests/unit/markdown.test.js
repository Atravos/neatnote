/*
 * Tests for the Markdown exporter (a renderer ES module).
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The renderer's modules are browser ES modules in a CommonJS package;
// loading the source through a data: URL works on every supported Node.
const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/utils/markdown.js'), 'utf8');
const loaded = import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));

const md = async (ops) => (await loaded).deltaToMarkdown(ops);
const line = (text, attributes) => (attributes
  ? [{ insert: text }, { insert: '\n', attributes }]
  : [{ insert: text + '\n' }]);

test('empty and plain documents', async () => {
  assert.equal(await md([]), '');
  assert.equal(await md([{ insert: '\n' }]), '');
  assert.equal(await md({ ops: [{ insert: 'Hello\n' }] }), 'Hello\n');
  assert.equal(await md([{ insert: 'one\n\n\ntwo\n' }]), 'one\n\ntwo\n', 'blank lines collapse to one separator');
});

test('headings, quotes, rules and code blocks', async () => {
  assert.equal(await md([...line('Title', { header: 1 }), ...line('Sub', { header: 3 }), ...line('body')]),
    '# Title\n\n### Sub\n\nbody\n');
  assert.equal(await md([...line('a', { blockquote: true }), ...line('b', { blockquote: true })]),
    '> a\n>\n> b\n');
  assert.equal(await md([{ insert: 'x\n' }, { insert: { divider: true } }, { insert: 'y\n' }]), 'x\n\n---\n\ny\n');

  const code = [
    ...line('if (a) {', { 'code-block': 'plain' }),
    ...line('    b *= 2; // _not_ emphasis', { 'code-block': 'plain' }),
    ...line('}', { 'code-block': 'plain' })
  ];
  assert.equal(await md(code), '```\nif (a) {\n    b *= 2; // _not_ emphasis\n}\n```\n', 'code is literal and keeps indentation');
  assert.equal(await md(line('print(1)', { 'code-block': 'python' })), '```python\nprint(1)\n```\n');
  assert.equal(await md(line('```nested```', { 'code-block': true })), '````\n```nested```\n````\n');
});

test('lists: bullets, numbering, nesting, checkboxes', async () => {
  const ops = [
    ...line('one', { list: 'ordered' }),
    ...line('child', { list: 'bullet', indent: 1 }),
    ...line('deep', { list: 'ordered', indent: 2 }),
    ...line('two', { list: 'ordered' }),
    ...line('after'),
    ...line('restart', { list: 'ordered' }),
    ...line('todo', { list: 'unchecked' }),
    ...line('done', { list: 'checked' })
  ];
  assert.equal(await md(ops),
    '1. one\n    - child\n        1. deep\n2. two\n\nafter\n\n1. restart\n- [ ] todo\n- [x] done\n');
});

test('inline formatting nests cleanly and keeps spaces outside the markers', async () => {
  const ops = [
    { insert: 'plain ' },
    { insert: 'bold ', attributes: { bold: true } },
    { insert: 'both', attributes: { bold: true, italic: true } },
    { insert: ' tail', attributes: { bold: true } },
    { insert: ' ' },
    { insert: 'gone', attributes: { strike: true } },
    { insert: ' ' },
    { insert: 'under', attributes: { underline: true } },
    { insert: '\n' }
  ];
  assert.equal(await md(ops), 'plain **bold *both* tail** ~~gone~~ <u>under</u>\n');

  assert.equal(await md([{ insert: 'a' }, { insert: ' spaced ', attributes: { italic: true } }, { insert: 'b\n' }]),
    'a *spaced* b\n');
});

test('links, inline code and images', async () => {
  const ops = [
    { insert: 'see ' },
    { insert: 'the docs', attributes: { link: 'https://example.com/a_b' } },
    { insert: ', ' },
    { insert: 'spaced', attributes: { link: 'https://example.com/a b(1)', bold: true } },
    { insert: ' and ' },
    { insert: 'x`y', attributes: { code: true } },
    { insert: ' ' },
    { insert: { image: 'data:image/png;base64,AAAA' } },
    { insert: '\n' }
  ];
  assert.equal(await md(ops),
    'see [the docs](https://example.com/a_b), [**spaced**](<https://example.com/a b(1)>) and ``x`y`` ![](data:image/png;base64,AAAA)\n');
});

test('text that looks like Markdown is escaped, snake_case is left readable', async () => {
  assert.equal(await md([{ insert: '2 * 3 * 4 and [x] and <tag> and a_b_c and _lead\n' }]),
    '2 \\* 3 \\* 4 and \\[x\\] and \\<tag> and a_b_c and \\_lead\n');
  assert.equal(await md([{ insert: '# not a heading\n- not a list\n1. nor this\n> nor a quote\n---\n' }]),
    '\\# not a heading\n\n\\- not a list\n\n1\\. nor this\n\n\\> nor a quote\n\n\\---\n');
});

test('malformed input does not throw', async () => {
  assert.equal(await md(null), '');
  assert.equal(await md([null, {}, { insert: null }, { insert: { video: 'x' } }, { insert: 'ok\n' }]), 'ok\n');
});

test('checklists become task list items', async () => {
  assert.equal(await md([...line('Buy milk', { list: 'unchecked' }), ...line('Call Sam', { list: 'checked' })]),
    '- [ ] Buy milk\n- [x] Call Sam\n');
});

test('tables become pipe tables with the first row as the header', async () => {
  const cell = (text, row) => [{ insert: text }, { insert: '\n', attributes: { table: row } }];
  const out = await md([
    ...cell('Item', 'r1'), ...cell('Qty', 'r1'),
    ...cell('Apples | red', 'r2'), ...cell('3', 'r2'),
    ...cell('', 'r3'), ...cell('5', 'r3'),
    ...line('after')
  ]);
  assert.equal(out, '| Item | Qty |\n| --- | --- |\n| Apples \\| red | 3 |\n|  | 5 |\n\nafter\n');
});

test('stored pictures are written as images/<file>; fonts and sizes are dropped', async () => {
  const { deltaToMarkdown } = await loaded;
  const name = 'a'.repeat(32) + '.png';
  const out = deltaToMarkdown([
    { insert: 'Big', attributes: { font: 'lora', size: '24px' } },
    { insert: '\n' },
    { insert: { image: 'neatnote-image://local/' + name }, attributes: { width: '50%' } },
    { insert: '\n' }
  ], { image: (src) => src.replace('neatnote-image://local/', 'images/') });
  assert.equal(out, 'Big\n\n![](images/' + name + ')\n');
});
