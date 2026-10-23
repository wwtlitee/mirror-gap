// Game-style growth of the winged companion. Only active, embodied life counts.
export const NEWBORN_LENGTH = .19 / 30;
export const MATURE_LENGTH = .19 / 12;
export const LEGACY_LENGTH = 1.49 * .22;
export const GROWTH_SECONDS = 6 * 3600;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const trackers = new WeakMap();
export function createGrowth(activeSeconds = 0) {
  return {format:1,startedAt:activeSeconds,elapsed:0,nutrition:0,rest:0,progress:0};
}
export function ensureGrowth(companion) {
  // Old saves retain their life history; unrecorded nourishment is never invented.
  return companion.growth ??= createGrowth(companion.activeSeconds ?? 0);
}
export function validateGrowth(growth, activeSeconds = Infinity) {
  const valid = (key, max) => typeof growth?.[key] === 'number' && Number.isFinite(growth[key]) && growth[key] >= 0 && growth[key] <= max;
  if (growth?.format !== 1 || !valid('startedAt', activeSeconds) || !valid('elapsed', 1e12)
    || !valid('nutrition', 1e12) || !valid('rest', 1e12) || !valid('progress', 1)
    || growth.nutrition > growth.elapsed + .1 || growth.rest > growth.elapsed + .1
    || growth.elapsed > activeSeconds - growth.startedAt + .1
    || growth.progress > Math.min(1, growth.elapsed / GROWTH_SECONDS, growth.nutrition / 180, growth.rest / 600) + 1e-6) {
    throw Error('成长存档无效，原数据已保留。');
  }
  return growth;
}
export function growthSummary(companion) {
  const g = companion?.growth ?? createGrowth(companion?.activeSeconds ?? 0);
  const progress = clamp(Number.isFinite(g.progress) ? g.progress : 0, 0, 1);
  const relativeSize = 1 + 1.5 * Math.sqrt(progress);
  const length = NEWBORN_LENGTH * relativeSize;
  return {...g, progress,stage:progress>=1?'mature':progress>=.08?'growing':'newborn',
    bodyScale:length/LEGACY_LENGTH,length,relativeSize};
}
export function applyGrowthSize(state) {
  if (!state.companion) return;
  ensureGrowth(state.companion);
  state.actor.bodyScale = growthSummary(state.companion).bodyScale;
}
export function stepGrowth(state, dt, evidence = null) {
  const c = state.companion;
  if (!c?.identity?.adoptedAt || state.paused || !(dt > 0) || !Number.isFinite(dt)) return;
  const g = ensureGrowth(c);
  const previous = trackers.get(state);
  const ate = state.stats?.ateSeconds ?? 0, rested = state.stats?.restedSeconds ?? 0;
  const nutrition = evidence?.nutrition ?? (previous ? ate - previous.ate : 0);
  const rest = evidence?.rest ?? (previous ? rested - previous.rested : 0);
  trackers.set(state, {ate,rested});
  g.elapsed += dt;
  g.nutrition += clamp(Number.isFinite(nutrition)?nutrition:0,0,dt);
  g.rest += clamp(Number.isFinite(rest)?rest:0,0,dt);
  const target = clamp(Math.min(g.elapsed/GROWTH_SECONDS,g.nutrition/180,g.rest/600),0,1);
  // Catch-up is gradual even if nourishment/rest credits arrive after a long gap.
  g.progress = Math.max(g.progress, Math.min(target,g.progress+dt/GROWTH_SECONDS));
  applyGrowthSize(state);
}
