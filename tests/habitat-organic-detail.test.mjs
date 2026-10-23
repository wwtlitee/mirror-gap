import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildOpenHabitat,HABITAT_ASSETS} from '../public/open-habitat.mjs';
import {refineHabitatOrganicModel,createHabitatSoilMaterial,createHabitatSoilGeometry} from '../public/habitat-model-detail.mjs';
import {HABITAT_GROUND} from '../public/habitat-ground.mjs';

const loader=new GLTFLoader().register(parser=>({name:'GeometryOnly',loadMaterial:index=>{
 const material=new THREE.MeshStandardMaterial();material.name=parser.json.materials[index].name;return Promise.resolve(material);
}}));
async function source(name){
 const bytes=await fs.readFile(new URL(`../public/assets/kenney-nature/${name}.glb`,import.meta.url));
 return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
}
function cleanup(root){
 const geometries=new Set(),materials=new Set(),maps=new Set();
 root.traverse(mesh=>{if(!mesh.isMesh)return;geometries.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
  materials.add(material);for(const key of ['map','bumpMap','roughnessMap'])if(material[key])maps.add(material[key]);
 }});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());maps.forEach(m=>m.dispose());
}
function validate(root){
 root.traverse(mesh=>{if(!mesh.isMesh)return;
  const geometry=mesh.geometry,p=geometry.attributes.position,index=geometry.index,edges=new Map();let volume=0;
  assert.ok(Array.from(p.array).every(Number.isFinite));assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
  const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(value=>Math.round(value*1e7)).join(',');
  for(let i=0;i<index.count;i+=3){
   const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],v=ids.map(id=>new THREE.Vector3().fromBufferAttribute(p,id));
   const n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));assert.ok(n.lengthSq()>1e-20,'real organic geometry has no collapsed triangles');
   volume+=v[0].dot(v[1].clone().cross(v[2]))/6;
   for(let edge=0;edge<3;edge++){const id=[key(ids[edge]),key(ids[(edge+1)%3])].sort().join('|');edges.set(id,(edges.get(id)??0)+1);}
  }
  assert.ok(volume>0,'new closed organic surfaces point outward');assert.ok([...edges.values()].every(count=>count===2),'every organic component is a closed shell');
 });
}
function legacyPlacement(model,position,size,angle){
 model.rotation.y=angle;model.updateMatrixWorld(true);let box=new THREE.Box3().setFromObject(model),extent=box.getSize(new THREE.Vector3());
 model.scale.set(size[0]/extent.x,size[1]/extent.y,size[2]/extent.z);model.updateMatrixWorld(true);
 box=new THREE.Box3().setFromObject(model);const centre=box.getCenter(new THREE.Vector3());
 model.position.set(position[0]-centre.x,position[1]-box.min.y,position[2]-centre.z);return new THREE.Box3().setFromObject(model);
}

test('actual habitat build keeps every planted instance in its old occupied range after fitting and production placement',async()=>{
 const entry=new THREE.Group(),perch=new THREE.Group(),original=GLTFLoader.prototype.loadAsync;
 GLTFLoader.prototype.loadAsync=async url=>({scene:await source(url.split('/').at(-1).replace('.glb',''))});
 const box=(size,position,material,parent)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...position);parent.add(mesh);return mesh;};
 try{
  await buildOpenHabitat({THREE,box,material:{darkWood:new THREE.MeshStandardMaterial(),water:new THREE.MeshStandardMaterial()},groups:{entry,perch}});
  const placed=[...entry.children,...perch.children].filter(o=>o.name.startsWith('kenney-'));
  assert.equal(placed.length,HABITAT_ASSETS.length);
  for(const [name,position,size,angle]of HABITAT_ASSETS){
   const actual=placed.find(o=>o.name===`kenney-${name}`&&new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(position[0],position[1]+size[1]/2,position[2]))<1e-5);
   assert.ok(actual,`${name} exists at its original planted position and height`);
   const old=await source(name),baseline=legacyPlacement(old,position,size,angle),bounds=new THREE.Box3().setFromObject(actual),extent=bounds.getSize(new THREE.Vector3()),oldExtent=baseline.getSize(new THREE.Vector3());
   assert.ok(Math.abs(bounds.min.y-position[1])<1e-6,`${name} keeps its bottom contact`);
   assert.ok(Math.abs(extent.y-oldExtent.y)<1e-6,`${name} never overwrites its fitted height`);
   const horizontalTolerance=name==='log'?.08:1e-6;
   assert.ok(Math.abs(extent.x-oldExtent.x)<horizontalTolerance&&Math.abs(extent.z-oldExtent.z)<horizontalTolerance,`${name} stays inside the old horizontal occupied range`);
   if(name.startsWith('rock_'))actual.traverse(o=>{if(o.isMesh)assert.equal(o.material.userData.naturalSurface,'stone','the old grass-named stone cap uses limestone albedo');});
   if(/grass_|plant_bush/.test(name))actual.traverse(o=>{if(o.isMesh&&o.material.vertexColors){assert.ok(o.geometry.attributes.color);assert.ok(o.material.color.g>=.9,'material tint does not multiply authored green into black');}});
   cleanup(old);
  }
  assert.equal(entry.children.filter(o=>o.name==='river-pebble').length,17);
 }finally{GLTFLoader.prototype.loadAsync=original;cleanup(entry);cleanup(perch);}
});

