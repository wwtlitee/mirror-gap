import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Ray,Triangle,Vector3} from 'three';
import {nearbyTriangles,segmentOccluded,surfaceBelow} from '../public/collision-world.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';
import {waterSurfaceBelow} from '../public/water-support.mjs';
import {ZONES} from '../public/world-spec.mjs';
import {withFoodStock,FOOD_IDS} from '../public/food-stock.mjs';

const buffer=fs.readFileSync(new URL('../public/assets/room-collision.bin',import.meta.url));
const data=new Float32Array(buffer.buffer,buffer.byteOffset,buffer.byteLength/4);
const triangle=new Triangle(),hit=new Vector3();
function load(id){const offset=id*10;triangle.a.fromArray(data,offset);triangle.b.fromArray(data,offset+3);triangle.c.fromArray(data,offset+6);return triangle;}
// Reference the previous broad-phase implementation, with the same baked
// faces, food state, endpoint tolerance and source-order tie breaking.
function referenceSegment(from,to,scale){
 const m=bodyMetrics(scale),origin=new Vector3(...from),direction=new Vector3(...to).sub(origin),length=direction.length();
 if(length<m.tolerance*2)return false;
 const ray=new Ray(origin,direction.normalize()),middle=from.map((v,i)=>(v+to[i])/2);
 for(const id of nearbyTriangles(middle,length/2+m.tolerance*.5)){
  load(id);if(ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit)){
   const distance=hit.distanceTo(origin);if(distance>m.tolerance&&distance<length-m.tolerance*1.5)return true;
  }
 }return false;
}
function referenceBelow(x,y,z,drop,scale){
 const ray=new Ray(new Vector3(x,y,z),new Vector3(0,-1,0)),tolerance=Math.max(.000001,Math.min(.001,drop/300));
 let result=waterSurfaceBelow(x,y,z,drop,scale);
 for(const id of nearbyTriangles([x,y-drop/2,z],drop/2+tolerance*2)){
  load(id);if(!ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit))continue;
  if(y-hit.y<-tolerance||y-hit.y>drop||result&&result.position[1]>=hit.y)continue;
  result={position:hit.toArray(),zone:ZONES[data[id*10+9]%ZONES.length].id};
 }return result;
}
test('BVH ray traversal matches the previous queries across room, food stock and body scales',()=>{
 const points=[[-3.11,1.4,1.55],[-3.01,1.4,1.73],[-3.94,1.5,.48],[-2.82,1.3,2.48],[-3.68,1.5,1.12],[-4.05,1.3,1.85],[-3.6,1.4,2.3],[4.5,.6,3.1],[4.3,.8,.5],[4.96,2.2,-.1],[-1.2,1.7,-3.15],[0,3,0],[3.1,1.5,-3.88]];
 for(const amount of [100,12.5,0])withFoodStock({companion:{},living:{care:{foods:Object.fromEntries(FOOD_IDS.map(id=>[id,amount]))}}},()=>{
  for(const scale of [1,.06])for(const [i,p]of points.entries()){
   const target=points[(i+4)%points.length];
   assert.equal(segmentOccluded(p,target,scale),referenceSegment(p,target,scale),`segment ${i} stock ${amount} scale ${scale}`);
   for(const drop of [.08,.3,1.7])assert.deepEqual(surfaceBelow(...p,drop,scale),referenceBelow(...p,drop,scale),`below ${i} stock ${amount} drop ${drop}`);
  }
 });
});
