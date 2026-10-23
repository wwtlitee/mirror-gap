import {splitFood} from '../public/food-portions.mjs';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RESOURCE_DEFINITIONS,createResourceShape,createResourceServing,placeResourceModel,createNaturalFoodModel} from '../public/resource-spec.mjs';
const loader=new GLTFLoader().register(()=>({name:'GeometryOnly',loadMaterial:()=>Promise.resolve(new THREE.MeshBasicMaterial())}));
const foods=[];
for(const definition of RESOURCE_DEFINITIONS){
 const {id:name,position:p,size,yaw=0}=definition;let model;
 model=createNaturalFoodModel(THREE,definition,{geometryOnly:true});
 if(model)placeResourceModel(THREE,model,definition);
 else if(definition.asset){
 const bytes=await fs.readFile(new URL(`../public/assets/kenney-home/${definition.asset}.glb`,import.meta.url));
 model=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 placeResourceModel(THREE,model,definition);
 }else model=createResourceShape(THREE,definition,{surface:new THREE.MeshBasicMaterial()});
 if(definition.serving){const combined=new THREE.Group();combined.add(model,createResourceServing(THREE,definition,new THREE.MeshBasicMaterial()));model=combined;}
 if(definition.kind==='food')model=splitFood(model,definition);
 model.updateMatrixWorld(true);
 const facePortions=[],inediblePortions=[],faceNeighbors=[],inedibleNeighbors=[];
 const faces=[],inedible=[],v=new THREE.Vector3();
 model.traverse(mesh=>{if(!mesh.isMesh)return;const pos=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv,index=mesh.geometry.index;
  // New meshes carry explicit edible semantics; legacy Kenney palette columns
  // remain the fallback for imported fruit, leaves, stalks and containers.
  const edibleU=definition.edibleU;
  for(let i=0;i<(index?index.count:pos.count);i+=3){const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
   const output=mesh.userData.edible===true||(mesh.userData.edible!==false&&(!edibleU||ids.every(id=>edibleU.some(u=>Math.abs(uv.getX(id)-u)<.001))))?faces:inedible;
   (output===faces?facePortions:inediblePortions).push(mesh.userData.foodPiece??-1);
   (output===faces?faceNeighbors:inedibleNeighbors).push(mesh.userData.foodNeighbor??-1);
   for(const id of ids){v.fromBufferAttribute(pos,id).applyMatrix4(mesh.matrixWorld);output.push(...v.toArray());}
  }
 });foods.push({id:name,label:definition.label,kind:definition.kind,zone:definition.zone,signalId:definition.signalId,faces,inedible,facePortions,inediblePortions,faceNeighbors,inedibleNeighbors});
 if(!faces.length)throw Error(`No edible faces for ${name}; review the asset palette.`);
}
await fs.mkdir(new URL('../public/assets/resource-surfaces/',import.meta.url),{recursive:true});
for(const food of foods)await fs.writeFile(new URL(`../public/assets/resource-surfaces/${food.id}.json`,import.meta.url),JSON.stringify(food));
await fs.writeFile(new URL('../public/assets/resource-surfaces.json',import.meta.url),JSON.stringify({format:'resource-surfaces-v2',files:foods.map(food=>({id:food.id,file:`resource-surfaces/${food.id}.json`}))}));
console.log(foods.map(f=>({id:f.id,triangles:f.faces.length/9})));
