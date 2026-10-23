import {meshClearance,segmentOccluded} from './collision-world.mjs';
import {foodGeometryKey} from './food-stock.mjs';
import {bodyMetrics} from './body-metrics.mjs';

const validPoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const interpolate=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const direction=(a,b)=>{const d=distance(a,b);return d>1e-8?b.map((v,i)=>(v-a[i])/d):[0,0,0];};
const validArrival=value=>value===null||Boolean(value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===2&&validPoint(value.via)&&Number.isFinite(value.heading));
const copyArrival=value=>value?{via:[...value.via],heading:value.heading}:null;
const sameArrival=(a,b)=>!a&&!b||Boolean(a&&b&&distance(a.via,b.via)<1e-6&&Math.abs(a.heading-b.heading)<1e-6);
const ROOM_BOUNDS=[[-5.72,.125,-4.12],[5.72,4.62,4.20]];

const NEIGHBORS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

// A deterministic heap keeps search work bounded independently of rendering.
class MinHeap{
 constructor(){this.items=[];this.serial=0;}
 push(id,cost){const item={id,cost,serial:this.serial++},a=this.items;let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(this.before(a[p],item))break;a[i]=a[p];i=p;}a[i]=item;}
 before(a,b){return a.cost<b.cost||a.cost===b.cost&&a.serial<b.serial;}
 pop(){const a=this.items,result=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&this.before(a[child+1],a[child]))child++;if(this.before(last,a[child]))break;a[i]=a[child];i=child;}a[i]=last;}return result;}
 get length(){return this.items.length;}
}