test('all new organic models have genuinely closed nondegenerate surfaces after fitting, with thin curved floating leaves',async()=>{
 for(const name of ['plant_bushDetailed','grass_leafsLarge','grass_large','mushroom_tanGroup','lily_large','log']){
  const original=await source(name),refined=refineHabitatOrganicModel(original,name);validate(refined);
  const before=new THREE.Box3().setFromObject(original,true),after=new THREE.Box3().setFromObject(refined,true);
  assert.ok(before.min.distanceTo(after.min)+before.max.distanceTo(after.max)<1e-6);
  if(name==='lily_large'){
   let leaf;refined.traverse(o=>{if(o.isMesh)leaf=o;});const geometry=leaf.geometry,p=geometry.attributes.position,stride=p.count/2;
   geometry.computeBoundingBox();const fullHeight=geometry.boundingBox.getSize(new THREE.Vector3()).y;
   for(let i=0;i<stride;i++)assert.ok(Math.abs(p.getY(i)-p.getY(i+stride))<fullHeight*.08,'floating leaf is a thin curved sheet, never a thick disc');
   assert.ok(new Set(Array.from(p.array).filter((_,i)=>i%3===1).map(value=>value.toFixed(5))).size>100,'floating leaf has continuous curvature and fine radial veins');
  }
  if(name==='mushroom_tanGroup')refined.traverse(o=>{if(o.isMesh)assert.equal(o.material.userData.surfaceMeters,undefined,'mushroom skin uses its own cap/stalk UV, not soil or cloth metre tiles');});
  cleanup(original);cleanup(refined);
 }
});

test('habitat soil has visible irregular aggregates without recurring horizontal or vertical cells',()=>{
 const soil=createHabitatSoilMaterial(0x80715b),pixels=soil.map.image.data,size=soil.map.image.width;
 try{
  assert.deepEqual(soil.userData.surfaceMeters,[.32,.32]);assert.equal(soil.map.wrapS,THREE.RepeatWrapping);
  const samples=Array.from({length:size*size},(_,i)=>pixels[i*4]),mean=samples.reduce((sum,v)=>sum+v,0)/samples.length;
  assert.ok(Math.max(...samples)-Math.min(...samples)>60&&Math.max(...samples)-Math.min(...samples)<145,'aggregates remain legible without clipped black or white grains');
  const correlation=offset=>{
   let covariance=0,variance=0,count=0;
   for(let i=0;i<samples.length-offset;i++){const a=samples[i]-mean,b=samples[i+offset]-mean;covariance+=a*b;variance+=a*a;count++;}
   assert.ok(count>1000);return covariance/variance;
  };
  assert.ok(correlation(1)>.35&&correlation(size)>.35,'aggregates remain coherent after mip filtering instead of averaging into a blank slab');
  assert.ok(Math.abs(correlation(13))<.2&&Math.abs(correlation(size*13))<.2,'aggregate centres do not form recurring horizontal or vertical cell bands');
 }finally{for(const map of [soil.map,soil.bumpMap,soil.roughnessMap])map.dispose();soil.dispose();}
});

test('loam relief is a closed, nondegenerate volume recessed into the unchanged ground envelope',()=>{
 for(const slab of HABITAT_GROUND.filter(s=>s.material==='soil')){
  const geometry=createHabitatSoilGeometry(slab.size),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());validate(mesh);geometry.computeBoundingBox();
  const before=new THREE.Box3(new THREE.Vector3(...slab.size).multiplyScalar(-.5),new THREE.Vector3(...slab.size).multiplyScalar(.5));
  assert.ok(before.min.distanceTo(geometry.boundingBox.min)+before.max.distanceTo(geometry.boundingBox.max)<1e-6,'terrain keeps the old support volume and maximum height');
  assert.ok(geometry.index.count/3<10000,'relief remains bounded for collision export');
  const ray=new THREE.Raycaster();
  for(const x of [-.4,0,.4])for(const z of [-.4,0,.4]){
   ray.set(new THREE.Vector3(x*slab.size[0],1,z*slab.size[2]),new THREE.Vector3(0,-1,0));
   const hit=ray.intersectObject(mesh)[0];assert.ok(hit&&hit.point.y<=slab.size[1]/2+1e-7&&hit.point.y>slab.size[1]/2-.013,'all sampled top points stay within the slab and expose no hole');
  }
  cleanup(mesh);
 }
});
