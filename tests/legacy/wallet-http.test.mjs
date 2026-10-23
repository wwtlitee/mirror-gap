import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Wallet } from 'ethers';

async function withServer(work) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mirror-wallet-http-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve(import.meta.dirname, '..'), windowsHide: true,
    env: { ...process.env, MIRROR_HOME_PORT: String(port), MIRROR_HOME_STATE_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
  const exited = new Promise(resolve => child.on('exit', resolve));
  function client() {
    const jar = new Map();
    return { jar, async request(route, data, overrides = {}) {
      const response = await fetch(`${base}${route}`, { method: data === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base,
          Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...overrides },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000) });
      for (const value of response.headers.getSetCookie()) {
        const [key, content] = value.split(';')[0].split('='); if (content) jar.set(key, content); else jar.delete(key);
      }
      return { status: response.status, data: await response.json() };
    } };
  }
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { ready = (await fetch(`${base}/api/health`)).ok; } catch { /* Wait for this test-owned process. */ }
      if (ready) break; await delay(50);
    }
    assert.ok(ready, logs);
    await work({ base, client });
  } finally {
    child.kill('SIGTERM'); await exited;
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    assert.ok(relative.startsWith('mirror-wallet-http-') && !relative.includes(path.sep));
    await rm(directory, { recursive: true, force: true });
  }
}

async function login(client, wallet) {
  const challenge = await client.request('/api/auth/challenge', { address: wallet.address, chainId: 56 });
  assert.equal(challenge.status, 200);
  const result = await client.request('/api/auth/verify', { signature: await wallet.signMessage(challenge.data.message) });
  assert.equal(result.status, 200);
  assert.equal(result.data.authenticated, true);
}

function slowPost(base, client, route, data) {
  const body = Buffer.from(JSON.stringify(data));
  const split = Math.floor(body.length / 2);
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(`${base}${route}`, { method: 'POST', agent: false,
      headers: { Origin: base, 'Content-Type': 'application/json', 'Content-Length': body.length,
        Cookie: [...client.jar].map(([key, value]) => `${key}=${value}`).join('; ') } }, incoming => {
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () => {
        try { resolve({ status: incoming.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('Slow-request regression timed out')));
  });
  // Keep rejection handled if setup fails before the test awaits the response.
  response.catch(() => {});
  request.flushHeaders();
  const written = new Promise((resolve, reject) => request.write(body.subarray(0, split), error => error ? reject(error) : resolve()));
  return { written, response, finish: () => request.end(body.subarray(split)), destroy: () => request.destroy() };
}

test('real signed HTTP login isolates accounts, rejects replay and forgery, and restores each personal room', async () => withServer(async ({ base, client }) => {
    const guest = client(), first = client(), second = client();
    const alice = Wallet.createRandom(), bob = Wallet.createRandom();
    const challenge = await first.request('/api/auth/challenge', { address: alice.address, chainId: 56 });
    assert.equal(challenge.status, 200);
    const signature = await alice.signMessage(challenge.data.message);
    const login = await first.request('/api/auth/verify', { signature });
    assert.equal(login.status, 200);
    assert.equal(login.data.authenticated, true);
    assert.equal(login.data.address.toLowerCase(), alice.address.toLowerCase());
    assert.equal((await first.request('/api/auth/verify', { signature })).status, 401);
    assert.equal((await guest.request('/api/fly/claim', { requestId: randomUUID(), address: alice.address })).status, 401);
    const secondChallenge = await second.request('/api/auth/challenge', { address: bob.address, chainId: 1 });
    assert.equal((await second.request('/api/auth/verify', { signature: await alice.signMessage(secondChallenge.data.message) })).status, 401);
    const retry = await second.request('/api/auth/challenge', { address: bob.address, chainId: 1 });
    assert.equal((await second.request('/api/auth/verify', { signature: await bob.signMessage(retry.data.message) })).status, 200);
    const claim = await first.request('/api/fly/claim', { requestId: randomUUID() });
    const flyId = claim.data.account.fly.id;
    assert.equal(claim.status, 200);
    assert.equal((await first.request('/api/fly/claim', { requestId: randomUUID() })).data.account.fly.id, flyId);
    const other = await second.request('/api/fly/claim', { requestId: randomUUID() });
    assert.notEqual(other.data.account.fly.id, flyId);
    assert.equal((await first.request('/api/command', { type: 'speed', value: 10 })).status, 400);
    assert.equal((await guest.request('/api/command', { type: 'speed', value: 10 })).status, 200);
    const before = (await second.request('/api/state')).data;
    assert.equal((await first.request('/api/command', { type: 'feed', address: bob.address })).status, 200);
    const after = (await second.request('/api/state')).data;
    assert.equal(after.stats.interactions, before.stats.interactions);
    assert.equal(after.speed, 1);
    assert.equal((await guest.request('/api/state')).data.account.authenticated, false);
    assert.equal((await first.request('/api/fly/claim', { requestId: randomUUID() }, { Origin: 'https://evil.example' })).status, 403);
    const stream = await fetch(`${base}/api/stream`, { headers: { Cookie: [...first.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    const reader = stream.body.getReader();
    const content = new TextDecoder().decode((await reader.read()).value);
    assert.ok(content.includes(flyId));
    assert.equal(content.includes(other.data.account.fly.id), false);
    await reader.cancel();
    assert.equal((await first.request('/api/auth/logout', {})).status, 200);
    assert.equal((await first.request('/api/account')).data.authenticated, false);
    assert.equal((await first.request('/api/fly/upgrade', { requestId: randomUUID() })).status, 401);
}));

test('logout revokes a signed session while claim or private command bodies are still streaming', async () => withServer(async ({ base, client }) => {
  const owner = client();
  const wallet = Wallet.createRandom();
  await login(owner, wallet);
  assert.equal((await owner.request('/api/account')).data.fly, null);

  const claim = slowPost(base, owner, '/api/fly/claim', { requestId: randomUUID() });
  try {
    await claim.written;
    // A server round trip after flushing the partial body orders logout without a timing sleep.
    assert.equal((await owner.request('/api/account')).data.authenticated, true);
    assert.equal((await owner.request('/api/auth/logout', {})).status, 200);
    claim.finish();
    assert.equal((await claim.response).status, 401);
  } finally { claim.destroy(); }

  await login(owner, wallet);
  assert.equal((await owner.request('/api/account')).data.fly, null, 'A revoked in-flight claim must not create a fly');
  assert.equal((await owner.request('/api/fly/claim', { requestId: randomUUID() })).status, 200);
  const before = (await owner.request('/api/state')).data;
  const guest = client();
  const demoBefore = (await guest.request('/api/state')).data.stats.interactions;
  const command = slowPost(base, owner, '/api/command', { type: 'feed' });
  try {
    await command.written;
    assert.equal((await owner.request('/api/account')).data.authenticated, true);
    assert.equal((await owner.request('/api/auth/logout', {})).status, 200);
    command.finish();
    assert.equal((await command.response).status, 401);
  } finally { command.destroy(); }

  await login(owner, wallet);
  const after = (await owner.request('/api/state')).data;
  assert.equal(after.account.fly.id, before.account.fly.id);
  assert.equal(after.stats.interactions, before.stats.interactions, 'A revoked in-flight command must not change the private room');
  assert.equal((await guest.request('/api/state')).data.stats.interactions, demoBefore, 'A revoked private command must not fall back to the demo');
}));
