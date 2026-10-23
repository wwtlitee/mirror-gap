import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RESOURCE_BY_ID,createNaturalFoodModel,placeResourceModel,createResourceServing,createResourceShape} from '../public/resource-spec.mjs';
import {splitFood,updateFoodPortions} from '../public/food-portions.mjs';
import {FOOD_IDS,FOOD_PIECES,withFoodStock} from '../public/food-stock.mjs';
import {createResourceIndex} from '../public/resource-contact.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';

const REFINED_FOODS = ['banana','burger','pizza','fries','sandwich','fig'];
const meshes = root => { const result=[];root.traverse(mesh=>{if(mesh.isMesh)result.push(mesh);});return result; };

function actualFood(id,{serving=true}={}) {
  const definition=RESOURCE_BY_ID[id];
  if(definition.shape==='fig')return createResourceShape(THREE,definition,{surface:new THREE.MeshBasicMaterial()});
  const model=createNaturalFoodModel(THREE,definition,{geometryOnly:true});
  assert.ok(model,`${id} must exercise the production natural builder`);
  placeResourceModel(THREE,model,definition);
  if(!serving||!definition.serving)return model;
  const root=new THREE.Group();root.add(model,createResourceServing(THREE,definition,new THREE.MeshBasicMaterial({color:0xe7bb62})));return root;
}

function triangles(mesh,{world=false}={}) {
  const {position,normal}=mesh.geometry.attributes,index=mesh.geometry.index,result=[];
  for(let i=0;i<(index?.count??position.count);i+=3) {
    const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
    const points=ids.map(id=>new THREE.Vector3().fromBufferAttribute(position,id));
    if(world)points.forEach(point=>point.applyMatrix4(mesh.matrixWorld));
    result.push({points,normal:ids.reduce((sum,id)=>sum.add(new THREE.Vector3().fromBufferAttribute(normal,id)),new THREE.Vector3())});
  }
  return result;
}

function surfaceArea(root,filter=()=>true) {
  root.updateMatrixWorld(true);let area=0;
  for(const mesh of meshes(root).filter(filter))for(const {points:[a,b,c]}of triangles(mesh,{world:true}))area+=b.sub(a).cross(c.sub(a)).length()/2;
  return area;
}

function assertSolidSlices(mesh) {
  const edges=new Map(),key=point=>point.toArray().map(value=>Math.round(value*1e7)).join(',');
  for(const {points}of triangles(mesh))for(let i=0;i<3;i++) {
    const edge=[key(points[i]),key(points[(i+1)%3])].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1);
  }
  assert.ok([...edges.values()].every(count=>count===2),`${mesh.name}: every dough, cheese, topping and crust boundary must close`);
}

for(const id of REFINED_FOODS) {
  test(`production ${id} has finite noncollapsed faces and outward winding before and after stock splitting`,()=>{
    const source=actualFood(id);
    for(const mesh of meshes(source)) {
      assert.ok([mesh.geometry.attributes.position,mesh.geometry.attributes.normal].every(attribute=>Array.from(attribute.array).every(Number.isFinite)),mesh.name);
      for(const {points:[a,b,c],normal}of triangles(mesh)) {
        const cross=b.sub(a).cross(c.sub(a));
        assert.ok(cross.lengthSq()>1e-20,`${id}: ${mesh.name} generated a collapsed face`);
        assert.ok(cross.dot(normal)>0,`${id}: ${mesh.name} generated an inward face`);
      }
    }
    const sliced=splitFood(source,RESOURCE_BY_ID[id]);
    for(const mesh of meshes(sliced))for(const {points:[a,b,c],normal}of triangles(mesh)) {
      const cross=b.sub(a).cross(c.sub(a));assert.ok(cross.lengthSq()>1e-19,`${id}: split face collapsed`);
      assert.ok(cross.dot(normal)>0,`${id}: split face winding reversed`);
    }
  });
}

