// Fast execution feedback may remove thrust and dissipate velocity, but cannot
// choose a destination, steer toward one, or propel a disconnected brain.
export function navigationBrake(actor,route){
 const point=route?.status==='ready'?route.waypoints?.[route.index]:null;
 if(!point||actor.contact||!point.every(Number.isFinite))return {thrust:1,drag:0};
 const distance=Math.hypot(...point.map((v,i)=>v-actor.position[i]));
 const thrust=Math.min(1,distance/.7);
 return {thrust,drag:(1-thrust)*7};
}
