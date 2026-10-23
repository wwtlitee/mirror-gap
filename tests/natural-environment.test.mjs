import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createNaturalFoodModel,placeResourceModel,RESOURCE_BY_ID} from '../public/resource-spec.mjs';
import {splitFood,updateFoodPortions} from '../public/food-portions.mjs';
import {createSurfaceMaps,naturalizeImportedMaterial} from '../public/natural-materials.mjs';

const meshes=root=>{const result=[];root.traverse(o=>{if(o.isMesh)result.push(o);});return result;};
test('natural apple uses the resource dimensions and all triangles remain finite with nonzero area',()=>{
 const definition=RESOURCE_BY_ID.apple,model=placeResourceModel(T,createNaturalFoodModel(T,definition,{geometryOnly:true}),definition);
 const size=new T.Box3().setFromObject(model,true).getSize(new T.Vector3());
 definition.size.forEach((n,i)=>assert.ok(Math.abs(size.getComponent(i)-n)<1e-6));
 for(const mesh of meshes(model)){
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<(index?index.count:p.count);i+=3){const points=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+k):i+k));assert.ok(points.every(v=>v.toArray().every(Number.isFinite)));assert.ok(points[1].sub(points[0]).cross(points[2].sub(points[0])).lengthSq()>1e-18,mesh.name);}
 }
});
test('explicit stalk and leaf semantics survive stock consumption and cannot create edible caps',()=>{
 const definition=RESOURCE_BY_ID.apple,source=placeResourceModel(T,createNaturalFoodModel(T,definition,{geometryOnly:true}),definition);
 const sliced=splitFood(source,definition),parts=meshes(sliced),immutable=parts.filter(m=>m.userData.edible===false&&!m.userData.foodTag);
 assert.ok(immutable.length>=2);const positions=immutable.map(m=>Array.from(m.geometry.attributes.position.array));
 updateFoodPortions(parts,{apple:100});assert.ok(parts.filter(m=>m.userData.foodNeighbor>=0).every(m=>!m.visible));
 updateFoodPortions(parts,{apple:50});assert.ok(parts.some(m=>m.visible&&m.userData.foodNeighbor>=0&&m.userData.edible));
 updateFoodPortions(parts,{apple:0});assert.ok(parts.filter(m=>m.userData.edible).every(m=>!m.visible));assert.ok(immutable.every(m=>m.visible));assert.deepEqual(immutable.map(m=>Array.from(m.geometry.attributes.position.array)),positions);
});
test('natural imported food shading retains the original palette map and its color-space contract',()=>{
 const source=new T.MeshStandardMaterial({map:new T.DataTexture(new Uint8Array([127,0,0,255]),1,1),color:0xffffff,emissive:0x00ffff,metalness:.8});
 const result=naturalizeImportedMaterial(source);assert.equal(result.map,source.map);assert.equal(result.metalness,0);assert.equal(result.emissive.getHex(),0);
 const maps=createSurfaceMaps('cloth');assert.equal(maps.map.colorSpace,T.SRGBColorSpace);assert.equal(maps.bumpMap.colorSpace,T.NoColorSpace);assert.equal(maps.roughnessMap.colorSpace,T.NoColorSpace);
});
