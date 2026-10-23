import { meshClearance, resolveMeshContact } from './collision-world.mjs';
import { ROOM } from './world-spec.mjs';
import { MECHANICAL_FLY_RADIUS } from './mechanical-fly.mjs';

const EPSILON = .000002, MAX_SPEED = Math.hypot(.7, .45);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = message => { throw new TypeError(`Mechanical room: ${message}`); };
function validatePosition(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every(finite)) fail(`${label} needs three finite coordinates`);
  if (Math.abs(value[0]) > ROOM.width / 2 || value[1] < 0 || value[1] > ROOM.height || Math.abs(value[2]) > ROOM.depth / 2) fail(`${label} outside room bounds`);
}

/** A continuous sphere sweep over the same baked room mesh as the resident. */
export function makeMechanicalRoomResolver({ clearance = meshClearance, resolveContact = resolveMeshContact, maxStep = .012 } = {}) {
  if (typeof clearance !== 'function' || typeof resolveContact !== 'function') fail('collision functions are required');
  if (!finite(maxStep) || maxStep < .001 || maxStep > .02) fail('maxStep must be within .001..02 metres');
  function clear(point, radius) {
    const hit = clearance([...point], radius + EPSILON);
    if (hit === null || hit === undefined) return true;
    if (!finite(hit.distance) || hit.distance < 0) fail('invalid clearance result');
    return hit.distance >= radius - EPSILON;
  }
  return function resolveMove({ position, desiredPosition, radius = MECHANICAL_FLY_RADIUS, seconds } = {}) {
    validatePosition(position, 'position');
    validatePosition(desiredPosition, 'desiredPosition');
    if (!finite(radius) || radius <= 0 || radius > .2 || !finite(seconds) || seconds < 0 || seconds > .25) fail('invalid radius or elapsed time');
    const delta = desiredPosition.map((value, axis) => value - position[axis]);
    const distance = Math.hypot(...delta);
    if (distance > MAX_SPEED * seconds + 1e-6) fail('requested movement exceeds the mechanical speed limit');
    if (!clear(position, radius)) fail('initial position intersects the room mesh');
    const checkedStart = [...position];
    resolveContact(checkedStart, [0, 0, 0], radius);
    validatePosition(checkedStart, 'initial collision result');
    if (Math.hypot(...checkedStart.map((value, axis) => value - position[axis])) > EPSILON) fail('initial position intersects a physical boundary');
    if (distance === 0) return { position: [...position], blocked: false };
    const steps = Math.ceil(distance / Math.min(maxStep, radius * .35));
    const increment = delta.map(value => value / steps);
    const velocity = delta.map(value => value / seconds);
    let safe = [...position];
    for (let index = 0; index < steps; index++) {
      const candidate = safe.map((value, axis) => value + increment[axis]);
      resolveContact(candidate, [...velocity], radius);
      const valid = Array.isArray(candidate) && candidate.length === 3 && Array.from(candidate).every(finite)
        && Math.abs(candidate[0]) <= ROOM.width / 2 && candidate[1] >= 0 && candidate[1] <= ROOM.height && Math.abs(candidate[2]) <= ROOM.depth / 2;
      if (!valid || Math.hypot(...candidate.map((value, axis) => value - position[axis])) > distance + 1e-6 || !clear(candidate, radius)) continue;
      safe = candidate;
    }
    return { position: safe, blocked: safe.some((value, axis) => Math.abs(value - desiredPosition[axis]) > EPSILON) };
  };
}
