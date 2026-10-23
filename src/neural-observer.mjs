import {readFileSync,sha256,randomSeed} from './platform-io.mjs';
import { Brain } from './neural-core.mjs';
import { ZONE_BY_ID } from '../public/world-spec.mjs';

const MODEL = new URL('../public/assets/connectome.json', import.meta.url);
const SOURCE_HASH = '80b15b42aa43ebb000f83a85105f64e50bb9157175b957190e4d8586507ac91d';
const bounded = value => Math.max(0, Math.min(1, value));

export function validateGraph(graph) {
  if (!graph || graph.neurons !== 1024 || graph.dt_ms !== 0.1 || graph.sha256 !== SOURCE_HASH
    || !Array.isArray(graph.pre) || graph.pre.length !== 55500
    || !Array.isArray(graph.post) || graph.post.length !== graph.pre.length
    || !Array.isArray(graph.weights) || graph.weights.length !== graph.pre.length
    || graph.pre.some(i => !Number.isInteger(i) || i < 0 || i >= graph.neurons)
    || graph.post.some(i => !Number.isInteger(i) || i < 0 || i >= graph.neurons)
    || graph.weights.some(w => !Number.isFinite(w))) throw new Error('神经连接数据无效');
  return graph;
}

// Numeric sensory assignments are engineering choices, not identified sensory cells.
export function lifeInputs(state, pulses = { feed: 0, mist: 0, chime: 0 }) {
  const { needs, actor, clock } = state;
  const distanceTo = id => Math.hypot(...actor.position.map((v, i) => v - ZONE_BY_ID[id].position[i]));
  const food = Math.exp(-distanceTo('feed') / 3);
  const windowLight = (0.3 + 0.7 * Math.max(0, Math.sin((clock.hour - 6) / 12 * Math.PI)))
    * Math.exp(-distanceTo('garden') / 5);
  return [bounded((1 - needs.satiety / 100) * food + pulses.feed),
    bounded(windowLight * (0.3 + needs.curiosity / 140)),
    bounded((1 - needs.comfort / 100) * 0.3 + pulses.mist),
    bounded((actor.mode === 'travel' ? 0.12 : 0) + (1 - needs.energy / 100) * 0.1 + pulses.chime)];
}

export class NeuralObserver {
  constructor({ modelPath = MODEL, hashPath = new URL('../public/assets/connectome.sha256', import.meta.url), validator = validateGraph, seed = randomSeed() || 1 } = {}) {
    this.pulses = { feed: 0, mist: 0, chime: 0 };
    this.frame = null; this.error = null; this.paused = false; this.totalSpikes = 0;
    try {
      const raw = readFileSync(modelPath);
      const expected = readFileSync(hashPath, 'utf8').trim();
      this.fingerprint = sha256(raw);
      if (this.fingerprint !== expected) throw new Error('神经连接文件校验失败');
      this.graph = validator(JSON.parse(raw));
      let rng = seed >>> 0 || 1;
      this.brain = new Brain(this.graph, () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; }, { inputChannels: this.graph.channels ?? null });
    } catch (error) { this.error = error.message; }
  }

  stimulate(type) {
    if (Object.hasOwn(this.pulses, type)) this.pulses[type] = 0.9;
  }

  tick(state) {
    this.paused = state.paused;
    if (!this.brain || this.error || this.paused) return;
    try {
      const inputs = lifeInputs(state, this.pulses);
      const result = this.brain.advance(inputs, 80); // 8 neural ms per 100 wall ms.
      this.totalSpikes += result.spikes.length;
      this.frame = { sequence: result.steps / 80, steps: result.steps, neuralMs: result.steps * 0.1,
        at: Date.now(), inputs, spikes: [...new Set(result.spikes)], spikeCount: result.spikes.length,
        transmitted: [...new Set(result.transmitted)], totalSpikes: this.totalSpikes };
      for (const type of Object.keys(this.pulses)) this.pulses[type] *= Math.exp(-0.1 / 2);
    } catch (error) { this.error = error.message; this.frame = null; }
  }

  snapshot() {
    return { available: Boolean(this.brain && !this.error), status: this.error ? 'unavailable' : this.paused ? 'paused' : this.frame ? 'live' : 'starting',
      reason: this.error, neurons: this.graph?.neurons ?? 0, connections: this.graph?.pre.length ?? 0,
      source: 'FlyWire v783', fingerprint: this.fingerprint, bodyControl: 'needs-rules',
      timeScale: 0.08, frame: this.frame };
  }
}
