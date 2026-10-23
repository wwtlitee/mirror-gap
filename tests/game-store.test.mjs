import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GAME_RULES, GameStore } from '../src/game-store.mjs';
import { PROTOCOL_VERSION } from '../src/neural-research.mjs';

const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
// Deliberately synthetic neural summaries for ledger tests, not measured model output.
const syntheticResult = (overrides = {}) => ({ baseline: 0, activation: 1, recovery: 0.01,
  computeSeconds: 2, modelFingerprint: 'a'.repeat(64), protocolVersion: PROTOCOL_VERSION, ...overrides });
const input = (overrides = {}) => ({ requestId: randomUUID(), stimulus: 'feed', intensity: 0.5, ...overrides });

function fixture(work, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'mirror-game-ledger-'));
  const filename = path.join(directory, 'game.sqlite');
  let store = new GameStore(filename, options);
  try { return work({ get store() { return store; }, filename,
    restart() { store.close(); store = new GameStore(filename, options); },
    reopenCheckpoint() { store.db.close(); store = new GameStore(filename, options); } }); }
  finally {
    store.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    assert.ok(relative.startsWith('mirror-game-ledger-') && !relative.includes(path.sep));
    rmSync(directory, { recursive: true, force: true });
  }
}
function advance(store, seconds) { for (let i = 0; i < seconds; i++) store.tick(1); }
function research(store, address = alice, result = syntheticResult(), request = input()) {
  store.beginResearch(address, request);
  return store.finishResearch(address, request, result);
}
const ledger = store => store.db.prepare('SELECT * FROM ledger ORDER BY id').all();

test('one free fly per wallet is independent, idempotent and persists with its room', () => fixture(context => {
  const { store } = context;
  const id = store.claim(alice, randomUUID());
  assert.equal(store.claim(alice, randomUUID()), id);
  assert.notEqual(store.claim(bob, randomUUID()), id);
  const before = store.snapshot(bob);
  store.interact(alice, 'feed');
  assert.deepEqual(store.snapshot(bob), before);
  assert.equal(store.snapshot(alice).stats.interactions, 1);
  assert.equal(store.account(alice).points.balance, 0, 'A room interaction without a neural result earns nothing');
  const saved = store.snapshot(alice);
  context.restart();
  assert.deepEqual(context.store.snapshot(alice), saved);
  assert.equal(context.store.account(alice).fly.id, id);
}));

test('unattended life, checkpoints, exports and wall-clock changes never create points', () => {
  let now = 1_800_000_000_000;
  fixture(context => {
    context.store.claim(alice, randomUUID());
    const first = context.store.account(alice).points;
    for (let second = 0; second < 600; second++) {
      context.store.tick(1);
      if (second % 5 === 0) context.store.flush({ force: false });
    }
    assert.ok(context.store.snapshot(alice).simSeconds >= 599);
    for (const value of ['pause', 'speed', 'reset']) assert.throws(() => context.store.interact(alice, value));
    assert.equal(context.store.snapshot(alice).speed, 1);
    assert.equal(context.store.snapshot(alice).paused, false);
    context.store.flush(); context.store.flush();
    const simulation = context.store.snapshot(alice);
    now += 7 * 86400_000;
    context.restart();
    assert.deepEqual(context.store.snapshot(alice), simulation, 'Stopped server time must not be replayed');
    assert.deepEqual(context.store.account(alice).points, first);
    assert.equal(Object.hasOwn(first, 'pending'), false);
    assert.equal(Object.hasOwn(first, 'settled'), false);
    const snapshot = context.store.exportSnapshot();
    assert.equal(snapshot.wallets[0].balance, 0);
    assert.equal(snapshot.ledger.length, 0);
    assert.equal(snapshot.conversionRatio, null);
    assert.equal(Object.hasOwn(snapshot.wallets[0], 'accrued'), false);
    assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  }, { now: () => now });
});

