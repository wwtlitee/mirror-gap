import {bodyMetrics} from './body-metrics.mjs';
import {portionActive} from './food-stock.mjs';
import {committedTo} from './activity-commitment.mjs';
import {activeResourceSession} from './resource-session.mjs';
import {activityAvailable} from './activity-cooldowns.mjs';
import {activityPermitted,focusedActivity} from './behavior-focus.mjs';
import {Box3,Triangle,Vector3,Ray} from 'three';
import {segmentOccluded} from './collision-world.mjs';
import {readResourceSurfaces} from './resource-data.mjs';
export const MOUTH_REACH=.14;
const validPosition=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function faces(values){
 if(!Array.isArray(values)||values.length%9||!values.every(Number.isFinite))throw Error('Invalid resource geometry');
 return Array.from({length:values.length/9},(_,i)=>{const triangle=new Triangle(...[0,3,6].map(k=>new Vector3(...values.slice(i*9+k,i*9+k+3))));return {triangle,box:new Box3().setFromPoints([triangle.a,triangle.b,triangle.c])};});
}
function tree(items){
 const box=new Box3();for(const item of items)box.union(item.box);
 if(items.length<=16)return {box,items};
 const size=box.getSize(new Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
 items.sort((a,b)=>(a.box.min[axis]+a.box.max[axis])-(b.box.min[axis]+b.box.max[axis]));const mid=items.length>>1;
 return {box,left:tree(items.slice(0,mid)),right:tree(items.slice(mid))};
}
// New tagged objects use the same index, without behaviour branches by name.
// A BVH keeps detailed food meshes out of the per-tick linear scan.
export function createResourceIndex(entries,{occluded=()=>false}={}){
 const ids=new Set(),resources=entries.map(entry=>{
  if(!entry.id||ids.has(entry.id)||!['food','water'].includes(entry.kind))throw Error('Invalid resource metadata');ids.add(entry.id);
  const edible=faces(entry.faces).map((face,i)=>({...face,piece:entry.facePortions?.[i],neighbor:entry.faceNeighbors?.[i]}));if(!edible.length)throw Error('Empty resource surface');
  return {...entry,tree:tree(edible),blockers:faces(entry.inedible??[]).map((face,i)=>({...face,piece:entry.inediblePortions?.[i],neighbor:entry.inedibleNeighbors?.[i]}))};
 });
 const probe=new Vector3(),point=new Vector3(),hit=new Vector3(),ray=new Ray();
 function nearest(position,kind,{visible=false,maxDistance=Infinity,id=null,bodyScale=1}={}){
  const m=bodyMetrics(bodyScale);
  if(!validPosition(position))return null;probe.set(...position);let result=null,limit=maxDistance;
  const blocked=()=>resources.some(resource=>resource.blockers.some(({triangle,box,piece,neighbor})=>(piece===undefined||piece<0||portionActive(resource.id,piece))&&(neighbor===undefined||neighbor<0||!portionActive(resource.id,neighbor))&&ray.intersectsBox(box)&&ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit)&&hit.distanceTo(probe)<point.distanceTo(probe)-m.tolerance));
  function visit(node,resource){
   if(node.box.distanceToPoint(probe)>limit)return;
   if(node.items){for(const {triangle,piece,neighbor}of node.items){if(piece>=0&&!portionActive(resource.id,piece)||neighbor>=0&&portionActive(resource.id,neighbor))continue;triangle.closestPointToPoint(probe,point);const distance=point.distanceTo(probe);if(distance>limit)continue;
    if(visible){ray.origin.copy(probe);ray.direction.copy(point).sub(probe).normalize();if(blocked()||occluded(probe.toArray(),point.toArray(),m.scale))continue;}
    limit=distance;result={id:resource.id,label:resource.label,kind:resource.kind,point:point.toArray(),distance};
   }}else{const first=node.left.box.distanceToPoint(probe)<=node.right.box.distanceToPoint(probe)?node.left:node.right;visit(first,resource);visit(first===node.left?node.right:node.left,resource);}
  }
  for(const r of resources.filter(r=>r.kind===kind&&(!id||r.id===id)).sort((a,b)=>a.tree.box.distanceToPoint(probe)-b.tree.box.distanceToPoint(probe)))visit(r.tree,r);
  return result;
 }
 function withinReach(actor,kind){const m=bodyMetrics(actor);return actor?.contact?nearest(actor.position,kind,{maxDistance:m.resourceReach}):null;}
 function contact(actor,kind){
  if(!withinReach(actor,kind)||!Number.isFinite(actor.heading))return null;
  const m=bodyMetrics(actor),sin=Math.sin(actor.heading),cos=Math.cos(actor.heading),mouth=[actor.position[0]+sin*m.mouthForward,actor.position[1]-m.mouthDown,actor.position[2]+cos*m.mouthForward];
  const resource=nearest(mouth,kind,{visible:true,maxDistance:m.mouthReach,bodyScale:m.scale});if(!resource)return null;
  const dx=resource.point[0]-actor.position[0],dz=resource.point[2]-actor.position[2];
  if((dx*sin+dz*cos)/Math.max(.001*m.scale,Math.hypot(dx,dz))<.5)return null;
  return {...resource,mouth};
 }
 const signals=resources.map(r=>({id:r.signalId??`resource-${r.id}`,resourceId:r.id,resourceKind:r.kind,kind:r.kind==='food'?'odor':'water',label:r.label,zone:r.zone,scope:'resource',range:r.kind==='food'?5.5:3,position:[(r.tree.box.min.x+r.tree.box.max.x)/2,r.tree.box.max.y+.07,(r.tree.box.min.z+r.tree.box.max.z)/2]}));
 function surfaceCandidates(id){
  const resource=resources.find(resource=>resource.id===id);if(!resource)return [];
  const candidates=[];
  function visit(node){if(node.items){for(const {triangle,piece,neighbor} of node.items){
   if(piece>=0&&!portionActive(resource.id,piece)||neighbor>=0&&portionActive(resource.id,neighbor))continue;
   const normal=triangle.getNormal(new Vector3());if(normal.y<.35)continue;
   candidates.push(triangle.getMidpoint(new Vector3()).toArray());
  }}else{visit(node.left);visit(node.right);}}
  visit(resource.tree);return candidates;
 }
 return {nearest,withinReach,contact,signals,surfaceCandidates};
}
const entries=await readResourceSurfaces();
export const resourceIndex=createResourceIndex(entries,{occluded:segmentOccluded});
export const RESOURCE_SIGNALS=resourceIndex.signals;
export const resourceSurfaceCandidates=id=>resourceIndex.surfaceCandidates(id);
export const nearestResource=(position,kind,options)=>resourceIndex.nearest(position,kind,options);
export const resourceWithinReach=(actor,kind)=>resourceIndex.withinReach(actor,kind);
export const resourceContact=(actor,kind)=>resourceIndex.contact(actor,kind);
export function bodyWaterContact(actor){return Boolean(actor?.contact&&nearestResource(actor.position,'water',{maxDistance:.105*bodyMetrics(actor).scale}));}
export function resourceIntent(state){
 const p=state.living.physiology,candidates=[],focus=focusedActivity(state);
 if(activityPermitted(state,'eat')&&activityAvailable(state,'eat')&&state.home.food>0&&state.needs.satiety<(state.actor.action==='eat'||focus==='eat'||committedTo(state,'eat')||activeResourceSession(state,'food')?99.5:55)){const target=resourceWithinReach(state.actor,'food');if(target)candidates.push({...target,urgency:1-state.needs.satiety/100});}
 if(activityPermitted(state,'drink')&&activityAvailable(state,'drink')&&state.home.water>0&&p.thirst>(state.living.behavior==='drink'||focus==='drink'||committedTo(state,'drink')||activeResourceSession(state,'water')?.005:.22)){const target=resourceWithinReach(state.actor,'water');if(target)candidates.push({...target,urgency:p.thirst});}
 return candidates.filter(target=>{
  if((state.living.navigation?.failedUntil?.['resource:'+target.id]??0)>state.simSeconds)return false;
  const dx=target.point[0]-state.actor.position[0],dz=target.point[2]-state.actor.position[2];
  const heading=Math.hypot(dx,dz)>.005*bodyMetrics(state.actor).scale?Math.atan2(dx,dz):state.actor.heading;
  return Boolean(resourceContact({...state.actor,heading},target.kind));
 }).sort((a,b)=>b.urgency-a.urgency||a.distance-b.distance)[0]??null;
}
