import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFurnitureBox,createRestMattressGeometry,createPaddedHeadboardGeometry,buildRestUpholstery,buildDeskCabinet,buildDeskJoinery,refineBookcase,buildDiningCabinetDetail,createDetailedLoungeChair} from '../public/room-model-detail.mjs';
import {buildHabitatRenovation} from '../public/habitat-renovation.mjs';
import {BOOKCASE} from '../public/habitat-layout.mjs';

const palette=()=>Object.fromEntries(['wood','darkWood','bronze','gold','fabric','pillow'].map(name=>[name,new THREE.MeshStandardMaterial({name})]));
const meshes=root=>{const found=[];root.traverse(mesh=>{if(mesh.isMesh)found.push(mesh);});return found;};
const triangles=geometry=>(geometry.index?.count??geometry.attributes.position.count)/3;
function assertGeometry(geometry,label=''){
 const positions=geometry.attributes.position,normals=geometry.attributes.normal,index=geometry.index;
 assert.ok([...positions.array,...normals.array].every(Number.isFinite),`${label}: finite positions and normals`);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<(index?.count??positions.count);i+=3){
  a.fromBufferAttribute(positions,index?index.getX(i):i);b.fromBufferAttribute(positions,index?index.getX(i+1):i+1);c.fromBufferAttribute(positions,index?index.getX(i+2):i+2);
  assert.ok(b.sub(a).cross(c.sub(a)).lengthSq()>1e-24,`${label}: noncollapsed triangle ${i/3}`);
 }
}

test('mattress and upholstered headboard have finite real surfaces in the original furniture envelopes',()=>{
 const mattress=createRestMattressGeometry();assertGeometry(mattress,'mattress');mattress.computeBoundingBox();
 const size=mattress.boundingBox.getSize(new THREE.Vector3());
 [2.42,.42,2.26].forEach((n,i)=>assert.ok(Math.abs(size.getComponent(i)-n)<1e-6));
 const headboard=createPaddedHeadboardGeometry();assertGeometry(headboard,'headboard');headboard.computeBoundingBox();
 const bounds=headboard.boundingBox;
 assert.ok(Math.abs(bounds.min.x+1.28*.91)<1e-6&&Math.abs(bounds.max.x-1.28*.91)<1e-6);
 assert.ok(bounds.min.y===0&&Math.abs(bounds.max.y-2.08*.92)<1e-6);
 assert.ok(bounds.min.z===0&&bounds.max.z>.075&&bounds.max.z<.09,'real padded depth stays behind the original timber arch');
 assert.ok(triangles(mattress)<1800&&triangles(headboard)<4200);
 for(const dims of [[.46,.30,.09],[.43,1.11,.84],[1.464,.636,.576]]){
  const box=createFurnitureBox(...dims);assertGeometry(box);box.computeBoundingBox();
  dims.forEach((n,i)=>assert.ok(Math.abs(box.boundingBox.getSize(new THREE.Vector3()).getComponent(i)-n)<1e-6));
 }
 assert.throws(()=>createFurnitureBox(0,1,1),RangeError);
 assert.throws(()=>createFurnitureBox(1,1,1,NaN),RangeError);
 assertGeometry(createFurnitureBox(1,1,1,0),'explicit square edge');
});

test('drawer fronts contain a real recess, returned handles and unchanged cabinet height',()=>{
 const parent=new THREE.Group(),material=palette();buildDeskCabinet({parent,material,x:0});parent.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(),hit=(x,y)=>{ray.set(new THREE.Vector3(x,y,-2),new THREE.Vector3(0,0,-1));return ray.intersectObject(parent,true)[0];};
 for(let row=0;row<3;row++){
  const y=.29+row*.34,field=hit(0,y-.055),frame=hit(0,y+.13);
  assert.equal(field.object.name,'Drawer_inset_field');assert.equal(frame.object.name,'Drawer_horizontal_frame');
  assert.ok(frame.point.z-field.point.z>.028,'panel is visibly recessed behind separate rails');
 }
 const bounds=new THREE.Box3().setFromObject(parent,true);
 assert.ok(Math.abs(bounds.min.y-.025)<1e-6&&Math.abs(bounds.max.y-1.135)<1e-6);
 assert.ok(Math.abs(bounds.min.x+.23)<1e-6&&Math.abs(bounds.max.x-.23)<1e-6);
 assert.equal(meshes(parent).filter(m=>m.name==='Drawer_returned_pull').length,3);
 assert.ok(meshes(parent).every(mesh=>Object.values(material).includes(mesh.material)),'parts reuse the authored room material batches');
 for(const mesh of meshes(parent))assertGeometry(mesh.geometry,mesh.name);
});

test('bookcase retains five shelf contact heights and its original open bay after board rebating',()=>{
 const nook=new THREE.Group(),material=palette(),groups={nook,entry:new THREE.Group(),perch:new THREE.Group(),work:new THREE.Group()};
 const box=(size,p,mat,parent)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);mesh.position.set(...p);parent.add(mesh);return mesh;};
 buildHabitatRenovation({THREE,box,material,groups});nook.updateMatrixWorld(true);
 const before=new THREE.Box3().setFromObject(nook,true),shelves=meshes(nook).filter(mesh=>Math.abs(mesh.geometry.parameters.height-.09)<1e-8);
 const shelfTops=shelves.map(mesh=>new THREE.Box3().setFromObject(mesh,true).max.y);
 const result=refineBookcase({nook,material});nook.updateMatrixWorld(true);
 assert.ok(result.refinedBoards>100);
 assert.deepEqual(shelves.map(mesh=>new THREE.Box3().setFromObject(mesh,true).max.y),shelfTops);
 assert.equal(shelfTops.length,BOOKCASE.levels.length);
 const after=new THREE.Box3().setFromObject(nook,true);
 for(const key of ['min','max'])for(const axis of ['x','y','z'])assert.ok(Math.abs(before[key][axis]-after[key][axis])<.006,'face frame fits original overall envelope');
 const ray=new THREE.Raycaster(new THREE.Vector3(-3.5,1.5,2.1),new THREE.Vector3(-1,0,0));
 const hit=ray.intersectObject(nook,true)[0];
 assert.ok(hit.point.x< -5.25,'reading bay remains open beyond the front of the shelf');
 for(const mesh of meshes(nook))assertGeometry(mesh.geometry,mesh.name);
});

