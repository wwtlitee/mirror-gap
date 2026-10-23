import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {lightweightMaterials} from '../public/render-quality.mjs';
import {batchSoftwareRoom} from '../public/software-batching.mjs';
import {naturalMaterial} from '../public/natural-materials.mjs';

function withCanvas(run){
 const original=globalThis.document,canvases=[];
 globalThis.document={createElement(name){
  assert.equal(name,'canvas');
  const canvas={width:0,height:0,draws:[]};
  canvas.getContext=()=>({fillRect(){},drawImage(image,...bounds){canvas.draws.push({image,bounds});}});
  canvases.push(canvas);return canvas;
 }};
 try{return run(canvases);}finally{
  if(original===undefined)delete globalThis.document;else globalThis.document=original;
 }
}

function disposeNatural(material){
 for(const map of new Set([material.map,material.bumpMap,material.roughnessMap].filter(Boolean)))map.dispose();
 material.dispose();
}

function triangle(){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([
  -.325,0,-.45,-.325,0,3.15,1.625,0,-.45,
 ],3));
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
 // Imported model UVs deliberately bear no relation to the world metre scale.
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute([-4,.3,9,-6,.4,3],2));
 return geometry;
}

test('lightweight conversion preserves natural mapping metadata, shader and shared texture identity',()=>{
 const source=naturalMaterial('wood');source.userData.owner='floor';
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),source),root=new THREE.Group();root.add(mesh);
 const light=lightweightMaterials(root),basic=mesh.material;
 try{
  assert.equal(basic.isMeshBasicMaterial,true);
  assert.equal(basic.name,source.name);
  assert.deepEqual(basic.userData,source.userData);
  assert.notEqual(basic.userData,source.userData);
  assert.notEqual(basic.userData.surfaceMeters,source.userData.surfaceMeters);
  assert.equal(basic.map,source.map,'conversion preserves RepeatWrapping and the already settled image');
  assert.equal(basic.map.wrapS,THREE.RepeatWrapping);assert.equal(basic.map.wrapT,THREE.RepeatWrapping);
  assert.equal(basic.onBeforeCompile,source.onBeforeCompile);
  assert.equal(basic.customProgramCacheKey(),source.customProgramCacheKey());
  basic.userData.surfaceMeters[0]=99;
  assert.equal(source.userData.surfaceMeters[0],.65,'copied metadata does not mutate the PBR owner');
 }finally{light.dispose();mesh.geometry.dispose();disposeNatural(source);}
});

test('converted actual natural shader keeps world and instance transforms and all three axis projections',()=>{
 for(const kind of ['wood','stone','soil','cloth','bark']){
  const source=naturalMaterial(kind),root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),source);root.add(mesh);
  const light=lightweightMaterials(root),basic=mesh.material;
  try{
   const shader={vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
   basic.onBeforeCompile(shader);
   assert.match(shader.vertexShader,/surfacePosition = instanceMatrix \* surfacePosition/);
   assert.match(shader.vertexShader,/naturalPosition = \(modelMatrix \* surfacePosition\)\.xyz/);
   assert.match(shader.vertexShader,/naturalNormal = normalize\(mat3\(modelMatrix\) \* surfaceNormal\)/);
   assert.match(shader.fragmentShader,/abs\(naturalNormal\.y\) > \.7 \? naturalPosition\.xz/);
   assert.match(shader.fragmentShader,/abs\(naturalNormal\.x\) > \.7 \? naturalPosition\.zy : naturalPosition\.xy/);
   assert.ok(shader.fragmentShader.includes(`/ vec2(${basic.userData.surfaceMeters.join(',')})`));
   assert.match(shader.fragmentShader,/naturalSurfaceSample\(map,naturalPosition\)/);
   if(kind!=='wood')assert.match(shader.fragmentShader,/weights\/=max\(dot\(weights,vec3\(1.0\)\),.0001\)/);
   assert.doesNotMatch(shader.fragmentShader,/fract\(surfaceUV|clamp\(surfaceUV|texture2D\(map, vMapUv\)/);
   assert.ok(!shader.fragmentShader.includes('#include <map_fragment>'),'Basic uses the actual natural map replacement');
  }finally{light.dispose();mesh.geometry.dispose();disposeNatural(source);}
 }
});

test('metre-mapped triangles spanning repeat periods retain geometry and per-fragment texture wrapping',()=>{
 const source=naturalMaterial('wood'),root=new THREE.Group(),zone=new THREE.Group();zone.userData.zoneId='floor';root.add(zone);
 zone.position.set(.65,.3,-1.8);zone.rotation.y=Math.PI/2;
 const geometry=triangle(),mesh=new THREE.Mesh(geometry,source);zone.add(mesh);
 const light=lightweightMaterials(root),basic=mesh.material;
 const positions=geometry.attributes.position.array.slice(),normals=geometry.attributes.normal.array.slice(),uv=geometry.attributes.uv.array.slice();
 try{
  withCanvas(canvases=>{
   const batch=batchSoftwareRoom(root);
   assert.equal(canvases.length,0,'a repeated world surface is never packed into a clamped atlas tile');
   assert.equal(batch.before,1);assert.equal(batch.after,1);assert.equal(batch.retainedSurfaces,1);
   assert.equal(zone.children[0],mesh);assert.equal(mesh.material,basic);assert.equal(mesh.geometry,geometry);
   assert.deepEqual(geometry.attributes.position.array,positions);assert.deepEqual(geometry.attributes.normal.array,normals);assert.deepEqual(geometry.attributes.uv.array,uv);
   const projected=[];
   for(let i=0;i<3;i++){
    const p=new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld);
    const n=new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,i).transformDirection(mesh.matrixWorld);
    assert.ok(Math.abs(n.y)>.7,'transformed normal selects the shader floor branch');
    projected.push(new THREE.Vector2(p.x/.65,p.z/1.8));
   }
   assert.ok(projected.some(p=>p.x<0||p.y<0),'world mapping crosses a negative texture coordinate');
   assert.ok(Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x))>1,'one triangle spans multiple horizontal repeat tiles');
   const interpolate=points=>points.reduce((sum,p)=>sum.addScaledVector(p,1/3),new THREE.Vector2());
   const sampled=basic.map.transformUv(interpolate(projected));
   const wrappedVertices=projected.map(p=>basic.map.transformUv(p.clone())),wrong=interpolate(wrappedVertices);
   assert.ok(sampled.distanceTo(wrong)>.2,'wrapping interpolated world coordinates differs materially from fract-ing the three vertices');
   assert.ok(sampled.x>=0&&sampled.x<=1&&sampled.y>=0&&sampled.y<=1,'GPU RepeatWrapping can sample the full repeated domain');
   batch.dispose();
  });
 }finally{light.dispose();geometry.dispose();disposeNatural(source);}
});