test('only positive response above baseline earns points and stronger responses do not earn less', () => fixture(({ store }) => {
  store.claim(alice, randomUUID()); store.claim(bob, randomUUID());
  let previous = 0;
  for (const [activation, expected] of [[0.125, 0], [0.25, 0], [0.5, 5.555], [1.25, 8.333]]) {
    const request = input();
    const result = syntheticResult({ baseline: 0.25, activation });
    const receipt = research(store, alice, result, request);
    assert.equal(receipt.pointsAwarded, expected);
    assert.ok(receipt.pointsAwarded >= previous && receipt.pointsAwarded <= GAME_RULES.maxResponsePoints);
    assert.equal(receipt.requestId, request.requestId);
    assert.equal(receipt.netActivation, Math.max(0, activation - 0.25));
    assert.equal(receipt.responseMultiplier, 1);
    assert.equal(receipt.ruleVersion, GAME_RULES.version);
    assert.equal(receipt.modelFingerprint, result.modelFingerprint);
    assert.equal(receipt.protocolVersion, PROTOCOL_VERSION);
    assert.equal(store.account(alice).research.latest.pointsAwarded, expected);
    previous = receipt.pointsAwarded;
    advance(store, GAME_RULES.researchCooldown);
  }
  assert.equal(store.account(bob).points.balance, 0);
  assert.equal(store.account(bob).research.latest, null);
  assert.equal(ledger(store).length, 4, 'Zero-point reactions also receive a replay-protected ledger receipt');
  assert.equal(ledger(store)[0].delta, 0);
  const account = store.account(alice);
  assert.equal(account.points.balance, 13.888);
  assert.equal(account.points.earned, 13.888);
  assert.equal(account.production.responseMultiplier, 1);
  assert.equal(account.production.maxPointsPerExperiment, 10);
  for (const key of ['ratePerMinute', 'boostMultiplier', 'boostRemaining']) assert.equal(Object.hasOwn(account.production, key), false);
}));

test('pending, replayed, changed-payload and duplicate-source experiments cannot double credit', () => fixture(({ store }) => {
  store.claim(alice, randomUUID());
  const request = input();
  assert.ok(store.beginResearch(alice, request).seed > 0);
  assert.throws(() => store.beginResearch(alice, request), /正在/);
  assert.throws(() => store.finishResearch(alice, { ...request, intensity: 1 }, syntheticResult()), /其他请求/);
  store.finishResearch(alice, request, syntheticResult());
  const before = store.account(alice);
  assert.deepEqual(store.beginResearch(alice, request), { replay: true });
  assert.throws(() => store.finishResearch(alice, request, syntheticResult()), /可结算/);
  assert.throws(() => store.beginResearch(alice, { ...request, stimulus: 'mist' }), /其他请求/);
  assert.throws(() => store.beginResearch(alice, input()), /秒/);
  assert.deepEqual(store.account(alice), before);
  assert.throws(() => store.db.exec(`INSERT INTO ledger(wallet,fly_id,kind,delta,balance,at,rule_version,season,source_request_id)
    SELECT wallet,fly_id,kind,delta,balance,at,rule_version,season,source_request_id FROM ledger LIMIT 1`), /UNIQUE/);
  assert.equal(ledger(store).length, 1);
  assert.equal(ledger(store)[0].source_request_id, request.requestId);
}));

test('invalid neural summaries fail closed without points, receipts or room effects', () => fixture(({ store }) => {
  store.claim(alice, randomUUID());
  const request = input();
  store.beginResearch(alice, request);
  const account = store.account(alice), simulation = store.snapshot(alice);
  const invalid = [null, {}, syntheticResult({ baseline: undefined }), syntheticResult({ baseline: NaN }),
    syntheticResult({ baseline: -1 }), syntheticResult({ activation: Infinity }), syntheticResult({ activation: 1000 }),
    syntheticResult({ recovery: '0.1' }), syntheticResult({ computeSeconds: 0 }), syntheticResult({ computeSeconds: Infinity }),
    syntheticResult({ modelFingerprint: 'unverified-fixture' }), syntheticResult({ protocolVersion: 'unknown' })];
  for (const result of invalid) assert.throws(() => store.finishResearch(alice, request, result), /结果无效/);
  assert.deepEqual(store.account(alice), account);
  assert.deepEqual(store.snapshot(alice), simulation);
  assert.equal(ledger(store).length, 0);
  store.failResearch(alice, request.requestId);
  assert.throws(() => store.finishResearch(alice, request, syntheticResult()), /可结算/);
  assert.throws(() => store.beginResearch(alice, request), /中断/);
}));

