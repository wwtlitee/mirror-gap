import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Brain } from '../src/neural-core.mjs';
import { NeuralObserver, lifeInputs, validateGraph } from '../src/neural-observer.mjs';
import { LifeSimulation } from '../src/simulation.mjs';

const graph = JSON.parse(readFileSync(new URL('../public/assets/connectome.json', import.meta.url)));
const state = () => new LifeSimulation().snapshot();
const generator = () => { let seed = 17; return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }; };

test('actual graph propagates input spikes into non-input neurons, disconnected graph does not', () => {
  const real = new Brain(graph, generator());
  const disconnected = new Brain({ ...graph, pre: [], post: [], weights: [] }, generator());
  const actual = real.advance([1, 1, 1, 1], 2000);
  const control = disconnected.advance([1, 1, 1, 1], 2000);
  assert.ok(actual.spikes.some(id => id >= 32));
  assert.equal(control.spikes.some(id => id >= 32), false);
  assert.deepEqual(new Brain(graph, generator()).advance([0, 0, 0, 0], 2000).spikes, []);
});

test('continuous state survives sampling boundaries and rejects invalid commands before mutation', () => {
  const whole = new Brain(graph, generator()), chunks = new Brain(graph, generator());
  whole.advance([0.5, 0.8, 0.2, 0.1], 800);
  for (let i = 0; i < 10; i++) chunks.advance([0.5, 0.8, 0.2, 0.1], 80);
  for (const key of ['v', 'g', 'ref', 'queue', 'step']) assert.deepEqual(chunks[key], whole[key]);
  for (const [input, steps] of [[[NaN, 0, 0, 0], 80], [[1, 1, 1], 80], [[0, 0, 0, 0], 0]]) {
    assert.throws(() => chunks.advance(input, steps));
    assert.equal(chunks.step, 800);
  }
});

test('shared observer is deterministic by seed; pauses preserve state and interactions enter inputs', () => {
  const first = new NeuralObserver({ seed: 27 }), second = new NeuralObserver({ seed: 27 });
  const current = state();
  for (let i = 0; i < 12; i++) { first.tick(current); second.tick(current); }
  const a = first.snapshot().frame, b = second.snapshot().frame;
  assert.deepEqual(a.spikes, b.spikes);
  assert.equal(a.steps, 960);
  first.tick({ ...current, paused: true });
  assert.equal(first.snapshot().status, 'paused');
  assert.deepEqual(first.snapshot().frame, a);
  first.stimulate('chime'); first.tick(current);
  assert.ok(first.snapshot().frame.inputs[3] > b.inputs[3]);
  assert.equal(first.snapshot().frame.steps, 1040);
  assert.equal(first.snapshot().bodyControl, 'needs-rules');
  assert.ok(lifeInputs(current).every(v => v >= 0 && v <= 1));
});

test('missing or modified neural data fails visibly without fabricated frames', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mirror-neural-integrity-'));
  try {
    const modelPath = path.join(dir, 'model.json');
    const missing = new NeuralObserver({ modelPath }); missing.tick(state());
    assert.equal(missing.snapshot().available, false);
    assert.equal(missing.snapshot().frame, null);
    writeFileSync(modelPath, JSON.stringify({ ...graph, weights: graph.weights.map(v => v * 2) }));
    const modified = new NeuralObserver({ modelPath }); modified.tick(state());
    assert.match(modified.snapshot().reason, /校验失败/);
    assert.equal(modified.snapshot().frame, null);
    assert.throws(() => validateGraph({ ...graph, neurons: 10 }));
    assert.throws(() => validateGraph({ ...graph, post: [-1] }));
  } finally { rmSync(dir, { recursive: true }); }
});
