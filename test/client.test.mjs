import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

test('rejecting a new target preserves the draft; accepting saves matching geometry and anchor', async () => {
  const revision = 'a'.repeat(64), nodes = new Map(), listeners = new Map(), sent = [], writes = [];
  const shape = x => ({ version: 1, viewport: { width: 402, height: 566 }, marks: [{ kind: 'rect', x, y: 100, width: 20, height: 20 }] });
  const original = { name: 'Reviewer', body: 'Keep this note', anchor: { quote: 'A', selector: 'p:nth-of-type(1)' }, markup: shape(10), revision };
  let stored = JSON.stringify(original), accepted = false;
  const element = () => ({ value: '', hidden: true, style: {}, dataset: {}, disabled: false, offsetHeight: 100,
    addEventListener() {}, setAttribute() {}, focus() {}, contains: () => false, append() {}, replaceChildren() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }), classList: { add() {}, remove() {} },
    contentWindow: { postMessage: message => sent.push(structuredClone(message)) } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const context = {
    document: { getElementById: node, body: node('page'), querySelector: node, querySelectorAll: () => [], createElement: element },
    localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; writes.push(JSON.parse(value)); } },
    crypto: { randomUUID: () => 'fixture-id' }, addEventListener: (type, fn) => listeners.set(type, fn),
    matchMedia: () => ({ matches: true }), innerWidth: 1000, innerHeight: 800, HTMLElement: class {},
    confirm: () => accepted, visualViewport: null, setInterval: () => 0,
    fetch: async () => ({ ok: true, json: async () => ({ revision, open: true, comments: [] }) }),
  };
  context.document.body.dataset.slug = 'fixture';
  vm.runInNewContext(readFileSync(new URL('../src/web/client.js.txt', import.meta.url), 'utf8'), context);
  await new Promise(setImmediate);
  const emit = data => listeners.get('message')({ source: node('document').contentWindow, data: { revision, ...data } });
  emit({ type: 'review-ready' }); sent.length = 0; writes.length = 0;
  const next = { quote: 'B', selector: 'p:nth-of-type(2)', markup: shape(200) };
  emit({ type: 'review-markup', ...next }); emit({ type: 'review-target', ...next });
  assert.equal(writes.length, 0);
  assert.equal(sent.length, 2);
  for (const message of sent) assert.deepEqual(message, { type: 'review-restore', revision, markup: original.markup, ...original.anchor });
  accepted = true; emit({ type: 'review-markup', ...next });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].anchor, { quote: next.quote, selector: next.selector });
  assert.deepEqual(writes[0].markup, next.markup);
  assert.equal(writes[0].body, original.body);
});
