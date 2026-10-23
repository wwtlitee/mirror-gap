import {bodyMetrics} from './body-metrics.mjs';
import {foodGeometryKey} from './food-stock.mjs';
import {RESOURCE_SIGNALS, nearestResource, resourceContact, resourceSurfaceCandidates} from './resource-contact.mjs';
import {surfaceBelow, supportedFeet} from './collision-world.mjs';
import {resolveBodyContacts,moveBody} from './environment-spec.mjs';
import {selectResourceArrival} from './resource-arrival.mjs';

// Static geometry is checked once. An edible surface alone is not a usable perch.
const cache = new Map();
const MAX_POSES=12,MAX_CANDIDATES=256,STABILITY_STEPS=80,STABILITY_DT=.02;

// A static contact can still slide off a curved fruit when the head turns.
// Probe a copy with the same held-body gravity and turn rate, then return its
// physical equilibrium. This never changes the live actor or suppresses a
// collision correction. Cold probes are bounded and cached per baked source,
// body scale and active food geometry; neural/physics ticks reuse the result.
export function stableResourceLandingPose(pose,kind,id){
 if(!Array.isArray(pose?.position)||pose.position.length!==3||!pose.position.every(Number.isFinite)||!Number.isFinite(pose.heading)||!['food','water'].includes(kind)||!id)return null;
 // A three-foot touch is enough for a live transient contact, but is a poor
 // sustained destination. Reject it before spending a gravity-probe budget.
 if(supportedFeet(pose.position,pose.heading,pose)<6)return null;
 const m=bodyMetrics(pose),actor={...pose,position:[...pose.position]},initial=[...pose.position],velocity=[0,0,0];
 let quiet=0;
 for(let tick=0;tick<STABILITY_STEPS;tick++){
  const resource=nearestResource(actor.position,kind,{maxDistance:m.resourceReach});
  if(!resource||resource.id!==id)return null;
  const dx=resource.point[0]-actor.position[0],dz=resource.point[2]-actor.position[2];
  const desired=Math.hypot(dx,dz)>.005*m.scale?Math.atan2(dx,dz):actor.heading;
  const turn=Math.atan2(Math.sin(desired-actor.heading),Math.cos(desired-actor.heading)),previous=[...actor.position];
  if(Math.abs(turn)>.01)actor.heading+=Math.max(-2*STABILITY_DT,Math.min(2*STABILITY_DT,turn));
  velocity[0]=velocity[2]=0;
  velocity[1]=(velocity[1]-2*STABILITY_DT)*Math.exp(-7*STABILITY_DT);
  let support=moveBody(actor.position,velocity,STABILITY_DT,actor.heading,undefined,undefined,m.scale);
  support=resolveBodyContacts(actor.position,velocity,actor.heading,undefined,undefined,m.scale)??support;
  const feet=supportedFeet(actor.position,actor.heading,m.scale);
  actor.contact=Boolean(support)&&velocity[1]<.08&&feet>=3;
  if(!actor.contact||resourceContact(actor,kind)?.id!==id||Math.hypot(...actor.position.map((v,i)=>v-initial[i]))>m.radius*.5)return null;
  const displacement=Math.hypot(...actor.position.map((v,i)=>v-previous[i]));
  // Six planted feet with only the live solver's existing sub-millimetre
  // contact drift are already a steady supported hold. Stop the copy probe
  // early; do not pin or overwrite its coordinates.
  quiet=feet===6&&Math.abs(turn)<=.01&&displacement<.002*m.scale?quiet+1:0;
  if(tick>=15&&quiet>=8)return actor;
 }
 return actor;
}