test('tailored recliner retains its original palette, placement dimensions and three shared material draws',async()=>{
 const bytes=await fs.readFile(new URL('../public/assets/kenney-home/loungeChairRelax.glb',import.meta.url));
 const source=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
 const originalMaterials=new Set(meshes(source).flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]));
 const chair=createDetailedLoungeChair(source);assert.equal(chair.children.length,3);
 for(const mesh of chair.children){
  if(mesh.material.name==='carpet'){
   const original=[...originalMaterials].find(material=>material.name==='carpet');
   assert.ok(mesh.material.color.equals(original.color),'woven cloth retains the authored pink color');
   assert.equal(mesh.material.userData.naturalSurface,'cloth');assert.ok(mesh.material.bumpMap&&mesh.material.roughnessMap);
  }else assert.ok(originalMaterials.has(mesh.material));
 }
 const roles=new Set(chair.userData.detailRoles);
 for(const role of ['Chair_rounded_arm','Chair_reclined_back_cushion','Chair_separate_seat_cushion','Chair_extended_foot_cushion','Chair_arm_sewn_edge','Chair_back_pleated_seam'])assert.ok(roles.has(role));
 const bounds=new THREE.Box3().setFromObject(chair,true),size=bounds.getSize(new THREE.Vector3());
 chair.rotation.y=Math.PI;chair.scale.set(1.24/size.x,1.12/size.y,1.30/size.z);chair.updateMatrixWorld(true);
 const placed=new THREE.Box3().setFromObject(chair,true).getSize(new THREE.Vector3());
 [1.24,1.12,1.30].forEach((n,i)=>assert.ok(Math.abs(placed.getComponent(i)-n)<1e-6));
 assert.ok(chair.children.reduce((sum,mesh)=>sum+triangles(mesh.geometry),0)<8500);
 for(const mesh of chair.children)assertGeometry(mesh.geometry,mesh.name);
 assert.throws(()=>createDetailedLoungeChair(new THREE.Group()),/authored carpet material/);
});

test('deformed pillow keeps its contact envelope and has continuous normals across duplicated triangle vertices',()=>{
 const rest=new THREE.Group();buildRestUpholstery({rest,material:palette(),headboardMaterial:new THREE.MeshStandardMaterial()});
 const pillow=rest.getObjectByName('Soft_box_pillow'),geometry=pillow.geometry;
 assertGeometry(geometry,'pillow');geometry.computeBoundingBox();
 const size=geometry.boundingBox.getSize(new THREE.Vector3());
 // The original compressed pillow's measured front is .275905758, not the
 // uncompressed box's .288; keep that occupied/contact envelope unchanged.
 [1.464,.636,.563905746].forEach((expected,axis)=>assert.ok(Math.abs(size.getComponent(axis)-expected)<1e-6));
 const p=geometry.attributes.position,n=geometry.attributes.normal,seen=new Map();let shared=0;
 for(let i=0;i<p.count;i++){
  const key=[p.getX(i),p.getY(i),p.getZ(i)].map(value=>Math.round(value*1e6)).join(','),normal=new THREE.Vector3().fromBufferAttribute(n,i);
  if(seen.has(key)){assert.ok(normal.dot(seen.get(key))>.99999,'one soft surface cannot have a triangle-by-triangle normal split');shared++;}
  else seen.set(key,normal);
 }
 assert.ok(shared>100);assert.ok(triangles(geometry)<1800,'close-up smoothing has a bounded triangle cost');
});

test('room detail remains batchable with no new material per seam or piece of joinery',()=>{
 const material=palette(),rest=new THREE.Group(),work=new THREE.Group(),feed=new THREE.Group();
 const headboardMaterial=new THREE.MeshStandardMaterial({name:'headboard'});
 buildRestUpholstery({rest,material,headboardMaterial});
 const headboard=rest.getObjectByName('Padded_arch_headboard');
 assert.ok(new THREE.Box3().setFromObject(headboard,true).min.z> -3.47,'padded dimples cannot cut through the original solid headboard face');
 buildDeskJoinery({work,material});buildDiningCabinetDetail({feed,material});
 const all=[...meshes(rest),...meshes(work),...meshes(feed)];
 assert.ok(new Set(all.map(mesh=>mesh.material)).size<=6);
 assert.equal(meshes(feed).length,72);
 const total=all.reduce((sum,mesh)=>sum+triangles(mesh.geometry),0);assert.ok(total<80000,`bounded detail triangle cost ${total}`);
 for(const mesh of all)assertGeometry(mesh.geometry,mesh.name);
 const bounds=new THREE.Box3().setFromObject(feed,true);
 assert.ok(bounds.min.x>=-4.526&&bounds.max.x<=-2.334&&bounds.min.z>=-.186&&bounds.max.z<=2.846,'tambour faces stay within the original rounded cabinet footprint');
});
