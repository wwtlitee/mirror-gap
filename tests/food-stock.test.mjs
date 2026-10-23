import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {createCare} from '../public/pet-care.mjs';
import {FOOD_IDS,foodStock,withFoodStock,consumeFood,refillFood,visiblePieces,portionTag,tagActive,syncFoodTotal} from '../public/food-stock.mjs';
import {nearestResource} from '../public/resource-contact.mjs';
import {resourceLandingPoses} from '../public/resource-landing.mjs';
import {nearbyTriangles} from '../public/collision-world.mjs';
import {ZONES} from '../public/world-spec.mjs';
import {companionCheckpoint,restoreCompanion} from '../public/companion-checkpoint.mjs';
import {readResourceSurfaces} from '../public/resource-data.mjs';
const state=()=>{const s=new EmbodiedLife().state;s.companion=createCompanion();adoptCompanion(s.companion,'小块');s.living.care=createCare();s.home.food=100;foodStock(s);return s;};
test('only the eaten food loses stock; refill and checkpoint retain seven independent amounts',()=>{
 const s=state();consumeFood(s,'banana',100/FOOD_IDS.length);assert.equal(foodStock(s).banana,0);assert.equal(foodStock(s).apple,100);assert.ok(Math.abs(s.home.food-600/7)<1e-8);
 const cp=companionCheckpoint(s),b=state();restoreCompanion(b,cp);assert.equal(foodStock(b).banana,0);refillFood(b,{replace:true});assert.ok(Object.values(foodStock(b)).every(n=>n===100));
 delete cp.habitat.care.foods;restoreCompanion(b,cp);assert.ok(Object.values(foodStock(b)).every(n=>n===cp.habitat.food));
});
test('empty food disappears from both edible surfaces and baked collision triangles',()=>{
 const s=state(),bytes=fs.readFileSync(new URL('../public/assets/room-collision.bin',import.meta.url));
 const meta=JSON.parse(fs.readFileSync(new URL('../public/assets/room-collision.json',import.meta.url),'utf8'));
 const floating=meta.format==='float32-v1',faces=floating?new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4):new Int16Array(bytes.buffer,bytes.byteOffset,bytes.length/2),unit=floating?1:meta.scale;
 const tag=portionTag('banana',7);let index=-1;for(let i=0;i<faces.length;i+=10)if(Math.floor(faces[i+9]/ZONES.length)===tag){index=i/10;break;}assert.ok(index>=0);
 const o=index*10,point=[0,1,2].map(a=>(faces[o+a]+faces[o+3+a]+faces[o+6+a])/(3*unit));
 assert.ok(withFoodStock(s,()=>nearbyTriangles(point,.01).includes(index)));
 foodStock(s).banana=0;syncFoodTotal(s);
 assert.ok(!withFoodStock(s,()=>nearbyTriangles(point,.01).includes(index)));
 assert.equal(withFoodStock(s,()=>nearestResource(point,'food',{id:'banana'})),null);
 assert.ok(withFoodStock(s,()=>nearestResource(point,'food',{id:'apple'})));
});
test('each food remains reachable with one remaining slice, and context cannot leak between pets',()=>{
 const s=state();for(const id of FOOD_IDS)foodStock(s)[id]=12.5;syncFoodTotal(s);
 withFoodStock(s,()=>{for(const id of FOOD_IDS){assert.equal(visiblePieces(id),1);assert.ok(resourceLandingPoses(id).length>0,`last ${id} slice must remain reachable`);}});
 for(const id of FOOD_IDS)assert.equal(visiblePieces(id),8);
 assert.throws(()=>withFoodStock(s,()=>{throw Error('test');}));assert.equal(visiblePieces('apple'),8);
});

test('every portion includes edible triangles and every stock stage has a reachable meal',async()=>{
 const resources=await readResourceSurfaces(),s=state();
 for(const id of FOOD_IDS)assert.equal(new Set(resources.find(r=>r.id===id).facePortions).size,8,`${id} must have eight edible portions`);
 for(let count=1;count<=8;count++){
  for(const id of FOOD_IDS)foodStock(s)[id]=count*12.5;syncFoodTotal(s);
  withFoodStock(s,()=>{for(const id of FOOD_IDS)assert.ok(resourceLandingPoses(id).length,`${id}: ${count} portions must be reachable`);});
 }
});

test('a cut face becomes solid only after its neighboring portion has gone',()=>{
 const s=state(),tag=portionTag('apple',0,7);
 assert.equal(withFoodStock(s,()=>tagActive(tag)),false);
 foodStock(s).apple=50;assert.equal(withFoodStock(s,()=>tagActive(tag)),true);
 foodStock(s).apple=0;assert.equal(withFoodStock(s,()=>tagActive(tag)),false);
});
