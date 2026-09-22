import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function viewer(reply) {
  const revision = 'a'.repeat(64), oldRevision = 'b'.repeat(64), nodes = new Map(), listeners = new Map(), sent = [], requests = [];
  const on = (handlers, type, fn) => handlers.set(type, [...handlers.get(type) || [], fn]);
  const element = () => {
    const handlers = new Map(), attributes = new Map();
    return { value: '', hidden: true, style: {}, dataset: {}, disabled: false, children: [], offsetHeight: 100, offsetWidth: 240,
      addEventListener: (type, fn) => on(handlers, type, fn),
      click() { if (!this.disabled) handlers.get('click')?.forEach(fn => fn()); },
      setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
      focus() {}, contains: () => false, append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }, get childElementCount() { return this.children.length; },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1080 }), classList: { add() {}, remove() {} },
      contentWindow: { postMessage: message => sent.push(structuredClone(message)) } };
  };
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const comments = ['one', 'two', 'old', 'general', 'resolved'].map((id, i) => ({
    id, parent_id: null, name: i % 2 ? 'Ana' : 'Santi', body: id + ' comment', quote: '', selector: '',
    revision: id === 'old' ? oldRevision : revision, status: id === 'resolved' ? 'resolved' : 'open', created_at: new Date(0).toISOString(),
    markup: id === 'general' ? null : { version: 1, viewport: { width: 1080, height: 800 }, marks: [{ kind: 'rect', x: 20, y: 100 + i * 150, width: 100, height: 40 }] },
  }));
  const context = {
    document: { getElementById: node, body: node('page'), createElement: element,
      querySelector: node, querySelectorAll: selector => selector === '[data-thread]' ? node('threads').children : [] },
    localStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => 'fixture-id' },
    addEventListener: (type, fn) => on(listeners, type, fn), matchMedia: () => ({ matches: false }),
    innerWidth: 1280, innerHeight: 800, HTMLElement: class {}, confirm: () => true, visualViewport: null, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
    fetch: async (url, options) => { requests.push({ url, options }); const response = reply?.(url, options); if (response) return response; return { ok: true, json: async () => ({ revision, open: true, comments }) }; },
  };
  context.document.body.dataset.slug = 'fixture'; node('document').src = '/fixture/content';
  vm.runInNewContext(readFileSync(new URL('../src/web/shortcuts.js.txt', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/web/client.js.txt', import.meta.url), 'utf8'), context);
  const emit = (type, value) => listeners.get(type)?.forEach(fn => fn(value));
  const message = value => emit('message', { source: node('document').contentWindow, data: { revision, ...value } });
  return { node, sent, requests, emit, message, revision, oldRevision };
}

test('rows and pins open threads without navigation or replacing the draft; Escape closes', async () => {
  const v = viewer(); await new Promise(setImmediate);
  v.message({ type: 'review-ready' }); v.sent.length = 0;
  v.node('body').value = 'Keep this draft';
  v.node('threads').children[0].click();
  assert.equal(v.node('thread-popover').hidden, false);
  assert.equal(v.node('thread-content').children[0].children[1].textContent, 'one comment');
  assert.equal(v.node('document').src, '/fixture/content');
  assert.equal(v.requests.length, 1, 'opening a thread does not fetch a snapshot');
  assert.equal(v.node('body').value, 'Keep this draft');
  assert.equal(v.sent.some(m => m.type === 'review-restore' || m.type === 'review-clear'), false);
  let layer = v.sent.findLast(m => m.type === 'review-threads');
  assert.deepEqual(layer.threads.map(t => t.id), ['one', 'two', 'general']);
  assert.deepEqual(layer.threads.map(t => t.initial), ['S', 'A', 'A']);
  assert.equal(layer.selectedId, 'one');
  v.message({ type: 'review-open-thread', id: 'two' });
  assert.equal(v.node('thread-content').children[0].children[1].textContent, 'two comment');
  assert.equal(v.node('document').src, '/fixture/content');
  v.message({ type: 'review-open-thread', id: 'one', revision: v.oldRevision });
  assert.equal(v.node('thread-content').children[0].children[1].textContent, 'two comment');
  v.emit('keydown', { key: 'Escape', composedPath: () => [], preventDefault() {} });
  assert.equal(v.node('thread-popover').hidden, true);
  layer = v.sent.findLast(m => m.type === 'review-threads');
  assert.equal(layer.selectedId, null); assert.equal(layer.threads.length, 3);
});

test('older comments stay in place until explicitly opening their original version', async () => {
  const v = viewer(); await new Promise(setImmediate); v.message({ type: 'review-ready' });
  v.node('threads').children[2].click();
  assert.equal(v.node('document').src, '/fixture/content');
  const original = v.node('thread-actions').children.find(button => button.textContent === 'View original version');
  assert.ok(original); original.click(); await new Promise(setImmediate);
  assert.equal(v.node('document').src, '/fixture/revision/' + v.oldRevision);
  v.message({ type: 'review-ready', revision: v.oldRevision });
  assert.deepEqual(v.sent.findLast(m => m.type === 'review-threads').threads.map(t => t.id), ['old']);
  v.node('current').click();
  assert.equal(v.node('document').src, '/fixture/content');
  v.message({ type: 'review-ready' });
  assert.deepEqual(v.sent.findLast(m => m.type === 'review-threads').threads.map(t => t.id), ['one', 'two', 'general']);
});

test('refresh preserves rows and selection; replying keeps the saved annotation layer', async () => {
  const v = viewer(); await new Promise(setImmediate); v.message({ type: 'review-ready' });
  const row = v.node('threads').children[0]; row.click();
  v.node('refresh').click(); await new Promise(setImmediate);
  assert.equal(v.node('threads').children[0], row);
  assert.equal(row.getAttribute('aria-expanded'), 'true');
  v.node('thread-actions').children.find(button => button.textContent === 'Reply').click();
  assert.equal(v.node('thread-popover').hidden, true);
  assert.equal(v.node('compose-popover').hidden, false);
  assert.equal(v.node('composer-title').textContent, 'Reply');
  assert.equal(v.sent.findLast(m => m.type === 'review-threads').threads.length, 3);
  v.node('resolved').checked = true;
  v.node('refresh').click(); await new Promise(setImmediate);
  assert.deepEqual(v.sent.findLast(m => m.type === 'review-threads').threads.map(t => t.id), ['one', 'two', 'general', 'resolved']);
});


test('Save submits a complete draft before dispatch and visibly reports a queued delivery', async () => {
  const v = viewer(url => url.endsWith('/dispatch') ? { ok: true, json: async () => ({ connected: true, delivery: { id: 'job', status: 'queued' } }) } : null);
  await new Promise(setImmediate); v.message({ type: 'review-ready' });
  v.node('new').click(); v.node('name').value = 'Santi'; v.node('body').value = 'Shorten this paragraph.';
  v.requests.length = 0; v.node('save').click(); v.node('save').click();
  await new Promise(setImmediate);
  assert.deepEqual(v.requests.filter(r => r.options?.method === 'POST').map(r => r.url), ['/fixture/comments', '/fixture/dispatch']);
  assert.equal(v.node('body').value, '');
  assert.equal(v.node('save-notice').textContent, 'Saved. Queued for your agent.');
  assert.equal(v.node('save-notice').hidden, false); assert.equal(v.node('save').disabled, false);
});
test('Save preserves incomplete drafts and reports an offline agent without claiming delivery', async () => {
  const v = viewer(url => url.endsWith('/dispatch') ? { ok: false, json: async () => ({ error: 'No agent is connected.' }) } : null);
  await new Promise(setImmediate); v.message({ type: 'review-ready' });
  v.node('new').click(); v.node('body').value = 'Keep my draft'; v.node('save').click();
  await new Promise(setImmediate);
  assert.equal(v.node('body').value, 'Keep my draft');
  assert.equal(v.requests.some(r => r.options?.method === 'POST'), false);
  assert.equal(v.node('compose-popover').hidden, false);
  v.node('body').value = ''; v.node('save').click(); await new Promise(setImmediate);
  assert.equal(v.node('save-notice').textContent, 'No agent is connected.');
  assert.equal(v.node('save-notice').hidden, false);
});
test('an empty Save does not claim that earlier feedback was sent again', async () => {
  const v = viewer(url => url.endsWith('/dispatch') ? { ok: true, json: async () => ({ connected: true, delivery: null }) } : null);
  await new Promise(setImmediate); v.message({ type: 'review-ready' });
  v.node('save').click(); await new Promise(setImmediate);
  assert.equal(v.node('save-notice').textContent, 'No new feedback to send.');
});
