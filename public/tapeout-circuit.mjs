/**
 * 镜隙 v8.5.0 — TAP-02 evaluator and unsigned X Layer reader.
 * Semantics: https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md
 * Independently implemented against the MIT reference by Alda (@ronesync):
 * https://github.com/TapeOutProtocol/TAPs/blob/main/assets/tap-02/reference.py
 * Copyright (c) 2026 Unclecow.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * No wallet, signer, private key, transaction, or persistent chain state is used.
 */

const FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761';
const CPU = '0x839bdd6fa7a66416a609a735e11de5411b98574e';
export const DEFAULT_TAPEOUT = Object.freeze({
  chainId: 196, factory: FACTORY, cpu: CPU, id: 1n, nIn: 2, nOut: 1,
  netlist: '0x00000002000003000000020000040000000300000400000005000006',
  sourceUrl: 'https://www.oklink.com/xlayer/address/' + CPU,
});
export const TAPEOUT_PULSE_CIRCUIT = Object.freeze({
  chainId: 196, factory: FACTORY, cpu: CPU, id: 4n, nIn: 0, nOut: 1,
  netlist: '0x02f044d395c91e77459e6b2155015e14f0dd9b349f00000000000000660001',
});
export const TAPEOUT_PULSE_SOURCE = Object.freeze({
  chainId: 196, factory: FACTORY, cpu: '0xf044d395c91e77459e6b2155015e14f0dd9b349f', id: 102n, nIn: 0, nOut: 1,
  netlist: '0x0100000701000009000000020000020000000300000300000004000005000000060000060000000200000500000008000008000000070000070000000a00000a',
});
const MAX_SIGNALS = 2 ** 24;
const MAX_GATES = 2 ** 32 - 1;
const MAX_BYTES = 2 ** 20;
const DESCRIPTORS = new WeakSet();

