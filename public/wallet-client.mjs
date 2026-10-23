const ADDRESS = /^0x[\da-f]{40}$/i;

function chainNumber(value) {
  const chain = typeof value === 'string' && /^0x[\da-f]+$/i.test(value) ? Number.parseInt(value, 16) : Number(value);
  if (!Number.isSafeInteger(chain) || chain <= 0) throw new Error('钱包返回了无效的网络编号。');
  return chain;
}

function changedError() {
  return Object.assign(new Error('钱包账户或网络已改变，请重新登录。'), { code: 'WALLET_CHANGED' });
}

export function walletErrorMessage(error) {
  const code = error?.code ?? error?.cause?.code;
  if (code === 4001 || code === '4001') return '已取消钱包请求。需要时可以重新连接。';
  if (code === -32002 || code === '-32002') return '钱包中已有待处理请求，请先打开钱包查看。';
  if (code === 4900 || code === 4901) return '钱包暂时未连接，请检查钱包后再试。';
  return typeof error?.message === 'string' ? error.message : '钱包连接未完成，请重试。';
}

export function createWalletClient({ onProviders, onInvalidate, onReadiness } = {}) {
  const providers = new Map();
  let revision = 0;
  let active = null;
  let identity = null;
  let restoredIdentity = null;
  let discoveringSession = false;
  let disposed = false;
  let removeListeners = () => {};

  function readiness(ready) { if (typeof onReadiness === 'function') onReadiness(ready); }

  function assertCurrent(token) {
    if (disposed || token !== revision) throw changedError();
  }
  function emitProviders() {
    if (typeof onProviders === 'function') onProviders(list());
    if (restoredIdentity && !active) void findSessionProvider();
  }
  function register(id, name, provider) {
    if (!provider || typeof provider.request !== 'function' || disposed) return;
    const existing = [...providers.values()].find(item => item.provider === provider);
    if (existing) {
      if (id !== 'legacy') existing.name = String(name || '浏览器钱包').slice(0, 60);
      return;
    }
    providers.set(id, { id, name: String(name || '浏览器钱包').slice(0, 60), provider });
  }
  function fallback() {
    if (providers.size || !window.ethereum) return;
    const provider = window.ethereum;
    register('legacy', provider.isRabby ? 'Rabby' : provider.isOkxWallet || provider.isOKExWallet
      ? 'OKX Wallet' : provider.isMetaMask ? 'MetaMask' : '浏览器钱包', provider);
  }
  function list() {
    fallback();
    return [...providers.values()].map(({ id, name }) => ({ id, name }));
  }
  function announce(event) {
    const detail = event.detail;
    if (!detail?.info || typeof detail.info.uuid !== 'string' || detail.info.uuid.length > 100) return;
    register(detail.info.uuid, detail.info.name, detail.provider);
    emitProviders();
  }
  function invalidate() {
    revision++;
    removeListeners(); removeListeners = () => {};
    active = null; identity = null; restoredIdentity = null;
    readiness(false);
    if (typeof onInvalidate === 'function') onInvalidate(changedError());
  }
  function observe(entry, expected) {
    removeListeners();
    active = entry; identity = expected;
    const accountChanged = accounts => {
      if (!Array.isArray(accounts) || !ADDRESS.test(accounts[0] || '')
        || accounts[0].toLowerCase() !== identity?.address.toLowerCase()) invalidate();
      else if (restoredIdentity) readiness(true);
    };
    const chainChanged = value => {
      try { if (chainNumber(value) !== identity?.chainId) invalidate(); }
      catch { invalidate(); }
    };
    if (typeof entry.provider.on === 'function') {
      entry.provider.on('accountsChanged', accountChanged);
      entry.provider.on('chainChanged', chainChanged);
      removeListeners = () => {
        entry.provider.removeListener?.('accountsChanged', accountChanged);
        entry.provider.removeListener?.('chainChanged', chainChanged);
      };
    } else removeListeners = () => {};
  }
  async function inspect(provider) {
    const accounts = await provider.request({ method: 'eth_accounts' });
    const chainId = chainNumber(await provider.request({ method: 'eth_chainId' }));
    return { address: Array.isArray(accounts) ? accounts[0] : undefined, chainId };
  }
  async function findSessionProvider() {
    if (discoveringSession || active || !restoredIdentity || disposed) return;
    discoveringSession = true;
    const token = revision;
    let connectedIdentityFound = false;
    try {
      fallback();
      for (const entry of providers.values()) {
        let current;
        try { current = await inspect(entry.provider); } catch { continue; }
        if (token !== revision || disposed || !restoredIdentity) return;
        connectedIdentityFound ||= ADDRESS.test(current.address || '');
        if (current.address?.toLowerCase() === restoredIdentity.address.toLowerCase()
          && current.chainId === restoredIdentity.chainId) {
          observe(entry, restoredIdentity); readiness(true); return;
        }
        if (providers.size === 1) {
          // Restore event listeners after a page refresh as well. An already
          // selected different account/network must not inherit the old room.
          observe(entry, restoredIdentity);
          if ((current.address && current.address.toLowerCase() !== restoredIdentity.address.toLowerCase())
            || current.chainId !== restoredIdentity.chainId) invalidate();
          return;
        }
      }
      if (connectedIdentityFound && token === revision && restoredIdentity) invalidate();
    } finally { discoveringSession = false; }
  }

  async function login(providerId, { challenge, verify, onStep } = {}) {
    const entry = providers.get(providerId);
    if (!entry) throw new Error('未找到所选钱包，请在装有钱包的浏览器中打开。');
    const token = ++revision;
    removeListeners(); active = null; identity = null; restoredIdentity = null;
    readiness(false);
    onStep?.('正在等待钱包连接…');
    const accounts = await entry.provider.request({ method: 'eth_requestAccounts' });
    assertCurrent(token);
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (!ADDRESS.test(address || '')) throw new Error('钱包没有提供可用的账户。');
    const chainId = chainNumber(await entry.provider.request({ method: 'eth_chainId' }));
    assertCurrent(token);
    observe(entry, { address, chainId });
    const prepared = await challenge({ address, chainId });
    assertCurrent(token);
    if (typeof prepared?.message !== 'string' || !prepared.message.length
      || !Number.isFinite(prepared.expiresAt) || prepared.expiresAt <= Date.now()) {
      throw new Error('登录请求已失效，请重新连接钱包。');
    }
    onStep?.('请在钱包中签署登录消息。');
    const encoded = `0x${Array.from(new TextEncoder().encode(prepared.message), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const signature = await entry.provider.request({ method: 'personal_sign', params: [encoded, address] });
    assertCurrent(token);
    const current = await inspect(entry.provider);
    assertCurrent(token);
    if (current.address?.toLowerCase() !== address.toLowerCase() || current.chainId !== chainId) {
      invalidate(); throw changedError();
    }
    onStep?.('正在验证签名…');
    const account = await verify({ signature });
    assertCurrent(token);
    if (!account?.authenticated || account.address?.toLowerCase() !== address.toLowerCase()
      || account.chainId !== chainId) throw new Error('登录身份校验未通过，请重新连接。');
    restoredIdentity = { address, chainId };
    readiness(true);
    return account;
  }
  function clear() {
    revision++;
    removeListeners(); removeListeners = () => {};
    active = null; identity = null; restoredIdentity = null;
    readiness(false);
  }
  function bindSession(account) {
    if (!account?.authenticated || !ADDRESS.test(account.address || '')) { clear(); return; }
    restoredIdentity = { address: account.address, chainId: account.chainId };
    if (active && identity?.address.toLowerCase() === account.address.toLowerCase()
      && identity.chainId === account.chainId) { readiness(true); return; }
    readiness(false);
    void findSessionProvider();
  }
  function refresh() {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    emitProviders();
  }
  function dispose() {
    clear(); disposed = true;
    window.removeEventListener('eip6963:announceProvider', announce);
  }
  window.addEventListener('eip6963:announceProvider', announce);
  // Defer callbacks until the caller has stored this client instance.
  queueMicrotask(refresh);
  return { list, login, clear, bindSession, refresh, dispose };
}
