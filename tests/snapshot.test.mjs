import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { GameStore } from '../src/game-store.mjs';
import { PROTOCOL_VERSION } from '../src/neural-research.mjs';

test('snapshot CLI exports committed reaction receipts without accruing points or promising conversion', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mirror-points-snapshot-'));
  const store = new GameStore(path.join(directory, 'game.sqlite'));
  try {
    const address = '0x3333333333333333333333333333333333333333';
    store.claim(address, randomUUID());
    const request = { requestId: randomUUID(), stimulus: 'mist', intensity: 0.5 };
    store.beginResearch(address, request);
    // A synthetic summary exercises export accounting; real model validation has a separate integration test.
    store.finishResearch(address, request, { baseline: 0, activation: 0.2, recovery: 0.01, computeSeconds: 2,
      modelFingerprint: 'b'.repeat(64), protocolVersion: PROTOCOL_VERSION });
    for (let i = 0; i < 50; i++) store.tick(0.1);
    store.flush({ force: false });
    const before = store.account(address);
    const process = spawnSync(globalThis.process.execPath, ['scripts/export-points.mjs'], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true,
      env: { ...globalThis.process.env, MIRROR_HOME_STATE_DIR: directory }, timeout: 5000
    });
    assert.equal(process.status, 0, process.stderr);
    const filename = readdirSync(directory).find(name => /^points-snapshot-.*\.json$/.test(name));
    assert.ok(filename);
    const { sha256, ...snapshot } = JSON.parse(readFileSync(path.join(directory, filename), 'utf8'));
    assert.equal(snapshot.conversionRatio, null);
    assert.equal(snapshot.wallets.length, 1);
    assert.equal(snapshot.wallets[0].balance, 5000);
    assert.equal(snapshot.wallets[0].earned, 5000);
    assert.equal(Object.hasOwn(snapshot.wallets[0], 'accrued'), false);
    assert.equal(snapshot.ledger.length, 1);
    assert.equal(snapshot.ledger[0].kind, 'reaction');
    assert.equal(snapshot.ledger[0].source_request_id, request.requestId);
    assert.equal(snapshot.receipts.length, 1);
    assert.equal(snapshot.receipts[0].pointsAwarded, 5);
    assert.equal(snapshot.receipts[0].requestId, request.requestId);
    assert.equal(snapshot.flies[0].owner, address);
    assert.equal(sha256, createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'));
    assert.deepEqual(store.account(address), before, 'An export must not mutate the running game');
  } finally {
    store.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    assert.ok(relative.startsWith('mirror-points-snapshot-') && !relative.includes(path.sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
