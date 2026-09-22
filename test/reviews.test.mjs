import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
const base = process.env.REVIEW_TEST_URL;
if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Set REVIEW_TEST_URL to the isolated local Wrangler server.');
const owner = { authorization: 'Bearer local-review-test-only' };
const json = { 'content-type': 'application/json' };
const fixture = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review test</title></head><body><h1>Launch plan</h1><p>Invite the first 20 customers.</p></body></html>';
async function call(path, method = 'GET', data, headers = {}) {
  return fetch(base + path, { method, headers: { ...(data ? json : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
async function document() {
  const slug = randomBytes(11).toString('hex');
  const put = await fetch(base + '/' + slug, { method: 'PUT', headers: owner, body: fixture });
  assert.equal(put.status, 200);
  const open = await call('/' + slug + '/review', 'POST', { action: 'open' }, owner);
  assert.equal(open.status, 200);
  const state = await (await call('/' + slug + '/comments')).json();
  return { slug, revision: state.revision };
}
function comment(revision, overrides = {}) {
  return { id: randomUUID(), name: 'Reviewer', body: 'Start with five.', quote: 'Invite the first 20 customers.', selector: 'p:nth-of-type(1)', revision, parentId: null, ...overrides };
}
const guest = { origin: base };

test('guest comments persist, retries deduplicate, and replies stay scoped to their document', async () => {
  const { slug, revision } = await document();
  const payload = comment(revision);
  assert.equal((await call('/' + slug + '/comments', 'POST', payload, guest)).status, 201);
  assert.equal((await call('/' + slug + '/comments', 'POST', payload, guest)).status, 200);
  const reply = comment(revision, { parentId: payload.id, body: 'Agreed.' });
  assert.equal((await call('/' + slug + '/comments', 'POST', reply, guest)).status, 201);
  const state = await (await call('/' + slug + '/comments')).json();
  assert.equal(state.comments.length, 2); assert.equal(state.comments[1].parent_id, payload.id);
  assert.equal('actor_hash' in state.comments[0], false);
  const other = await document();
  assert.equal((await call('/' + other.slug + '/comments', 'POST', comment(other.revision, { parentId: payload.id }), guest)).status, 400);
});
test('owner controls reject guests and close, reopen, and resolve correctly', async () => {
  const { slug, revision } = await document();
  const payload = comment(revision);
  await call('/' + slug + '/comments', 'POST', payload, guest);
  assert.equal((await call('/' + slug + '/review', 'POST', { action: 'close' }, guest)).status, 401);
  assert.equal((await call('/' + slug + '/comments/' + payload.id, 'PATCH', { status: 'resolved' }, guest)).status, 401);
  assert.equal((await call('/' + slug + '/comments/' + payload.id, 'PATCH', { status: 'resolved' }, owner)).status, 200);
  await call('/' + slug + '/review', 'POST', { action: 'close' }, owner);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision), guest)).status, 403);
  assert.equal((await (await call('/' + slug + '/comments')).json()).open, false);
  await call('/' + slug + '/review', 'POST', { action: 'open' }, owner);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision), guest)).status, 201);
});
test('identical retries survive document updates and network changes but reject changed payloads', async () => {
  const { slug, revision } = await document();
  const payload = comment(revision);
  const path = '/' + slug + '/comments';
  assert.equal((await call(path, 'POST', payload, { ...guest, 'cf-connecting-ip': '192.0.2.1' })).status, 201);
  await fetch(base + '/' + slug, { method: 'PUT', headers: owner, body: fixture.replace('20 customers', '5 customers') });
  assert.equal((await call(path, 'POST', payload, { ...guest, 'cf-connecting-ip': '192.0.2.2' })).status, 200);
  assert.equal((await call(path, 'POST', { ...payload, body: 'Different comment' }, guest)).status, 409);
  const state = await (await call(path)).json();
  assert.equal(state.comments.length, 1);
  assert.equal(state.comments[0].body, payload.body);
});
test('origin, validation, revision, and atomic rate limits reject invalid writes', async () => {
  const { slug, revision } = await document();
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision))).status, 403);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision), { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision, { body: 'x'.repeat(2001) }), guest)).status, 400);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment('old'), guest)).status, 409);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision, { body: 'x'.repeat(97000) }), guest)).status, 413);
  const responses = await Promise.all(Array.from({ length: 12 }, () => call('/' + slug + '/comments', 'POST', comment(revision), guest)));
  assert.equal(responses.filter(response => response.status === 201).length, 10);
  assert.equal(responses.filter(response => response.status === 429).length, 2);
});