for (const [stage, trigger] of [
  ['ledger insert', "BEFORE INSERT ON ledger WHEN NEW.kind='reaction'"],
  ['operation completion', "BEFORE UPDATE ON operations WHEN NEW.status='done'"],
  ['room receipt persistence', 'BEFORE UPDATE ON flies'],
  ['permanent receipt insert', 'BEFORE INSERT ON reactions']
]) {
  test(`reaction settlement rolls back points, receipts and room effects on ${stage} failure`, () => fixture(({ store }) => {
    store.claim(alice, randomUUID());
    const request = input();
    store.beginResearch(alice, request);
    const account = store.account(alice), simulation = store.snapshot(alice);
    store.db.exec(`CREATE TRIGGER fail_reaction ${trigger} BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;`);
    assert.throws(() => store.finishResearch(alice, request, syntheticResult()), /simulated disk failure/);
    assert.deepEqual(store.account(alice), account);
    assert.deepEqual(store.snapshot(alice), simulation);
    assert.equal(ledger(store).length, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM reactions').get().count, 0);
    assert.equal(store.db.prepare('SELECT status FROM operations WHERE request_id=?').get(request.requestId).status, 'pending');
    store.db.exec('DROP TRIGGER fail_reaction');
    store.finishResearch(alice, request, syntheticResult());
    assert.equal(ledger(store).length, 1);
    assert.equal(store.snapshot(alice).stats.interactions, simulation.stats.interactions + 1);
  }));
}

test('earned reaction points fund an atomic, idempotent upgrade without creating passive income', () => fixture(({ store }) => {
  store.claim(alice, randomUUID());
  assert.throws(() => store.upgrade(alice, randomUUID()), /积分不足/);
  for (let i = 0; i < 3; i++) { research(store); advance(store, 20); }
  const before = store.account(alice);
  assert.equal(before.points.balance, 24.999);
  const id = randomUUID();
  store.upgrade(alice, id);
  const after = store.account(alice);
  assert.equal(after.fly.level, 2);
  assert.equal(after.points.balance, 4.999);
  assert.equal(after.points.spent, 20);
  assert.equal(after.production.responseMultiplier, 1.25);
  assert.equal(after.production.maxPointsPerExperiment, 12.5);
  store.upgrade(alice, id);
  assert.deepEqual(store.account(alice).points, after.points);
  advance(store, 180); store.flush();
  assert.deepEqual(store.account(alice).points, after.points);
  assert.throws(() => store.upgrade(alice, '../bad'), /编号无效/);
  const receipt = research(store);
  assert.equal(receipt.responseMultiplier, 1.25);
  assert.equal(receipt.pointsAwarded, 10.416);
  assert.ok(receipt.pointsAwarded <= 12.5);
  assert.equal(ledger(store).find(row => row.kind === 'upgrade').source_request_id, id);
}));

test('a failed upgrade preserves both earned balance and fly attributes', () => fixture(({ store }) => {
  store.claim(alice, randomUUID());
  for (let i = 0; i < 3; i++) { research(store); advance(store, 20); }
  const before = store.account(alice);
  store.db.exec("CREATE TRIGGER fail_spend BEFORE INSERT ON ledger WHEN NEW.kind='upgrade' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;");
  assert.throws(() => store.upgrade(alice, randomUUID()), /simulated disk failure/);
  assert.deepEqual(store.account(alice), before);
}));

test('committed reaction points and history survive an unclean stop while pending work becomes interrupted', () => fixture(context => {
  context.store.claim(alice, randomUUID());
  const receipt = research(context.store);
  const before = context.store.account(alice);
  context.reopenCheckpoint();
  assert.deepEqual(context.store.account(alice), before);
  assert.equal(context.store.account(alice).research.latest.requestId, receipt.requestId);
  advance(context.store, 20);
  const pending = input({ stimulus: 'mist' });
  context.store.beginResearch(alice, pending);
  context.reopenCheckpoint();
  assert.throws(() => context.store.beginResearch(alice, pending), /中断/);
  assert.deepEqual(context.store.account(alice).points, before.points);
  assert.deepEqual(context.store.account(alice).research.history, before.research.history);
  assert.equal(ledger(context.store).length, 1);
}));

test('schema-one migration preserves historical collect rows and discards obsolete automatic production metadata', () => fixture(context => {
  const { store } = context;
  const flyId = store.claim(alice, randomUUID());
  store.flush();
  store.db.exec('DROP INDEX ledger_wallet_request; ALTER TABLE ledger DROP COLUMN source_request_id; PRAGMA user_version=1;');
  store.db.prepare('UPDATE wallets SET balance=3000,earned=3000 WHERE address=?').run(alice);
  store.db.prepare("INSERT INTO ledger(wallet,fly_id,kind,delta,balance,at,rule_version,season) VALUES(?,?,'collect',3000,3000,'2026-09-19T00:00:00.000Z','alpha-1','local-alpha-1')").run(alice, flyId);
  const meta = { ...store.requireRoom(alice).meta, boostMultiplier: 1.4, boostRemaining: 120,
    accrual: { milli: 750, fraction: 0.5, seconds: 5 } };
  store.db.prepare('UPDATE flies SET meta=? WHERE id=?').run(JSON.stringify(meta), flyId);
  const historical = ledger(store);
  context.reopenCheckpoint();
  assert.equal(context.store.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.deepEqual(ledger(context.store).map(({ source_request_id, ...row }) => row), historical.map(row => ({ ...row })));
  assert.equal(ledger(context.store)[0].source_request_id, null);
  assert.equal(context.store.account(alice).points.balance, 3);
  const restoredMeta = JSON.parse(context.store.db.prepare('SELECT meta FROM flies WHERE id=?').get(flyId).meta);
  for (const key of ['accrual', 'boostMultiplier', 'boostRemaining']) assert.equal(Object.hasOwn(restoredMeta, key), false);
  advance(context.store, 120); context.store.flush({ force: true });
  assert.equal(context.store.account(alice).points.balance, 3);
  assert.equal(ledger(context.store).length, 1);
}));

test('all permanent reaction receipts remain auditable after the eight-item UI history rolls over', () => fixture(context => {
  context.store.claim(alice, randomUUID());
  const receipts = [];
  for (let i = 0; i < 10; i++) {
    receipts.push(research(context.store));
    advance(context.store, 20);
  }
  assert.equal(context.store.account(alice).research.history.length, 8);
  assert.equal(context.store.account(alice).research.history.some(row => row.requestId === receipts[0].requestId), false);
  context.restart();
  const snapshot = context.store.exportSnapshot();
  assert.equal(snapshot.receipts.length, 10);
  const first = snapshot.receipts.find(row => row.requestId === receipts[0].requestId);
  assert.deepEqual(first, { wallet: alice, ...receipts[0] });
  assert.equal(first.seed, context.store.requireRoom(alice).seed);
  assert.equal(first.flyId, context.store.account(alice).fly.id);
  for (const receipt of snapshot.receipts) {
    const entry = snapshot.ledger.find(row => row.wallet === receipt.wallet && row.source_request_id === receipt.requestId);
    assert.equal(entry.delta, Math.round(receipt.pointsAwarded * 1000));
    assert.equal(entry.rule_version, receipt.ruleVersion);
  }
  assert.equal(snapshot.ledger.reduce((sum, row) => sum + row.delta, 0), snapshot.wallets[0].balance);
}));
