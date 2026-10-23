import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHomeRenderFinish,updatePhysicalHomeLight} from '../public/home-render-finish.mjs';
import {lightweightMaterials} from '../public/render-quality.mjs';

function rig(){
 return {
  renderer:{toneMappingExposure:1},scene:new THREE.Scene(),
  ambient:new THREE.HemisphereLight(),sunlight:new THREE.DirectionalLight(),
  warm:new THREE.PointLight(),deskLight:new THREE.PointLight(),
  blueFill:new THREE.PointLight(),frontFill:new THREE.DirectionalLight(),
 };
}

test('day and night preserve exposure while shifting the dominant source toward local lamps',()=>{
 const lights=rig();
 updatePhysicalHomeLight(lights,1,12);
 const day={sun:lights.sunlight.intensity,warm:lights.warm.intensity,desk:lights.deskLight.intensity,environment:lights.scene.environmentIntensity,exposure:lights.renderer.toneMappingExposure};
 assert.ok(lights.sunlight.intensity>lights.ambient.intensity+lights.frontFill.intensity,'window key retains directional modeling');
 updatePhysicalHomeLight(lights,0,22);
 assert.ok(lights.sunlight.intensity<day.sun*.05);
 assert.ok(lights.warm.intensity>day.warm);
 assert.ok(lights.deskLight.intensity>day.desk);
 assert.ok(lights.scene.environmentIntensity<day.environment);
 assert.ok(lights.scene.environmentIntensity>0,'night retains reflection detail');
 assert.equal(lights.renderer.toneMappingExposure,day.exposure,'a day/night transition does not silently auto-expose');
});

test('invalid snapshot light inputs cannot poison the scene and occlusion only attenuates the sun',()=>{
 const lights=rig();
 for(const value of [NaN,Infinity,-Infinity,-12,80]){
  updatePhysicalHomeLight(lights,value,value,value);
  for(const key of ['ambient','sunlight','warm','deskLight','blueFill','frontFill']){
   assert.ok(Number.isFinite(lights[key].intensity));assert.ok(lights[key].intensity>=0);
   assert.ok(lights[key].color.toArray().every(Number.isFinite));
  }
  assert.ok(Number.isFinite(lights.scene.environmentIntensity));
 }
 updatePhysicalHomeLight(lights,.6,18,0);const sun=lights.sunlight.intensity,warm=lights.warm.intensity;
 updatePhysicalHomeLight(lights,.6,42,1);
 assert.ok(Math.abs(lights.sunlight.intensity-sun*.2)<1e-10);
 assert.equal(lights.warm.intensity,warm);
 const evening=lights.sunlight.color.clone();updatePhysicalHomeLight(lights,.6,18,1);assert.ok(lights.sunlight.color.equals(evening));
});

test('software and non-HDR renderers use one direct render and leave renderer accounting untouched',()=>{
 for(const software of [true,false]){
  const scene={},camera={},calls=[];
  const renderer={extensions:{has:()=>false},info:{autoReset:true},render:(...args)=>calls.push(args)};
  const finish=createHomeRenderFinish(renderer,scene,camera,{software});
  finish.resize(640,480);finish.render();finish.dispose();
  assert.deepEqual(calls,[[scene,camera]]);assert.equal(renderer.info.autoReset,true);
  assert.equal(finish.mode,software?'direct-software':'direct-no-hdr');
 }
});

test('HDR setup checks its attachment sample support and restores renderer accounting on disposal',()=>{
 const queries=[];
 const gl={RENDERBUFFER:1,RGBA16F:2,SAMPLES:3,getInternalformatParameter(...args){queries.push(args);return new Int32Array([2]);}};
 const renderer={extensions:{has:()=>true},getContext:()=>gl,getPixelRatio:()=>1,capabilities:{maxSamples:8},info:{autoReset:true}};
 const finish=createHomeRenderFinish(renderer,new THREE.Scene(),new THREE.PerspectiveCamera());
 assert.deepEqual(queries,[[gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES]]);
 assert.equal(finish.mode,'linear-hdr-agx');assert.equal(renderer.info.autoReset,false);
 finish.resize(640,480);finish.dispose();assert.equal(renderer.info.autoReset,true);
});

test('software fallback retains alpha cutouts and depth visibility without taking ownership of textures',()=>{
 const alphaMap=new THREE.Texture(),geometry=new THREE.PlaneGeometry();
 const clippingPlanes=[new THREE.Plane(new THREE.Vector3(1,0,0),0)];
 const source=new THREE.MeshStandardMaterial({alphaMap,alphaTest:.4,colorWrite:false,depthTest:false,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,clippingPlanes});
 const mesh=new THREE.Mesh(geometry,source),scene=new THREE.Scene();scene.add(mesh);
 let textureDisposals=0;alphaMap.addEventListener('dispose',()=>textureDisposals++);
 const fallback=lightweightMaterials(scene),converted=mesh.material;
 assert.equal(converted.alphaMap,alphaMap);assert.equal(converted.alphaTest,.4);
 assert.equal(converted.colorWrite,false);assert.equal(converted.depthTest,false);assert.equal(converted.depthWrite,false);
 assert.equal(converted.toneMapped,false);assert.equal(converted.polygonOffset,true);assert.equal(converted.polygonOffsetFactor,-1);
 assert.equal(converted.clippingPlanes,clippingPlanes);
 for(const value of [NaN,Infinity,-10,10]){fallback.update(value);assert.ok(converted.color.toArray().every(channel=>Number.isFinite(channel)&&channel>=0&&channel<=1));}
 fallback.dispose();assert.equal(textureDisposals,0);geometry.dispose();source.dispose();alphaMap.dispose();
});
