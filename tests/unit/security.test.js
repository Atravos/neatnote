/*
 * Tests for the pure security helpers and the application menu template.
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { toSafeExternalUrl } = require('../../src/main/security.js');
const { buildMenuTemplate } = require('../../src/main/menu.js');

test('only web and mail links may be handed to the operating system', () => {
  assert.equal(toSafeExternalUrl('https://example.com/a?b=c#d'), 'https://example.com/a?b=c#d');
  assert.equal(toSafeExternalUrl('http://example.com'), 'http://example.com/');
  assert.equal(toSafeExternalUrl('HTTPS://EXAMPLE.COM/Path'), 'https://example.com/Path');
  assert.equal(toSafeExternalUrl('mailto:someone@example.com'), 'mailto:someone@example.com');

  for (const bad of [
    'file:///etc/passwd',
    'file://C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'smb://server/share',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x',
    'vscode://file/etc/passwd',
    'about:blank',
    'blob:https://example.com/1',
    'ftp://example.com/file',
    'https://',
    'example.com',
    '//example.com',
    '',
    ' ',
    'https://example.com/' + 'a'.repeat(3000),
    null, undefined, 42, {}, ['https://example.com']
  ]) {
    assert.equal(toSafeExternalUrl(bad), null, `should be rejected: ${String(bad).slice(0, 60)}`);
  }
});

/** Every role and label anywhere in a menu template */
function flatten(template) {
  const found = [];
  const walk = (items) => {
    for (const item of items) {
      if (item.role) found.push(String(item.role).toLowerCase());
      if (item.label) found.push(item.label);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return found;
}

test('installed builds have no reload or DevTools menu items, on any platform', () => {
  for (const isMac of [true, false]) {
    const production = flatten(buildMenuTemplate({ isMac, isDev: false, sendAction() {} }));
    for (const role of ['reload', 'forcereload', 'toggledevtools']) {
      assert.equal(production.includes(role), false, `${role} present in production (isMac=${isMac})`);
    }
    // The roles that make standard shortcuts work are still there
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall', 'zoomin', 'zoomout', 'resetzoom']) {
      assert.equal(production.includes(role), true, `${role} missing (isMac=${isMac})`);
    }

    const development = flatten(buildMenuTemplate({ isMac, isDev: true, sendAction() {} }));
    assert.equal(development.includes('reload') && development.includes('toggledevtools'), true);
  }
});

test('macOS File menu items send their action to the renderer', () => {
  const sent = [];
  const template = buildMenuTemplate({ isMac: true, isDev: false, sendAction: (action) => sent.push(action) });
  const file = template.find(item => item.label === 'File');
  assert.ok(file, 'File menu missing on macOS');
  for (const item of file.submenu) {
    if (typeof item.click === 'function') item.click();
  }
  assert.deepEqual(sent, ['new-note', 'new-folder', 'save', 'export-markdown', 'search']);

  const windows = buildMenuTemplate({ isMac: false, isDev: false, sendAction() {} });
  assert.equal(windows.some(item => item.label === 'File' || item.role === 'appMenu'), false);
});
