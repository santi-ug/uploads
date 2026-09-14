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
  const context = { parent, reviewRevision: 'a'.repeat(64), innerWidth: 402, innerHeight: 566,
    scrollX: 0, scrollY: 0, requestAnimationFrame: () => 1, setTimeout, clearTimeout,
    addEventListener: on, document: { createElement: node, createElementNS: node,
      documentElement: node(), title: 'Fixture', addEventListener: on } };
  vm.runInNewContext(readFileSync(new URL('../src/web/bridge.js.txt', import.meta.url), 'utf8'), context);
  const emit = (type, value) => listeners.get(type)?.forEach(fn => fn(value));
  const send = value => emit('message', { source: parent, data: value });
  const pointer = (type, x, y) => emit(type, { type, clientX: x, clientY: y, button: 0, pointerId: 1,
    composedPath: () => [], preventDefault() {}, stopImmediatePropagation() {} });
  const tool = value => send({ type: 'review-tool', tool: value, allowed: true });
  const latest = () => messages.findLast(message => message.type === 'review-markup');
  return { send, pointer, tool, latest };
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
