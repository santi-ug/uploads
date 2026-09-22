import test from 'node:test';
import assert from 'node:assert/strict';
import { tick, deliveryCommand } from '../scripts/review-agent.mjs';
const config = { reviewUrl: 'http://localhost:8787/doc', t3Origin: 'http://localhost:3773', threadId: 'thread', relayId: 'relay', t3Token: 'private', uploadToken: 'owner' };
const delivery = { id: 'batch', created_at: 1000, comments: [{ body: 'Shorten this paragraph.' }] };
const thread = () => ({ id: 'thread', messages: [], session: { status: 'ready' }, latestTurn: { state: 'completed' }, runtimeMode: 'approval-required', interactionMode: 'default' });

test('relay waits while busy, preserves permissions, and uses stable IDs on retry', async () => {
  const current = thread(), sent = [];
  const request = async (url, _token, body) => {
    if (url.includes('/threads/')) return { thread: current };
    if (url.endsWith('/agent')) return { delivery };
    sent.push({ url, body }); return {};
  };
  current.session.status = 'running';
  assert.equal(await tick(config, request), 'waiting'); assert.equal(sent.length, 0);
  current.session.status = 'ready';
  assert.equal(await tick(config, request), 'delivered');
  assert.equal(sent[0].body.runtimeMode, 'approval-required');
  assert.equal(sent[0].body.commandId, 'review-save:batch');
  assert.equal(sent[1].url, config.reviewUrl + '/agent/batch');
  const command = deliveryCommand(current, delivery, config.reviewUrl);
  assert.deepEqual(sent[0].body, command);
  current.messages = [{ id: command.message.messageId }]; current.session.status = 'running'; sent.length = 0;
  assert.equal(await tick(config, request), 'delivered');
  assert.equal(sent.length, 1); assert.ok(sent[0].url.endsWith('/agent/batch'), 'acknowledgement retry must not start another turn');
});
test('relay never acknowledges a failed dispatch or refreshes its lease when T3 is unreachable', async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.includes('/threads/')) return { thread: thread() };
    if (url.endsWith('/agent')) return { delivery };
    throw Error('Offline');
  };
  await assert.rejects(tick(config, request), /Offline/);
  assert.equal(calls.some(url => url.endsWith('/agent/batch')), false);
  let count = 0;
  await assert.rejects(tick(config, async () => { count++; throw Error('T3 unavailable'); }), /T3 unavailable/);
  assert.equal(count, 1);
});