test('production foods retain authored bottom anchors, local dimensions and banana long axis through yaw',()=>{
  for(const id of REFINED_FOODS) {
    const model=actualFood(id,{serving:false}),definition=RESOURCE_BY_ID[id],bounds=new THREE.Box3().setFromObject(model,true),centre=bounds.getCenter(new THREE.Vector3());
    if(id==='fig'){
      assert.ok(Math.abs(bounds.min.y-(definition.position[1]-.0578))<1e-6,'fig: existing half-fruit bottom anchor changed');
      assert.ok(Math.abs(bounds.max.x-bounds.min.x-.34)<1e-6&&Math.abs(bounds.max.z-bounds.min.z-.391)<1e-6,'fig: existing complete footprint changed');
      continue;
    }
    assert.ok(Math.abs(bounds.min.y-definition.position[1])<1e-6,`${id}: bottom anchor changed`);
    assert.ok(Math.abs(centre.x-definition.position[0])<1e-6&&Math.abs(centre.z-definition.position[2])<1e-6,`${id}: authored placement changed`);
    const yaw=model.rotation.y;model.rotation.y=0;model.updateMatrixWorld(true);
    const size=new THREE.Box3().setFromObject(model,true).getSize(new THREE.Vector3());
    size.toArray().forEach((value,i)=>assert.ok(Math.abs(value-definition.size[i])<1e-6,`${id}: local axis ${i} changed`));
    model.rotation.y=yaw;model.updateMatrixWorld(true);
    if(id==='banana') {
      const world=new THREE.Box3().setFromObject(model,true).getSize(new THREE.Vector3());
      assert.ok(size.z>4*size.x&&world.x>.49&&world.y<.18,'banana must stay long instead of being normalized after rotation');
    }
  }
});

test('real burger and sandwich ingredient layers contact instead of floating as entire disconnected slabs',()=>{
  const touching=(lower,upper,label)=>{
    const a=new THREE.Box3().setFromObject(lower,true),b=new THREE.Box3().setFromObject(upper,true);
    assert.ok(a.max.y>=b.min.y-1e-6,`${label}: complete vertical air gap between ingredients`);
    assert.ok(Math.min(a.max.x,b.max.x)>Math.max(a.min.x,b.min.x)&&Math.min(a.max.z,b.max.z)>Math.max(a.min.z,b.min.z),`${label}: ingredients have no shared footprint`);
  };
  const burger=actualFood('burger',{serving:false}),ingredient=name=>{const mesh=burger.getObjectByName(name);assert.ok(mesh,name);return mesh;};
  for(const [lower,upper]of [['Bottom_bun_crust','Bread_crumb'],['Bread_crumb','Seared_patty'],['Seared_patty','Cheese_slice'],['Cheese_slice','Ruffled_lettuce']])touching(ingredient(lower),ingredient(upper),`burger ${lower}/${upper}`);
  const sandwich=actualFood('sandwich',{serving:false}),parts=meshes(sandwich),bread=parts.filter(mesh=>mesh.name==='Bread_crust').sort((a,b)=>new THREE.Box3().setFromObject(a,true).min.y-new THREE.Box3().setFromObject(b,true).min.y);
  assert.equal(bread.length,2);
  const lettuce=sandwich.getObjectByName('Sandwich_lettuce'),cheese=sandwich.getObjectByName('Sandwich_cheese'),tomato=sandwich.getObjectByName('Sandwich_tomato');
  assert.ok(lettuce&&cheese&&tomato);
  for(const [lower,upper,label]of [[bread[0],lettuce,'lower bread/lettuce'],[lettuce,cheese,'lettuce/cheese'],[cheese,tomato,'cheese/tomato'],[tomato,bread[1],'tomato/upper bread']])touching(lower,upper,`sandwich ${label}`);
});

