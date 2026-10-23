import {waterSurfaceBelow,resolveWaterSupport} from './water-support.mjs';
import {bodyMetrics} from './body-metrics.mjs';
import {tagActive} from './food-stock.mjs';
import {Triangle,Vector3,Ray} from 'three';
import {ZONES} from './world-spec.mjs';
import {insideHabitatGround,resolveHabitatGround} from './habitat-ground.mjs';

const url=new URL('./assets/room-collision.bin',import.meta.url);
const bytes=typeof process!=='undefined'&&Boolean(process.versions?.node)?await (await import('node:fs/promises')).readFile(url):new Uint8Array(await (await fetch(url)).arrayBuffer());
const metadataUrl=new URL('./assets/room-collision.json',import.meta.url);
const metadata=typeof process!=='undefined'&&Boolean(process.versions?.node)?JSON.parse(await (await import('node:fs/promises')).readFile(metadataUrl,'utf8')):await (await fetch(metadataUrl)).json();
const floating=metadata.format==='float32-v1'||metadata.format===2;
const bytesPerTriangle=floating?40:20,unit=floating?1:(metadata.scale??1000);
if(bytes.byteLength%bytesPerTriangle)throw new Error('Room collision mesh is truncated');
const data=floating?new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4):new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2),count=data.length/10;
const bounds=new Float32Array(count*6);
for(let i=0;i<count;i++)for(let a=0;a<3;a++){
 const o=i*10;bounds[i*6+a]=Math.min(data[o+a],data[o+3+a],data[o+6+a])/unit;
 bounds[i*6+3+a]=Math.max(data[o+a],data[o+3+a],data[o+6+a])/unit;
}
function build(ids){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const id of ids)for(let a=0;a<3;a++){min[a]=Math.min(min[a],bounds[id*6+a]);max[a]=Math.max(max[a],bounds[id*6+3+a]);}
 if(ids.length<=24)return {min,max,ids};
 let axis=0;for(let a=1;a<3;a++)if(max[a]-min[a]>max[axis]-min[axis])axis=a;
 ids.sort((a,b)=>(bounds[a*6+axis]+bounds[a*6+axis+3])-(bounds[b*6+axis]+bounds[b*6+axis+3]));
 const mid=ids.length>>1;return {min,max,left:build(ids.slice(0,mid)),right:build(ids.slice(mid))};
}
const tree=build(Array.from({length:count},(_,i)=>i)),triangle=new Triangle(),point=new Vector3(),nearest=new Vector3(),normal=new Vector3();
const loadTriangle=id=>{const o=id*10;triangle.a.set(data[o]/unit,data[o+1]/unit,data[o+2]/unit);triangle.b.set(data[o+3]/unit,data[o+4]/unit,data[o+5]/unit);triangle.c.set(data[o+6]/unit,data[o+7]/unit,data[o+8]/unit);return triangle;};
function collect(node,p,r,out){
 for(let a=0;a<3;a++)if(p[a]+r<node.min[a]||p[a]-r>node.max[a])return;
 if(node.ids){for(const id of node.ids){let hit=true;for(let a=0;a<3;a++)if(p[a]+r<bounds[id*6+a]||p[a]-r>bounds[id*6+a+3]){hit=false;break;}if(hit&&tagActive(Math.floor(data[id*10+9]/ZONES.length)))out.push(id);}}
 else{collect(node.left,p,r,out);collect(node.right,p,r,out);}
}
let digest=2166136261;for(const b of bytes)digest=Math.imul(digest^b,16777619)>>>0;
export const collisionInfo=Object.freeze({triangles:count,bytes:bytes.byteLength,precision:floating?.000001:1/unit,digest:digest.toString(16)});
export function nearbyTriangles(position,radius){
 const ids=[];collect(tree,position,radius,ids);
 // BVH layout changes when distant geometry changes. Resolve local contacts in
 // baked source order so that tree traversal cannot change physical motion.
 return ids.sort((a,b)=>a-b);
}
const contactRay=new Ray(),contactEnd=new Vector3(),contactHit=new Vector3();
// Ray queries must follow the ray through the BVH. A sphere around a long
// segment includes almost the whole room, and sorting those detailed faces
// blocks the simulation even when the actual line crosses empty space.
function rayBounds(ray,min,max,start,end){
 for(let axis=0;axis<3;axis++){
  const key=['x','y','z'][axis],origin=ray.origin[key],direction=ray.direction[key];
  if(Math.abs(direction)<1e-15){if(origin<min[axis]||origin>max[axis])return false;continue;}
  let a=(min[axis]-origin)/direction,b=(max[axis]-origin)/direction;
  if(a>b)[a,b]=[b,a];start=Math.max(start,a);end=Math.min(end,b);
  if(end<start)return false;
 }
 return true;
}
function rayFaces(node,ray,start,end,visit){
 if(!rayBounds(ray,node.min,node.max,start,end))return false;
 if(node.ids){for(const id of node.ids){
  if(!tagActive(Math.floor(data[id*10+9]/ZONES.length)))continue;
  const offset=id*6;
  if(!rayBounds(ray,bounds.subarray(offset,offset+3),bounds.subarray(offset+3,offset+6),start,end))continue;
  if(visit(id))return true;
 }return false;}
 return rayFaces(node.left,ray,start,end,visit)||rayFaces(node.right,ray,start,end,visit);
}
export function segmentOccluded(from,to,actorOrScale=1){
 const m=bodyMetrics(actorOrScale);
 contactRay.origin.set(...from);contactEnd.set(...to);const length=contactEnd.distanceTo(contactRay.origin);
 if(length<m.tolerance*2)return false;
 contactRay.direction.copy(contactEnd).sub(contactRay.origin).normalize();
 return rayFaces(tree,contactRay,0,length,id=>{
  loadTriangle(id);
  if(contactRay.intersectTriangle(triangle.a,triangle.b,triangle.c,false,contactHit)){
   const distance=contactHit.distanceTo(contactRay.origin);
   if(distance>m.tolerance&&distance<length-m.tolerance*1.5)return true;
  }
  return false;
 });
}
export function meshClearance(position,radius=.4){
 const solid=insideHabitatGround(position);
 if(solid)return {distance:0,point:[...position],zone:solid.zone};
 point.set(...position);let closest=Infinity,hit=null;
 for(const id of nearbyTriangles(position,radius)){loadTriangle(id).closestPointToPoint(point,nearest);const distance=nearest.distanceTo(point);if(distance<closest){closest=distance;hit={distance,point:nearest.toArray(),zone:ZONES[data[id*10+9]%ZONES.length].id};}}
 return hit;
}
export function resolveMeshContact(position,velocity,radius){
 const m=bodyMetrics(radius/.085);
 let support=resolveWaterSupport(position,velocity,radius)??resolveHabitatGround(position,velocity,radius);
 for(let pass=0;pass<3;pass++){
  let corrected=false;
  for(const id of nearbyTriangles(position,radius+m.tolerance*1.5)){
   point.set(...position);loadTriangle(id).closestPointToPoint(point,nearest);normal.copy(point).sub(nearest);
   const distance=normal.length();if(distance>radius+m.tolerance)continue;
   if(distance>1e-8)normal.multiplyScalar(1/distance);else triangle.getNormal(normal);
   if(normal.y>.45&&velocity[1]<.08)support={id:`mesh-${id}`,zone:ZONES[data[id*10+9]%ZONES.length].id};
   if(distance>=radius)continue;
   const depth=radius-distance+m.skin,incoming=velocity[0]*normal.x+velocity[1]*normal.y+velocity[2]*normal.z;
   position[0]+=normal.x*depth;position[1]+=normal.y*depth;position[2]+=normal.z*depth;
   if(incoming<0){velocity[0]-=incoming*normal.x;velocity[1]-=incoming*normal.y;velocity[2]-=incoming*normal.z;}
   corrected=true;
  }
  if(!corrected)break;
 }
 // The room perimeter is a boundary, including the open dollhouse cutaway.
 for(const [axis,low,high]of [[0,-5.72,5.72],[1,radius+.04,4.62],[2,-4.12,4.20]]){
  if(position[axis]<low){position[axis]=low;velocity[axis]=Math.max(0,velocity[axis]);if(axis===1)support={id:'floor',zone:'flight'};}
  if(position[axis]>high){position[axis]=high;velocity[axis]=Math.min(0,velocity[axis]);}
 }
 support=resolveWaterSupport(position,velocity,radius)??resolveHabitatGround(position,velocity,radius)??support;
 if(!support&&position[1]<=radius+.04+m.tolerance*.5)support={id:'floor',zone:'flight'};
 return support;
}

