import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { LifeSimulation } from '../src/simulation.mjs';
import { EmbodiedLife } from '../src/embodied-life.mjs';
import { VERSION, ZONE_BY_ID } from '../public/world-spec.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('authenticated shutdown persists, releases the lock, and preserves pause choice',async()=>{
 await withFixture(async fixture=>{
  const server=await fixture.start();
  await command(server,{type:'pause',value:true});
  const lock=JSON.parse(await readFile(path.join(fixture.stateDir,'server.lock'),'utf8'));
  const headers={Origin:`http://127.0.0.1:${server.port}`};
  assert.equal((await request(server,'/api/shutdown',{method:'POST',headers})).status,403);
  const before=(await request(server,'/api/state')).json;
  const result=await request(server,'/api/shutdown',{method:'POST',headers:{...headers,Authorization:`Bearer ${lock.controlToken}`}});
  assert.equal(result.status,200);assert.equal(result.json.instanceId,lock.instanceId);
  assert.equal((await server.exited).code,0);
  const saved=JSON.parse(await readFile(fixture.savePath,'utf8'));assert.equal(saved.paused,true);assert.equal(saved.simSeconds,before.simSeconds);
  await assert.rejects(readFile(path.join(fixture.stateDir,'server.lock')),e=>e.code==='ENOENT');
 });
});

async function freePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

function request(server, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.port,
      path: pathname, method, headers, timeout: 2000, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* Static files need not be JSON. */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.once('error', reject);
    req.once('timeout', () => req.destroy(new Error('Test HTTP request timed out')));
    req.end(body);
  });
}

function command(server, value, headers = {}) {
  return request(server, '/api/command', { method: 'POST', body: JSON.stringify(value),
    headers: { Origin: `http://127.0.0.1:${server.port}`, 'Content-Type': 'application/json', ...headers } });
}

async function launch(stateDir, testing=true) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: projectRoot, windowsHide: true,
    env: { ...process.env, MIRROR_HOME_TEST_MODE: testing?'1':'0', MIRROR_HOME_PORT: String(port), MIRROR_HOME_STATE_DIR: stateDir },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = chunk => { output = (output + chunk.toString('utf8')).slice(-16384); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const exited = new Promise(resolve => {
    child.once('error', () => resolve({ code: null, spawnError: true }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const server = { port, child, exited, output: () => output };
  return server;
}

async function ready(server) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error('Isolated test server exited before becoming ready');
    }
    try {
      const result = await request(server, '/api/health');
      if (result.status === 200) return;
    } catch { /* Startup has not bound the port yet. */ }
    await delay(25);
  }
  throw new Error('Isolated test server did not become ready: '+server.output());
}

async function stop(server) {
  if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGTERM');
  const stopped = await Promise.race([server.exited, delay(4000).then(() => null)]);
  if (!stopped) {
    server.child.kill('SIGKILL');
    await server.exited;
  }
}

async function withFixture(callback) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mirror-gap-home-http-'));
  const stateDir = path.join(tempRoot, 'state');
  await mkdir(stateDir);
  const ownedServers = [];
  try {
    await callback({ tempRoot, stateDir, savePath: path.join(stateDir, 'home-state.json'),
      async start({ waitForReady = true, testing=true } = {}) {
        const server = await launch(stateDir,testing);
        ownedServers.push(server);
        if (waitForReady) await ready(server);
        return server;
      } });
  } finally {
    for (const server of ownedServers) await stop(server);
    const resolved = path.resolve(tempRoot);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()), 'Cleanup must stay in the temporary directory');
    assert.match(path.basename(resolved), /^mirror-gap-home-http-/, 'Cleanup must target this test fixture');
    await rm(resolved, { recursive: true, force: true });
  }
}

test('HTTP health and snapshots agree with the shared simulation contract', async () => {
  await withFixture(async fixture => {
    const server = await fixture.start();
    const health = await request(server, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.version, VERSION);
    assert.equal(health.json.persistenceError, null);
    assert.equal(health.json.mode, 'single-resident');
    assert.equal(health.json.neural.available, true);
    assert.equal(health.json.neural.neurons, 4386);
    const response = await request(server, '/api/state');
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    const snapshot = response.json;
    assert.equal(snapshot.version, VERSION);
    assert.equal(snapshot.server.connected, true);
    assert.equal(snapshot.server.persistenceError, null);
    assert.ok(Number.isFinite(Date.parse(snapshot.server.lastSavedAt)));
    assert.ok(Object.hasOwn(ZONE_BY_ID, snapshot.actor.zoneId));
    assert.ok(snapshot.history.length > 0);
    assert.deepEqual(Object.keys(snapshot.needs).sort(), ['comfort', 'curiosity', 'energy', 'satiety']);
    assert.equal(Object.hasOwn(snapshot.actor, 'route'), false);
    const saved = JSON.parse(await readFile(fixture.savePath, 'utf8'));
    assert.doesNotThrow(() => new EmbodiedLife(saved));
    assert.equal(snapshot.neural.bodyControl, 'functional-neural-motor');
  });
});

