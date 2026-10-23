import { createHash, randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_CHALLENGES = 4096;
const MAX_SESSIONS = 4096;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/;
const LOGIN_STATEMENT = 'Login only. No transaction or token approval. Current assets and points are off-chain.';

export class WalletAuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'WalletAuthError';
    this.statusCode = statusCode;
  }
}

function requireInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WalletAuthError(400, '登录参数格式无效，请重新连接钱包。');
  }
  return value;
}

function normalizeAddress(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new WalletAuthError(400, '钱包地址格式无效，请重新连接钱包。');
  }
  try { return getAddress(value); }
  catch { throw new WalletAuthError(400, '钱包地址校验失败，请重新连接钱包。'); }
}

function normalizeChainId(value) {
  let chainId;
  if (typeof value === 'number') chainId = value;
  else if (typeof value === 'string' && value.length <= 18 && (
    /^[1-9][0-9]*$/.test(value) || /^0x[1-9a-fA-F][0-9a-fA-F]*$/.test(value)
  )) chainId = Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new WalletAuthError(400, '钱包网络编号无效，请重新读取当前网络。');
  }
  return chainId;
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[^\x21-\x7e]/.test(value)) {
    throw new WalletAuthError(400, '登录来源无效，请从当前页面重新连接。');
  }
  let url;
  try { url = new URL(value); }
  catch { throw new WalletAuthError(400, '登录来源无效，请从当前页面重新连接。'); }
  // A browser Origin is canonical and contains no path, credentials or suffix.
  // The HTTP layer additionally owns the trusted same-origin allowlist.
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) {
    throw new WalletAuthError(400, '登录来源无效，请从当前页面重新连接。');
  }
  return url.origin;
}

function randomToken() { return randomBytes(32).toString('hex'); }
function tokenHash(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  return createHash('sha256').update(token, 'ascii').digest('hex');
}

/**
 * Server-generated ERC-4361 messages verified with the EOA ERC-191 method.
 * No RPC, transaction, token approval or ERC-1271 contract-wallet verification.
 * All expiry values returned by this class are Unix milliseconds.
 * Raw challenge/session bearer tokens are never retained in the server maps.
 */
export class WalletAuth {
  #now;
  #challenges = new Map();
  #sessions = new Map();
  #closed = false;

  constructor({ now = () => Date.now() } = {}) {
    if (typeof now !== 'function') throw new TypeError('登录时钟必须是函数。');
    this.#now = now;
  }

  #time() {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0 || now > 8.64e15 - SESSION_LIFETIME_MS) {
      throw new WalletAuthError(503, '登录服务时间异常，请稍后重试。');
    }
    return now;
  }

  #assertOpen() {
    if (this.#closed) throw new WalletAuthError(503, '登录服务已关闭，请稍后重试。');
  }

  #prune(now) {
    for (const store of [this.#challenges, this.#sessions]) {
      for (const [key, value] of store) if (value.expiresAt <= now) store.delete(key);
    }
  }

  issue(input) {
    this.#assertOpen();
    const { address: rawAddress, chainId: rawChainId, origin: rawOrigin } = requireInput(input);
    const address = normalizeAddress(rawAddress);
    const chainId = normalizeChainId(rawChainId);
    const origin = normalizeOrigin(rawOrigin);
    const now = this.#time();
    this.#prune(now);
    if (this.#challenges.size >= MAX_CHALLENGES) {
      throw new WalletAuthError(429, '当前登录请求较多，请稍后重试。');
    }

    const challengeId = randomToken();
    const nonce = randomToken();
    const expiresAt = now + CHALLENGE_LIFETIME_MS;
    const message = [
      `${origin} wants you to sign in with your Ethereum account:`,
      address,
      '',
      LOGIN_STATEMENT,
      '',
      `URI: ${origin}/wallet/login`,
      'Version: 1',
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    ].join('\n');
    this.#challenges.set(tokenHash(challengeId), { address, chainId, origin, message, issuedAt: now, expiresAt });
    return { challengeId, message, expiresAt };
  }

  verify(input) {
    this.#assertOpen();
    const { challengeId, signature, origin: rawOrigin } = requireInput(input);
    const now = this.#time();
    this.#prune(now);
    const challengeKey = tokenHash(challengeId);
    const challenge = challengeKey ? this.#challenges.get(challengeKey) : null;
    // Consume first, including invalid origins and malformed/incorrect signatures.
    // Verification is synchronous, so there is no await window for a replay race.
    if (challengeKey) this.#challenges.delete(challengeKey);
    if (!challenge || now < challenge.issuedAt) {
      throw new WalletAuthError(401, '登录请求已失效，请重新连接钱包。');
    }
    const origin = normalizeOrigin(rawOrigin);
    if (origin !== challenge.origin) {
      throw new WalletAuthError(401, '登录来源不匹配，请从当前页面重新连接。');
    }
    if (typeof signature !== 'string' || !SIGNATURE_PATTERN.test(signature)) {
      throw new WalletAuthError(400, '钱包签名格式无效，请重新发起登录。');
    }
    let signer;
    try { signer = getAddress(verifyMessage(challenge.message, signature)); }
    catch { throw new WalletAuthError(401, '钱包签名校验失败，请使用普通 EOA 钱包重新登录。'); }
    if (signer !== challenge.address) {
      throw new WalletAuthError(401, '签名钱包与登录地址不一致，请重新连接钱包。');
    }
    if (this.#sessions.size >= MAX_SESSIONS) {
      throw new WalletAuthError(429, '当前登录会话较多，请稍后重试。');
    }

    const sessionToken = randomToken();
    const expiresAt = now + SESSION_LIFETIME_MS;
    const record = { address: challenge.address, chainId: challenge.chainId, origin, issuedAt: now, expiresAt };
    this.#sessions.set(tokenHash(sessionToken), record);
    return { sessionToken, address: record.address, chainId: record.chainId, expiresAt };
  }

  session(sessionToken, rawOrigin) {
    if (this.#closed) return null;
    const now = this.#time();
    this.#prune(now);
    const key = tokenHash(sessionToken);
    if (!key) return null;
    let origin;
    try { origin = normalizeOrigin(rawOrigin); }
    catch { return null; }
    const session = this.#sessions.get(key);
    if (!session || session.origin !== origin || now < session.issuedAt) return null;
    return { address: session.address, chainId: session.chainId, expiresAt: session.expiresAt };
  }

  logout(sessionToken) {
    const key = tokenHash(sessionToken);
    return key ? this.#sessions.delete(key) : false;
  }

  close() {
    this.#challenges.clear();
    this.#sessions.clear();
    this.#closed = true;
  }
}