test('every production recipe retains all eight stock portions and exposes cuts only after neighbors disappear',()=>{
  for(const id of REFINED_FOODS) {
    const split=splitFood(actualFood(id),RESOURCE_BY_ID[id]),parts=meshes(split),edible=parts.filter(mesh=>mesh.userData.edible);
    assert.deepEqual([...new Set(edible.map(mesh=>mesh.userData.foodPiece))].sort((a,b)=>a-b),Array.from({length:FOOD_PIECES},(_,i)=>i),id);
    for(let count=0;count<=FOOD_PIECES;count++) {
      updateFoodPortions(parts,{[id]:count*12.5});
      for(const mesh of parts.filter(mesh=>mesh.userData.foodTag)) {
        const {foodPiece,foodNeighbor}=mesh.userData;
        assert.equal(mesh.visible,foodPiece<count&&(foodNeighbor<0||foodNeighbor>=count),`${id}: stock ${count}, portion ${foodPiece}, neighbor ${foodNeighbor}`);
      }
      assert.equal(edible.some(mesh=>mesh.visible),count>0,id);
    }
  }
});

test('production fries carton is inedible, open at the top and remains unchanged at zero stock',()=>{
  const source=actualFood('fries'),carton=meshes(source).filter(mesh=>mesh.userData.edible===false);
  assert.equal(carton.length,5,'the carton is four walls and a floor');
  const ray=new THREE.Raycaster(new THREE.Vector3(...RESOURCE_BY_ID.fries.position).add(new THREE.Vector3(0,.8,0)),new THREE.Vector3(0,-1,0));
  source.updateMatrixWorld(true);const hit=ray.intersectObjects(carton,true)[0];
  assert.ok(hit&&hit.point.y<RESOURCE_BY_ID.fries.position[1]+.02,'carton mouth must see its floor without an opaque top');
  const split=splitFood(source,RESOURCE_BY_ID.fries),parts=meshes(split),immutable=parts.filter(mesh=>!mesh.userData.foodTag),before=immutable.map(mesh=>Array.from(mesh.geometry.attributes.position.array));
  assert.ok(immutable.length>0);updateFoodPortions(parts,{fries:0});
  assert.ok(immutable.every(mesh=>mesh.visible&&mesh.userData.edible===false));
  assert.ok(parts.filter(mesh=>mesh.userData.edible).every(mesh=>!mesh.visible));
  assert.deepEqual(immutable.map(mesh=>Array.from(mesh.geometry.attributes.position.array)),before);
});

test('production pizza has eight closed slices and preserves full surface area when split',()=>{
  const source=actualFood('pizza'),native=meshes(source);assert.equal(native.length,8);
  for(const mesh of native)assertSolidSlices(mesh);
  const before=surfaceArea(source),split=splitFood(source,RESOURCE_BY_ID.pizza),parts=meshes(split);assert.equal(parts.length,8);
  assert.ok(Math.abs(surfaceArea(split)-before)<1e-6,'production pizza surface area must be conserved');
  assert.deepEqual(parts.map(mesh=>mesh.userData.foodPiece).sort((a,b)=>a-b),[0,1,2,3,4,5,6,7]);
});

test('stock clipping preserves production vertex colors on every original ingredient surface',()=>{
  for(const id of REFINED_FOODS) {
    const source=actualFood(id,{serving:false}),materials=new Set(meshes(source).map(mesh=>mesh.material));
    const ranges=new Map();
    for(const mesh of meshes(source)) {
      const color=mesh.geometry.attributes.color;assert.ok(color&&color.count===mesh.geometry.attributes.position.count,`${id}: source ingredient must be colored`);
      if(!ranges.has(mesh.material))ranges.set(mesh.material,[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]);
      const range=ranges.get(mesh.material);
      for(let i=0;i<color.count;i++)for(let c=0;c<3;c++){const value=color.array[i*3+c];range[c]=Math.min(range[c],value);range[c+3]=Math.max(range[c+3],value);}
    }
    const split=splitFood(source,RESOURCE_BY_ID[id]);
    for(const mesh of meshes(split).filter(mesh=>materials.has(mesh.material))) {
      const color=mesh.geometry.attributes.color;assert.ok(color&&color.count===mesh.geometry.attributes.position.count,`${id}: clipping lost ingredient colors`);
      const range=ranges.get(mesh.material);
      assert.ok(Array.from(color.array).every((value,i)=>Number.isFinite(value)&&value>=range[i%3]-1e-6&&value<=range[i%3+3]+1e-6),`${id}: clipping invented or corrupted a color`);
    }
  }
});