export function circuitBytes(value = new Uint8Array()) {
  if (value instanceof Uint8Array) {
    if (value.length > MAX_BYTES) throw new RangeError('bytes resource limit');
    return value.slice();
  }
  if (typeof value !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(value)) throw new TypeError('invalid hex bytes');
  if (value.length > 2 + MAX_BYTES * 2) throw new RangeError('bytes resource limit');
  return Uint8Array.from(value.slice(2).match(/../g) || [], byte => parseInt(byte, 16));
}
export const circuitHex = bytes => '0x' + Array.from(circuitBytes(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
function pinCount(value, min, label) {
  if (!Number.isInteger(value) || value < min || value > 65536) throw new RangeError(label + ' pin range');
  return value;
}
function address(value) {
  if (typeof value !== 'string' || !/^0x[a-f\d]{40}$/i.test(value)) throw new TypeError('invalid address');
  return value.toLowerCase();
}
function uint256(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError('uint256 range');
  if (!['number', 'bigint', 'string'].includes(typeof value) || (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value))) throw new TypeError('uint256 value');
  const n = BigInt(value);
  if (n < 0n || n >= 1n << 256n) throw new RangeError('uint256 range');
  return n;
}
const word = value => uint256(value).toString(16).padStart(64, '0');

/** resolveRef(cpu, bigintId) must return an already validated registered descriptor. */
export function parseCircuit({ netlist, nIn, nOut }, { resolveRef } = {}) {
  pinCount(nIn, 0, 'nIn'); pinCount(nOut, 1, 'nOut');
  const bytes = circuitBytes(netlist);
  if (bytes.length > MAX_BYTES) throw new RangeError('netlist resource limit');
  let position = 0; let signals = 2 + nIn;
  const elements = [];
  const take = count => {
    if (position + count > bytes.length) throw new RangeError('truncated netlist record');
    const result = bytes.subarray(position, position + count); position += count; return result;
  };
  const u24 = () => { const b = take(3); return b[0] * 65536 + b[1] * 256 + b[2]; };
  while (position < bytes.length) {
    const op = take(1)[0]; const firstOut = signals; let inputs; let cpu; let id; let count = 1;
    if (op === 0) inputs = [u24(), u24()];
    else if (op === 1) inputs = [u24()];
    else if (op === 2) {
      cpu = circuitHex(take(20)); id = BigInt(circuitHex(take(8)));
      const pins = take(2); count = pins[1]; inputs = Array.from({ length: pins[0] }, u24);
    } else throw new TypeError('unknown netlist opcode');
    signals += count;
    if (signals > MAX_SIGNALS) throw new RangeError('signal size overflow');
    elements.push({ op, inputs, firstOut, nOut: count, cpu, id });
  }
  if (signals - 2 - nIn < nOut) throw new RangeError('too few signals for outputs');
  let nState = 0; let gateCount = 0;
  for (const element of elements) {
    const limit = element.op === 1 ? signals : element.firstOut;
    if (element.inputs.some(index => index >= limit)) throw new RangeError('future or out of range signal');
    element.stateBase = nState;
    if (element.op === 1) nState++;
    if (element.op === 2) {
      const sub = resolveRef?.(element.cpu, element.id);
      if (!DESCRIPTORS.has(sub)) throw new TypeError('REF requires registered circuit resolver');
      if (sub.nIn !== element.inputs.length || sub.nOut !== element.nOut) throw new TypeError('REF arity mismatch');
      element.sub = sub; nState += sub.nState; gateCount += sub.gateCount;
    } else gateCount++;
    if (nState > MAX_SIGNALS || gateCount > MAX_GATES) throw new RangeError('state or gate size overflow');
    Object.freeze(element.inputs); Object.freeze(element);
  }
  const descriptor = Object.freeze({ nIn, nOut, nState, gateCount, signals, netlist: circuitHex(bytes), elements: Object.freeze(elements) });
  DESCRIPTORS.add(descriptor); return descriptor;
}
const bit = (bytes, index) => ((bytes[index >> 3] || 0) >> (index & 7)) & 1;
const put = (bytes, index, value) => { if (value) bytes[index >> 3] |= 1 << (index & 7); };

/** TAP-02 leniency is intentional: missing bits are zero; extra bits are ignored. */
export function stepCircuit(circuit, { state, inputs } = {}) {
  if (!DESCRIPTORS.has(circuit)) throw new TypeError('validated circuit required');
  return runBeat(circuit, circuitBytes(state), circuitBytes(inputs), 0);
}
function runBeat(circuit, state, inputs, depth) {
  if (depth > 64) throw new RangeError('REF evaluation resource limit');
  const signals = new Uint8Array(circuit.signals); signals[1] = 1;
  const newState = new Uint8Array(Math.ceil(circuit.nState / 8));
  for (let i = 0; i < circuit.nIn; i++) signals[2 + i] = bit(inputs, i);
  for (const e of circuit.elements) {
    if (e.op === 0) signals[e.firstOut] = 1 - (signals[e.inputs[0]] & signals[e.inputs[1]]);
    else if (e.op === 1) signals[e.firstOut] = bit(state, e.stateBase);
    else {
      const subState = new Uint8Array(Math.ceil(e.sub.nState / 8));
      const subInput = new Uint8Array(Math.ceil(e.sub.nIn / 8));
      for (let i = 0; i < e.sub.nState; i++) put(subState, i, bit(state, e.stateBase + i));
      for (let i = 0; i < e.inputs.length; i++) put(subInput, i, signals[e.inputs[i]]);
      const next = runBeat(e.sub, subState, subInput, depth + 1);
      for (let i = 0; i < e.sub.nState; i++) put(newState, e.stateBase + i, bit(next.newState, i));
      for (let i = 0; i < e.nOut; i++) signals[e.firstOut + i] = bit(next.outputs, i);
    }
  }
  for (const e of circuit.elements) if (e.op === 1) put(newState, e.stateBase, signals[e.inputs[0]]);
  const outputs = new Uint8Array(Math.ceil(circuit.nOut / 8));
  for (let i = 0; i < circuit.nOut; i++) put(outputs, i, signals[circuit.signals - circuit.nOut + i]);
  return { newState, outputs };
}

function abiWords(hex) {
  const b = circuitBytes(hex);
  const read = offset => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 32 > b.length) throw new RangeError('ABI bounds');
    return BigInt(circuitHex(b.subarray(offset, offset + 32)));
  };
  const bounded = n => { if (n > BigInt(MAX_BYTES)) throw new RangeError('ABI length resource limit'); return Number(n); };
  const dynamic = (head, headLength = 32) => {
    const offset = bounded(read(head));
    if (offset % 32 || offset < headLength) throw new RangeError('ABI dynamic offset');
    const length = bounded(read(offset));
    if (offset + 32 + Math.ceil(length / 32) * 32 > b.length) throw new RangeError('ABI bytes bounds');
    return b.slice(offset + 32, offset + 32 + length);
  };
  return { read, bounded, dynamic };
}
function encodeDynamic(bytes) { const h = circuitHex(bytes).slice(2); return word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0'); }

/** Each bridge pins all reads to one block on one explicitly selected RPC operator. */
export function createReadonlyTapeoutBridge({ rpcUrls = ['https://rpc.xlayer.tech'], fetch: fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!Array.isArray(rpcUrls) || !rpcUrls.length || !rpcUrls.every(url => typeof url === 'string' && /^https:\/\//.test(url))) throw new TypeError('HTTPS RPC URL required');
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('invalid RPC options');
  const rpcUrl = rpcUrls[0]; let sequence = 0; let verification; let pendingVerification;
  const checkedCpus = new Map(); const circuits = new Map();
  async function rpc(method, params = []) {
    const id = ++sequence; const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
      if (!response.ok) throw new Error('RPC HTTP ' + response.status);
      const data = await response.json();
      if (data.id !== id || data.jsonrpc !== '2.0') throw new Error('RPC response mismatch');
      if (data.error) throw new Error('RPC ' + String(data.error.message || data.error.code).slice(0, 160));
      if (typeof data.result !== 'string' || data.result.length > 2 + MAX_BYTES * 2 || !/^0x[a-f\d]*$/i.test(data.result)) throw new Error('RPC malformed result');
      return data.result;
    } finally { clearTimeout(timeout); }
  }
  const callAt = (cpu, data, block) => rpc('eth_call', [{ to: address(cpu), data }, block]);
  async function verifyCpu(cpu, blockNumber) {
    cpu = address(cpu);
    if (checkedCpus.has(cpu)) return checkedCpus.get(cpu);
    const code = circuitBytes(await rpc('eth_getCode', [cpu, blockNumber]));
    if (!code.length) throw new Error('processor code is absent');
    const registered = abiWords(await callAt(FACTORY, '0x5f5a364f' + cpu.slice(2).padStart(64, '0'), blockNumber)).read(0);
    if (registered !== 1n) throw new Error('processor is not registered in factory');
    const factoryResult = abiWords(await callAt(cpu, '0xc45a0155', blockNumber)).read(0);
    if (factoryResult !== BigInt(FACTORY)) throw new Error('processor factory mismatch');
    checkedCpus.set(cpu, code.length); return code.length;
  }
  async function verifyDeployment() {
    if (verification) return verification;
    if (pendingVerification) return pendingVerification;
    pendingVerification = (async () => {
      const chain = await rpc('eth_chainId');
      if (BigInt(chain) !== 196n) throw new Error('RPC chain mismatch: expected X Layer 196');
      const blockNumber = await rpc('eth_blockNumber');
      const factoryCode = circuitBytes(await rpc('eth_getCode', [FACTORY, blockNumber]));
      if (!factoryCode.length) throw new Error('factory code is absent');
      const cpuCodeBytes = await verifyCpu(CPU, blockNumber);
      verification = Object.freeze({ chainId: 196, factory: FACTORY, cpu: CPU, blockNumber, rpcUrl, factoryCodeBytes: factoryCode.length, cpuCodeBytes });
      return verification;
    })();
    try { return await pendingVerification; } finally { pendingVerification = undefined; }
  }
  async function loadCircuit({ cpu = CPU, id = 1n } = {}, ancestors = new Set()) {
    cpu = address(cpu); id = uint256(id);
    const key = cpu + ':' + id;
    if (ancestors.has(key) || ancestors.size > 64) throw new Error('REF cycle or depth resource limit');
    if (circuits.has(key)) return circuits.get(key);
    const { blockNumber } = await verifyDeployment(); await verifyCpu(cpu, blockNumber);
    const info = abiWords(await callAt(cpu, '0x084d60f1' + word(id), blockNumber));
    const values = [0, 32, 64, 96].map(offset => info.read(offset));
    if (values.some(value => value > 0xffffffffn)) throw new RangeError('ABI uint32 range');
    const [nIn, nOut, nState, gateCount] = values.map(Number);
    const netlist = abiWords(await callAt(cpu, '0x3fc4be56' + word(id), blockNumber)).dynamic(0);
    const nextAncestors = new Set([...ancestors, key]); const refs = new Map();
    // Discover every REF by scanning records; parseCircuit performs final validation below.
    let p = 0;
    while (p < netlist.length) {
      const op = netlist[p];
      if (op === 0) p += 7;
      else if (op === 1) p += 4;
      else if (op === 2) {
        if (p + 31 > netlist.length) throw new RangeError('truncated REF');
        if (p + 31 + 3 * netlist[p + 29] > netlist.length) throw new RangeError('truncated REF inputs');
        const refCpu = circuitHex(netlist.subarray(p + 1, p + 21)); const refId = BigInt(circuitHex(netlist.subarray(p + 21, p + 29)));
        refs.set(refCpu + ':' + refId, await loadCircuit({ cpu: refCpu, id: refId }, nextAncestors)); p += 31 + 3 * netlist[p + 29];
      } else throw new TypeError('unknown netlist opcode');
    }
    const c = parseCircuit({ netlist, nIn, nOut }, { resolveRef: (refCpu, refId) => refs.get(refCpu + ':' + refId) });
    if (c.nState !== nState || c.gateCount !== gateCount) throw new Error('chain circuit metadata mismatch');
    circuits.set(key, c); return c;
  }
  async function step({ cpu = CPU, id = 1n, state, inputs } = {}) {
    cpu = address(cpu); id = uint256(id);
    const { blockNumber } = await verifyDeployment(); await verifyCpu(cpu, blockNumber);
    const s = encodeDynamic(circuitBytes(state)); const i = encodeDynamic(circuitBytes(inputs));
    const result = abiWords(await callAt(cpu, '0xe8281a1a' + word(id) + word(96) + word(96 + s.length / 2) + s + i, blockNumber));
    return { newState: result.dynamic(0, 64), outputs: result.dynamic(32, 64) };
  }
  async function evaluate({ cpu = CPU, id = 1n, inputs } = {}) {
    cpu = address(cpu); id = uint256(id);
    const { blockNumber } = await verifyDeployment(); await verifyCpu(cpu, blockNumber);
    return abiWords(await callAt(cpu, '0x934d06ea' + word(id) + word(64) + encodeDynamic(circuitBytes(inputs)), blockNumber)).dynamic(0);
  }
  return Object.freeze({ verifyDeployment, loadCircuit, step, eval: evaluate });
}