// Geometry caches contain only static occupancy and edges. Actor state, route
// progress and timing remain in the serializable route, never in this cache.
export function createRoutePlanner({clearance=meshClearance,occluded=segmentOccluded,bounds=ROOM_BOUNDS,spacing=.4,maxExpanded=5000,bodyScale=1}={}){
 if(!Array.isArray(bounds)||bounds.length!==2||!bounds.every(validPoint)||bounds[0].some((v,i)=>v>=bounds[1][i])||!(spacing>=.2&&spacing<=.8)||!Number.isSafeInteger(maxExpanded)||maxExpanded<1)throw Error('Invalid route planner configuration');
 const m=bodyMetrics(bodyScale),TRANSIT_RADIUS=m.transitRadius;
 const floor=bounds===ROOM_BOUNDS?.04+m.radius:bounds[0][1];
 const effectiveBounds=[[bounds[0][0],floor,bounds[0][2]],bounds[1]];
 const low=effectiveBounds[0].map((v,i)=>v+(i===1?TRANSIT_RADIUS-m.radius+.02:TRANSIT_RADIUS)),high=bounds[1].map(v=>v-TRANSIT_RADIUS);
 const size=low.map((v,i)=>Math.floor((high[i]-v)/spacing)+1),occupancy=new Map(),edges=new Map();
 let geometryKey='';
 const key=c=>c.join(','),point=c=>c.map((v,i)=>low[i]+v*spacing);
 const inside=p=>p.every((v,i)=>v>=effectiveBounds[0][i]-m.tolerance*.5&&v<=bounds[1][i]+m.tolerance*.5);
 const transitPoint=p=>inside(p)&&!(clearance(p,TRANSIT_RADIUS)?.distance<TRANSIT_RADIUS);
 const open=c=>{if(c.some((v,i)=>v<0||v>=size[i]))return false;const id=key(c);if(!occupancy.has(id))occupancy.set(id,transitPoint(point(c)));return occupancy.get(id);};
 function transitSegment(from,to){
  const length=distance(from,to),steps=Math.max(1,Math.ceil(length/.07));
  // The extra 4 cm over the complete body envelope exceeds half a sample
  // interval, so no thin triangle can be skipped between these samples.
  for(let i=0;i<=steps;i++)if(!transitPoint(interpolate(from,to,i/steps)))return false;
  return true;
 }
 function bodySegment(from,to,heading){
  if(!validPoint(from)||!validPoint(to)||!Number.isFinite(heading)||!inside(from)||!inside(to))return false;
  const length=distance(from,to),steps=Math.max(1,Math.ceil(length/.025));
  for(const offset of m.offsets){
   const shift=[Math.sin(heading)*offset,0,Math.cos(heading)*offset],a=from.map((v,i)=>v+shift[i]),b=to.map((v,i)=>v+shift[i]);
   if(occluded(a,b,m.scale))return false;
   for(let i=0;i<=steps;i++){
    const t=i/steps,p=interpolate(a,b,t);
    // Surface contact at an endpoint is legal; the middle of a flight segment
    // requires clearance. Navigation never counts hovering as resource contact.
    const radius=m.radius-m.tolerance*.5+Math.min(.014,t*length*.25,(1-t)*length*.25);
    if(!inside(p)||clearance(p,radius)?.distance<radius)return false;
   }
  }
  return true;
 }
 function connections(position,heading,arriving=false){
  const center=position.map((v,i)=>Math.round((v-low[i])/spacing)),found=[];
  for(let x=-2;x<=2;x++)for(let y=-2;y<=2;y++)for(let z=-2;z<=2;z++){
   const cell=center.map((v,i)=>v+[x,y,z][i]);if(!open(cell))continue;
   const p=point(cell),d=distance(position,p);if(d>spacing*2.2)continue;
   found.push({cell,point:p,distance:d});
  }
  found.sort((a,b)=>a.distance-b.distance);
  // Only a handful of endpoint connectors are needed; grid edges are shared.
  const connected=[];
  for(const candidate of found){
   const travelHeading=Math.atan2(candidate.point[0]-position[0],candidate.point[2]-position[2])+(arriving?Math.PI:0);
   if(bodySegment(position,candidate.point,heading)&&bodySegment(position,candidate.point,travelHeading))connected.push(candidate);
   if(connected.length>=12)break;
  }
  return connected;
 }
 function edge(a,b){const ak=key(a),bk=key(b),id=ak<bk?ak+'|'+bk:bk+'|'+ak;if(!edges.has(id))edges.set(id,transitSegment(point(a),point(b)));return edges.get(id);}
 function plan(actor,goal,arrival=null){
  const nextKey=foodGeometryKey();if(geometryKey!==nextKey){occupancy.clear();edges.clear();geometryKey=nextKey;}
  if(!validPoint(actor?.position)||!Number.isFinite(actor.heading)||!validPoint(goal))throw Error('Invalid route endpoints');
  if(!validArrival(arrival))throw Error('Invalid route arrival');
  const from=actor.position,failed=(reason,expanded)=>({status:'unreachable',reason,goal:[...goal],waypoints:[],expanded});
  if(!inside(from))return failed('start-blocked',0);
  if(!inside(goal))return failed('goal-blocked',0);
  if(arrival){
   if(!bodySegment(arrival.via,goal,arrival.heading))return failed('goal-blocked',0);
   const lead=plan(actor,arrival.via);
   if(lead.status!=='ready'||!lead.waypoints.length||distance(lead.waypoints.at(-1),arrival.via)>1e-8)return failed(lead.reason??'goal-blocked',lead.expanded);
   return {status:'ready',goal:[...goal],waypoints:[...lead.waypoints.map(point=>[...point]),[...goal]],expanded:lead.expanded};
  }
  const facing=Math.atan2(goal[0]-from[0],goal[2]-from[2]);
  // A direct segment must clear the actual body envelope at both headings.
  if(bodySegment(from,goal,actor.heading)&&bodySegment(from,goal,facing))return {status:'ready',goal:[...goal],waypoints:[[...goal]],expanded:0};
  const starts=connections(from,actor.heading);if(!starts.length)return failed('start-blocked',0);
  let goals=[],endpoint=null;
  // Surface cues may name the surface itself rather than a body centre. A
  // small vertical staging point lets ordinary gravity/contact finish arrival.
  for(const lift of [0,.04*m.scale,.09*m.scale,.16*m.scale,.24*m.scale,.04,.09,.16,.24]){
   const candidate=[goal[0],goal[1]+lift,goal[2]];if(!inside(candidate))continue;
   goals=connections(candidate,facing,true);if(goals.length){endpoint=candidate;break;}
  }
  if(!goals.length)return failed('goal-blocked',0);
  const endings=new Map(goals.map(c=>[key(c.cell),c])),cost=new Map(),parents=new Map(),closed=new Set(),heap=new MinHeap();
  for(const start of starts){const id=key(start.cell);cost.set(id,start.distance);parents.set(id,null);heap.push(id,start.distance+distance(start.point,endpoint));}
  let expanded=0,finish=null;
  while(heap.length&&expanded<maxExpanded){
   const {id}=heap.pop();if(closed.has(id))continue;closed.add(id);expanded++;
   if(endings.has(id)){finish=id;break;}
   const cell=id.split(',').map(Number);
   for(const step of NEIGHBORS){const next=cell.map((v,i)=>v+step[i]),nextId=key(next);if(closed.has(nextId)||!open(next)||!edge(cell,next))continue;
    const nextCost=cost.get(id)+spacing;if(nextCost>=(cost.get(nextId)??Infinity))continue;
    cost.set(nextId,nextCost);parents.set(nextId,id);heap.push(nextId,nextCost+distance(point(next),endpoint));
   }
  }
  if(finish===null)return failed('no-route',expanded);
  const path=[];for(let id=finish;id!==null;id=parents.get(id))path.push(point(id.split(',').map(Number)));path.reverse();
  // Smooth only between fully clear transit nodes. Endpoint connectors retain
  // their tested body heading and cannot cut through a table or canopy.
  const smooth=[];for(let i=0;i<path.length;){smooth.push(path[i]);let next=i+1;for(let j=path.length-1;j>i+1;j--)if(transitSegment(path[i],path[j])){next=j;break;}i=next;}
  smooth.push(endpoint);
  return {status:'ready',goal:[...goal],waypoints:smooth,expanded};
 }
 return {plan,segmentClear:bodySegment,transitClear:transitSegment,cacheStats:()=>({nodes:occupancy.size,edges:edges.size})};
}

