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
test('origin, validation, revision, and atomic rate limits reject invalid writes', async () => {
  const { slug, revision } = await document();
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision))).status, 403);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision), { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision, { body: 'x'.repeat(2001) }), guest)).status, 400);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment('old'), guest)).status, 409);
  assert.equal((await call('/' + slug + '/comments', 'POST', comment(revision, { body: 'x'.repeat(13000) }), guest)).status, 413);
  const responses = await Promise.all(Array.from({ length: 12 }, () => call('/' + slug + '/comments', 'POST', comment(revision), guest)));
  assert.equal(responses.filter(response => response.status === 201).length, 10);
  assert.equal(responses.filter(response => response.status === 429).length, 2);
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
