import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NeuralResearch, NeuralResearchError, PROTOCOL_VERSION } from '../src/neural-research.mjs';

const native = new NeuralResearch();
const hasNative = native.status().available;
const valid = { stimulus: 'feed', intensity: 0.5, seed: 17 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('研究接口仅接受受限刺激、强度与服务端种子，非法请求不启动实验', async () => {
  const research = new NeuralResearch();
  for (const request of [null, [], {}, { ...valid, stimulus: 'mine' }, { ...valid, intensity: 0.75 },
    { ...valid, intensity: '0.5' }, { ...valid, seed: -1 }, { ...valid, seed: 0x100000000 },
    { ...valid, seed: 1.5 }, { ...valid, seed: NaN }, { ...valid, path: 'untrusted.py' }]) {
    await assert.rejects(research.run(request), error => error instanceof NeuralResearchError && error.statusCode === 400);
  }
  assert.equal(research.status().busy, false);
});

test('缺少模型时状态明确不可用，调用失败且不会持有忙碌锁', async () => {
  const research = new NeuralResearch({ modelPath: path.join(os.tmpdir(), 'missing-mirror-home-model-does-not-exist.npz') });
  assert.equal(research.status().available, false);
  assert.equal(research.status().model, 'FlyWire v783 子网络');
  await assert.rejects(research.run(valid), error => error.statusCode === 503);
  assert.equal(research.status().busy, false);
});

test('真实单序列返回32×16神经响应，可复现且不会改写模型；并发实验明确拒绝', { skip: !hasNative }, async t => {
  const modelBefore = await readFile(native.modelPath);
  const metadataBefore = await readFile(native.metadataPath);
  const firstPromise = native.run(valid);
  assert.equal(native.status().busy, true);
  await assert.rejects(native.run({ ...valid, stimulus: 'mist' }), error => error.statusCode === 429 && error.code === 'research_busy');
  const anotherFly = new NeuralResearch();
  assert.equal(anotherFly.status().busy, true);
  await assert.rejects(anotherFly.run(valid), error => error.code === 'research_busy');
  const first = await firstPromise;
  assert.equal(native.status().busy, false);
  assert.equal(first.protocolVersion, PROTOCOL_VERSION);
  assert.equal(first.neurons, 1024); assert.equal(first.edges, 55500);
  assert.equal(first.response.length, 32);
  assert.ok(first.response.every(row => row.length === 16 && row.every(value => Number.isFinite(value) && value >= 0)));
  assert.equal(first.baseline, 0);
  assert.ok(first.activation > 0 && first.peak > 0 && first.recovery >= 0);
  assert.ok(first.computeSeconds >= first.simulationSeconds && first.simulationSeconds > 0);
  assert.equal(first.mapping.activeChannel, 0);
  assert.match(first.mapping.notice, /工程映射/);
  const repeated = await native.run(valid);
  assert.deepEqual(repeated.response, first.response);
  assert.equal(repeated.activation, first.activation);
  assert.equal(repeated.modelFingerprint, first.modelFingerprint);
  assert.equal(hash(await readFile(native.modelPath)), hash(modelBefore));
  assert.equal(hash(await readFile(native.metadataPath)), hash(metadataBefore));
  t.diagnostic(`真实首轮计算 ${first.computeSeconds}s，其中仿真 ${first.simulationSeconds}s；复测 ${repeated.computeSeconds}s；activation=${first.activation}，recovery=${first.recovery}。`);
});

test('超时终止本次子进程并释放并发锁，不能把超时当实验结果', { skip: !hasNative }, async () => {
  const research = new NeuralResearch({ timeoutMs: 25 });
  await assert.rejects(research.run(valid), error => error.code === 'research_timeout' && error.statusCode === 504);
  assert.equal(research.status().busy, false);
  await assert.rejects(research.run(valid), error => error.code === 'research_timeout');
  assert.equal(research.status().busy, false);
});

test('模型指纹不匹配时失败且保留原文件，没有伪造成功响应', { skip: !hasNative }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mirror-neural-model-test-'));
  const modelPath = path.join(temporary, 'model.npz');
  const metadataPath = path.join(temporary, 'model.json');
  try {
    const bytes = Buffer.from('invalid local test artifact');
    const metadata = JSON.parse(await readFile(native.metadataPath, 'utf8'));
    metadata.artifact_sha256 = '0'.repeat(64);
    await writeFile(modelPath, bytes);
    await writeFile(metadataPath, JSON.stringify(metadata));
    const research = new NeuralResearch({ modelPath });
    await assert.rejects(research.run(valid), error => error.code === 'research_process_failed'
      && error.diagnostic.includes('fingerprint'));
    assert.equal(research.status().busy, false);
    assert.deepEqual(await readFile(modelPath), bytes);
  } finally {
    const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^mirror-neural-model-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
});