const planners=new Map();
function plannerFor(actorOrScale=1){
 const scale=bodyMetrics(actorOrScale).scale,key=scale.toFixed(4);
 if(!planners.has(key)){if(planners.size>=12)planners.delete(planners.keys().next().value);planners.set(key,createRoutePlanner({bodyScale:Number(key)}));}
 return planners.get(key);
}
export const planRoute=(actor,goal,arrival=null)=>plannerFor(actor).plan(actor,goal,arrival);
export const routeSegmentClear=(from,to,heading=0,actorOrScale=1)=>plannerFor(actorOrScale).segmentClear(from,to,heading);

export function validateRoute(route){
 if(route?.arrival!==undefined&&!validArrival(route.arrival))throw Error('Invalid route arrival checkpoint');
 if(!route||typeof route.targetId!=='string'||!validPoint(route.goal)||!Array.isArray(route.waypoints)||route.waypoints.length>128||!route.waypoints.every(validPoint)||!Number.isSafeInteger(route.index)||route.index<0||route.index>route.waypoints.length||!['ready','arrived','unreachable','stalled'].includes(route.status)||!validPoint(route.direction)||!['remainingDistance','plannedAt','lastProgressAt','bestRemaining','replans','checkedAt'].every(k=>Number.isFinite(route[k])&&route[k]>=0))throw Error('Invalid route checkpoint');
 if(route.reason!=null&&!['start-blocked','goal-blocked','no-route'].includes(route.reason))throw Error('Invalid route failure reason');
}

export function updateRoute(actor,targetId,goal,previous=null,now=0,arrival=null){
 if(typeof targetId!=='string'||!Number.isFinite(now)||now<0||!validPoint(goal)||!validPoint(actor?.position)||!Number.isFinite(actor.heading))throw Error('Invalid route update');
 if(!validArrival(arrival))throw Error('Invalid route arrival');
 const m=bodyMetrics(actor);
 let route=previous;
 const changed=!route||route.targetId!==targetId||distance(route.goal,goal)>Math.max(.006,.28*m.scale)||Math.abs((route.bodyScale??1)-m.scale)>m.scale*.015||!sameArrival(route.arrival,arrival);
 const make=()=>{const result=planRoute(actor,goal,arrival);return {bodyScale:m.scale,targetId,goal:[...goal],arrival:copyArrival(arrival),waypoints:result.waypoints,index:0,status:result.status,reason:result.reason??null,direction:[0,0,0],remainingDistance:0,plannedAt:now,lastProgressAt:now,bestRemaining:0,replans:changed?0:(route?.replans??0)+1,checkedAt:now};};
 if(changed)route=make();
 if(['unreachable','stalled'].includes(route.status))return route;
 if(route.status==='arrived'&&distance(actor.position,route.waypoints.at(-1))>.22*m.scale){route.index=route.waypoints.length-1;route.lastProgressAt=now;route.bestRemaining=0;}
 while(route.index<route.waypoints.length&&distance(actor.position,route.waypoints[route.index])<(route.index===route.waypoints.length-1?.06*m.scale:.16))route.index++;
 if(route.index>=route.waypoints.length){route.status='arrived';route.direction=[0,0,0];route.remainingDistance=0;return route;}
 if(now-route.checkedAt>=2){
  route.checkedAt=now;
  if(!routeSegmentClear(actor.position,route.waypoints[route.index],actor.heading,actor)){
   if(route.replans>=2){route.status='stalled';route.direction=[0,0,0];return route;}
   route=make();if(route.status!=='ready')return route;
  }
 }
 route.status='ready';route.direction=direction(actor.position,route.waypoints[route.index]);
 route.remainingDistance=distance(actor.position,route.waypoints[route.index]);
 for(let i=route.index+1;i<route.waypoints.length;i++)route.remainingDistance+=distance(route.waypoints[i-1],route.waypoints[i]);
 // Establish a fresh plan's baseline without forgiving its failed predecessor.
 // Only observed travel along this plan clears consecutive replan failures.
 if(!route.bestRemaining){route.bestRemaining=route.remainingDistance;route.lastProgressAt=now;}
 else if(route.remainingDistance<=route.bestRemaining-Math.max(.003,.08*m.scale)){route.bestRemaining=route.remainingDistance;route.lastProgressAt=now;route.replans=0;}
 if(now-route.lastProgressAt>10){route.status='stalled';route.direction=[0,0,0];}
 return route;
}
