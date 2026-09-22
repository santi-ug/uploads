import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tick, deliveryCommand, feedbackMessage, startCodexTurn } from '../scripts/review-agent.mjs';
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

test('Codex resumes the exact session and acknowledges only after turn start', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-agent-'));
  try {
    const cli = { ...config, harness: 'codex', sessionId: 'exact-session', receiptPath: join(directory, 'accepted') };
    const calls = [];
    const request = async (url, _token, body) => {
      calls.push({ url, body });
      return url.endsWith('/agent') ? { delivery } : {};
    };
    const start = async (target, message) => { calls.push({ target, message }); };
    assert.equal(await tick(cli, request, undefined, start), 'delivered');
    assert.deepEqual(calls[1], { target: cli, message: feedbackMessage(delivery, cli.reviewUrl) });
    assert.equal(calls[2].url, cli.reviewUrl + '/agent/batch');
    calls.length = 0;
    assert.equal(await tick(cli, request, undefined, start), 'delivered');
    assert.equal(calls.some(call => call.target), false, 'failed ack retry must not restart the turn');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Claude waits for its exact background session and does not acknowledge a failed resume', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-agent-'));
  try {
    const cli = { ...config, harness: 'claude', sessionId: '12345678-1234-1234-1234-123456789abc', sessionCwd: '/project', receiptPath: join(directory, 'accepted') };
    const calls = [];
    let state = 'busy', fail = false;
    const request = async (url) => { calls.push(url); return url.endsWith('/agent') ? { delivery } : {}; };
    const run = async (executable, args, options) => {
      if (args[0] === 'agents') return { stdout: JSON.stringify([{ sessionId: cli.sessionId, cwd: cli.sessionCwd, kind: 'background', state }]) };
      calls.push({ executable, args, options });
      if (fail) throw Error('resume failed');
      return { stdout: 'backgrounded · 12345678' };
    };
    assert.equal(await tick(cli, request, run), 'waiting');
    assert.equal(calls.some(call => typeof call !== 'string'), false);
    state = 'done'; fail = true; calls.length = 0;
    await assert.rejects(tick(cli, request, run), /resume failed/);
    assert.equal(calls.some(call => typeof call === 'string' && call.endsWith('/agent/batch')), false);
    fail = false; calls.length = 0;
    assert.equal(await tick(cli, request, run), 'delivered');
    assert.deepEqual(calls[1].args, ['stop', '12345678']);
    assert.deepEqual(calls[2].args.slice(0, 3), ['--bg', '--resume', cli.sessionId]);
    assert.equal(calls[2].options.cwd, cli.sessionCwd);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Claude rejects and stops a copied session instead of claiming delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-agent-'));
  try {
    const cli = { ...config, harness: 'claude', sessionId: '12345678-1234-1234-1234-123456789abc', sessionCwd: '/project', receiptPath: join(directory, 'accepted') };
    const calls = [];
    const request = async url => { calls.push(url); return url.endsWith('/agent') ? { delivery } : {}; };
    const run = async (_executable, args) => {
      calls.push(args);
      return args[0] === 'agents'
        ? { stdout: JSON.stringify([{ sessionId: cli.sessionId, cwd: cli.sessionCwd, kind: 'background', state: 'done' }]) }
        : { stdout: 'backgrounded · deadbeef' };
    };
    await assert.rejects(tick(cli, request, run), /different session/);
    assert.deepEqual(calls.filter(Array.isArray).at(-1), ['stop', 'deadbeef']);
    assert.equal(calls.includes(cli.reviewUrl + '/agent/batch'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Codex rejects a resume that starts a different thread', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => { killed = true; setImmediate(() => child.emit('exit', 0)); };
  const launch = () => {
    setImmediate(() => child.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'other-session' }) + '\n'));
    return child;
  };
  await assert.rejects(startCodexTurn({ sessionId: 'exact-session', sessionCwd: '/project' }, 'feedback', launch), /different session/);
  assert.equal(killed, true);
});
