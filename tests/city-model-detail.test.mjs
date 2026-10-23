import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createStreetPartGeometry,createStreetDetailParts,createBeveledCityBox,createCityTire} from '../public/city-model-detail.mjs';
import {createRoadLife} from '../public/city-road-life.mjs';
import {trafficPaths} from '../public/city-traffic-paths.mjs';

const city=JSON.parse(fs.readFileSync(new URL('../public/assets/night-city.json',import.meta.url)));

function assertUsableGeometry(geometry){
 const positions=geometry.attributes.position,normals=geometry.attributes.normal,index=geometry.index;
 assert.ok(Array.from(positions.array).every(Number.isFinite));
 assert.ok(Array.from(normals.array).every(Number.isFinite));
 for(let i=0;i<(index?.count??positions.count);i+=3){
  const p=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(i+k):i+k));
  const faceNormal=p[1].sub(p[0]).cross(p[2].sub(p[0]));
  assert.ok(faceNormal.lengthSq()>1e-20,'triangle retains a real surface');
  const vertexNormal=new THREE.Vector3();
  for(let k=0;k<3;k++)vertexNormal.add(new THREE.Vector3().fromBufferAttribute(normals,index?index.getX(i+k):i+k));
  assert.ok(faceNormal.dot(vertexNormal)>0,'triangle winding agrees with its outward normals');
 }
}

test('higher precision keeps authored building bounds and usable faces on every original city part',()=>{
 for(const part of city.parts){
  const geometry=createStreetPartGeometry(part);assertUsableGeometry(geometry);
  if(geometry.type==='RoundedBoxGeometry'){
   geometry.scale(part.w,part.h,part.d);geometry.computeBoundingBox();
   const size=geometry.boundingBox.getSize(new THREE.Vector3());
   [part.w,part.h,part.d].forEach((n,i)=>assert.ok(Math.abs(size.getComponent(i)-n)<2e-5,part.owner));
  }
  const triangleCount=(geometry.index?.count??geometry.attributes.position.count)/3;
  assert.ok(triangleCount<=432,'precision stays bounded per part');geometry.dispose();
 }
});

test('detail fits existing recessed windows, storefront artwork and seven original rail supports',()=>{
 const original=JSON.stringify(city),parts=createStreetDetailParts(city);
 assert.equal(JSON.stringify(city),original,'authored layout, signs and transit remain unchanged');
 const roles=new Set(parts.map(p=>p.detailRole));
 for(const role of ['recessed-window-frame','projecting-window-sill','shop-glass-frame','shop-door-handle','rail-post-bearing','pavement-joint'])assert.ok(roles.has(role));
 const frames=parts.filter(p=>p.detailRole==='recessed-window-frame');
 for(const p of frames){
  assert.ok(p.x-p.w/2<41.94&&p.x+p.w/2>41.94,'frame attaches to original glazing');
  assert.ok(city.buildings.some(b=>b.id===p.owner));
 }
 assert.equal(parts.filter(p=>p.detailRole==='shop-door-handle').length,8);
 const bearings=parts.filter(p=>p.detailRole==='rail-post-bearing');
 assert.deepEqual(bearings.map(p=>p.z),[-260,-190,-120,-50,20,90,160]);
 assert.ok(bearings.every(p=>p.x===36&&p.y+p.h/2===17.62));
 assert.ok(parts.every(p=>[p.x,p.y,p.z,p.w,p.h,p.d].every(Number.isFinite)&&p.w>0&&p.h>0&&p.d>0));
 assert.ok(parts.every(p=>!['cyan','violet','red','lime'].includes(p.material)),'detail does not add new illuminated accents');
});

test('beveled car bodies and tire shoulders keep original dimensions without invalid surfaces',()=>{
 for(const dims of [[1.85,.55,4.2],[1.62,.7,2.15],[2.05,.48,4.5]]){
  const geometry=createBeveledCityBox(...dims);assertUsableGeometry(geometry);geometry.computeBoundingBox();
  const size=geometry.boundingBox.getSize(new THREE.Vector3());dims.forEach((n,i)=>assert.ok(Math.abs(size.getComponent(i)-n)<1e-6));geometry.dispose();
 }
 for(const [radius,width]of [[.37,.24],[.22,.15]]){
  const tire=createCityTire(radius,width);assertUsableGeometry(tire);tire.computeBoundingBox();
  const size=tire.boundingBox.getSize(new THREE.Vector3());assert.ok(Math.abs(size.x-radius*2)<1e-6&&Math.abs(size.y-width)<1e-6&&Math.abs(size.z-radius*2)<1e-6);tire.dispose();
 }
 assert.throws(()=>createBeveledCityBox(0,1,1),RangeError);assert.throws(()=>createCityTire(NaN,1),RangeError);
});

test('detailed traffic uses the original routes, instance counts and nine draws over ten minutes',()=>{
 const root=new THREE.Group(),life=createRoadLife(root,m=>m),matrix=new THREE.Matrix4(),actual=new THREE.Vector3();
 assert.equal(life.drawCalls,9);assert.equal(root.children.length,9);
 assert.deepEqual(root.children.map(m=>m.count),[8,8,2,2,6,6,6,6,12]);
 root.traverse(mesh=>{if(mesh.isMesh)assertUsableGeometry(mesh.geometry);});
 for(let time=0;time<=600;time+=5){
  life.update(time);const expected=trafficPaths(time),state=life.state();
  assert.deepEqual(state.carPositions,expected.cars.map(p=>p.position));
  assert.deepEqual(state.hoverPositions,expected.hover.map(p=>p.position));
  assert.deepEqual(state.robotPositions,expected.robots.map(p=>p.position));
  for(let i=0;i<expected.cars.length;i++){
   root.children[0].getMatrixAt(i,matrix);actual.setFromMatrixPosition(matrix);
   assert.ok(actual.distanceTo(new THREE.Vector3(...expected.cars[i].position))<2e-5);
  }
 }
});
