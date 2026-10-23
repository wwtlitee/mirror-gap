import test from 'node:test';
import assert from 'node:assert/strict';

let api = {};
try { api = await import('../public/tapeout-circuit.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const ready = () => assert.equal(typeof api.parseCircuit, 'function', 'TAP-02 parser must exist');
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const nand = '0x00000002000003';
const word = x => BigInt(x).toString(16).padStart(64, '0');
const bytesResult = bytes => '0x' + word(32) + word(bytes.length / 2) + bytes.padEnd(Math.ceil(bytes.length / 64) * 64, '0');
const stepResult = (state, output) => {
  const s = word(state.length / 2) + state.padEnd(Math.ceil(state.length / 64) * 64, '0');
  return '0x' + word(64) + word(64 + s.length / 2) + s + word(output.length / 2) + output.padEnd(Math.ceil(output.length / 64) * 64, '0');
};

test('NAND truth table and LSB packing agree with TAP-02', () => {
  ready();
  const circuit = api.parseCircuit({ netlist: nand, nIn: 2, nOut: 1 });
  assert.equal(circuit.nState, 0);
  assert.equal(circuit.gateCount, 1);
  for (let x = 0; x < 4; x++) assert.equal(api.stepCircuit(circuit, { inputs: Uint8Array.of(x) }).outputs[0], x === 3 ? 0 : 1);
  assert.equal(api.stepCircuit(circuit, { inputs: Uint8Array.of(0xff, 0xff) }).outputs[0], 0);
  assert.equal(api.stepCircuit(circuit, { inputs: new Uint8Array() }).outputs[0], 1);
});

test('LATCH exposes previous state and updates forward feedback after all gates', () => {
  ready();
  const c = api.parseCircuit({ netlist: '0x0100000300000002000002', nIn: 0, nOut: 1 });
  assert.equal(c.nState, 1);
  assert.deepEqual([...api.stepCircuit(c, { state: '0x00' }).newState], [1]);
  assert.deepEqual([...api.stepCircuit(c, { state: '0x01' }).outputs], [0]);
  assert.equal(hex(api.stepCircuit(c).outputs), '01');
});

test('rejects malformed opcodes, truncated records, future NAND, and pin bounds', () => {
  ready();
  for (const netlist of ['0xff', '0x00000002', '0x00000004000002', '0x01000009']) {
    assert.throws(() => api.parseCircuit({ netlist, nIn: 2, nOut: 1 }));
  }
  for (const nIn of [-1, NaN, 1.2, 65537]) assert.throws(() => api.parseCircuit({ netlist: nand, nIn, nOut: 1 }));
  assert.throws(() => api.parseCircuit({ netlist: nand, nIn: 2, nOut: 0 }));
  assert.throws(() => api.parseCircuit({ netlist: '0xzz', nIn: 2, nOut: 1 }));
  assert.throws(() => api.parseCircuit({ netlist: '0x', nIn: 2, nOut: 1 }));
});

test('REF resolves a registered descriptor, preserves nested state, and rejects mismatched pins', () => {
  ready();
  const sub = api.parseCircuit(api.TAPEOUT_PULSE_SOURCE);
  const c = api.parseCircuit(api.TAPEOUT_PULSE_CIRCUIT, { resolveRef: (cpu, id) => {
    assert.equal(cpu, api.TAPEOUT_PULSE_SOURCE.cpu); assert.equal(id, 102n); return sub;
  } });
  assert.equal(c.nState, 2); assert.equal(c.gateCount, 10);
  let state = new Uint8Array(); const outputs = [];
  for (let i = 0; i < 8; i++) { const next = api.stepCircuit(c, { state }); state = next.newState; outputs.push(next.outputs[0]); }
  assert.equal(outputs.length, 8);
  assert.deepEqual(outputs, [1, 0, 0, 1, 0, 0, 1, 0]);
  assert.throws(() => api.parseCircuit(api.TAPEOUT_PULSE_CIRCUIT), /REF/);
  assert.throws(() => api.parseCircuit(api.TAPEOUT_PULSE_CIRCUIT, { resolveRef: () => api.parseCircuit({ netlist: nand, nIn: 2, nOut: 1 }) }), /arity/);
});

test('fixed X Layer XOR fixture is reproducible and independent of caller mutation', () => {
  ready(); const c = api.parseCircuit(api.DEFAULT_TAPEOUT);
  for (let x = 0; x < 4; x++) assert.equal(api.stepCircuit(c, { inputs: Uint8Array.of(x) }).outputs[0], [0, 1, 1, 0][x]);
  assert.ok(Object.isFrozen(c)); assert.ok(Object.isFrozen(c.elements));
});

test('REF uint64 IDs stay exact above Number safe range and state blocks need no byte alignment', () => {
  ready();
  const cpu = '0x00000000000000000000000000000000000000aa';
  const id = 2n ** 63n + 37n;
  const sub = api.parseCircuit({ netlist: nand, nIn: 2, nOut: 1 });
  const c = api.parseCircuit({ nIn: 2, nOut: 1, netlist: '0x02' + cpu.slice(2) + id.toString(16).padStart(16, '0') + '0201000002000003' }, {
    resolveRef: (foundCpu, foundId) => { assert.equal(foundCpu, cpu); assert.equal(foundId, id); return sub; },
  });
  assert.equal(api.stepCircuit(c, { inputs: '0x03' }).outputs[0], 0);
  const parent = api.parseCircuit({ nIn: 1, nOut: 2, netlist: '0x01000003' + api.TAPEOUT_PULSE_CIRCUIT.netlist.slice(2) }, { resolveRef: () => api.parseCircuit(api.TAPEOUT_PULSE_SOURCE) });
  assert.deepEqual([...api.stepCircuit(parent).newState], [2]);
  assert.deepEqual([...api.stepCircuit(parent).outputs], [2]);
  assert.deepEqual([...api.stepCircuit(parent, { state: '0x03' }).newState], [5]);
});

test('byte inputs enforce an explicit resource bound before copying', () => {
  ready();
  assert.throws(() => api.circuitBytes(new Uint8Array(2 ** 20 + 1)), /resource/);
});

test('read-only bridge verifies chain, factory and processor, then decodes circuit bytes', async () => {
  ready(); const requests = [];
  const fetch = async (_url, options) => {
    const q = JSON.parse(options.body); requests.push(q); let result;
    if (q.method === 'eth_chainId') result = '0xc4';
    else if (q.method === 'eth_blockNumber') result = '0x123';
    else if (q.method === 'eth_getCode') result = '0x6000';
    else if (q.params[0].data.startsWith('0x5f5a364f')) result = '0x' + word(1);
    else if (q.params[0].data === '0xc45a0155') result = '0x' + api.DEFAULT_TAPEOUT.factory.slice(2).padStart(64, '0');
    else if (q.params[0].data.startsWith('0x084d60f1')) result = '0x' + [2, 1, 0, 4].map(word).join('');
    else if (q.params[0].data.startsWith('0x3fc4be56')) result = bytesResult(api.DEFAULT_TAPEOUT.netlist.slice(2));
    else if (q.params[0].data.startsWith('0xe8281a1a')) result = stepResult('', '01');
    else if (q.params[0].data.startsWith('0x934d06ea')) result = bytesResult('01');
    else throw Error('unexpected RPC');
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result }) };
  };
  const bridge = api.createReadonlyTapeoutBridge({ fetch, rpcUrls: ['https://rpc.example.test'] });
  const verified = await bridge.verifyDeployment(); assert.equal(verified.chainId, 196);
  const c = await bridge.loadCircuit(); assert.equal(c.gateCount, 4);
  assert.equal(hex((await bridge.step({ inputs: '0x01' })).outputs), '01');
  assert.equal(hex(await bridge.eval({ inputs: '0x01' })), '01');
  assert.ok(requests.every(q => ['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call'].includes(q.method)));
  assert.ok(requests.filter(q => q.method === 'eth_call').every(q => q.params[1] === '0x123'));
  await assert.rejects(bridge.step({ id: -1 }), /uint256/);
  await assert.rejects(bridge.step({ id: 1n << 256n }), /uint256/);
  await assert.rejects(bridge.step({ id: Number.MAX_SAFE_INTEGER + 1 }), /uint256/);
  await assert.rejects(bridge.loadCircuit({ cpu: 'not-an-address' }), /address/);
});

