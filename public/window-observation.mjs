// Keep the entire body supported; the eyes then sit at the outer sill edge.
import {bodyMetrics} from './body-metrics.mjs';
export const WINDOW_VIEW_Z = -3.88;
export function windowObservationAdjustment(actor) {
  const [x,y,z] = actor.position;
  const body=bodyMetrics(actor);
  if (!actor.contact || x < 1 || x > 5.2 || Math.abs(y-(1.28+body.radius+body.skin)) > Math.max(.004,.06*body.scale) || z < -4.01 || z > -3.75) return null;
  const delta = WINDOW_VIEW_Z-z;
  const threshold=Math.max(.001,.02*body.scale);
  return {settled:Math.abs(delta)<threshold, velocity:Math.abs(delta)<threshold?0:Math.sign(delta)*Math.min(.10,Math.max(.002,Math.abs(delta)*2))};
}
