#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const [reviewUrl, threadId] = process.argv.slice(2);
if (!reviewUrl || !threadId || !process.env.DOCS_UPLOAD_TOKEN) throw Error('Usage: DOCS_UPLOAD_TOKEN=… node scripts/connect-review-agent.mjs <review-url> <t3-thread-id>');
const url = new URL(reviewUrl);
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('Use HTTPS or a loopback URL.');
if (!/^[a-z0-9-]{22,160}$/.test(url.pathname.slice(1)) || url.search || url.hash || url.username || url.password) throw Error('Use the plain document review URL.');
const t3Home = process.env.T3CODE_HOME || join(homedir(), '.t3');
const runtime = JSON.parse(await readFile(join(t3Home, 'userdata/server-runtime.json'), 'utf8'));
const t3Origin = 'http://127.0.0.1:' + runtime.port;
const directory = join(homedir(), '.config/docs-review', createHash('sha256').update(reviewUrl).digest('hex').slice(0, 20));
await mkdir(directory, { recursive: true, mode: 0o700 });
const configPath = join(directory, 'config.json'), pidPath = join(directory, 'relay.pid');
try {
  const pid = Number(await readFile(pidPath, 'utf8')), previous = JSON.parse(await readFile(configPath, 'utf8'));
  process.kill(pid, 0);
  if (previous.expiresAt > Date.now()) {
    if (previous.threadId !== threadId) throw Error('This review already has a relay for another conversation. Stop that relay before reconnecting.');
    console.log(JSON.stringify({ connected: true, pid, expiresAt: new Date(previous.expiresAt).toISOString(), configPath }));
    process.exit(0);
  }
} catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
let executable = process.env.T3_CLI || 't3', prefix = [], environment = process.env;
if (!process.env.T3_CLI && process.platform === 'darwin') {
  const bundle = ['/Applications/T3 Code (Nightly).app', '/Applications/T3 Code.app'].find(existsSync);
  if (bundle) {
    const appName = bundle.split('/').at(-1).replace('.app', '');
    executable = join(bundle, 'Contents/MacOS', appName);
    prefix = [join(bundle, 'Contents/Resources/app.asar/apps/server/dist/bin.mjs')];
    environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  }
}
const t3TokenFile = join(directory, 't3-token');
const token = execFileSync(executable, [...prefix, 'auth', 'session', 'issue', '--base-dir', t3Home, '--ttl', '4h', '--label', 'Hosted review Save relay', '--token-only'], { encoding: 'utf8', env: environment }).trim();
await writeFile(t3TokenFile, token, { mode: 0o600 });
const config = { reviewUrl, threadId, relayId: randomUUID(), t3Origin, t3TokenFile, uploadToken: process.env.DOCS_UPLOAD_TOKEN, expiresAt: Date.now() + 4 * 60 * 60_000 - 5000 };
const threadResponse = await fetch(t3Origin + '/api/orchestration/threads/' + encodeURIComponent(threadId) + '?turnLimit=1', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10_000) });
if (!threadResponse.ok) throw Error('Could not connect to the selected T3 conversation: HTTP ' + threadResponse.status);
const lease = await fetch(reviewUrl + '/agent', { method: 'POST', headers: { authorization: 'Bearer ' + config.uploadToken, 'content-type': 'application/json' }, body: JSON.stringify({ relayId: config.relayId }), signal: AbortSignal.timeout(10_000) });
if (!lease.ok) throw Error('Could not connect this review to an agent: HTTP ' + lease.status);
await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
const log = await open(join(directory, 'relay.log'), 'a', 0o600);
const child = spawn(process.execPath, [fileURLToPath(new URL('./review-agent.mjs', import.meta.url)), configPath], { detached: true, stdio: ['ignore', log.fd, log.fd] });
if (!child.pid) throw Error('Could not start the review relay.');
await writeFile(pidPath, String(child.pid)); child.unref(); await log.close();
console.log(JSON.stringify({ started: true, pid: child.pid, expiresAt: new Date(config.expiresAt).toISOString(), configPath }));
