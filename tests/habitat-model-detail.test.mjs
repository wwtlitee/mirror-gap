import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createBotanicalLeafGeometry,createPlantPotGeometry,createPotSoilGeometry,createDrinkingBowlGeometry,refineHabitatStoneModel,refineHabitatPalmModel} from '../public/habitat-model-detail.mjs';
import {RESOURCE_BY_ID} from '../public/resource-spec.mjs';
import {FOOD_PROPS,FOOD_TOP} from '../public/habitat-layout.mjs';

const loader = new GLTFLoader().register(() => ({name:'Geometry',loadMaterial:() => Promise.resolve(new THREE.MeshStandardMaterial())}));
async function model(name) {
  const bytes = await fs.readFile(new URL(`../public/assets/kenney-nature/${name}.glb`, import.meta.url));
  return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
}
function meshList(root) { const list = []; root.traverse(mesh => { if(mesh.isMesh) list.push(mesh); }); return list; }
function validGeometry(geometry) {
  const p = geometry.attributes.position, index = geometry.index;
  assert.ok(Array.from(p.array).every(Number.isFinite));
  assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    const points = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k)));
    volume += points[0].dot(points[1].clone().cross(points[2])) / 6;
    assert.ok(points[1].sub(points[0]).cross(points[2].sub(points[0])).lengthSq() > 1e-20, 'no degenerate triangle enters physics');
  }
  return volume;
}
function assertClosed(geometry) {
  const p = geometry.attributes.position, index = geometry.index, edges = new Map();
  const key = i => [p.getX(i),p.getY(i),p.getZ(i)].map(v => Math.round(v*1e7)).join(',');
  for(let i=0;i<index.count;i+=3) for(let j=0;j<3;j++) {
    const a=key(index.getX(i+j)), b=key(index.getX(i+(j+1)%3)), edge=[a,b].sort().join('|');
    edges.set(edge,(edges.get(edge)??0)+1);
  }
  assert.ok([...edges.values()].every(count=>count===2),'each welded boundary edge has two faces');
}

test('botanical leaf retains authored footprint and UV direction with a closed, bounded curved blade',()=>{
  const geometry=createBotanicalLeafGeometry();
  assert.ok(validGeometry(geometry)>0);assertClosed(geometry);geometry.computeBoundingBox();
  const box=geometry.boundingBox;
  assert.ok(Math.abs(box.min.x+.32)<1e-7&&Math.abs(box.max.x-.32)<1e-7);
  assert.equal(box.min.y,0);assert.equal(box.max.y,1);assert.ok(box.max.z>.16&&box.max.z<.18);
  assert.ok(geometry.index.count/3<=300,'instanced leaves have a fixed collision budget');
  const p=geometry.attributes.position,uv=geometry.attributes.uv;
  for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-uv.getY(i))<1e-6,'original leaf texture runs from stem to tip');
});

test('plant pot has a real bottom, complete inner wall and rolled lip within its original extent',()=>{
  for(const size of [.48,.75]){
    const geometry=createPlantPotGeometry(size);assert.ok(validGeometry(geometry)>0);assertClosed(geometry);geometry.computeBoundingBox();
    const span=geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(span.x-.66*size)<1e-6&&Math.abs(span.y-.46*size)<1e-6);
    const pot=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()),ray=new THREE.Raycaster(new THREE.Vector3(0,size,0),new THREE.Vector3(0,-1,0));
    const bottom=ray.intersectObject(pot)[0];assert.ok(bottom&&Math.abs(bottom.point.y-.05*size)<1e-6,'opening sees inner bottom, not an opaque lid');
    ray.ray.origin.x=.293*size;assert.ok(ray.intersectObject(pot)[0].point.y>.44*size,'rim has an actual upper support face');
    const soil=createPotSoilGeometry(.27*size);assert.ok(validGeometry(soil)>0);assertClosed(soil);
    const p=soil.attributes.position;assert.ok(new Set(Array.from(p.array).filter((_,i)=>i%3===1).map(y=>y.toFixed(5))).size>50,'soil relief is in the mesh');
  }
});

test('drinking bowl keeps its original bounds and contains every point of the unchanged water disc',()=>{
  const radius=FOOD_PROPS.water.radius,geometry=createDrinkingBowlGeometry(radius),definition=RESOURCE_BY_ID['water-bowl'];
  assert.ok(validGeometry(geometry)>0);assertClosed(geometry);geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.max.y-radius*.46)<1e-6);
  assert.ok(Math.abs(geometry.boundingBox.max.x-radius)<1e-6);
  assert.deepEqual(definition.position,[FOOD_PROPS.water.x,FOOD_TOP+radius*.30,FOOD_PROPS.water.z]);
  assert.equal(definition.radius,radius*.87);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()),ray=new THREE.Raycaster();
  for(let i=0;i<24;i++)for(const r of [0,.5,.99]){
    const angle=i/24*Math.PI*2;ray.set(new THREE.Vector3(Math.cos(angle)*definition.radius*r,1,Math.sin(angle)*definition.radius*r),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(mesh)[0];assert.ok(hit&&hit.point.y<radius*.30,'water surface remains open above the real ceramic interior');
  }
});