test('retired economy routes cannot authenticate, mutate or create a ledger; old cookies do not select another room', async () => {
  await withFixture(async fixture => {
    const archive = path.join(fixture.stateDir, 'game.sqlite');
    await writeFile(archive, 'PRESERVED_OLD_LEDGER');
    const server = await fixture.start();
    for (const endpoint of ['/api/account', '/api/auth/challenge', '/api/auth/verify', '/api/auth/logout',
      '/api/fly/claim', '/api/fly/upgrade', '/api/research/start']) {
      for (const method of ['GET', 'POST']) assert.equal((await request(server, endpoint, { method })).status, 410);
    }
    assert.equal((await request(server, '/wallet-client.mjs')).status, 404);
    await command(server, { type: 'pause', value: true });
    const clean = (await request(server, '/api/state')).json;
    const staleCookie = (await request(server, '/api/state', { headers: { Cookie: `mg_session_${server.port}=old` } })).json;
    assert.deepEqual(clean.actor, staleCookie.actor);
    assert.deepEqual(clean.needs, staleCookie.needs);
    assert.equal(Object.hasOwn(staleCookie, 'account'), false);
    assert.equal(await readFile(archive, 'utf8'), 'PRESERVED_OLD_LEDGER');
    const page = (await request(server, '/')).text;
    assert.doesNotMatch(page, /钱包|积分|NFT|代币|领取|升级/);
    assert.match(page, /brain-canvas/);
  });
});

test('neural frames advance without viewers, interactions enter the network, pause stops sampling', async () => {
  await withFixture(async fixture => {
    const server = await fixture.start();
    const waitFrame=async steps=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const n=(await request(server,'/api/state')).json.neural;if((n.frame?.steps??0)>steps)return n;await delay(25);}assert.fail('Neural frame did not advance within bounded deadline');};
    const first = (await waitFrame(0)).frame;
    assert.ok(first.steps > 0);
    await command(server, { type: 'chime' });
    const observed = await waitFrame(first.steps);
    const next = observed.frame;
    assert.ok(next.steps > first.steps);
    assert.ok(observed.sensory.signals.find(signal => signal.id === 'bell').intensity > 0);
    assert.notDeepEqual(next.inputs, first.inputs);
    await command(server, { type: 'pause', value: true });
    await delay(180);
    const paused = (await request(server, '/api/state')).json.neural;
    await delay(250);
    assert.equal(paused.status, 'paused');
    assert.deepEqual((await request(server, '/api/state')).json.neural.frame, paused.frame);
    await command(server, { type: 'pause', value: false });
    assert.ok((await waitFrame(paused.frame.steps)).frame.steps > paused.frame.steps);
  });
});

test('runtime accounts for elapsed time as simulated steps, bounded debt or explicit overload loss', async () => {
  await withFixture(async fixture => {
    const server = await fixture.start();
    const first = (await request(server, '/api/state')).json;
    await delay(700);
    const next = (await request(server, '/api/state')).json;
    const before=first.server.timing,after=next.server.timing;
    // Compare the same server pump interval. Client response latency is not
    // part of the sampled simulation interval, especially under CPU load.
    const elapsed=after.activeElapsedSeconds-before.activeElapsedSeconds;
    const accounted=next.simSeconds-first.simSeconds+after.pendingSeconds-before.pendingSeconds+after.droppedSeconds-before.droppedSeconds;
    assert.ok(next.simSeconds>first.simSeconds);assert.ok(after.pendingSeconds<=.25);assert.ok(after.droppedSeconds>=before.droppedSeconds);
    assert.ok(elapsed>0);assert.ok(Math.abs(accounted-elapsed)<.021,`accounted=${accounted}, active elapsed=${elapsed}`);
  });
});

