import { ROOM } from './world-spec.mjs';

export const MECHANICAL_FLY_RADIUS = .045;
export const MECHANICAL_FLY_VERSION = '8.5.0';
const HORIZONTAL_SPEED = .7, VERTICAL_SPEED = .45;
const CAPACITY = 100, CHARGE_RATE = 20, RECOVERY_SECONDS = 3, EPSILON = 1e-9;
const bounds = [ROOM.width / 2 - MECHANICAL_FLY_RADIUS, ROOM.height - MECHANICAL_FLY_RADIUS, ROOM.depth / 2 - MECHANICAL_FLY_RADIUS];
const allowedInputs = new Set(['move', 'lift', 'emit', 'interact']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = message => { throw new TypeError(`Mechanical fly: ${message}`); };

function vector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !Array.from(value).every(finite)) fail(`${label} must contain ${length} finite numbers`);
}

function position(value, label) {
  vector(value, 3, label);
  if (Math.abs(value[0]) > bounds[0] + EPSILON || value[1] < MECHANICAL_FLY_RADIUS - EPSILON || value[1] > bounds[1] + EPSILON || Math.abs(value[2]) > bounds[2] + EPSILON) fail(`${label} is outside the room`);
}

function cargo(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 128 || /[\u0000-\u001f]/.test(value.id)) fail('cargo needs a valid id');
  // Weight is a normalized game load (0..1), not a biological mass claim.
  if (!finite(value.weight) || value.weight <= 0 || value.weight > 1) fail('cargo weight must be greater than zero and at most one');
  return { id: value.id, weight: value.weight };
}

function validateState(state) {
  if (!state || typeof state !== 'object') fail('state is required');
  position(state.position, 'position');
  position(state.lastChargingPoint, 'lastChargingPoint');
  vector(state.velocity, 3, 'velocity');
  if (!finite(state.yaw) || !finite(state.battery) || state.battery < 0 || state.battery > CAPACITY) fail('invalid yaw or battery');
  for (const field of ['emptySeconds', 'stuckSeconds']) if (!finite(state[field]) || state[field] < 0 || state[field] > RECOVERY_SECONDS + EPSILON) fail(`invalid ${field}`);
  if (!Number.isSafeInteger(state.recoveredCount) || state.recoveredCount < 0 || typeof state.recoveryLatched !== 'boolean') fail('invalid recovery state');
  if (!['A', 'B', 'off'].includes(state.emit) || typeof state.interact !== 'boolean' || typeof state.blocked !== 'boolean' || typeof state.recoveredThisStep !== 'boolean') fail('invalid command state');
  if (state.cargo !== null) cargo(state.cargo);
}

function copyState(state) {
  return { ...state, position: [...state.position], velocity: [...state.velocity], lastChargingPoint: [...state.lastChargingPoint], cargo: state.cargo === null ? null : cargo(state.cargo) };
}

function readInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowedInputs.has(key))) fail('unsupported controls');
  const move = input.move === undefined ? [0, 0] : input.move;
  const lift = input.lift === undefined ? 0 : input.lift;
  vector(move, 2, 'move');
  if (move.some(value => Math.abs(value) > 1) || !finite(lift) || Math.abs(lift) > 1) fail('movement controls must be within -1..1');
  if (input.emit !== undefined && !['A', 'B', 'off'].includes(input.emit)) fail('invalid signal');
  if (input.interact !== undefined && typeof input.interact !== 'boolean') fail('interact must be boolean');
  const length = Math.hypot(...move), scale = length > 1 ? 1 / length : 1;
  return { move: move.map(value => value * scale), lift, emit: input.emit, interact: input.interact ?? false };
}

/** Pure mechanical state; no neural body, reward, inventory or learning references. */
export function createMechanicalFly({ position: initialPosition = [0, .08, 0], seed = 0 } = {}) {
  position(initialPosition, 'spawn position');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) fail('seed must be an unsigned 32-bit integer');
  return {
    version: MECHANICAL_FLY_VERSION, seed, position: [...initialPosition], velocity: [0, 0, 0], yaw: 0,
    battery: CAPACITY, cargo: null, lastChargingPoint: [...initialPosition], emit: 'off', interact: false,
    blocked: false, emptySeconds: 0, stuckSeconds: 0, recoveryLatched: false,
    recoveredCount: 0, recoveredThisStep: false, recoveredReason: null
  };
}

function recover(state, reason) {
  state.position = [...state.lastChargingPoint];
  state.velocity = [0, 0, 0];
  state.emptySeconds = 0;
  state.stuckSeconds = 0;
  state.recoveredThisStep = true;
  state.recoveredReason = reason;
  state.recoveredCount++;
  state.recoveryLatched = state.battery === 0;
}

