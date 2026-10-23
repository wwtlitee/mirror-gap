import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {billboardFrame,AD_COUNT} from './billboard-cycle.mjs';

export async function createCityBillboards(root,clip,signs){
 const sources=await Promise.all(['ad-atlas.png','ad-street.png'].map(name=>new THREE.TextureLoader().loadAsync('/assets/night-city/'+name)));
 // Upload the complete playlist once; a crossfade changes only three uniforms.
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=4096;const ctx=canvas.getContext('2d');
 for(let id=0;id<AD_COUNT;id++){
  const atlas=Math.floor(id/8),index=id%8,img=sources[atlas].image,cols=atlas===2?2:4,rows=atlas===2?4:2;
  const sx=index%cols*img.width/cols,sy=Math.floor(index/cols)*img.height/rows,sw=img.width/cols,sh=img.height/rows;
  const x=id%8*256+2,y=Math.floor(id/8)*1024+2,w=252,h=1020;
  ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle='#111a20';ctx.fillRect(x,y,w,h);
  // Only portrait campaigns are included in the tower playlist.
  const cover=Math.max(w/sw,h/sh);ctx.filter='blur(12px)';ctx.globalAlpha=.30;
  ctx.drawImage(img,sx,sy,sw,sh,x+(w-sw*cover)/2,y+(h-sh*cover)/2,sw*cover,sh*cover);
  ctx.filter='none';ctx.globalAlpha=1;const fit=Math.min(w/sw,h/sh);
  ctx.drawImage(img,sx,sy,sw,sh,x+(w-sw*fit)/2,y+(h-sh*fit)/2,sw*fit,sh*fit);ctx.restore();
 }
 sources.forEach(t=>t.dispose());
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
 const boards=[];let triangles=0;
 function materialFor(uniforms,reflection=false){
  const material=new THREE.MeshBasicMaterial({map,toneMapped:false,transparent:reflection,opacity:reflection?.09:1,depthWrite:!reflection});
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,uniforms);
   shader.fragmentShader='uniform vec4 adFrom; uniform vec4 adTo; uniform float adMix;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
    vec2 adUV=vMapUv;
    vec4 firstAd=texture2D(map,adFrom.xy+adUV*adFrom.zw);
    vec4 secondAd=texture2D(map,adTo.xy+adUV*adTo.zw);
    diffuseColor*=mix(firstAd,secondAd,adMix);
    ${reflection?'diffuseColor.a*=smoothstep(0.0,.22,adUV.x)*smoothstep(0.0,.22,1.0-adUV.x)*smoothstep(0.0,.3,adUV.y)*smoothstep(0.0,.3,1.0-adUV.y);':''}
   `);
  };
  material.customProgramCacheKey=()=>`city-billboard-crossfade-${reflection}`;
  return clip(material);
 }
 const tile=(id,target)=>target.set((id%8*256+2)/2048,1-(Math.floor(id/8)*1024+1022)/4096,252/2048,1020/4096);
 signs.forEach((sign,index)=>{
  const uniforms={adFrom:{value:new THREE.Vector4()},adTo:{value:new THREE.Vector4()},adMix:{value:0}},material=materialFor(uniforms),parts=[];
  for(const side of [-1,1]){
   const geometry=new THREE.PlaneGeometry(sign.w,sign.h),angle=sign.ry??0;
   geometry.rotateY(angle+(side<0?Math.PI:0));geometry.translate(sign.x+Math.sin(angle)*side*.12,sign.y,sign.z+Math.cos(angle)*side*.12);parts.push(geometry.toNonIndexed());geometry.dispose();
  }
  const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());root.add(new THREE.Mesh(geometry,material));triangles+=geometry.attributes.position.count/3;
  const reflected=new THREE.PlaneGeometry(sign.w,20),reflection=materialFor(uniforms,true);
  reflected.rotateX(-Math.PI/2);reflected.rotateY(Math.PI/2);reflected.translate(Math.sign(sign.x)*19,1.245,sign.z);
  root.add(new THREE.Mesh(reflected,reflection));triangles+=2;
  boards.push({uniforms,material,reflection,index,frame:null});
 });
 function update(seconds,daylight){for(const b of boards){const frame=billboardFrame(seconds,b.index);tile(frame.from,b.uniforms.adFrom.value);tile(frame.to,b.uniforms.adTo.value);b.uniforms.adMix.value=frame.mix;b.material.color.setScalar(.8+.2*(1-daylight));b.reflection.opacity=.008+.055*(1-daylight);b.frame=frame;}}
 update(0,1);
 return {triangles,drawCalls:boards.length*2,update,state:()=>({playlistSize:AD_COUNT,boards:boards.map(b=>({...b.frame}))})};
}
