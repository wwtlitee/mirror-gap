import {bodyMetrics} from './body-metrics.mjs';
import {supportedFeet,surfaceBelow} from './collision-world.mjs';
import {resolveBodyContacts,moveBody} from './environment-spec.mjs';
export const TOILET_BASIN={x:4.265,z:.38,halfX:.13,halfZ:.10,waterY:.46};
const rearOffset=.14;
const validActor=actor=>actor&&Array.isArray(actor.position)&&actor.position.length===3&&actor.position.every(Number.isFinite)&&Number.isFinite(actor.heading);
export function toiletPose(actor){
 if(!validActor(actor)||(!actor.contact&&(actor.supportFeet??0)<3)||actor.zoneId!=='toilet')return null;
 const m=bodyMetrics(actor),[x,y,z]=actor.position,b=TOILET_BASIN;
 if(y<(m.scale<.15?.465:.48)||y>.8)return null;
 const dx=x-b.x,dz=z-b.z,distance=Math.hypot(dx,dz);
 const sideRim=m.scale<.15&&x>=4.11&&x<=4.44&&(z>=.212&&z<=.225||z>=.535&&z<=.548);
 const heading=sideRim?(z<.38?Math.PI:0):distance>.025*m.scale?Math.atan2(dx,dz):actor.heading;
 const drop=[x-Math.sin(heading)*rearOffset*m.scale,y-.04*m.scale,z-Math.cos(heading)*rearOffset*m.scale];
 if(m.scale<.15){
  // The small insect uses the porcelain inside edge. The old adult reaches
  // across the entire rim; its historical water rectangle is too far away.
  const surface=surfaceBelow(drop[0],y+m.radius,drop[2],.2,m.scale);
  if(sideRim){
   // Six feet stay on the horizontal seat; the abdomen reaches beyond its
   // actual inner edge. A flat outer seat is not a valid discharge surface.
   if(!surface||surface.position[1]>=y-m.radius*1.15)return null;
  }else if(drop[0]<4.08||drop[0]>4.46||drop[2]<.235||drop[2]>.525||!surface||surface.position[1]>=y-m.radius*.4)return null;
 }else if(Math.abs(drop[0]-b.x)>b.halfX||Math.abs(drop[2]-b.z)>b.halfZ)return null;
 return {heading,drop};
}
export function toiletAligned(actor){
 const pose=toiletPose(actor);return Boolean(actor?.contact&&pose&&Math.abs(Math.atan2(Math.sin(actor.heading-pose.heading),Math.cos(actor.heading-pose.heading)))<.10);
}

let landingPoses=null;
const smallLandingPoses=new Map();
const adjustmentCache=new Map(),ADJUSTMENT_CACHE_LIMIT=256;
const rimStationsCache=new Map();
// Broad outer-seat landing sites, each with a short supported walk to the
// inside lip. The upright lid is not a safe landing or walking surface.
export function toiletRimStations(actorOrScale=1){
 const actual=bodyMetrics(actorOrScale);if(actual.scale>=.15)return [];
 const key=actual.scale.toFixed(4);if(rimStationsCache.has(key))return rimStationsCache.get(key);
 const m=bodyMetrics(Number(key));
 const stations=[];
 for(const x of [4.20,4.33])for(const side of [-1,1]){
  const outerZ=side<0?.205:.555,innerZ=side<0?.221:.539,heading=side<0?Math.PI:0;
  const outer=surfaceBelow(x,.7,outerZ,.25,m.scale),inner=surfaceBelow(x,.7,innerZ,.25,m.scale);
  if(!outer||!inner||outer.zone!=='toilet'||inner.zone!=='toilet')continue;
  const entry=[x,outer.position[1]+m.radius+m.skin,outerZ],position=[x,inner.position[1]+m.radius+m.skin,innerZ];
  if(supportedFeet(entry,heading,m.scale)<4||supportedFeet(position,heading,m.scale)<4)continue;
  const corridor=Array.from({length:9},(_,i)=>entry.map((v,k)=>v+(position[k]-v)*i/8));
  if(corridor.some(point=>supportedFeet(point,heading+Math.PI,m.scale)<4)||Array.from({length:9},(_,i)=>heading+Math.PI*i/8).some(turn=>supportedFeet(position,turn,m.scale)<4))continue;
  stations.push({id:`${x}:${side}`,entry,position,heading,walkHeading:heading+Math.PI,rendezvous:[x,entry[1]+.09,outerZ]});
 }
 if(rimStationsCache.size>=32)rimStationsCache.delete(rimStationsCache.keys().next().value);
 rimStationsCache.set(key,stations);
 return stations;
}
// The front lip is rounded and supports only one or two feet. Side rims offer
// actual stable stances; verify against the collision mesh instead of chasing
// the scent origin or assuming every point on the fixture can hold the body.
export function toiletLandingPoses(actorOrScale=1){
 const m=bodyMetrics(actorOrScale),scale=Number(m.scale.toFixed(4));
 if(m.scale<.15){
  const key=scale.toFixed(4);if(smallLandingPoses.has(key))return smallLandingPoses.get(key);
  const size=bodyMetrics(scale),poses=[];
  // Sample the actual sloping inside wall, above the blue water surface.
  for(const x of [4.078,4.08,4.082,4.085,4.09,4.10,4.12,4.42,4.44,4.455,4.458,4.46,4.462])for(const z of [.23,.232,.234,.235,.236,.238,.24,.245,.25,.26,.5,.51,.515,.52,.522,.524,.525,.526,.528,.53]){
   const hit=surfaceBelow(x,.75,z,.3,size.scale);if(!hit||hit.position[1]<.465)continue;
   const heading=Math.atan2(x-TOILET_BASIN.x,z-TOILET_BASIN.z),position=[x,hit.position[1]+size.radius+size.skin,z];
   resolveBodyContacts(position,[0,0,0],heading,undefined,undefined,size.scale);
   const actor={position,heading,contact:true,zoneId:'toilet',bodyScale:size.scale};
   if(supportedFeet(position,heading,size.scale)>=4&&toiletPose(actor))poses.push({position,heading,bodyScale:size.scale});
  }
  if(smallLandingPoses.size>32)smallLandingPoses.delete(smallLandingPoses.keys().next().value);
  smallLandingPoses.set(key,poses);return poses;
 }
 if(landingPoses)return landingPoses;
 const poses=[];
 for(const x of [4.265,4.225,4.305,4.345])for(const z of [.22,.54]){
  const position=[x,.6021,z],heading=Math.atan2(x-TOILET_BASIN.x,z-TOILET_BASIN.z),resolved=[...position];
  resolveBodyContacts(resolved,[0,0,0],heading);
  const actor={position,heading,contact:true,zoneId:'toilet'};
  if(Math.hypot(...resolved.map((v,i)=>v-position[i]))<.003&&supportedFeet(position,heading)>=4&&toiletPose(actor))poses.push({position,heading});
 }
 landingPoses=poses;return poses;
}
export function toiletLandingPoint(position,actorOrScale=1){
 if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))return null;
 let best=null,score=Infinity;
 for(const pose of toiletLandingPoses(actorOrScale)){
  const distance=Math.hypot(...pose.position.map((v,i)=>v-position[i]));
  if(distance<score){best=pose.position;score=distance;}
 }
 return best;
}

