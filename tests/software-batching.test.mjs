import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {batchSoftwareRoom,dataTextureAtlasPixels} from '../public/software-batching.mjs';
import {createSurfaceMaps} from '../public/natural-materials.mjs';

test('natural material sRGB pixels survive atlas conversion exactly without a second gamma transform',()=>{
 for(const kind of ['wood','cloth','stone','soil','leaf','ceramic','fruit']){
  const maps=createSurfaceMaps(kind,16),original=maps.map.image.data.slice(),converted=dataTextureAtlasPixels(maps.map);
  assert.equal(converted.width,16);assert.equal(converted.height,16);
  assert.deepEqual(Array.from(converted.data),Array.from(original));
  assert.deepEqual(maps.map.image.data,original,'conversion does not modify a texture shared with another renderer');
  Object.values(maps).forEach(map=>map.dispose());
 }
});

test('linear float and half-float colors are encoded to sRGB while alpha and row order remain unchanged',()=>{
 const values=[.5,.0031308,1,.5,0,.25,.75,1];
 const linear=new THREE.DataTexture(new Float32Array(values),1,2,THREE.RGBAFormat,THREE.FloatType);
 linear.colorSpace=THREE.LinearSRGBColorSpace;linear.flipY=false;
 assert.deepEqual(Array.from(dataTextureAtlasPixels(linear).data),[188,10,255,128,0,137,225,255]);
 const half=new THREE.DataTexture(new Uint16Array(values.map(value=>THREE.DataUtils.toHalfFloat(value))),1,2,THREE.RGBAFormat,THREE.HalfFloatType);
 half.colorSpace=THREE.LinearSRGBColorSpace;
 assert.deepEqual(Array.from(dataTextureAtlasPixels(half).data),[188,10,255,128,0,137,225,255]);
 const bytes=new THREE.DataTexture(new Uint8Array([128,0,255,128]),1,1,THREE.RGBAFormat);
 assert.equal(bytes.colorSpace,THREE.NoColorSpace);
 assert.deepEqual(Array.from(dataTextureAtlasPixels(bytes).data),[188,0,255,128],'unannotated sampled values are linear, as in the original GPU map');
});

test('typed-array subviews and red/RG textures use their own dimensions and GPU channel defaults',()=>{
 const backing=new Uint8Array([90,91,92,93,12,34,56,78,98,76,54,32,94,95,96,97]);
 const texture=new THREE.DataTexture(new Uint8Array(backing.buffer,4,8),2,1,THREE.RGBAFormat);
 texture.colorSpace=THREE.SRGBColorSpace;
 assert.deepEqual(Array.from(dataTextureAtlasPixels(texture).data),[12,34,56,78,98,76,54,32]);
 const red=new THREE.DataTexture(new Uint8Array([255,0]),2,1,THREE.RedFormat);
 assert.deepEqual(Array.from(dataTextureAtlasPixels(red).data),[255,0,0,255,0,0,0,255]);
 const rg=new THREE.DataTexture(new Uint8Array([255,128]),1,1,THREE.RGFormat);rg.colorSpace=THREE.SRGBColorSpace;
 assert.deepEqual(Array.from(dataTextureAtlasPixels(rg).data),[255,128,0,255]);
});

test('invalid data cannot silently produce a blank or wrongly sized atlas tile',()=>{
 for(const texture of [
  new THREE.DataTexture(new Uint8Array(4),0,1),
  new THREE.DataTexture(new Uint8Array(4),1.5,1),
  new THREE.DataTexture(new Uint8Array(3),1,1),
  new THREE.DataTexture(new Float32Array([NaN,0,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType),
  new THREE.DataTexture(new Uint16Array(4),1,1,THREE.RGBAFormat,THREE.UnsignedByteType),
 ])assert.throws(()=>dataTextureAtlasPixels(texture),/Data texture|data texture/);
});

test('actual software batching rasterizes data pixels while ordinary canvas maps keep their original drawImage path',()=>{
 const originalDocument=globalThis.document,canvases=[];
 const createCanvas=()=>{
  const canvas={acceptedImage:true,width:0,height:0,draws:[],writes:[]};
  canvas.getContext=()=>({fillRect(){},createImageData:(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}),putImageData(image){canvas.writes.push(image);},drawImage(image,...bounds){assert.equal(image.acceptedImage,true,'drawImage only receives an actual image surface, never {data,width,height}');canvas.draws.push({image,bounds});}});
  canvases.push(canvas);return canvas;
 };
 globalThis.document={createElement(name){assert.equal(name,'canvas');return createCanvas();}};
 const root=new THREE.Group(),zone=new THREE.Group();zone.userData.zoneId='rest';root.add(zone);
 const canvasMap=new THREE.CanvasTexture(createCanvas());canvasMap.colorSpace=THREE.SRGBColorSpace;
 const dataMap=createSurfaceMaps('wood',4).map;
 for(const map of [canvasMap,dataMap])zone.add(new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map})));
 try{
  const batch=batchSoftwareRoom(root),atlas=zone.children[0].material.map.image;
  assert.equal(batch.before,2);assert.equal(batch.after,1);assert.equal(zone.children.length,1);
  assert.equal(atlas.draws.length,2);assert.equal(atlas.draws[0].image,canvasMap.image);
  assert.notEqual(atlas.draws[1].image,dataMap.image);
  assert.equal(atlas.draws[1].image.width,4);assert.equal(atlas.draws[1].image.height,4);
  assert.deepEqual(Array.from(atlas.draws[1].image.writes[0].data),Array.from(dataMap.image.data));
  assert.equal(zone.children[0].material.map.colorSpace,THREE.SRGBColorSpace);
  batch.dispose();
 }finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
 }
});