test('commands enforce local Host, trusted Origin, and JSON requests', async () => {
  await withFixture(async fixture => {
    const server = await fixture.start();
    assert.equal((await request(server, '/api/state', { headers: { Host: 'foreign.invalid' } })).status, 403);
    const body = JSON.stringify({ type: 'pause', value: true });
    assert.equal((await request(server, '/api/command', { method: 'POST', body,
      headers: { 'Content-Type': 'application/json' } })).status, 403);
    for (const origin of ['https://foreign.invalid', 'null', `http://127.0.0.1:${server.port + 1}`]) {
      assert.equal((await command(server, { type: 'pause', value: true }, { Origin: origin })).status, 403);
    }
    assert.equal((await command(server, { type: 'pause', value: true }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request(server, '/api/state')).json.paused, false);
    assert.equal((await command(server, { type: 'pause', value: true })).status, 200);
    assert.equal((await command(server, { type: 'speed', value: 3 },
      { Host: `localhost:${server.port}`, Origin: `http://localhost:${server.port}` })).status, 200);
  });
});

test('multiple viewers share pause and speed; committed state survives a server restart', async () => {
  await withFixture(async fixture => {
    const server = await fixture.start();
    assert.equal((await command(server, { type: 'speed', value: 10 })).status, 200);
    const before = (await request(server, '/api/state')).json;
    await delay(250);
    const after = (await request(server, '/api/state')).json;
    assert.ok(after.simSeconds > before.simSeconds, 'Life advances while the server runs');
    assert.equal((await command(server, { type: 'pause', value: true })).status, 200);
    const firstViewer = (await request(server, '/api/state')).json;
    await delay(250);
    const secondViewer = (await request(server, '/api/state')).json;
    assert.equal(secondViewer.simSeconds, firstViewer.simSeconds);
    assert.equal(secondViewer.speed, 10);
    assert.equal(secondViewer.paused, true);
    assert.deepEqual(secondViewer.actor, firstViewer.actor);
    const committed = JSON.parse(await readFile(fixture.savePath, 'utf8'));
    assert.equal(committed.speed, 10);
    assert.equal(committed.paused, true);
    await stop(server);
    const restarted = await fixture.start();
    const restored = (await request(restarted, '/api/state')).json;
    assert.equal(restored.speed, 10);
    assert.equal(restored.paused, true);
    assert.equal(restored.simSeconds, firstViewer.simSeconds);
    assert.deepEqual(restored.actor, firstViewer.actor);
    assert.deepEqual(restored.history, firstViewer.history);
  });
});

test('invalid commands do not mutate state and interaction cooldowns apply to every viewer', async () => {
  await withFixture(async fixture => {
    const server = await fixture.start();
    await command(server, { type: 'pause', value: true });
    const baseline = (await request(server, '/api/state')).json;
    const invalid = [null, [], 'pause', {}, { type: 'missing' }, { type: 'speed', value: 2 },
      { type: 'speed', value: '10' }, { type: 'pause', value: 1 }, { type: 'pause' }];
    for (const value of invalid) assert.equal((await command(server, value)).status, 400);
    assert.equal((await request(server, '/api/command', { method: 'POST', body: '{broken',
      headers: { Origin: `http://127.0.0.1:${server.port}`, 'Content-Type': 'application/json' } })).status, 400);
    const unchanged = (await request(server, '/api/state')).json;
    for (const key of ['speed', 'paused', 'simSeconds', 'actor', 'needs', 'stats', 'history']) {
      assert.deepEqual(unchanged[key], baseline[key]);
    }
    assert.equal((await command(server, { type: 'feed' })).status, 200);
    assert.equal((await command(server, { type: 'feed' })).status, 429);
    assert.equal((await request(server, '/api/state')).json.stats.interactions, 1);
  });
});

test('static routes reject traversal and do not return files outside their permitted roots', async () => {
  await withFixture(async fixture => {
    const marker = 'PRIVATE_TEST_MARKER_NOT_FOR_STATIC_SERVING';
    const markerPath = path.join(fixture.tempRoot, 'private-marker.txt');
    await writeFile(markerPath, marker, 'utf8');
    const server = await fixture.start();
    const paths = ['/server.mjs', '/%2e%2e%5cserver.mjs', '/vendor/three/%2e%2e%5c%2e%2e%5cserver.mjs',
      '/%2e%2e%2fserver.mjs', `/${encodeURIComponent(markerPath)}`, '/%ZZ'];
    for (const pathname of paths) {
      const response = await request(server, pathname);
      assert.ok([400, 403, 404].includes(response.status), 'Outside-root requests must be rejected');
      assert.equal(response.text.includes(marker), false);
      assert.equal(response.text.includes("import http from 'node:http'"), false);
    }
    const script = await request(server, '/world-spec.mjs');
    assert.equal(script.status, 200);
    assert.match(script.headers['content-type'], /^text\/javascript/);
    const head = await request(server, '/world-spec.mjs', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
  });
});

test('bad saved files stop startup and remain byte-for-byte intact', async t => {
  const incompatible = new LifeSimulation().serialize();
  incompatible.version = '999.0.0';
  const cases = [
    ['invalid JSON', '{ definitely not JSON'],
    ['invalid structure', JSON.stringify({ schemaVersion: 1 })],
    ['incompatible version', JSON.stringify(incompatible)],
    ['JSON null is an invalid save', 'null']
  ];
  for (const [name, content] of cases) {
    await t.test(name, async () => {
      await withFixture(async fixture => {
        await writeFile(fixture.savePath, content, 'utf8');
        const server = await fixture.start({ waitForReady: false });
        const outcome = await Promise.race([server.exited, delay(10000, null, {ref:false})]);
        const after = await readFile(fixture.savePath, 'utf8');
        assert.equal(after === content, true, 'Invalid saved data must never be overwritten during startup');
        assert.ok(outcome && Number.isInteger(outcome.code) && outcome.code > 0, 'Invalid saved data must prevent server startup: '+server.output());
      });
    });
  }
});


test('production resets accelerated saves and rejects non-realtime clocks',async()=>{
 await withFixture(async fixture=>{
  const sim=new EmbodiedLife();sim.setSpeed(10);sim.environmentCommand('daytime','night');
  await writeFile(fixture.savePath,JSON.stringify(sim.serialize()));
  const server=await fixture.start({testing:false});
  const state=(await request(server,'/api/state')).json;
  assert.equal(state.speed,1);assert.equal(state.living.clock.mode,'local');assert.equal(state.server.timezone,'Asia/Shanghai');assert.equal(state.server.testing,false);
  assert.equal((await command(server,{type:'speed',value:3})).status,403);
  assert.equal((await command(server,{type:'daytime',value:'cycle'})).status,403);
  assert.equal((await command(server,{type:'daytime',value:'night'})).status,403);
 });
});

test('paused streaming keeps clock updates and command feedback without repeated idle saves', async () => {
  await withFixture(async fixture => {
    const sim = new EmbodiedLife();
    sim.setPaused(true);
    // A cooldown must finish and be persisted even while the body is paused.
    sim.state.cooldowns.feed = sim.state.realSeconds + .25;
    await writeFile(fixture.savePath, JSON.stringify(sim.serialize()));
    const server = await fixture.start();
    const initial = (await request(server, '/api/state')).json;
    const frames = [];
    let buffer = '', streamResponse;
    const stream = http.get({ hostname: '127.0.0.1', port: server.port, path: '/api/stream', agent: false }, response => {
      streamResponse = response;
      response.setEncoding('utf8');
      response.on('data', chunk => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = message.split('\n').find(line => line.startsWith('data: '));
          if (data) frames.push(JSON.parse(data.slice(6)));
        }
      });
    });
    async function waitFor(predicate, label) {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (predicate()) return;
        await delay(25);
      }
      assert.fail(label);
    }
    try {
      await waitFor(() => frames.length > 0, 'SSE sends its initial state immediately');
      assert.equal(frames[0].paused, true);
      await delay(5300);
      assert.ok(frames.length >= 4 && frames.length <= 8, `Paused viewers need a 1 Hz heartbeat, got ${frames.length} frames`);
      assert.equal(frames.at(-1).cooldowns.feed, 0);
      const completed = (await request(server, '/api/state')).json;
      const saved = JSON.parse(await readFile(fixture.savePath, 'utf8'));
      assert.ok(saved.realSeconds >= saved.cooldowns.feed, 'Elapsed cooldown is committed before idle saving stops');
      assert.notEqual(completed.server.lastSavedAt, initial.server.lastSavedAt);
      const idleSave = await readFile(fixture.savePath, 'utf8');
      await delay(5200);
      assert.equal(await readFile(fixture.savePath, 'utf8'), idleSave, 'Unchanged paused life must not rewrite a full neural save');

      assert.equal((await command(server, { type: 'pause', value: false })).status, 200);
      await waitFor(() => frames.at(-1)?.paused === false, 'Resume reaches existing SSE viewers');
      const resumedTime = frames.at(-1).simSeconds;
      await waitFor(() => frames.at(-1)?.simSeconds > resumedTime, 'Resume returns to live body updates');
      assert.equal((await command(server, { type: 'pause', value: true })).status, 200);
      await waitFor(() => frames.at(-1)?.paused === true, 'Pause reaches existing SSE viewers');
    } finally {
      streamResponse?.destroy();
      stream.destroy();
    }
  });
});
