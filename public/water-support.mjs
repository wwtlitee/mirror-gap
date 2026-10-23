import {RESOURCE_DEFINITIONS} from './resource-spec.mjs';
import {bodyMetrics} from './body-metrics.mjs';

// A millimetre-scale insect rests on the liquid surface, not on the submerged
// basin floor. This is a physical support shared by contact and foot placement.
const waterDiscs=RESOURCE_DEFINITIONS.filter(resource=>resource.kind==='water'&&resource.shape==='disc');
export function waterSurfaceBelow(x,y,z,maxDrop,actorOrScale=1){
 const m=bodyMetrics(actorOrScale);if(m.scale>=.15)return null;
 let result=null;
 for(const resource of waterDiscs){
  const [cx,cy,cz]=resource.position;
  if(Math.hypot(x-cx,z-cz)>resource.radius||y<cy-m.tolerance||y-cy>maxDrop)continue;
  if(!result||cy>result.position[1])result={position:[x,cy,z],zone:resource.zone,id:resource.id};
 }
 return result;
}
export function resolveWaterSupport(position,velocity,radius){
 const m=bodyMetrics(radius/.085);if(m.scale>=.15||velocity[1]>.08)return null;
 const hit=waterSurfaceBelow(position[0],position[1]+m.tolerance,position[2],radius+m.tolerance*2,m.scale);
 if(!hit||position[1]<hit.position[1]-m.tolerance)return null;
 if(position[1]>hit.position[1]+radius+m.tolerance)return null;
 position[1]=Math.max(position[1],hit.position[1]+radius+m.skin);velocity[1]=Math.max(0,velocity[1]);
 return {id:'water-surface-'+hit.id,zone:hit.zone};
}
