import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// DataTexture.image is {data,width,height}, not a CanvasImageSource. Encode its
// linear color samples into the sRGB canvas atlas; existing sRGB bytes must not
// be encoded a second time. Alpha remains linear and row order stays unchanged
// because the atlas UV path below already handles each source's flipY flag.
export function dataTextureAtlasPixels(texture){
 const {data,width,height}=texture.image??{};
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||!ArrayBuffer.isView(data)||data instanceof DataView)throw new TypeError('Data texture requires typed pixels and positive integer dimensions');
 const channels=texture.format===THREE.RGBAFormat?4:texture.format===THREE.RGFormat?2:texture.format===THREE.RedFormat?1:0;
 if(!channels||!Number.isSafeInteger(width*height*channels)||data.length!==width*height*channels)throw new RangeError('Data texture dimensions and color channels do not match its pixels');
 let sample;
 if(texture.type===THREE.UnsignedByteType&&(data instanceof Uint8Array||data instanceof Uint8ClampedArray))sample=i=>data[i]/255;
 else if(texture.type===THREE.FloatType&&data instanceof Float32Array)sample=i=>data[i];
 else if(texture.type===THREE.HalfFloatType&&data instanceof Uint16Array)sample=i=>THREE.DataUtils.fromHalfFloat(data[i]);
 else throw new TypeError('Unsupported data texture pixel type for software atlas');
 if(![THREE.SRGBColorSpace,THREE.LinearSRGBColorSpace,THREE.NoColorSpace].includes(texture.colorSpace))throw new TypeError('Unsupported data texture color space for software atlas');
 const encoded=texture.colorSpace===THREE.SRGBColorSpace,pixels=new Uint8ClampedArray(width*height*4);
 const byte=(value,color)=>{
  if(!Number.isFinite(value))throw new RangeError('Data texture contains a nonfinite pixel');
  value=Math.max(0,Math.min(1,value));
  if(color&&!encoded)value=value<=.0031308?value*12.92:1.055*value**(1/2.4)-.055;
  return Math.round(value*255);
 };
 for(let pixel=0;pixel<width*height;pixel++){
  const source=pixel*channels,target=pixel*4;
  pixels[target]=byte(sample(source),true);
  pixels[target+1]=byte(channels>=2?sample(source+1):0,true);
  pixels[target+2]=byte(channels>=3?sample(source+2):0,true);
  pixels[target+3]=byte(channels===4?sample(source+3):1,false);
 }
 return {data:pixels,width,height};
}

function atlasImage(texture){
 if(!texture.isDataTexture)return texture.image;
 const pixels=dataTextureAtlasPixels(texture),canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;
 const context=canvas.getContext('2d'),image=context.createImageData(pixels.width,pixels.height);image.data.set(pixels.data);context.putImageData(image,0,0);
 return canvas;
}

// Software WebGL pays heavily for each draw call. Bake the already shaded
// static colors and textures into one atlas, keeping separate selectable zones.
// Metre-mapped surfaces retain their shader and texture. Its world position /
// normal projection and RepeatWrapping sample each fragment, including triangles
// spanning multiple periods. A single atlas tile cannot preserve that by taking
// fract at vertices: interpolation would stretch across the repeat boundary.
export function batchSoftwareRoom(root){
  root.updateMatrixWorld(true);
  const sources=[];let retainedSurfaces=0;
  root.traverse(o=>{
    if(!o.isMesh||o.userData.foodTag||o.isInstancedMesh||Array.isArray(o.material)||o.material.transparent||o.material.map?.userData.dynamic||o.material.colorWrite===false)return;
    if(o.material.userData.surfaceMeters){retainedSurfaces++;return;}
    sources.push(o);
  });
  if(!sources.length)return {before:retainedSurfaces,after:retainedSurfaces,retainedSurfaces,update(){},dispose(){}};
  const maps=[null,...new Set(sources.map(o=>o.material.map).filter(Boolean))];
  const tile=256,cols=Math.ceil(Math.sqrt(maps.length)),size=cols*tile;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,size,size);
  maps.forEach((m,i)=>{if(m?.image)ctx.drawImage(atlasImage(m),(i%cols)*tile,Math.floor(i/cols)*tile,tile,tile);});
  const atlas=new THREE.CanvasTexture(canvas);atlas.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshBasicMaterial({map:atlas,vertexColors:true,side:THREE.DoubleSide});
  const groups=new Map(),geometries=[];
  for(const source of sources){
    let owner=source.parent;while(owner!==root&&!owner.userData.zoneId)owner=owner.parent;
    const g=source.geometry.index?source.geometry.toNonIndexed():source.geometry.clone();g.applyMatrix4(source.matrixWorld);
    const p=g.attributes.position,oldColor=g.attributes.color,uv=g.attributes.uv;
    const colors=new Float32Array(p.count*3),coords=new Float32Array(p.count*2);
    const m=source.material,index=maps.indexOf(m.map??null),x=index%cols,y=Math.floor(index/cols);
    for(let i=0;i<p.count;i++){
      for(let a=0;a<3;a++)colors[i*3+a]=(oldColor?oldColor.array[i*3+a]:1)*[m.color.r,m.color.g,m.color.b][a];
      const u=uv?uv.getX(i):.5,v=uv?uv.getY(i):.5;
      // Legacy palette UVs stay clamped within their source tile, with a
      // half-texel inset to avoid sampling a neighboring material's color.
      coords[i*2]=(x+(m.map?Math.max(0,Math.min(1,u)):.5)*(1-1/tile)+.5/tile)/cols;
      const vv=m.map?.flipY===false?1-v:v;
      coords[i*2+1]=1-(y+1-((m.map?Math.max(0,Math.min(1,vv)):.5)*(1-1/tile)+.5/tile))/cols;
    }
    for(const key of Object.keys(g.attributes))if(key!=='position')g.deleteAttribute(key);
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.setAttribute('uv',new THREE.BufferAttribute(coords,2));
    if(!groups.has(owner))groups.set(owner,[]);groups.get(owner).push(g);
  }
  for(const [owner,list]of groups){const geometry=mergeGeometries(list);list.forEach(g=>g.dispose());geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name='software_atlas_room';owner.add(mesh);geometries.push(geometry);
  }
  sources.forEach(o=>o.removeFromParent());
  return {before:sources.length+retainedSurfaces,after:groups.size+retainedSurfaces,retainedSurfaces,update(daylight){material.color.setScalar(.62+.38*daylight);},dispose(){geometries.forEach(g=>g.dispose());material.dispose();atlas.dispose();}};
}
