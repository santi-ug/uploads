import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the shipped bridge's message/pointer protocol without a browser dependency.
function bridge() {
  const listeners = new Map(), messages = [];
  const node = () => ({ style: {}, hidden: true, append() {}, replaceChildren() {}, setAttribute() {},
    attachShadow: node, addEventListener() {}, setPointerCapture() {}, hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }) });
  const on = (type, fn) => listeners.set(type, [...listeners.get(type) || [], fn]);
  const parent = { postMessage: value => messages.push(structuredClone(value)) };
  const paragraphs = ['First', 'Second'].map((textContent, i) => ({ textContent, localName: 'p', closest() { return this; },
    scrollIntoView() {}, getBoundingClientRect: () => ({ left: 10, top: 100 + i * 100, width: 100, height: 20 }) }));
  const page = { children: paragraphs }; paragraphs.forEach(p => { p.parentElement = page; });
  const context = { parent, reviewRevision: 'a'.repeat(64), innerWidth: 402, innerHeight: 566,
    scrollX: 0, scrollY: 0, requestAnimationFrame: () => 1, setTimeout, clearTimeout,
    addEventListener: on, document: { createElement: node, createElementNS: node,
      body: page, elementsFromPoint: (_x, y) => [paragraphs[y >= 200 ? 1 : 0]], querySelector: () => paragraphs[0],
      documentElement: node(), title: 'Fixture', addEventListener: on } };
  vm.runInNewContext(readFileSync(new URL('../src/web/shortcuts.js.txt', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/web/bridge.js.txt', import.meta.url), 'utf8'), context);
  const emit = (type, value) => listeners.get(type)?.forEach(fn => fn(value));
  const send = value => emit('message', { source: parent, data: value });
  const pointer = (type, x, y) => emit(type, { type, clientX: x, clientY: y, button: 0, pointerId: 1,
    composedPath: () => [], preventDefault() {}, stopImmediatePropagation() {} });
  const tool = value => send({ type: 'review-tool', tool: value, allowed: true });
  const latest = () => messages.findLast(message => message.type === 'review-markup');
  return { send, pointer, tool, latest, emit, messages };
}

test('erase has reversible history and redo preserves the original viewport', () => {
  const b = bridge(); b.tool('ellipse');
  b.pointer('pointerdown', 100, 100); b.pointer('pointermove', 200, 220); b.pointer('pointerup', 200, 220);
  const original = b.latest().markup;
  assert.equal(original.marks[0].kind, 'ellipse');
  b.tool('erase'); b.pointer('pointerdown', 150, 150);
  assert.equal(b.latest().markup, null);
  assert.equal(b.latest().canUndo, true);
  b.send({ type: 'review-history', action: 'undo' });
  assert.deepEqual(b.latest().markup, original);
  b.send({ type: 'review-history', action: 'redo' });
  assert.equal(b.latest().markup, null);
  b.send({ type: 'review-history', action: 'undo' });
  b.send({ type: 'review-history', action: 'undo' });
  assert.equal(b.latest().markup, null);
  b.send({ type: 'review-history', action: 'redo' });
  assert.deepEqual(b.latest().markup, original);
});

test('document keyboard forwarding uses registered shortcuts and respects editable fields', () => {
  const b = bridge();
  b.send({ type: 'review-tool', tool: 'read', allowed: true, shortcuts: ['c', 'z', 'Shift+z'] });
  let prevented = 0;
  const press = overrides => b.emit('keydown', { key: 'c', composedPath: () => [], preventDefault: () => prevented++, ...overrides });
  press({}); press({ key: 'z', metaKey: true }); press({ key: 'Z', shiftKey: true });
  for (const overrides of [{ repeat: true }, { isComposing: true }, { altKey: true }, { metaKey: true }, { defaultPrevented: true }, { key: 'x' }, { composedPath: () => [{ isContentEditable: true }] }, { composedPath: () => [{ matches: () => true }] }]) press(overrides);
  assert.equal(prevented, 3);
  assert.deepEqual(b.messages.filter(m => m.type === 'review-shortcut').map(m => m.key), ['c', 'z', 'Shift+z']);
  b.send({ type: 'review-tool', tool: 'read', allowed: false, shortcuts: ['c'] }); press({});
  assert.equal(prevented, 3);
});

test('cancelled gestures do not save marks and clear resets both history stacks', () => {
  const b = bridge(); b.tool('stroke');
  b.pointer('pointerdown', 10, 10); b.pointer('pointermove', 30, 30); b.pointer('pointercancel', 30, 30);
  assert.equal(b.latest(), undefined);
  b.pointer('pointerdown', 10, 10); b.pointer('pointermove', 30, 30); b.pointer('pointerup', 30, 30);
  assert.equal(b.latest().markup.marks[0].points.length, 2);
  b.send({ type: 'review-clear' });
  assert.equal(b.latest().markup, null);
  assert.equal(b.latest().canUndo, false);
  assert.equal(b.latest().canRedo, false);
});

test('undo restores geometry and text anchor together', () => {
  const b = bridge(); b.tool('select');
  b.pointer('pointerdown', 10, 100); const first = b.latest();
  b.pointer('pointerdown', 10, 200); assert.equal(b.latest().quote, 'Second');
  b.send({ type: 'review-history', action: 'undo' });
  assert.deepEqual(b.latest().markup, first.markup);
  assert.equal(b.latest().quote, first.quote);
  assert.equal(b.latest().selector, first.selector);
});

test('revealing a text anchor does not trap the next drawing tool in replay', () => {
  const b = bridge(); b.tool('read');
  b.send({ type: 'review-reveal', revision: 'a'.repeat(64), selector: 'p', quote: 'First' });
  b.tool('rect'); b.pointer('pointerdown', 10, 10); b.pointer('pointermove', 50, 50); b.pointer('pointerup', 50, 50);
  assert.equal(b.latest().markup.marks.length, 1);
  assert.equal(b.latest().markup.marks[0].kind, 'rect');
});

test('Enter opens the comment target for a freshly drawn mark', () => {
  const b = bridge(); b.tool('rect');
  b.pointer('pointerdown', 10, 10); b.pointer('pointermove', 50, 50); b.pointer('pointerup', 50, 50);
  b.emit('keydown', { key: 'Enter', composedPath: () => [], preventDefault() {} });
  const target = b.messages.findLast(message => message.type === 'review-target');
  assert.ok(target);
  assert.equal(target.markup.marks[0].kind, 'rect');
});

test('Enter is ignored while typing and when there is nothing pending', () => {
  const b = bridge(); b.tool('rect');
  b.emit('keydown', { key: 'Enter', composedPath: () => [], preventDefault() {} });
  assert.equal(b.messages.some(message => message.type === 'review-target'), false);
  b.pointer('pointerdown', 10, 10); b.pointer('pointermove', 50, 50); b.pointer('pointerup', 50, 50);
  const before = b.messages.length;
  b.emit('keydown', { key: 'Enter', composedPath: () => [{ matches: () => true }], preventDefault() {} });
  assert.equal(b.messages.slice(before).length, 0);
});
