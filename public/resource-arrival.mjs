import {routeSegmentClear} from './route-planner.mjs';

const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const angle=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const validPoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const anchorCache=new WeakMap();

function anchors(pose,actor,clear){
  // Match route-planner's body-envelope cache; growth inside the same bin uses identical geometry queries.
  const scaleKey=Number.isFinite(actor.bodyScale)?actor.bodyScale.toFixed(4):'default';
  const cached=clear===routeSegmentClear?anchorCache.get(pose):null;
  if(cached?.scaleKey===scaleKey)return cached.points;
  const points=[];
  for(const length of [.128,.256,.384])for(const rise of [.002,.008,.016]){
    const via=[pose.position[0]-Math.sin(pose.heading)*length,pose.position[1]+rise,pose.position[2]-Math.cos(pose.heading)*length];
    if(!clear(via,pose.position,pose.heading,actor))continue;
    // The fly can turn naturally at this waypoint before entering a narrow perch.
    if(!Array.from({length:16},(_,i)=>i*Math.PI/8).every(yaw=>clear(via,via,yaw,actor)))continue;
    points.push(via);
  }
  if(clear===routeSegmentClear)anchorCache.set(pose,{scaleKey,points});
  return points;
}

/** Choose only existing stable food poses; the resulting waypoints remain sensory targets. */
export function selectResourceArrival(poses,actor,{segmentClear=routeSegmentClear}={}){
  if(!Array.isArray(poses)||!validPoint(actor?.position)||!Number.isFinite(actor.heading)||typeof segmentClear!=='function'
    ||poses.some(pose=>!validPoint(pose?.position)||!Number.isFinite(pose.heading)))throw Error('Invalid resource arrival candidates');
  if(!poses.length)return null;
  const ranked=poses.map(pose=>({pose,distance:distance(actor.position,pose.position)})).sort((a,b)=>a.distance-b.distance);
  let best=null,bestCost=Infinity;
  for(const {pose,distance:directDistance}of ranked){
    const facing=Math.atan2(pose.position[0]-actor.position[0],pose.position[2]-actor.position[2]);
    if(angle(facing,pose.heading)<.15&&segmentClear(actor.position,pose.position,actor.heading,actor)&&segmentClear(actor.position,pose.position,facing,actor)){
      if(directDistance<bestCost){bestCost=directDistance;best={position:[...pose.position],arrival:null};}
      continue;
    }
    for(const via of anchors(pose,actor,segmentClear)){
      const incoming=Math.atan2(via[0]-actor.position[0],via[2]-actor.position[2]);
      const cost=distance(actor.position,via)+distance(via,pose.position);
      if(cost>=bestCost||!segmentClear(actor.position,via,actor.heading,actor)||!segmentClear(actor.position,via,incoming,actor))continue;
      bestCost=cost;best={position:[...pose.position],arrival:{via:[...via],heading:pose.heading}};
    }
  }
  // Keep the ordinary global route search when no locally certified entry exists.
  return best??{position:[...ranked[0].pose.position],arrival:null};
}
