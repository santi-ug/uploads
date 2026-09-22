#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const [reviewUrl, target] = process.argv.slice(2);
if (!reviewUrl || !target || !process.env.DOCS_UPLOAD_TOKEN) throw Error('Usage: DOCS_UPLOAD_TOKEN=… node scripts/connect-review-agent.mjs <review-url> <t3|codex|claude>:<session-id>');
const [harness, sessionId] = target.includes(':') ? target.split(':') : ['t3', target];
if (!['t3', 'codex', 'claude'].includes(harness) || !sessionId || target.split(':').length > 2) throw Error('Choose t3, codex, or claude and an exact session ID.');
if (harness !== 't3' && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(sessionId)) throw Error('Use the complete session UUID.');
const url = new URL(reviewUrl);
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('Use HTTPS or a loopback URL.');
if (!/^[a-z0-9-]{22,160}$/.test(url.pathname.slice(1)) || url.search || url.hash || url.username || url.password) throw Error('Use the plain document review URL.');
const directory = join(homedir(), '.config/docs-review', createHash('sha256').update(reviewUrl).digest('hex').slice(0, 20));
await mkdir(directory, { recursive: true, mode: 0o700 });
const configPath = join(directory, 'config.json'), pidPath = join(directory, 'relay.pid');
let previous;
try {
  const pid = Number(await readFile(pidPath, 'utf8'));
  previous = JSON.parse(await readFile(configPath, 'utf8'));
  process.kill(pid, 0);
  if (previous.expiresAt > Date.now()) {
    if ((previous.harness || 't3') !== harness || (previous.sessionId || previous.threadId) !== sessionId) throw Error('This review already has a relay for another session. Stop that relay before reconnecting.');
    console.log(JSON.stringify({ connected: true, pid, expiresAt: new Date(previous.expiresAt).toISOString(), configPath }));
    process.exit(0);
  }
  // An expired watcher can still be finishing its last tick. Do not run two relays at once.
  for (let attempt = 0; attempt < 175; attempt++) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') break; throw error; }
    if (attempt === 174) throw Error('The previous review relay is still stopping. Retry after it exits.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
} catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
const sameSession = (previous?.harness || 't3') === harness && (previous?.sessionId || previous?.threadId) === sessionId;
const config = { reviewUrl, harness, sessionId, relayId: sameSession ? previous.relayId : randomUUID(), uploadToken: process.env.DOCS_UPLOAD_TOKEN, expiresAt: Date.now() + 4 * 60 * 60_000 - 5000 };
if (harness === 't3') {
  const t3Home = process.env.T3CODE_HOME || join(homedir(), '.t3');
  const runtime = JSON.parse(await readFile(join(t3Home, 'userdata/server-runtime.json'), 'utf8'));
  const t3Origin = 'http://127.0.0.1:' + runtime.port;
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
  Object.assign(config, { threadId: sessionId, t3Origin, t3TokenFile });
  const threadResponse = await fetch(t3Origin + '/api/orchestration/threads/' + encodeURIComponent(sessionId) + '?turnLimit=1', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10_000) });
  if (!threadResponse.ok) throw Error('Could not connect to the selected T3 conversation: HTTP ' + threadResponse.status);
} else {
  config.receiptPath = join(directory, 'accepted-delivery');
  if (harness === 'codex') {
    const sessionsDir = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
    const files = await readdir(sessionsDir, { recursive: true });
    const file = files.find(item => item.endsWith(sessionId + '.jsonl'));
    if (!file) throw Error('Codex session was not found on this machine. Use its exact session UUID.');
    const handle = await open(join(sessionsDir, file));
    const buffer = Buffer.alloc(16_384);
    let bytesRead;
    try { ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0)); }
    finally { await handle.close(); }
    const firstLine = buffer.subarray(0, bytesRead).toString().split('\n', 1)[0];
    const metadata = JSON.parse(firstLine);
    if (metadata.type !== 'session_meta' || typeof metadata.payload?.cwd !== 'string') throw Error('Codex session has no recorded working directory.');
    config.sessionCwd = metadata.payload.cwd;
    execFileSync('codex', ['exec', 'resume', '--help'], { stdio: 'ignore', timeout: 10_000 });
  } else {
    const sessions = JSON.parse(execFileSync('claude', ['agents', '--json', '--all'], { encoding: 'utf8', timeout: 10_000 }));
    const session = sessions.find(item => item.sessionId === sessionId);
    if (!session || session.kind !== 'background') throw Error('Claude session must be an existing background session. Run /background in that session first.');
    config.sessionCwd = session.cwd;
  }
}
const lease = await fetch(reviewUrl + '/agent', { method: 'POST', headers: { authorization: 'Bearer ' + config.uploadToken, 'content-type': 'application/json' }, body: JSON.stringify({ relayId: config.relayId }), signal: AbortSignal.timeout(10_000) });
if (!lease.ok) throw Error('Could not connect this review to an agent: HTTP ' + lease.status);
await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
const log = await open(join(directory, 'relay.log'), 'a', 0o600);
const child = spawn(process.execPath, [fileURLToPath(new URL('./review-agent.mjs', import.meta.url)), configPath], { detached: true, stdio: ['ignore', log.fd, log.fd] });
if (!child.pid) throw Error('Could not start the review relay.');
await writeFile(pidPath, String(child.pid)); child.unref(); await log.close();
console.log(JSON.stringify({ started: true, pid: child.pid, expiresAt: new Date(config.expiresAt).toISOString(), configPath }));
