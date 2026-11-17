/*
 * Behavioral tests for sidebar ordering (storage keys, migration).
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { SortOrders, applyOrder, legacyKeyFor } = require('../../src/main/sortOrders.js');

/** Minimal stand-in for electron-store */
function fakeStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    data,
    writes: 0,
    get(key) { return data[key] === undefined ? undefined : JSON.parse(JSON.stringify(data[key])); },
    set(key, value) { this.writes += 1; data[key] = JSON.parse(JSON.stringify(value)); },
    has(key) { return Object.prototype.hasOwnProperty.call(data, key); }
  };
}

const ROOT = path.resolve(path.sep, 'data', 'notes');
const at = (...segments) => path.join(ROOT, ...segments);

test('keys are exact relative paths, so different folders never collide', () => {
  const orders = new SortOrders(fakeStore(), ROOT);
  assert.equal(orders.keyFor(null), '/');
  assert.equal(orders.keyFor(ROOT), '/');
  assert.equal(orders.keyFor(at('Work')), '/Work');
  assert.equal(orders.keyFor(at('Work', 'Sub folder')), '/Work/Sub folder');
  assert.notEqual(orders.keyFor(at('日本語')), orders.keyFor(at('中国語')));
  assert.notEqual(orders.keyFor(at('My Notes')), orders.keyFor(at('My_Notes')));
  assert.notEqual(orders.keyFor(at('_root')), orders.keyFor(null), 'a folder named _root is not the root');

  // Anything outside the root has no key
  assert.equal(orders.keyFor(path.resolve(ROOT, '..')), null);
  assert.equal(orders.keyFor(ROOT + '-other'), null);
  assert.equal(orders.keyFor(at('..', '..', 'etc')), null);
  assert.equal(orders.keyFor(42), null);
  assert.equal(orders.keyFor(''), null);
});

test('set validates its input; get returns what was saved', () => {
  const store = fakeStore();
  const orders = new SortOrders(store, ROOT);

  assert.equal(orders.set(at('Work'), ['b.html', 'a.html', 'b.html']), true);
  assert.deepEqual(orders.get(at('Work')), ['b.html', 'a.html'], 'duplicates removed');
  assert.equal(orders.get(at('Other')), null);

  for (const bad of ['a', null, [1, 2], [''], [{}], ['x'.repeat(300)]]) {
    assert.equal(orders.set(at('Work'), bad), false);
  }
  assert.equal(orders.set(path.resolve(ROOT, '..'), ['a']), false);
  assert.deepEqual(orders.get(at('Work')), ['b.html', 'a.html'], 'rejected writes change nothing');

  // Folder names that are special in JavaScript objects are just keys
  assert.equal(orders.set(at('__proto__'), ['x']), true);
  assert.equal(orders.set(at('constructor'), ['y']), true);
  assert.deepEqual(orders.get(at('__proto__')), ['x']);
  assert.equal({}.x, undefined);
});