test('rounded stone reconstruction preserves authored bounds/materials with a closed outward curved surface',async()=>{
  for(const name of ['rock_largeA','rock_largeC','rock_smallFlatA','rock_smallE']){
    const root=await model(name),beforeBounds=new THREE.Box3().setFromObject(root,true),before=meshList(root).map(m=>({geometry:m.geometry,material:m.material}));
    refineHabitatStoneModel(root);const after=meshList(root),afterBounds=new THREE.Box3().setFromObject(root,true);
    assert.equal(beforeBounds.min.distanceTo(afterBounds.min)+beforeBounds.max.distanceTo(afterBounds.max),0);
    const localBounds=new THREE.Box3();after.forEach(mesh=>localBounds.union(mesh.geometry.boundingBox));
    const solidCentre=localBounds.getCenter(new THREE.Vector3());
    const whole=[];
    after.forEach((mesh,m)=>{
      validGeometry(mesh.geometry);assert.equal(mesh.material,before[m].material);
      // Material primitives are partial surfaces, including a flat top. Their
      // separate bounds are not the interior centre of the complete stone.
      const p=mesh.geometry.attributes.position,index=mesh.geometry.index,centre=solidCentre;
      for(let i=0;i<index.count;i+=3){
        const v=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k)));
        const faceNormal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
        assert.ok(faceNormal.dot(v[0].clone().sub(centre))>0,'every real stone face points outside the closed solid');
        whole.push(...v.flatMap(point=>point.toArray()));
      }
    });
    const closed=new THREE.BufferGeometry();closed.setAttribute('position',new THREE.Float32BufferAttribute(whole,3));closed.setIndex(Array.from({length:whole.length/3},(_,i)=>i));assertClosed(closed);
    assert.ok(whole.length/9<=(name==='rock_largeA'?720:700),'closed stones keep a bounded collision budget');
    const top=afterBounds.max.y,vertices=[];root.updateMatrixWorld(true);
    root.traverse(mesh=>{if(mesh.isMesh)for(let i=0;i<mesh.geometry.attributes.position.count;i++)vertices.push(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld));});
    const topPoints=vertices.filter(point=>Math.abs(point.y-top)<1e-7),span=new THREE.Box3().setFromPoints(topPoints).getSize(new THREE.Vector3());
    if(name==='rock_largeA'){
      // The actual b delivery has a broad cap here: adult six-foot landing
      // depends on it. A pointed summit is not a valid universal rock contract.
      const centre=afterBounds.getCenter(new THREE.Vector3()),size=afterBounds.getSize(new THREE.Vector3()),ray=new THREE.Raycaster();
      for(const x of[-.10,0,.10])for(const z of[-.10,0,.10]){
        ray.set(new THREE.Vector3(centre.x+x*size.x,top+.1,centre.z+z*size.z),new THREE.Vector3(0,-1,0));
        const hit=ray.intersectObject(root,true)[0];assert.ok(hit&&Math.abs(hit.point.y-top)<1e-7,'the original broad standing surface remains at its authored height');
      }
    }else assert.ok(span.x<.04&&span.z<.04,'rounded decorative stones retain their worn summit');
  }
});

test('palm keeps eight authored canopy directions, source transforms and bounds with continuous detailed surfaces',async()=>{
  const root=await model('tree_palmDetailedShort'),before=new THREE.Box3().setFromObject(root,true);
  const authored=meshList(root).map(m=>({name:m.name,position:m.position.clone(),quaternion:m.quaternion.clone(),material:m.material}));
  refineHabitatPalmModel(root);const after=new THREE.Box3().setFromObject(root,true),meshes=meshList(root);
  assert.equal(before.min.distanceTo(after.min)+before.max.distanceTo(after.max),0);assert.equal(meshes.length,3);
  meshes.forEach((mesh,i)=>{
    assert.equal(mesh.name,authored[i].name);assert.equal(mesh.position.distanceTo(authored[i].position),0);assert.equal(mesh.quaternion.angleTo(authored[i].quaternion),0);assert.equal(mesh.material,authored[i].material);
    assert.ok(validGeometry(mesh.geometry)>0);assertClosed(mesh.geometry);assert.ok(mesh.geometry.index.count/3<=2800,'denser palm feather pairs retain a bounded closed collision mesh');
  });
});

test('invalid dimensions fail before they can emit nonfinite render or physics coordinates',()=>{
  for(const size of [0,-1,NaN,Infinity])for(const create of [createPlantPotGeometry,createPotSoilGeometry,createDrinkingBowlGeometry])assert.throws(()=>create(size),RangeError);
  assert.throws(()=>refineHabitatStoneModel(new THREE.Group(),1),RangeError);
});