/**
 * Resolve interior obstacles using the actual room collider supplied by the caller.
 * resolveMove({position, desiredPosition, radius, seconds}) -> {position:[x,y,z]}.
 * The fallback only confines motion to the room shell; it invents no furniture.
 * charging is true only when the caller has verified a physical charging zone.
 */
export function advanceMechanicalFly(state, input = {}, seconds = 0, { resolveMove, charging = false } = {}) {
  validateState(state);
  const controls = readInput(input);
  if (!finite(seconds) || seconds < 0 || seconds > .25) fail('seconds must be within 0..0.25');
  if (resolveMove !== undefined && typeof resolveMove !== 'function') fail('resolveMove must be a function');
  if (typeof charging !== 'boolean') fail('charging must be boolean');
  const next = copyState(state);
  if (seconds === 0) return next;
  next.recoveredThisStep = false;
  next.recoveredReason = null;
  next.blocked = false;
  next.interact = controls.interact;
  next.emit = controls.emit ?? state.emit;

  const horizontal = Math.hypot(...controls.move), moving = horizontal > 0 || controls.lift !== 0;
  const load = state.cargo?.weight ?? 0;
  const drain = .1 + (horizontal * 3.5 + Math.abs(controls.lift) * 6) * (1 + load) + (next.emit === 'off' ? 0 : .6);
  let poweredSeconds = Math.min(seconds, state.battery / drain);
  if (charging && !moving) {
    next.battery = clamp(state.battery + (CHARGE_RATE - drain) * seconds, 0, CAPACITY);
    next.lastChargingPoint = [...state.position];
    poweredSeconds = seconds;
  } else next.battery = Math.max(0, state.battery - drain * poweredSeconds);
  if (next.battery > 0) next.recoveryLatched = false;

  const requestedVelocity = [controls.move[0] * HORIZONTAL_SPEED, controls.lift * VERTICAL_SPEED, controls.move[1] * HORIZONTAL_SPEED];
  const requestedDistance = Math.hypot(...requestedVelocity) * poweredSeconds;
  let endpoint = state.position.map((value, axis) => value + requestedVelocity[axis] * poweredSeconds);
  endpoint = [clamp(endpoint[0], -bounds[0], bounds[0]), clamp(endpoint[1], MECHANICAL_FLY_RADIUS, bounds[1]), clamp(endpoint[2], -bounds[2], bounds[2])];
  if (resolveMove && requestedDistance > 0) {
    const resolved = resolveMove({ position: [...state.position], desiredPosition: [...endpoint], radius: MECHANICAL_FLY_RADIUS, seconds: poweredSeconds });
    position(resolved?.position, 'collision endpoint');
    endpoint = [...resolved.position];
    if (Math.hypot(...endpoint.map((value, axis) => value - state.position[axis])) > requestedDistance + 1e-6) fail('collision endpoint exceeds the permitted travel distance');
  }
  next.position = endpoint;
  next.velocity = endpoint.map((value, axis) => (value - state.position[axis]) / seconds);
  if (horizontal > 0 && poweredSeconds > 0) next.yaw = Math.atan2(controls.move[0], controls.move[1]);
  const actualDistance = Math.hypot(...next.velocity) * seconds;
  const expected = state.position.map((value, axis) => value + requestedVelocity[axis] * poweredSeconds);
  next.blocked = expected.some((value, axis) => Math.abs(value - endpoint[axis]) > 1e-6);
  next.stuckSeconds = moving && poweredSeconds > 0 && requestedDistance > 1e-6 && actualDistance < 1e-6 ? Math.min(RECOVERY_SECONDS, state.stuckSeconds + poweredSeconds) : 0;
  next.emptySeconds = next.battery === 0 && !next.recoveryLatched ? Math.min(RECOVERY_SECONDS, state.emptySeconds + seconds - poweredSeconds) : 0;
  if (next.battery === 0) next.emit = 'off';
  if (next.emptySeconds >= RECOVERY_SECONDS - EPSILON) recover(next, 'empty');
  else if (next.stuckSeconds >= RECOVERY_SECONDS - EPSILON) recover(next, 'stuck');
  return next;
}

/** Cargo bookkeeping only. World pickup range and unique ownership belong to the caller. */
export function pickupMechanicalCargo(state, item) {
  validateState(state);
  if (state.cargo !== null) fail('cargo slot is already occupied');
  const carried = cargo(item), next = copyState(state);
  next.cargo = carried;
  return next;
}

/** The caller transfers the returned cargo into the physical world exactly once. */
export function dropMechanicalCargo(state) {
  validateState(state);
  const next = copyState(state), dropped = next.cargo;
  next.cargo = null;
  return { state: next, cargo: dropped };
}