test('bridge rejects foreign chain, absent code, RPC errors and malformed dynamic output', async () => {
  ready();
  const make = result => api.createReadonlyTapeoutBridge({ rpcUrls: ['https://rpc.example.test'], fetch: async (_u, o) => {
    const q = JSON.parse(o.body); return { ok: true, json: async () => ({ jsonrpc: '2.0', id: q.id, result: result(q) }) };
  } });
  await assert.rejects(make(() => '0x1').verifyDeployment(), /chain/);
  await assert.rejects(make(q => q.method === 'eth_chainId' ? '0xc4' : q.method === 'eth_blockNumber' ? '0x123' : '0x').verifyDeployment(), /code/);
  const malformed = make(q => q.method === 'eth_chainId' ? '0xc4' : q.method === 'eth_blockNumber' ? '0x123' : q.method === 'eth_getCode' ? '0x60' : q.params[0].data.startsWith('0x5f5a364f') ? '0x' + word(1) : q.params[0].data === '0xc45a0155' ? '0x' + api.DEFAULT_TAPEOUT.factory.slice(2).padStart(64, '0') : '0xffff');
  await assert.rejects(malformed.eval(), /ABI|length|bounds/);
  const overlapping = make(q => q.method === 'eth_chainId' ? '0xc4' : q.method === 'eth_blockNumber' ? '0x123' : q.method === 'eth_getCode' ? '0x60' : q.params[0].data.startsWith('0x5f5a364f') ? '0x' + word(1) : q.params[0].data === '0xc45a0155' ? '0x' + api.DEFAULT_TAPEOUT.factory.slice(2).padStart(64, '0') : '0x' + word(32) + word(64) + word(0) + word(0));
  await assert.rejects(overlapping.step(), /ABI/);
  const errored = api.createReadonlyTapeoutBridge({ rpcUrls: ['https://rpc.example.test'], fetch: async (_u, o) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: JSON.parse(o.body).id, error: { code: -32000, message: 'denied' } }) }) });
  await assert.rejects(errored.verifyDeployment(), /RPC denied/);
});