const downRay=new Ray(new Vector3(),new Vector3(0,-1,0)),rayHit=new Vector3();
export function surfaceBelow(x,y,z,maxDrop=.30,actorOrScale=1){
 const tolerance=Math.max(.000001,Math.min(.001,maxDrop/300));
 downRay.origin.set(x,y,z);let hit=waterSurfaceBelow(x,y,z,maxDrop,actorOrScale);
 let bestId=Infinity;
 rayFaces(tree,downRay,0,maxDrop,id=>{
  if(!downRay.intersectTriangle(loadTriangle(id).a,triangle.b,triangle.c,false,rayHit))return false;
  const drop=y-rayHit.y;
  if(drop<-tolerance||drop>maxDrop||hit&&(hit.position[1]>rayHit.y||hit.position[1]===rayHit.y&&(bestId===Infinity||bestId<id)))return false;
  hit={position:rayHit.toArray(),zone:ZONES[data[id*10+9]%ZONES.length].id};bestId=id;return false;
 });
 return hit;
}

export function supportedFeet(position,heading=0,actorOrScale=1){
 const m=bodyMetrics(actorOrScale);
 let count=0;const sin=Math.sin(heading),cos=Math.cos(heading);
 for(const side of [-1,1])for(const [x,z]of [[.0966,.10098],[.1177,-.00198],[.09878,-.11088]]){
  const dx=(side*x*cos+z*sin)*m.scale,dz=(-side*x*sin+z*cos)*m.scale;
  for(const inset of [1,.8,.6,.35,0]){
   const hit=surfaceBelow(position[0]+dx*inset,position[1]-.015*m.scale,position[2]+dz*inset,m.footDrop,m.scale);
   if(hit){count++;break;}
  }
 }
 return count;
}
