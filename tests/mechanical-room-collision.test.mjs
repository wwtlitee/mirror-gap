import test from 'node:test';
import assert from 'node:assert/strict';
import { meshClearance } from '../public/collision-world.mjs';
import { createMechanicalFly, advanceMechanicalFly, MECHANICAL_FLY_RADIUS as radius } from '../public/mechanical-fly.mjs';

let api = {};
try { api = await import('../public/mechanical-room-collision.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const make = options => { assert.equal(typeof api.makeMechanicalRoomResolver, 'function', 'mechanical room resolver must exist'); return api.makeMechanicalRoomResolver(options); };
const validClearance = position => { const contact = meshClearance(position, radius + .001); assert.ok(!contact || contact.distance >= radius - .000002, JSON.stringify({ position, contact })); };

test('the specified mechanical spawn is clear of the actual baked room geometry', () => {
  const resolveMove = make();
  const spawn = [-2.1, 1.6, 1.6];
  validClearance(spawn);
  const state = advanceMechanicalFly(createMechanicalFly({ position: spawn }), { move: [1, 0], lift: 1 }, .25, { resolveMove });
  validClearance(state.position);
  assert.ok(Math.hypot(...state.position.map((v, i) => v - spawn[i])) <= Math.hypot(.7, .45) * .25 + 1e-6);
});

test('continuous subdivisions prevent crossing a thin obstacle between clear endpoints', () => {
  let contacts = 0;
  const resolveMove = make({
    clearance: position => ({ distance: Math.abs(position[0] - .1) }),
    resolveContact(position) { contacts++; if (position[0] > .1 - radius && position[0] < .1 + radius) position[0] = .1 - radius; }
  });
  const before = [0, 1, 0], desiredPosition = [.2, 1, 0];
  const result = resolveMove({ position: before, desiredPosition, radius, seconds: .25 });
  assert.ok(contacts > 10);
  assert.ok(result.position[0] <= .1 - radius + 1e-6);
  assert.deepEqual(before, [0, 1, 0]);
  assert.deepEqual(desiredPosition, [.2, 1, 0]);
});

test('real room wall collisions remain clear and within every controller movement budget', () => {
  const resolveMove = make();
  let state = createMechanicalFly({ position: [-5.6, 2, 0] });
  for (let step = 0; step < 9; step++) {
    const before = state.position;
    state = advanceMechanicalFly(state, { move: [-1, 0] }, .25, { resolveMove });
    validClearance(state.position);
    assert.ok(Math.hypot(...state.position.map((value, axis) => value - before[axis])) <= .7 * .25 + 1e-6);
  }
  assert.ok(state.position[0] >= -5.72);
});

test('descending onto a real desk cannot tunnel into its baked mesh', () => {
  const resolveMove = make();
  let state = createMechanicalFly({ position: [-2, 1.7, -3.2] });
  for (let step = 0; step < 7; step++) {
    state = advanceMechanicalFly(state, { lift: -1 }, .25, { resolveMove });
    validClearance(state.position);
  }
  assert.ok(state.position[1] > 1.2);
});

test('invalid requests, penetrating starts and resolver warps reject without mutating inputs', () => {
  const request = { position: [0, 1, 0], desiredPosition: [.1, 1, 0], radius, seconds: .2 }, before = structuredClone(request);
  const resolveMove = make();
  for (const bad of [{ ...request, position: [NaN, 1, 0] }, { ...request, position: Array(3) }, { ...request, radius: 0 }, { ...request, seconds: Infinity }, { ...request, desiredPosition: [10, 1, 0] }]) assert.throws(() => resolveMove(bad));
  assert.throws(() => make({ clearance: () => ({ distance: 0 }) })(request));
  const warp = make({ clearance: () => null, resolveContact(p) { p[0] = 100; } });
  assert.throws(() => warp(request));
  const movingWarp = make({ clearance: () => null, resolveContact(p, velocity) { if (Math.hypot(...velocity) > 0) p[0] = 100; } });
  assert.deepEqual(movingWarp(request).position, request.position);
  assert.deepEqual(request, before);
});