export function resourceLandingPoses(id,actorOrScale=1,{candidateBudget=Infinity,searchCache=cache}={}) {
  if(candidateBudget!==Infinity&&(!Number.isSafeInteger(candidateBudget)||candidateBudget<1||candidateBudget>MAX_CANDIDATES))throw Error('Invalid landing candidate budget');
  const metrics=bodyMetrics(actorOrScale),scale=Number(metrics.scale.toFixed(4)),m=bodyMetrics(scale);
  const cacheId=id+':'+m.key,key=foodGeometryKey();
  const source = RESOURCE_SIGNALS.find(s => s.resourceId === id);
  if (!source || source.resourceKind !== 'food'&&m.scale>=.15) return [];
  let search=searchCache.get(cacheId);
  if(search?.key!==key||search.source!==source){
    if(searchCache.size>=64&&!searchCache.has(cacheId))searchCache.delete(searchCache.keys().next().value);
    search={key,source,poses:[],cursor:0};searchCache.set(cacheId,search);
    if(m.scale<.15){
      const candidates=resourceSurfaceCandidates(id),step=Math.max(1,Math.ceil(candidates.length/MAX_CANDIDATES));
      search.candidates=candidates.filter((_,i)=>i%step===0);
    }else{
      search.candidates=[];
      for(let radius=.06;radius<=.48;radius+=.06)for(let angle=0;angle<24;angle++){
        const theta=angle*Math.PI/12;
        search.candidates.push([source.position[0]+Math.sin(theta)*radius,source.position[1],source.position[2]+Math.cos(theta)*radius]);
      }
    }
  }
  const {poses,candidates}=search;
  // Runtime callers resume this deterministic cursor between neural frames.
  // Only fully checked poses enter sensation; an unfinished probe is never a
  // fallback target. Offline callers retain the complete synchronous search.
  const end=Math.min(candidates.length,search.cursor+candidateBudget);
  if(m.scale<.15){
    while(search.cursor<end&&poses.length<MAX_POSES){
      const point=candidates[search.cursor++],surface=surfaceBelow(point[0],point[1]+m.radius*4,point[2],m.radius*8,m.scale);
      if(!surface||Math.abs(surface.position[1]-point[1])>m.radius*2)continue;
      for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
        const position=[point[0],surface.position[1]+m.radius+m.skin,point[2]],resolved=[...position];
        for(let settle=0;settle<5;settle++)resolveBodyContacts(resolved,[0,0,0],heading,undefined,undefined,m.scale);
        if(Math.hypot(...resolved.map((v,j)=>v-position[j]))>m.radius*.5)continue;
        const check=[...resolved];resolveBodyContacts(check,[0,0,0],heading,undefined,undefined,m.scale);
        if(Math.hypot(...check.map((v,j)=>v-resolved[j]))>m.tolerance)continue;
        const actor={position:check,heading,contact:true,bodyScale:m.scale};
        if(supportedFeet(check,heading,m.scale)>=3&&resourceContact(actor,source.resourceKind)?.id===id){
          const stable=stableResourceLandingPose(actor,source.resourceKind,id);
          if(stable){poses.push(stable);break;}
        }
      }
    }
    return poses;
  }
  while(search.cursor<end){
      const [x,,z]=candidates[search.cursor++];
      const surface = surfaceBelow(x, source.position[1] + .3, z, 1);
      if (!surface) continue;
      const position = [x, surface.position[1] + .0851, z];
      const food = nearestResource(position, 'food', {id, maxDistance: .24});
      if (!food) continue;
      const heading = Math.atan2(food.point[0] - x, food.point[2] - z);
      const resolved = [...position];
      resolveBodyContacts(resolved, [0, 0, 0], heading);
      if (Math.hypot(...resolved.map((v, i) => v - position[i])) > .005) continue;
      if (supportedFeet(position, heading) < 3) continue;
      const actor = {position, heading, contact: true};
      if (resourceContact(actor, 'food')?.id === id) poses.push(actor);
  }
  return poses;
}

export function resourceLandingPoint(source, position,actorOrScale=1,options) {
  if (source.resourceKind !== 'food'&&!(source.resourceKind==='water'&&bodyMetrics(actorOrScale).scale<.15)) return source.position;
  const poses = resourceLandingPoses(source.resourceId,actorOrScale,options);
  let best = null, distance = Infinity;
  for (const pose of poses) {
    const d = Math.hypot(...pose.position.map((v, i) => v - position[i]));
    if (d < distance) { distance = d; best = pose.position; }
  }
  return best;
}

/** A contact destination retains the stable pose's safe entry direction. */
export function resourceLandingTarget(source,position,actorOrScale=1,options){
  if(source.resourceKind!=='food')return {position:resourceLandingPoint(source,position,actorOrScale,options),arrival:null};
  const poses=resourceLandingPoses(source.resourceId,actorOrScale,options);
  const actor=typeof actorOrScale==='object'?actorOrScale:{position:[...position],heading:0,bodyScale:actorOrScale};
  return selectResourceArrival(poses,actor);
}