test('mixed rooms keep transformed natural surfaces separate while preserving legacy atlas UV and flipY semantics',()=>{
 for(const flipY of [true,false]){
 const source=naturalMaterial('stone'),root=new THREE.Group(),zone=new THREE.Group();zone.userData.zoneId='habitat';root.add(zone);
 zone.position.set(2,0,-3);
 const surface=new THREE.Mesh(triangle(),source);zone.add(surface);
 const light=lightweightMaterials(root),natural=surface.material;
 try{
  withCanvas(canvases=>{
   const image={width:8,height:8},map=new THREE.Texture(image);map.flipY=flipY;map.colorSpace=THREE.SRGBColorSpace;
   const geometry=triangle(),legacyMaterial=new THREE.MeshBasicMaterial({map}),legacy=new THREE.Mesh(geometry,legacyMaterial);zone.add(legacy);
   const batch=batchSoftwareRoom(root),atlasMesh=zone.children.find(o=>o.name==='software_atlas_room');
   try{
    assert.equal(batch.before,2);assert.equal(batch.after,2);assert.equal(batch.retainedSurfaces,1);
    assert.equal(legacy.parent,null);assert.equal(surface.parent,zone);assert.equal(surface.material,natural);
    assert.equal(canvases.length,1);assert.equal(canvases[0].draws.length,1);assert.equal(canvases[0].draws[0].image,image);
    assert.equal(atlasMesh.material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile,'palette atlas does not receive metre projection');
    const uv=atlasMesh.geometry.attributes.uv,tile=256,cols=2;
    for(let i=0;i<3;i++){
     const u=Math.max(0,Math.min(1,geometry.attributes.uv.getX(i))),originalV=geometry.attributes.uv.getY(i),v=Math.max(0,Math.min(1,flipY?originalV:1-originalV));
     const expectedU=(1+u*(1-1/tile)+.5/tile)/cols;
     const expectedV=1-(1-(v*(1-1/tile)+.5/tile))/cols;
     assert.ok(Math.abs(uv.getX(i)-expectedU)<1e-7);assert.ok(Math.abs(uv.getY(i)-expectedV)<1e-7);
     const p=new THREE.Vector3().fromBufferAttribute(atlasMesh.geometry.attributes.position,i),original=new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(legacy.matrixWorld);
     assert.ok(p.distanceTo(original)<1e-6,'legacy world position bake remains unchanged');
    }
   }finally{batch.dispose();geometry.dispose();legacyMaterial.dispose();map.dispose();}
  });
 }finally{light.dispose();surface.geometry.dispose();disposeNatural(source);}
 }
});

test('software atlas disposal owns only atlas resources and never retained surface material, texture or geometry',()=>{
 const source=naturalMaterial('soil'),root=new THREE.Group(),surface=new THREE.Mesh(triangle(),source);root.add(surface);
 const light=lightweightMaterials(root);let disposed=0;
 for(const owned of [surface.geometry,surface.material,surface.material.map])owned.addEventListener('dispose',()=>disposed++);
 try{
  withCanvas(()=>{
   const legacy=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());root.add(legacy);
   const batch=batchSoftwareRoom(root),atlas=root.children.find(o=>o.name==='software_atlas_room');let atlasDisposed=0;
   for(const owned of [atlas.geometry,atlas.material,atlas.material.map])owned.addEventListener('dispose',()=>atlasDisposed++);
   batch.dispose();assert.equal(disposed,0);assert.equal(atlasDisposed,3);
   assert.equal(surface.parent,root);assert.equal(surface.material.map.wrapS,THREE.RepeatWrapping);
   legacy.geometry.dispose();legacy.material.dispose();
  });
 }finally{light.dispose();surface.geometry.dispose();disposeNatural(source);}
});