function localStepClear(actor,position,heading){
 const m=bodyMetrics(actor),point=[...actor.position];let facing=actor.heading;
 // Revalidate the next real footfalls from the exact supported pose. A rounded
 // cache centre cannot veto a valid stance after a few millimetres of progress.
 // The long approach belongs to navigation; this is only local rim placement.
 for(let i=0;i<3;i++){
  const turn=Math.atan2(Math.sin(heading-facing),Math.cos(heading-facing));facing+=Math.max(-.04,Math.min(.04,turn));
  const velocity=position.map((v,k)=>k===1?-.12*m.scale:Math.max(-.07*m.scale,Math.min(.07*m.scale,(v-point[k])*2)));
  const previous=[...point];
  moveBody(point,velocity,.02,facing,undefined,undefined,actor);
  if(point[1]<(m.scale<.15?.465:.53)||point[1]>.82||supportedFeet(point,facing,actor)<3||Math.hypot(...point.map((v,k)=>v-previous[k]))>.025*m.scale)return false;
 }
 return true;
}

// Local foot placement may begin on a physically adjacent supported ledge.
// Only the final real toilet contact can permit elimination in toiletPose.
export function toiletAdjustment(actor){
 const pose=toiletPose(actor);if(pose)return pose;
 const m=bodyMetrics(actor);
 if(!validActor(actor)||(!actor.contact&&(actor.supportFeet??0)<4))return null;
 const [x,y,z]=actor.position;if(y<(m.scale<.15?.465:.48)||y>.95||Math.hypot(x-TOILET_BASIN.x,z-TOILET_BASIN.z)>.55)return null;
 // A small local quantization cache is a navigation hint only. Every live
 // motion still uses collision resolution, while live support and height gates
 // above remain mandatory and cannot be bypassed by an old cached hint.
 const facing=Math.atan2(Math.sin(actor.heading),Math.cos(actor.heading));
 const cell=[Math.round(x/.03),Math.round(y/.015),Math.round(z/.03),Math.round(facing/.12)];
 const cacheKey=[m.scale.toFixed(4),...cell,actor.contact?1:0,Math.min(6,actor.supportFeet??(actor.contact?6:0))].join(',');
 // Cache static candidate order, never a canonical pose's contact verdict.
 // Stable endpoints are checked once; the next short motion is checked live.
 if(!adjustmentCache.has(cacheKey)){
  const candidates=toiletLandingPoses(actor).slice().sort((a,b)=>Math.hypot(a.position[0]-cell[0]*.03,a.position[2]-cell[2]*.03)-Math.hypot(b.position[0]-cell[0]*.03,b.position[2]-cell[2]*.03));
  if(adjustmentCache.size>=ADJUSTMENT_CACHE_LIMIT)adjustmentCache.delete(adjustmentCache.keys().next().value);
  adjustmentCache.set(cacheKey,candidates);
 }
 return adjustmentCache.get(cacheKey).find(p=>localStepClear(actor,p.position,p.heading))??null;
}
