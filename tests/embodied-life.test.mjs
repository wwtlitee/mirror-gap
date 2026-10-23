import {meshClearance} from '../public/collision-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbodiedLife } from '../src/embodied-life.mjs';
import { LifeSimulation } from '../src/simulation.mjs';
import { NeuralController, senseEnvironment } from '../src/neural-controller.mjs';
import { SOLIDS, SIGNAL_SOURCES, BODY_RADIUS, resolveContacts } from '../public/environment-spec.mjs';

const run = (s, seconds) => { for (let i = 0; i < seconds * 10; i++) s.tick(.1); };

test('actual downstream neural output is essential: severing connectivity removes active propulsion', () => {
  const active = new EmbodiedLife(), disconnected = new EmbodiedLife();
  active.state.actor.position = [0, 2, 0]; disconnected.state.actor.position = [0, 2, 0];
  disconnected.neural.brain.disconnect();
  run(active, 8); run(disconnected, 8);
  assert.ok(active.state.stats.distanceTravelled > 1);
  assert.ok(active.neural.motor.drive > .05);
  const {referenceHeading,...disconnectedMotor}=disconnected.neural.motor;
  assert.ok(Number.isFinite(referenceHeading));
  assert.deepEqual(disconnectedMotor, { local: [0, 0, 0], drive: 0, populations: [0, 0, 0, 0] });
  assert.ok(disconnected.state.actor.contact); // Passive gravity remains, no hidden route.
  assert.equal(disconnected.state.actor.position[0], 0);
  assert.equal(disconnected.state.actor.position[2], 0);
});

test('body and continuous membrane/delay/random state resume exactly across a checkpoint', () => {
  const original = new EmbodiedLife();original.state.living.clock={mode:'preview',hour:12,anchor:0}; run(original, 3.4);
  original.interact('mist'); original.tick(.013);
  const copy = new EmbodiedLife(original.serialize());
  run(original, 4); run(copy, 4);
  assert.deepEqual(copy.serialize(), original.serialize());
});

test('old life history, needs and clock survive migration; old routes cannot issue commands', () => {
  const old = new LifeSimulation(); old.tick(25);
  const previous = old.serialize(); previous.version = '1.0.0';
  const next = new EmbodiedLife(previous);
  for (const key of ['needs', 'history', 'home', 'simSeconds', 'stats']) assert.deepEqual(next.state[key], previous[key]);
  assert.deepEqual(next.state.actor.route, []);
  assert.equal(next.state.actor.targetZoneId, null);
  next.goTo = next.chooseNext = next.planFlight = () => { throw new Error('Scripted movement called'); };
  run(next, 5);
  assert.equal(next.state.actor.targetZoneId, null);
});

test('signals are directional, local and need-dependent; interaction never teleports or fills a need', () => {
  const sim = new EmbodiedLife(), state = sim.serialize();
  // Compare directional cues in unobstructed air, outside the top-surface detour.
  state.actor.position = [0, 2.5, 0]; state.actor.contact = false;
  const pulses = { feed: 0, mist: 0, chime: 0 };
  const original = senseEnvironment(state, pulses);
  const moved = SIGNAL_SOURCES.map(source => ({ ...source, position: source.position.map((v, i) => i === 0 ? -v : v) }));
  assert.notDeepEqual(senseEnvironment(state, pulses, moved).inputs, original.inputs);
  state.needs.satiety = 4;
  assert.ok(senseEnvironment(state, pulses).signals.find(s => s.id === 'fruit').intensity > original.signals.find(s => s.id === 'fruit').intensity);
  const before = sim.snapshot(); sim.interact('mist');
  assert.deepEqual(sim.snapshot().needs, before.needs);
  assert.deepEqual(sim.snapshot().actor, before.actor);
  assert.equal(sim.neural.pulses.mist, .9);
  assert.throws(() => sim.interact('mist'), /请等/);
});

test('all solid top faces support the smaller body and side faces stop penetration', () => {
  for (const solid of SOLIDS) {
    const center = solid.min.map((v, i) => (v + solid.max[i]) / 2);
    const p = [center[0], solid.max[1] + BODY_RADIUS - .001, center[2]], v = [0, -1, 0];
    assert.ok(resolveContacts(p, v, BODY_RADIUS, [solid], []));
    assert.equal(v[1], 0);
    assert.ok(Math.abs(p[1] - solid.max[1] - BODY_RADIUS) < 1e-8);
  }
});

