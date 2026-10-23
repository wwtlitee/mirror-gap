import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOM } from '../public/world-spec.mjs';

let api = {};
try { api = await import('../public/mechanical-fly.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const ready = () => assert.equal(typeof api.createMechanicalFly, 'function', 'mechanical controller must exist');
const create = options => { ready(); return api.createMechanicalFly(options); };
const tick = (state, input = {}, seconds = .25, options) => api.advanceMechanicalFly(state, input, seconds, options);
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const advanceFor = (state, seconds, input = {}, options) => {
  for (let left = seconds; left > 1e-9; left -= .25) state = tick(state, input, Math.min(.25, left), options);
  return state;
};

test('creates deterministic isolated mechanical state without sharing spawn arrays', () => {
  const position = [0, .08, 0], state = create({ position, seed: 42 });
  assert.deepEqual(state, create({ position, seed: 42 }));
  assert.equal(api.MECHANICAL_FLY_RADIUS, .045);
  position[0] = 5;
  assert.deepEqual(state.position, [0, .08, 0]);
  assert.deepEqual(state.lastChargingPoint, [0, .08, 0]);
  assert.notEqual(state.position, state.lastChargingPoint);
  assert.equal(state.battery, 100);
  assert.equal(state.cargo, null);
  assert.equal(state.emit, 'off');
});

test('caps diagonal horizontal speed and applies metric vertical speed', () => {
  const start = create(), state = tick(start, { move: [1, 1], lift: 1 });
  close(Math.hypot(state.velocity[0], state.velocity[2]), .7);
  close(state.position[1] - start.position[1], .45 * .25);
  close(state.yaw, Math.PI / 4);
  assert.deepEqual(start.velocity, [0, 0, 0]);
});

test('default movement remains inside the room with a body radius margin', () => {
  const r = api.MECHANICAL_FLY_RADIUS ?? .045;
  const state = tick(create({ position: [ROOM.width / 2 - r, ROOM.height - r, ROOM.depth / 2 - r] }), { move: [1, 1], lift: 1 });
  assert.deepEqual(state.position, [ROOM.width / 2 - r, ROOM.height - r, ROOM.depth / 2 - r]);
  assert.deepEqual(state.velocity, [0, 0, 0]);
});

test('rejects invalid construction, controls, elapsed time and states without partial mutation', () => {
  const state = create(), before = structuredClone(state);
  for (const options of [{ position: [0, NaN, 0] }, { position: [99, 1, 0] }, { seed: -1 }, { position: [0, 0] }]) {
    assert.throws(() => api.createMechanicalFly(options));
  }
  for (const [input, seconds] of [[{ move: [NaN, 0] }, .1], [{ move: [2, 0] }, .1], [{ move: [0] }, .1], [{ lift: Infinity }, .1], [{ emit: 'C' }, .1], [{ interact: 1 }, .1], [{ position: [3, 3, 3] }, .1], [{}, NaN], [{}, -.01], [{}, .251]]) {
    assert.throws(() => tick(state, input, seconds));
    assert.deepEqual(state, before);
  }
  assert.throws(() => tick({ ...state, battery: NaN }));
  assert.throws(() => tick({ ...state, lastChargingPoint: [999, 0, 0] }));
});

test('zero elapsed time is a copied no-op and does not invoke collisions or charge', () => {
  const state = create(), next = tick(state, { emit: 'A', interact: true }, 0, { charging: true, resolveMove() { assert.fail('zero step must not resolve'); } });
  assert.deepEqual(next, state);
  assert.notEqual(next, state);
  assert.notEqual(next.position, state.position);
});

test('rejects sparse vectors and explicit null controls rather than producing NaN state', () => {
  const state = create(), before = structuredClone(state);
  assert.throws(() => api.createMechanicalFly({ position: Array(3) }));
  for (const input of [{ move: Array(2) }, { move: null }, { lift: null }]) assert.throws(() => tick(state, input));
  assert.throws(() => tick({ ...state, velocity: Array(3) }));
  assert.deepEqual(state, before);
});

test('uses the injected collision endpoint for both authoritative position and velocity', () => {
  let request;
  const start = create(), state = tick(start, { move: [1, 1] }, .2, { resolveMove(value) {
    request = value;
    return { position: [value.position[0], value.desiredPosition[1], value.desiredPosition[2]], blocked: true };
  } });
  close(state.position[0], 0);
  close(state.position[2], .7 / Math.sqrt(2) * .2);
  close(state.velocity[0], 0);
  close(state.velocity[2], .7 / Math.sqrt(2));
  assert.equal(request.radius, .045);
  assert.equal(request.seconds, .2);
  assert.equal(state.blocked, true);
  assert.ok(state.battery < start.battery);
});

test('rejects invalid collision results and protects the caller state from resolver mutation', () => {
  const state = create(), before = structuredClone(state);
  for (const resolveMove of [() => ({ position: [NaN, 0, 0] }), () => ({ position: [50, 1, 0] }), () => ({ position: [2, .08, 0] }), () => { throw Error('collision failure'); }]) {
    assert.throws(() => tick(state, { move: [1, 0] }, .1, { resolveMove }));
    assert.deepEqual(state, before);
  }
  tick(state, { move: [1, 0] }, .1, { resolveMove(request) {
    const endpoint = [...request.desiredPosition];
    request.position[0] = 4;
    return { position: endpoint };
  } });
  assert.deepEqual(state, before);
});

test('cargo increases propulsion energy use and signaling consumes real mechanical energy', () => {
  const start = create(), loaded = api.pickupMechanicalCargo(start, { id: 'fruit-01', weight: .4 });
  const emptyMoved = tick(start, { move: [1, 0] }), loadedMoved = tick(loaded, { move: [1, 0] });
  assert.ok(loadedMoved.battery < emptyMoved.battery);
  assert.ok(tick(start, { emit: 'A' }).battery < tick(start).battery);
  assert.equal(tick(start, { emit: 'A' }).emit, 'A');
  assert.equal(tick(start, { interact: true }).interact, true);
});

test('charges only when upper layer marks a stationary real charging zone', () => {
  const start = { ...create(), battery: 50 };
  assert.ok(tick(start, {}, .25).battery <= 50);
  const charged = tick(start, {}, .25, { charging: true });
  assert.ok(charged.battery > 50);
  assert.deepEqual(charged.lastChargingPoint, start.position);
  assert.ok(tick(start, { move: [1, 0] }, .25, { charging: true }).battery < 50);
  assert.equal(advanceFor(charged, 20, {}, { charging: true }).battery, 100);
});

test('runs out of energy within a step without allowing unpowered travel', () => {
  const start = { ...create(), battery: .01 };
  const state = tick(start, { move: [1, 0] });
  assert.equal(state.battery, 0);
  assert.ok(state.position[0] > 0 && state.position[0] < .7 * .25);
  assert.ok(state.emptySeconds > 0 && state.emptySeconds < .25);
  const exhausted = tick(state, { move: [1, 0], lift: 1, emit: 'A' });
  assert.deepEqual(exhausted.position, state.position);
  assert.deepEqual(exhausted.velocity, [0, 0, 0]);
  assert.equal(exhausted.emit, 'off');
});

test('empty for three seconds recovers only the machine once and conserves cargo', () => {
  const cargoState = api.pickupMechanicalCargo(create({ position: [-1, .08, 0] }), { id: 'battery-cell', weight: .2 });
  const stranded = { ...cargoState, position: [1, .08, 0], battery: 0 };
  const before = structuredClone(stranded);
  let state = advanceFor(stranded, 2.75, { move: [1, 0] });
  assert.deepEqual(state.position, [1, .08, 0]);
  state = tick(state, {}, .25);
  assert.deepEqual(state.position, [-1, .08, 0]);
  assert.deepEqual(state.cargo, before.cargo);
  assert.equal(state.recoveredCount, 1);
  assert.equal(state.recoveredThisStep, true);
  assert.equal(state.recoveredReason, 'empty');
  assert.equal(state.battery, 0);
  assert.equal(advanceFor(state, 4).recoveredCount, 1);
  assert.deepEqual(stranded, before);
  assert.ok(tick(state, {}, .25, { charging: true }).battery > 0);
});

test('persistent complete collision blockage can recover the mechanical actor without losing cargo', () => {
  const start = { ...create({ position: [-1, .08, 0] }), position: [1, .08, 0] };
  const state = advanceFor(start, 3, { move: [1, 0] }, { resolveMove: ({ position }) => ({ position }) });
  assert.equal(state.recoveredReason, 'stuck');
  assert.equal(state.recoveredCount, 1);
  assert.deepEqual(state.position, [-1, .08, 0]);
  assert.ok(state.battery > 0 && state.battery < 100);
});

test('pickup and drop conserve cargo identity, reject overwrites and isolate caller objects', () => {
  const start = create(), cargo = { id: 'supply-1', weight: .3 };
  const loaded = api.pickupMechanicalCargo(start, cargo);
  cargo.weight = .9;
  assert.equal(start.cargo, null);
  assert.equal(loaded.cargo.weight, .3);
  assert.throws(() => api.pickupMechanicalCargo(loaded, { id: 'other', weight: .1 }));
  for (const invalid of [{ id: '', weight: .2 }, { id: 'bad', weight: NaN }, { id: 'bad', weight: 0 }, { id: 'heavy', weight: 1.01 }]) assert.throws(() => api.pickupMechanicalCargo(start, invalid));
  const dropped = api.dropMechanicalCargo(loaded);
  assert.deepEqual(dropped.cargo, { id: 'supply-1', weight: .3 });
  assert.equal(dropped.state.cargo, null);
  assert.equal(loaded.cargo.id, 'supply-1');
  dropped.cargo.id = 'edited';
  assert.equal(loaded.cargo.id, 'supply-1');
  assert.equal(api.dropMechanicalCargo(dropped.state).cargo, null);
});
