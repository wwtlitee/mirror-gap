import * as THREE from 'three';
// The CPU renderer cannot afford PBR, environment lighting and shadow passes.
// Vertex shading retains shape while leaving the same geometry and collisions.
export function lightweightMaterials(scene){
 const replacements=new Map(),shaded=new Set(),lights=[];
 scene.traverse(o=>{if(!o.isMesh||!o.material)return;
  o.castShadow=false;o.receiveShadow=false;
  const convert=m=>{
   if(!m.isMeshStandardMaterial&&!m.isMeshPhysicalMaterial)return m;
   if(replacements.has(m))return replacements.get(m);
   const basic=new THREE.MeshBasicMaterial({
    color:m.color,map:m.map,alphaMap:m.alphaMap,transparent:m.transparent,opacity:m.opacity,side:m.side,
    depthWrite:m.depthWrite,depthTest:m.depthTest,depthFunc:m.depthFunc,colorWrite:m.colorWrite,
    vertexColors:true,alphaTest:m.alphaTest,alphaHash:m.alphaHash,alphaToCoverage:m.alphaToCoverage,
    blending:m.blending,premultipliedAlpha:m.premultipliedAlpha,toneMapped:m.toneMapped,
    polygonOffset:m.polygonOffset,polygonOffsetFactor:m.polygonOffsetFactor,polygonOffsetUnits:m.polygonOffsetUnits,
    clippingPlanes:m.clippingPlanes,clipIntersection:m.clipIntersection,clipShadows:m.clipShadows,
   });
   basic.name=m.name;
   basic.userData={...m.userData};
   if(Array.isArray(m.userData.surfaceMeters))basic.userData.surfaceMeters=m.userData.surfaceMeters.slice();
   basic.onBeforeCompile=m.onBeforeCompile;basic.customProgramCacheKey=m.customProgramCacheKey.bind(m);
   const base=m.color.clone(),glow=m.emissive?.clone().multiplyScalar(Math.min(1,m.emissiveIntensity??0))??new THREE.Color(0);lights.push({material:basic,base,glow});replacements.set(m,basic);return basic;
  };
  const mats=Array.isArray(o.material)?o.material:[o.material];
  if(mats.some(m=>m.isMeshStandardMaterial||m.isMeshPhysicalMaterial)&&!shaded.has(o.geometry)){
   const g=o.geometry,n=g.attributes.normal,prior=g.attributes.color;if(n){const colors=new Float32Array(n.count*3);for(let i=0;i<n.count;i++){const shade=.58+.42*Math.max(0,n.getY(i)*.8+n.getZ(i)*.25+n.getX(i)*.15);for(let a=0;a<3;a++)colors[i*3+a]=shade*(prior?prior.array[i*3+a]:1);}g.setAttribute('color',new THREE.BufferAttribute(colors,3));}shaded.add(g);
  }
  o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);
 });
 return {update(daylight){const amount=THREE.MathUtils.clamp(Number.isFinite(daylight)?daylight:.5,0,1);for(const {material,base,glow}of lights)material.color.copy(base).multiplyScalar(.62+.38*amount).add(glow);},dispose(){for(const m of replacements.values())m.dispose();}};
}
