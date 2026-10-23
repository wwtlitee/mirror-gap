// World-space dimensions come from one relative scale. Missing scale retains
// historical fixtures/checkpoints; adopted companions supply their growth scale.
export const BASE_BODY_RADIUS = .085;
export const BASE_CHARACTER_SCALE = .22;
export const BASE_BODY_OFFSETS = Object.freeze([-.105, 0, .09]);
export const BASE_BODY_LENGTH = 1.49 * BASE_CHARACTER_SCALE;

export function bodyMetrics(actorOrScale = 1) {
  const value = typeof actorOrScale === 'number' ? actorOrScale : actorOrScale?.bodyScale;
  const scale = Number.isFinite(value) && value > 0 ? Math.max(.005, Math.min(2, value)) : 1;
  const tolerance = Math.max(.000001, .002 * scale);
  return {
    scale, key: scale.toFixed(6), radius: BASE_BODY_RADIUS * scale,
    offsets: BASE_BODY_OFFSETS.map(value => value * scale),
    characterScale: BASE_CHARACTER_SCALE * scale, length: BASE_BODY_LENGTH * scale,
    tolerance, skin: Math.max(.0000002, .0001 * scale),
    mouthForward: .12078 * scale, mouthDown: .01606 * scale,
    mouthReach: .14 * scale, resourceReach: .24 * scale,
    footProbeAbove: .025 * scale, footDrop: .12 * scale,
    movementStep: Math.max(.0001, .025 * scale),
    transitRadius: .19 * scale + .04,
  };
}
