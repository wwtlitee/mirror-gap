import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Signature } from 'ethers';
import { WalletAuth, WalletAuthError } from '../src/wallet-auth.mjs';

// Ephemeral, memory-only signing keys; no RPC/provider and no real wallet keys.
const alice = Wallet.createRandom();
const bob = Wallet.createRandom();
const ORIGIN = 'http://127.0.0.1:4186';
const START = Date.parse('2026-09-19T00:00:00.000Z');

function fixture() {
  let now = START;
  const auth = new WalletAuth({ now: () => now });
  return { auth, advance: amount => { now += amount; } };
}

function challenge(auth, overrides = {}) {
  return auth.issue({ address: alice.address, chainId: 56, origin: ORIGIN, ...overrides });
}

async function signIn(auth, overrides = {}) {
  const issued = challenge(auth, overrides);
  const signature = await alice.signMessage(issued.message);
  return auth.verify({ challengeId: issued.challengeId, signature, origin: overrides.origin || ORIGIN });
}

function expectError(operation, statusCode) {
  assert.throws(operation, error => {
    assert.ok(error instanceof WalletAuthError);
    assert.equal(error.statusCode, statusCode);
    assert.match(error.message, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(error.message, /INVALID_ARGUMENT|stack|privateKey|0x[0-9a-f]{64}/i);
    return true;
  });
}

test('issues an origin-bound complete SIWE message with an independent 256-bit nonce', () => {
  const { auth } = fixture();
  const first = challenge(auth, { address: alice.address.toLowerCase(), chainId: '0x38' });
  const second = challenge(auth);
  assert.match(first.challengeId, /^[0-9a-f]{64}$/);
  assert.notEqual(first.challengeId, second.challengeId);
  const firstNonce = /^Nonce: ([0-9a-f]{64})$/m.exec(first.message)?.[1];
  const secondNonce = /^Nonce: ([0-9a-f]{64})$/m.exec(second.message)?.[1];
  assert.ok(firstNonce && secondNonce);
  assert.notEqual(firstNonce, first.challengeId);
  assert.notEqual(firstNonce, secondNonce);
  assert.equal(first.expiresAt, START + 300_000);
  assert.equal(first.message.split('\n')[0], `${ORIGIN} wants you to sign in with your Ethereum account:`);
  assert.equal(first.message.split('\n')[1], alice.address);
  assert.match(first.message, /\n\nLogin only\. No transaction or token approval\. Current assets and points are off-chain\.\n\n/);
  assert.match(first.message, /\nURI: http:\/\/127\.0\.0\.1:4186\/wallet\/login\nVersion: 1\nChain ID: 56\n/);
  assert.match(first.message, /\nIssued At: 2026-09-19T00:00:00\.000Z\nExpiration Time: 2026-09-19T00:05:00\.000Z$/);
  assert.doesNotMatch(first.message, /[^\x20-\x7e\n]/);
  assert.ok(!first.message.includes(first.challengeId), 'HttpOnly challenge bearer is not embedded into client-visible message');
  auth.close();
});

test('accepts a valid EOA signature and returns a 24-hour origin-isolated session', async () => {
  const { auth, advance } = fixture();
  advance(22_000);
  const result = await signIn(auth, { chainId: '11155111' });
  assert.match(result.sessionToken, /^[0-9a-f]{64}$/);
  assert.equal(result.address, alice.address);
  assert.equal(result.chainId, 11155111);
  assert.equal(result.expiresAt, START + 22_000 + 86_400_000);
  assert.deepEqual(auth.session(result.sessionToken, ORIGIN), {
    address: alice.address, chainId: 11155111, expiresAt: result.expiresAt,
  });
  assert.equal(auth.session(result.sessionToken, 'http://localhost:4186'), null);
  assert.equal(auth.session(result.sessionToken, 'https://127.0.0.1:4186'), null);
  assert.equal(auth.session(result.sessionToken, 'http://127.0.0.1:4187'), null);
  assert.equal(auth.session(result.sessionToken, `${ORIGIN}/`), null);
  const publicSession = auth.session(result.sessionToken, ORIGIN);
  publicSession.address = bob.address;
  assert.equal(auth.session(result.sessionToken, ORIGIN).address, alice.address);
  auth.close();
});

test('a consumed challenge cannot replay even with the same valid signature', async () => {
  const { auth } = fixture();
  const issued = challenge(auth);
  const signature = await alice.signMessage(issued.message);
  auth.verify({ challengeId: issued.challengeId, signature, origin: ORIGIN });
  expectError(() => auth.verify({ challengeId: issued.challengeId, signature, origin: ORIGIN }), 401);
  auth.close();
});

test('wrong signer fails and consumes the challenge before retry', async () => {
  const { auth } = fixture();
  const issued = challenge(auth);
  const wrong = await bob.signMessage(issued.message);
  const correct = await alice.signMessage(issued.message);
  expectError(() => auth.verify({ challengeId: issued.challengeId, signature: wrong, origin: ORIGIN }), 401);
  expectError(() => auth.verify({ challengeId: issued.challengeId, signature: correct, origin: ORIGIN }), 401);
  auth.close();
});

test('wrong origin and malformed origin both consume the challenge', async () => {
  const { auth } = fixture();
  for (const [origin, status] of [['https://unrelated.example', 401], [`${ORIGIN}\nNonce: injected`, 400]]) {
    const issued = challenge(auth);
    const signature = await alice.signMessage(issued.message);
    expectError(() => auth.verify({ challengeId: issued.challengeId, signature, origin }), status);
    expectError(() => auth.verify({ challengeId: issued.challengeId, signature, origin: ORIGIN }), 401);
  }
  auth.close();
});

test('rejects message tampering in address, chain, nonce, URI and expiration', async () => {
  const { auth } = fixture();
  const mutations = [
    message => message.replace(alice.address, bob.address),
    message => message.replace('Chain ID: 56', 'Chain ID: 1'),
    message => message.replace(/Nonce: [0-9a-f]{64}/, `Nonce: ${'0'.repeat(64)}`),
    message => message.replace(`URI: ${ORIGIN}/wallet/login`, 'URI: https://unrelated.example/wallet/login'),
    message => message.replace('Expiration Time: 2026-09-19', 'Expiration Time: 2027-09-19'),
  ];
  for (const mutate of mutations) {
    const issued = challenge(auth);
    const signature = await alice.signMessage(mutate(issued.message));
    expectError(() => auth.verify({ challengeId: issued.challengeId, signature, origin: ORIGIN }), 401);
  }
  auth.close();
});

test('rejects malformed signatures safely and accepts EOA compact signatures', async () => {
  const { auth } = fixture();
  for (const signature of [undefined, {}, '0x12', `0x${'00'.repeat(65)}`, 'x'.repeat(5000)]) {
    const issued = challenge(auth);
    const expectedStatus = signature === `0x${'00'.repeat(65)}` ? 401 : 400;
    expectError(() => auth.verify({ challengeId: issued.challengeId, signature, origin: ORIGIN }), expectedStatus);
    const correct = await alice.signMessage(issued.message);
    expectError(() => auth.verify({ challengeId: issued.challengeId, signature: correct, origin: ORIGIN }), 401);
  }
  const issued = challenge(auth);
  const compact = Signature.from(await alice.signMessage(issued.message)).compactSerialized;
  assert.equal(auth.verify({ challengeId: issued.challengeId, signature: compact, origin: ORIGIN }).address, alice.address);
  auth.close();
});

test('challenge and session expiration reject at the exact expiry boundary', async () => {
  const { auth, advance } = fixture();
  const issued = challenge(auth);
  const signature = await alice.signMessage(issued.message);
  advance(300_000);
  expectError(() => auth.verify({ challengeId: issued.challengeId, signature, origin: ORIGIN }), 401);
  const result = await signIn(auth);
  advance(86_400_000 - 1);
  assert.ok(auth.session(result.sessionToken, ORIGIN));
  advance(1);
  assert.equal(auth.session(result.sessionToken, ORIGIN), null);
  auth.close();
});

test('logout removes only the selected session and close clears all state', async () => {
  const { auth } = fixture();
  const first = await signIn(auth);
  const second = await signIn(auth);
  assert.notEqual(first.sessionToken, second.sessionToken);
  assert.equal(auth.logout(first.sessionToken), true);
  assert.equal(auth.logout(first.sessionToken), false);
  assert.equal(auth.session(first.sessionToken, ORIGIN), null);
  assert.ok(auth.session(second.sessionToken, ORIGIN));
  auth.close();
  assert.equal(auth.session(second.sessionToken, ORIGIN), null);
  expectError(() => challenge(auth), 503);
  auth.close();
});

test('invalid address, chain ID and origin formats cannot issue challenges', () => {
  const { auth } = fixture();
  for (const address of [null, 1, 'alice.eth', '0x123', ` ${alice.address}`, '0x52908400098527886e0F7030069857D2E4169EE7']) {
    expectError(() => challenge(auth, { address }), 400);
  }
  for (const chainId of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', '00', '01', '0x0', '0x01', '0X38', '1e3', '1.0', ' 56', '56\n', '0x20000000000000', null, {}, []]) {
    expectError(() => challenge(auth, { chainId }), 400);
  }
  for (const origin of [null, '', 'null', 'file:///tmp', `${ORIGIN}/`, `${ORIGIN}/path`, `${ORIGIN}?query`, `${ORIGIN}#hash`, 'http://alice:secret@127.0.0.1:4186', `${ORIGIN}\r\nextra`]) {
    expectError(() => challenge(auth, { origin }), 400);
  }
  for (const input of [null, undefined, [], 123]) expectError(() => auth.issue(input), 400);
  assert.match(challenge(auth, { chainId: Number.MAX_SAFE_INTEGER }).message, /Chain ID: 9007199254740991/);
  auth.close();
});

test('malformed bearer tokens are rejected without coercion or exposure', () => {
  const { auth } = fixture();
  for (const token of [null, undefined, {}, [], '', 'a'.repeat(63), 'b'.repeat(65), 'x'.repeat(10000)]) {
    assert.equal(auth.session(token, ORIGIN), null);
    assert.equal(auth.logout(token), false);
    expectError(() => auth.verify({ challengeId: token, signature: '0x12', origin: ORIGIN }), 401);
  }
  auth.close();
});

test('the challenge map is bounded and expired entries release capacity', () => {
  const { auth, advance } = fixture();
  for (let index = 0; index < 4096; index++) challenge(auth);
  expectError(() => challenge(auth), 429);
  advance(300_000);
  assert.match(challenge(auth).challengeId, /^[0-9a-f]{64}$/);
  auth.close();
});