test('applyOrder: listed items first in saved order, the rest keep their order', () => {
  const items = ['a', 'b', 'c', 'd'].map(name => ({ name }));
  assert.deepEqual(applyOrder(items, ['c', 'ghost', 'a']).map(i => i.name), ['c', 'a', 'b', 'd']);
  assert.deepEqual(applyOrder(items, null).map(i => i.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(applyOrder(items, []).map(i => i.name), ['a', 'b', 'c', 'd']);
});

test('place inserts next to the reference and drops names that no longer exist', () => {
  const orders = new SortOrders(fakeStore(), ROOT);
  orders.set(null, ['gone.html', 'a', 'b']);
  const current = ['a', 'b', 'c'];

  assert.equal(orders.place(null, current, 'c', 'a', 'before'), true);
  assert.deepEqual(orders.get(null), ['c', 'a', 'b']);
  orders.place(null, ['c', 'a', 'b'], 'c', 'b', 'after');
  assert.deepEqual(orders.get(null), ['a', 'b', 'c']);
  orders.place(null, ['a', 'b', 'c'], 'a', 'missing', 'before');
  assert.deepEqual(orders.get(null), ['b', 'c', 'a'], 'unknown reference appends');
  assert.equal(orders.place(null, ['a', 'b'], 'nope', 'a', 'before'), false);
});

test('rename, remove and folder moves keep orders in step', () => {
  const orders = new SortOrders(fakeStore(), ROOT);
  orders.set(null, ['Work', 'Workshop', 'n.html']);
  orders.set(at('Work'), ['a', 'b']);
  orders.set(at('Work', 'Deep'), ['x']);
  orders.set(at('Workshop'), ['w']);

  orders.renameName(null, 'n.html', 'm.html');
  assert.deepEqual(orders.get(null), ['Work', 'Workshop', 'm.html']);
  orders.renameName(null, 'm.html', 'm.html');
  orders.renameName(null, 'absent', 'x');
  assert.deepEqual(orders.get(null), ['Work', 'Workshop', 'm.html']);

  // Renaming "Work" must carry its subtree and must NOT touch "Workshop"
  orders.moveTree(at('Work'), at('Job'));
  assert.equal(orders.get(at('Work')), null);
  assert.deepEqual(orders.get(at('Job')), ['a', 'b']);
  assert.deepEqual(orders.get(at('Job', 'Deep')), ['x']);
  assert.deepEqual(orders.get(at('Workshop')), ['w']);

  orders.removeName(null, 'm.html');
  assert.deepEqual(orders.get(null), ['Work', 'Workshop']);

  orders.removeTree(at('Job'));
  assert.equal(orders.get(at('Job')), null);
  assert.equal(orders.get(at('Job', 'Deep')), null);
  assert.deepEqual(orders.get(at('Workshop')), ['w']);

  // The root's own order can't be wiped or re-keyed by a bad call
  orders.removeTree(null);
  orders.moveTree(null, at('X'));
  orders.moveTree(at('Workshop'), null);
  assert.deepEqual(orders.get(null), ['Work', 'Workshop']);
});

test('migrates the previous lossy format once, leaving the old data in place', () => {
  const store = fakeStore({
    sortOrder: {
      _root: ['b.html', 'a.html'],
      My_Notes: ['two', 'one'],
      'Work/Sub': ['s'],
      ___: ['shared'],          // what both 日本語 and 中国語 were stored under
      Deleted: ['ghost'],
      broken: 'not an array'
    },
    themeBackground: '#1c1e22'
  });
  const orders = new SortOrders(store, ROOT);

  assert.equal(legacyKeyFor('My Notes'), 'My_Notes');
  assert.equal(legacyKeyFor('日本語'), '___');
  assert.equal(legacyKeyFor(''), '_root');

  const dirs = [at('My Notes'), at('Work'), at('Work', 'Sub'), at('日本語'), at('中国語'), at('broken')];
  assert.equal(orders.migrateLegacy(dirs), true);

  assert.deepEqual(orders.get(null), ['b.html', 'a.html']);
  assert.deepEqual(orders.get(at('My Notes')), ['two', 'one']);
  assert.deepEqual(orders.get(at('Work', 'Sub')), ['s']);
  assert.deepEqual(orders.get(at('日本語')), ['shared']);
  assert.deepEqual(orders.get(at('中国語')), ['shared']);
  assert.equal(orders.get(at('Work')), null);
  assert.equal(orders.get(at('broken')), null);
  assert.equal(Object.keys(store.data.sortOrders).some(k => k.includes('Deleted')), false, 'ghost entries are dropped');

  assert.deepEqual(store.data.sortOrder._root, ['b.html', 'a.html'], 'legacy data untouched (downgrade-safe)');
  assert.equal(store.data.themeBackground, '#1c1e22');

  // Runs once: later changes are never clobbered by a second migration
  orders.set(null, ['a.html', 'b.html']);
  assert.equal(orders.migrateLegacy(dirs), false);
  assert.deepEqual(orders.get(null), ['a.html', 'b.html']);
});

test('a fresh install (no legacy data) just starts with an empty map', () => {
  const store = fakeStore();
  const orders = new SortOrders(store, ROOT);
  assert.equal(orders.migrateLegacy([]), true);
  assert.deepEqual(store.data.sortOrders, {});
  assert.equal(orders.get(null), null);
});