test('free 3D flight stays finite and bounded with no targets or abrupt jumps', () => {
  const s = new EmbodiedLife(); const bounds = [[9, -9], [9, -9], [9, -9]];
  // Start airborne: a legitimate window-to-desk visit need not vary altitude.
  Object.assign(s.state.actor,{position:[0,3,0],contact:false,mode:'travel',action:'explore',zoneId:'flight'});
  for (let i = 0; i < 1600; i++) {
    const before = [...s.state.actor.position]; s.tick(.02);
    assert.ok(Math.hypot(...s.state.actor.position.map((v, j) => v - before[j])) < .16);
    s.state.actor.position.forEach((v, j) => { assert.ok(Number.isFinite(v)); bounds[j][0] = Math.min(bounds[j][0], v); bounds[j][1] = Math.max(bounds[j][1], v); });
    assert.equal(s.state.actor.targetZoneId, null);
    const clearance=meshClearance(s.state.actor.position,BODY_RADIUS);assert.ok(!clearance||clearance.distance>=BODY_RADIUS-.008);
  }
  assert.ok(bounds.every(([min, max]) => max - min > .4));
});

test('pause freezes both loops and equal simulated time at different speeds gives equal trajectories', () => {
  const a = new EmbodiedLife(), b = new EmbodiedLife();
  for(const sim of [a,b])sim.state.living.clock={mode:'preview',hour:12,anchor:0};
  a.setPaused(true); const before = a.serialize(), beforeNeural = a.neural.serialize(); run(a, 1);
  assert.deepEqual(a.state.actor, before.actor);
  assert.deepEqual(a.neural.serialize(), beforeNeural);
  assert.deepEqual(a.neural.learning.serializeWeights(), before.synapticMemory);
  assert.equal(Object.hasOwn(before.neural,'synapticMemory'),false); // The body checkpoint owns this one copy.
  a.setPaused(false); b.setSpeed(10); a.tick(1); b.tick(.1);
  assert.deepEqual(a.state.actor, b.state.actor);
  assert.deepEqual(a.neural.serialize(), b.neural.serialize());
});

test('contact with food is required to eat; touching the far end of the table is insufficient', () => {
  const s = new EmbodiedLife();
  s.state.needs.satiety = 10;
  Object.assign(s.state.actor,{position:[-3.01222381526149,1.3590130174789878,1.7106751467150032],heading:-1.7103630065546365,contact:true,zoneId:'feed',mode:'activity',velocity:[0,0,0]});
  // Include the two-sample arbitration window at the user-selected 1 Hz rate.
  run(s, 8); assert.ok(s.state.needs.satiety > 12); assert.equal(s.state.actor.action, 'eat');
  s.state.actor.position = [-3.13, 1.105, 0]; s.state.actor.velocity = [0, 0, 0];
  const satiety = s.state.needs.satiety; run(s, 2);
  assert.ok(s.state.needs.satiety < satiety); assert.notEqual(s.state.actor.action, 'eat');
});

test('damaged neural or body checkpoint is rejected instead of silently restarting', () => {
  const s = new EmbodiedLife(); run(s, 1); const saved = s.serialize();
  const badBody = structuredClone(saved); badBody.actor.position[0] = NaN;
  assert.throws(() => new EmbodiedLife(badBody), /存档无效/);
  const badBrain = structuredClone(saved); badBrain.neural.v[0] = Infinity;
  assert.throws(() => new EmbodiedLife(badBrain), /存档无效/);
  const badQueue = structuredClone(saved); badQueue.neural.queue[0] = [-1];
  assert.throws(() => new EmbodiedLife(badQueue), /存档无效/);
});

test('missing graph explicitly disables neural motor output', () => {
  const neural = new NeuralController({ modelPath: new URL('./absent-model.json', import.meta.url) });
  assert.equal(neural.snapshot().available, false);
  assert.equal(neural.motor.drive, 0);
});