test('stock clipping conserves every production ingredient outer surface',()=>{
  for(const id of REFINED_FOODS) {
    const source=actualFood(id),originalMaterials=new Set(meshes(source).map(mesh=>mesh.material)),before=surfaceArea(source);
    const split=splitFood(source,RESOURCE_BY_ID[id]),after=surfaceArea(split,mesh=>originalMaterials.has(mesh.material));
    assert.ok(Math.abs(after-before)<1e-6,`${id}: splitting removed or duplicated original ingredient surface (${before} -> ${after})`);
  }
});

function resourceEntry(root,id) {
  root.updateMatrixWorld(true);const entry={id,kind:'food',faces:[],inedible:[],facePortions:[],faceNeighbors:[],inediblePortions:[],inedibleNeighbors:[]};
  for(const mesh of meshes(root))for(const {points}of triangles(mesh,{world:true})) {
    const edible=mesh.userData.edible===true,target=edible?entry.faces:entry.inedible;
    points.forEach(point=>target.push(...point.toArray()));
    (edible?entry.facePortions:entry.inediblePortions).push(mesh.userData.foodPiece??-1);
    (edible?entry.faceNeighbors:entry.inedibleNeighbors).push(mesh.userData.foodNeighbor??-1);
  }
  return entry;
}

// This reads the new triangles directly, without silently exercising the old
// baked JSON. It tests geometric support/mouth reach; long-lived gravity and
// turning are covered separately after the unified collision bake.
test('new production surfaces provide geometric six-foot support and mouth contact at every stock stage',()=>{
  const scale=.0193,m=bodyMetrics(scale),ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0)),hit=new THREE.Vector3();
  for(const id of REFINED_FOODS) {
    const root=splitFood(actualFood(id),RESOURCE_BY_ID[id]),parts=meshes(root),entry=resourceEntry(root,id),index=createResourceIndex([entry]);
    const state={companion:{},home:{food:100},living:{care:{foods:Object.fromEntries(FOOD_IDS.map(food=>[food,100]))}}};
    for(let count=1;count<=FOOD_PIECES;count++) {
      state.living.care.foods[id]=count*12.5;updateFoodPortions(parts,state.living.care.foods);
      const support=parts.filter(mesh=>mesh.visible).flatMap(mesh=>triangles(mesh,{world:true}).map(({points})=>new THREE.Triangle(...points)));
      const below=(x,y,z,maxDrop)=>{
        ray.origin.set(x,y,z);let top=-Infinity;
        for(const triangle of support)if(ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit)&&y-hit.y>=-1e-7&&y-hit.y<=maxDrop)top=Math.max(top,hit.y);
        return Number.isFinite(top)?top:null;
      };
      const success=withFoodStock(state,()=>{
        const candidates=index.surfaceCandidates(id),step=Math.max(1,Math.floor(candidates.length/180));
        for(let i=0;i<candidates.length;i+=step) {
          const [x,y,z]=candidates[i],surface=below(x,y+m.radius*4,z,m.radius*8);if(surface===null)continue;
          for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
            const actor={position:[x,surface+m.radius+m.skin,z],heading,bodyScale:scale,contact:true};
            if(index.contact(actor,'food')?.id!==id)continue;
            let feet=0;
            for(const side of [-1,1])for(const [lx,lz]of [[.0966,.10098],[.1177,-.00198],[.09878,-.11088]]) {
              const dx=(side*lx*Math.cos(heading)+lz*Math.sin(heading))*scale,dz=(-side*lx*Math.sin(heading)+lz*Math.cos(heading))*scale;
              if([1,.8,.6,.35,0].some(inset=>below(x+dx*inset,actor.position[1]-.015*scale,z+dz*inset,m.footDrop)!==null))feet++;
            }
            if(feet===6)return true;
          }
        }
        return false;
      });
      assert.equal(success,true,`${id}: ${count} remaining portions have no geometrically supported mouth contact`);
    }
  }
});