const markup = { version: 1, viewport: { width: 390, height: 650 }, marks: [
  { kind: 'ellipse', x: 20, y: 130, width: 220, height: 110 },
  { kind: 'stroke', points: [{ x: 20, y: 100 }, { x: 40, y: 110 }, { x: 60, y: 100 }] },
  { kind: 'rect', x: 30, y: 800, width: 200, height: 80 },
] };
test('markup geometry persists, deduplicates, and replays an owner-authored older revision', async () => {
  const { slug, revision } = await document();
  const payload = comment(revision, { markup });
  assert.equal((await call('/' + slug + '/comments', 'POST', payload, guest)).status, 201);
  assert.equal((await call('/' + slug + '/comments', 'POST', payload, guest)).status, 200);
  const state = await (await call('/' + slug + '/comments')).json();
  assert.deepEqual(state.comments[0].markup, markup);
  await fetch(base + '/' + slug, { method: 'PUT', headers: owner, body: fixture.replace('20 customers', '5 customers') });
  const saved = await call('/' + slug + '/revision/' + revision);
  assert.equal(saved.status, 200); assert.match(await saved.text(), /20 customers/);
  assert.match(saved.headers.get('content-security-policy'), /sandbox/);
  const other = await document();
  assert.equal((await call('/' + other.slug + '/revision/' + '0'.repeat(64))).status, 404);
  await call('/' + slug, 'DELETE', undefined, owner);
  assert.equal((await call('/' + slug + '/revision/' + revision)).status, 404);
});
test('markup boundary rejects executable shapes, invalid dimensions, point floods, and oversized requests', async () => {
  const { slug, revision } = await document();
  const invalid = [
    { ...markup, version: 2 },
    { ...markup, viewport: { width: -1, height: 650 } },
    { ...markup, marks: [{ kind: 'svg', html: '<script>alert(1)</script>' }] },
    { ...markup, marks: [{ kind: 'ellipse', x: null, y: 0, width: 2, height: 2 }] },
    { ...markup, marks: Array(33).fill(markup.marks[0]) },
    { ...markup, marks: [{ kind: 'stroke', points: Array(513).fill({ x: 1, y: 1 }) }] },
    { ...markup, marks: Array(5).fill({ kind: 'stroke', points: Array(500).fill({ x: 1, y: 1 }) }) },
  ];
  for (const value of invalid) assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision, { markup: value }), guest)).status, 400);
  const state = await (await call('/' + slug + '/comments')).json(); assert.equal(state.comments.length, 0);
});
test('republish keeps earlier threads and revoked links cannot be read or resurrected', async () => {
  const { slug, revision } = await document();
  await call('/' + slug + '/comments', 'POST', comment(revision), guest);
  await fetch(base + '/' + slug, { method: 'PUT', headers: owner, body: fixture.replace('20 customers', '5 customers') });
  const state = await (await call('/' + slug + '/comments')).json();
  assert.notEqual(state.revision, revision); assert.equal(state.comments[0].revision, revision);
  assert.equal((await call('/' + slug, 'DELETE', undefined, owner)).status, 204);
  for (const suffix of ['', '/content', '/comments']) assert.equal((await call('/' + slug + suffix)).status, 404);
  assert.equal((await fetch(base + '/' + slug, { method: 'PUT', headers: owner, body: fixture })).status, 410);
});
test('readable title UUID slugs route alongside legacy opaque slugs', async () => {
  const readable = 'void-button-hierarchy-019f2c3a-4b5c-6d7e-8f90-abcdef123456';
  assert.equal((await fetch(base + '/' + readable, { method: 'PUT', headers: owner, body: fixture })).status, 200);
  assert.equal((await call('/' + readable)).status, 200);
  const opaque = randomBytes(11).toString('hex');
  assert.equal((await fetch(base + '/' + opaque, { method: 'PUT', headers: owner, body: fixture })).status, 200);
  assert.equal((await call('/' + opaque)).status, 200);
});
test('malformed readable slugs are rejected', async () => {
  for (const slug of ['Title With Spaces-019f2c3a-4b5c-6d7e-8f90-abcdef123456', 'title-019f2c3a-4b5c-6d7e-8f90-abcdef12345', 'x'.repeat(161)]) {
    assert.equal((await call('/' + slug)).status, 404);
  }
});
test('review viewer isolates authored HTML and leaves the stored HTML intact', async () => {
  const { slug } = await document();
  const shell = await call('/' + slug); const shellHtml = await shell.text();
  assert.match(shellHtml, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(shellHtml, /allow-same-origin/);
  assert.match(shellHtml, /<aside id="panel"/);
  const content = await call('/' + slug + '/content');
  assert.match(content.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.match(await content.text(), /reviewRevision/);
  const head = await call('/' + slug, 'HEAD'); assert.equal(await head.text(), '');
  const plain = randomBytes(11).toString('hex');
  await fetch(base + '/' + plain, { method: 'PUT', headers: owner, body: fixture });
  assert.equal(await (await call('/' + plain)).text(), fixture);
});

test('Save queues once, requires a connected owner relay, and acknowledges only that document', async () => {
  const { slug, revision } = await document(), root = comment(revision), relayId = randomUUID(), id = randomUUID();
  const path = '/' + slug;
  await call(path + '/comments', 'POST', root, guest);
  assert.equal((await call(path + '/dispatch', 'POST', { id }, guest)).status, 503);
  assert.equal((await call(path + '/agent', 'POST', { relayId }, guest)).status, 401);
  assert.equal((await call(path + '/agent', 'POST', { relayId }, owner)).status, 200);
  assert.equal((await call(path + '/agent', 'POST', { relayId: randomUUID() }, owner)).status, 409);
  assert.equal((await call(path + '/dispatch', 'POST', { id })).status, 403);
  const results = await Promise.all([id, randomUUID()].map(id => call(path + '/dispatch', 'POST', { id }, guest).then(r => r.json())));
  assert.equal(results.filter(result => result.delivery).length, 1, 'only the click that captures feedback reports a new delivery');
  const jobId = results.find(result => result.delivery).delivery.id;
  const pending = await (await call(path + '/agent', 'POST', { relayId }, owner)).json();
  assert.equal(pending.delivery.comments.length, 1); assert.equal(pending.delivery.comments[0].id, root.id);
  assert.equal((await call(path + '/agent/' + jobId, 'POST', { relayId: randomUUID() }, owner)).status, 409);
  assert.equal((await call(path + '/agent/' + jobId, 'POST', { relayId }, guest)).status, 401);
  assert.equal((await call(path + '/agent/' + jobId, 'POST', { relayId }, owner)).status, 200);
  const saved = await (await call(path + '/dispatch', 'POST', { id: randomUUID() }, guest)).json();
  assert.equal(saved.delivery, null, 'a no-op Save must not report an older delivery as new');
  assert.equal((await (await call(path + '/dispatch')).json()).delivery.id, jobId, 'GET still reports the latest delivery for status polling');
  assert.equal((await (await call(path + '/agent', 'POST', { relayId }, owner)).json()).delivery, null);
  const reply = comment(revision, { parentId: root.id, body: 'One more change.' });
  await call(path + '/comments', 'POST', reply, guest);
  await call(path + '/dispatch', 'POST', { id: randomUUID() }, guest);
  const next = await (await call(path + '/agent', 'POST', { relayId }, owner)).json();
  assert.deepEqual(next.delivery.comments.map(c => c.id), [reply.id]);
  await call(path + '/review', 'POST', { action: 'close' }, owner);
  assert.equal((await call(path + '/dispatch', 'POST', { id: randomUUID() }, guest)).status, 403);
  assert.equal((await call(path + '/agent', 'POST', { relayId }, owner)).status, 403);
});
