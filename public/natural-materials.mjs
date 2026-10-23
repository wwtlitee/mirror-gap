import * as THREE from 'three';

const photographedSurfaces = new Map();
const IMAGE_SURFACES = {wood:'/assets/natural-surfaces/walnut-v8.1.0c.png',stone:'/assets/natural-surfaces/limestone-v8.1.0c.png',cloth:'/assets/natural-surfaces/linen-v8.1.0c.png',bread:'/assets/natural-surfaces/bread-v8.1.0c.png',bark:'/assets/natural-surfaces/bark-v8.1.0c.png'};

function photographedSurface(kind) {
  if (!IMAGE_SURFACES[kind] || typeof document === 'undefined') return null;
  if (!photographedSurfaces.has(kind)) {
    let settle;
    const ready=new Promise(resolve=>{settle=resolve;});
    const map = new THREE.TextureLoader().load(IMAGE_SURFACES[kind],()=>settle(map),undefined,()=>settle(null));
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    photographedSurfaces.set(kind, {map,ready});
  }
  return photographedSurfaces.get(kind);
}

export async function waitForSurfaceTextures() {
  await Promise.all([...photographedSurfaces.values()].map(entry=>entry.ready));
}

// Reuse authored UVs on cylindrical bark while participating in the same
// load barrier as the room surfaces (including software atlas conversion).
export function useGeneratedAlbedo(material,kind) {
  const entry=photographedSurface(kind);
  if(entry)entry.ready.then(loaded=>{if(loaded){const previous=material.map;material.map=loaded.clone();material.map.needsUpdate=true;material.needsUpdate=true;previous?.dispose();}});
  material.userData.generatedAlbedo=IMAGE_SURFACES[kind]??null;
  return material;
}

// Metre-based mapping survives furniture batching and individual floorboard
// instancing. Grain follows the long axis of a board instead of its UV count.
function mapBuiltSurface(material, kind) {
  if (!['wood','stone','soil','cloth','bark'].includes(kind)) return material;
  const scale = {wood:[.65,1.8],stone:[.72,.72],soil:[.32,.32],cloth:[.24,.24],bark:[.22,.8]}[kind];
  const smoothProjection = kind !== 'wood';
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 naturalPosition;\nvarying vec3 naturalNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 surfacePosition = vec4(transformed, 1.0);
      vec3 surfaceNormal = normal;
      #ifdef USE_INSTANCING
        surfacePosition = instanceMatrix * surfacePosition;
        surfaceNormal = mat3(instanceMatrix) * surfaceNormal;
      #endif
      naturalPosition = (modelMatrix * surfacePosition).xyz;
      naturalNormal = normalize(mat3(modelMatrix) * surfaceNormal);`);
    const projection = 'abs(naturalNormal.y) > .7 ? naturalPosition.xz : (abs(naturalNormal.x) > .7 ? naturalPosition.zy : naturalPosition.xy)';
    shader.fragmentShader = `varying vec3 naturalPosition; varying vec3 naturalNormal;
      vec2 naturalSurfaceUV(){return (${projection}) / vec2(${scale[0]},${scale[1]});}
      vec4 naturalSurfaceSample(sampler2D surfaceMap,vec3 p){
        ${smoothProjection ? `vec3 weights=pow(abs(normalize(naturalNormal)),vec3(4.0));
        weights/=max(dot(weights,vec3(1.0)),.0001);
        vec2 metres=vec2(${scale[0]},${scale[1]});
        return texture2D(surfaceMap,p.zy/metres)*weights.x+texture2D(surfaceMap,p.xz/metres)*weights.y+texture2D(surfaceMap,p.xy/metres)*weights.z;`
        : `return texture2D(surfaceMap,naturalSurfaceUV());`}
      }\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 surfaceUV = naturalSurfaceUV();
      #ifdef USE_MAP
        vec4 naturalAlbedo = naturalSurfaceSample(map,naturalPosition);
        diffuseColor *= naturalAlbedo;
      #endif`);
    // The relief and roughness maps use the same projection as the albedo.
    // Generated bitmap albedo is deliberately separate from scalar PBR maps.
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        roughnessFactor *= naturalSurfaceSample(roughnessMap,naturalPosition).g;
      #endif`);
    let bumpChunk=THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll('vBumpMapUv','naturalSurfaceUV()');
    if(smoothProjection){
      // Derivatives remain in world metres and use the same smooth projection
      // as color/roughness; curved stones no longer have a hard latitude seam.
      bumpChunk=bumpChunk.replace(/vec2 dHdxy_fwd\(\)\s*\{[\s\S]*?\n\t\}/,`vec2 dHdxy_fwd(){
        float Hll=bumpScale*naturalSurfaceSample(bumpMap,naturalPosition).x;
        float dBx=bumpScale*naturalSurfaceSample(bumpMap,naturalPosition+dFdx(naturalPosition)).x-Hll;
        float dBy=bumpScale*naturalSurfaceSample(bumpMap,naturalPosition+dFdy(naturalPosition)).x-Hll;
        return vec2(dBx,dBy);
      }`);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <bumpmap_pars_fragment>',bumpChunk);
  };
  material.customProgramCacheKey = () => `natural-metres-v8.1.0c-blended-${kind}`;
  material.userData.surfaceMeters = scale;
  return material;
}

// Small deterministic surface maps are generated locally, without external
// imagery. Color maps are sRGB; relief and roughness carry linear data.
export function createSurfaceMaps(kind, size = 128) {
  const color = new Uint8Array(size * size * 4);
  const relief = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const palettes = {wood:[206,187,157],cloth:[239,234,223],stone:[221,218,207],soil:[143,126,100],bark:[179,154,123],leaf:[153,173,120],ceramic:[246,245,238],fruit:[216,72,46]};
  const base = palettes[kind] ?? palettes.stone;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const grain = ((Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263)) >>> 0) / 4294967296;
    let shape = (grain - .5) * .12;
    if (kind === 'wood') shape = (grain-.5)*.022 + Math.sin(u*Math.PI*48 + Math.sin(v*Math.PI*4)*1.8)*.025 + Math.sin(u*Math.PI*12 + Math.sin(v*Math.PI*6)*.4)*.025;
    if (kind === 'cloth') shape = (grain-.5)*.022 + Math.sin(u*Math.PI*64)*Math.sin(v*Math.PI*64)*.018;
    if (kind === 'bark') shape = Math.sin(u*Math.PI*52+Math.sin(v*Math.PI*7)*.9)*.09+(grain-.5)*.04;
    if (kind === 'soil') shape = (grain-.5)*.22+Math.sin(u*Math.PI*22)*Math.sin(v*Math.PI*26)*.045;
    if (kind === 'leaf') shape += Math.exp(-Math.abs(u - .5) * 85) * .18 + Math.sin((v + Math.abs(u - .5) * .8) * Math.PI * 18) * .035;
    if (kind === 'fruit') shape += Math.sin(u * Math.PI * 22 + Math.sin(v * Math.PI * 4)) * .065 + (grain > .97 ? .23 : 0);
    if (kind === 'ceramic') shape *= .22;
    const offset = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) {
      color[offset + c] = Math.max(0, Math.min(255, Math.round(base[c] * (1 + shape))));
      relief[offset + c] = Math.round(Math.max(0, Math.min(1, .5 + shape * 1.5)) * 255);
      roughness[offset + c] = Math.round(Math.max(.55, Math.min(1, .92 + shape*.35)) * 255);
    }
    color[offset + 3] = relief[offset + 3] = roughness[offset + 3] = 255;
  }
  const texture = (pixels, colorSpace) => {
    const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    map.colorSpace = colorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true;
    return map;
  };
  return {map:texture(color, THREE.SRGBColorSpace),bumpMap:texture(relief, THREE.NoColorSpace),roughnessMap:texture(roughness, THREE.NoColorSpace)};
}

export function naturalMaterial(kind, options = {}) {
  const maps = createSurfaceMaps(kind);
  const photograph = photographedSurface(kind);
  const defaults = {
    wood:{roughness:.72,bumpScale:.002},cloth:{roughness:1,bumpScale:.0012},
    stone:{roughness:.93,bumpScale:.0015},soil:{roughness:1,bumpScale:.003},
    leaf:{roughness:.71,bumpScale:.0007,side:THREE.DoubleSide},
    ceramic:{roughness:.28,bumpScale:.0002},fruit:{roughness:.38,bumpScale:.00035},
    bark:{roughness:.95,bumpScale:.0025},
  };
  const material = new THREE.MeshStandardMaterial({...maps,metalness:0,...defaults[kind],...options});
  material.name = `natural-${kind}`; material.userData.naturalSurface = kind;
  if(photograph){const fallback=maps.map;photograph.ready.then(loaded=>{if(loaded){material.map=loaded.clone();material.map.needsUpdate=true;material.needsUpdate=true;fallback.dispose();}});}
  material.userData.generatedAlbedo = IMAGE_SURFACES[kind] ?? null;
  return mapBuiltSurface(material,kind);
}

export function foodMaterial(color, {roughness=.66,relief=.0007,vertexColors=false}={}) {
  const maps = createSurfaceMaps('ceramic',64);
  maps.map.dispose();
  const material = new THREE.MeshStandardMaterial({color,roughness,metalness:0,bumpMap:maps.bumpMap,bumpScale:relief,roughnessMap:maps.roughnessMap,vertexColors});
  material.name = 'food-physical-surface'; material.userData.naturalSurface='food';
  const photograph=photographedSurface('bread');
  if(photograph)photograph.ready.then(loaded=>{if(loaded){material.map=loaded.clone();material.map.needsUpdate=true;material.needsUpdate=true;}});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 ingredientPosition; varying vec3 ingredientNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ningredientPosition=(modelMatrix*vec4(transformed,1.0)).xyz;ingredientNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader=`varying vec3 ingredientPosition; varying vec3 ingredientNormal;
      vec2 ingredientUV(){return (abs(ingredientNormal.y)>.7?ingredientPosition.xz:(abs(ingredientNormal.x)>.7?ingredientPosition.zy:ingredientPosition.xy))/.085;}
      float ingredientHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float ingredientNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(mix(ingredientHash(i),ingredientHash(i+vec3(1,0,0)),f.x),mix(ingredientHash(i+vec3(0,1,0)),ingredientHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(ingredientHash(i+vec3(0,0,1)),ingredientHash(i+vec3(1,0,1)),f.x),mix(ingredientHash(i+vec3(0,1,1)),ingredientHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      float ingredientRelief(vec3 p){return ingredientNoise(p*1400.0)*.65+ingredientNoise(p*620.0)*.35;}\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      #ifdef USE_MAP
        float pores=dot(texture2D(map,ingredientUV()).rgb,vec3(.2126,.7152,.0722));
        bool leafy=diffuseColor.g>diffuseColor.r*1.12;
        bool juicy=diffuseColor.r>diffuseColor.g*1.6&&diffuseColor.r>.15;
        float amount=leafy?.14:(juicy?.22:.66);
        diffuseColor.rgb*=1.0+(pores-.38)*amount;
      #endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float ingredientPore=ingredientRelief(ingredientPosition);
      diffuseColor.rgb*=.88+.20*ingredientPore;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      bool freshRed=diffuseColor.r>diffuseColor.g*1.5&&diffuseColor.r>.10;
      bool freshGreen=diffuseColor.g>diffuseColor.r*1.12;
      roughnessFactor*=freshRed?.65:(freshGreen?.82:1.0);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <bumpmap_pars_fragment>',THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll('vBumpMapUv','ingredientUV()'));
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      #ifdef USE_BUMPMAP
        float ingredientHeight=ingredientRelief(ingredientPosition);
        vec2 ingredientGradient=vec2(ingredientRelief(ingredientPosition+dFdx(ingredientPosition))-ingredientHeight,
          ingredientRelief(ingredientPosition+dFdy(ingredientPosition))-ingredientHeight)*.00011;
        normal=perturbNormalArb(-vViewPosition,normal,ingredientGradient,faceDirection);
      #endif`);
  };
  material.customProgramCacheKey=()=>`food-grain-v8.1.0c-relief-${vertexColors}`;
  return material;
}

// Preserve palette UVs on imported foods. Their U columns are still the legacy
// edible/stalk/container contract, including the geometry-only baker.
export function naturalizeImportedMaterial(material, kind = 'food') {
  const result = material.clone();
  result.metalness = 0; result.roughness = kind === 'ceramic' ? .30 : kind === 'cloth' ? .96 : .65;
  result.emissive?.setHex(0); result.emissiveIntensity = 0;
  result.userData = {...result.userData,naturalSurface:kind,paletteUvPreserved:true};
  if (kind !== 'food') return result;
  const previous = result.onBeforeCompile;
  result.onBeforeCompile = shader => {
    previous.call(result, shader);
    shader.vertexShader = 'varying vec3 foodSurfacePosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfoodSurfacePosition = position;');
    shader.fragmentShader = 'varying vec3 foodSurfacePosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float foodGrain = fract(sin(dot(floor(foodSurfacePosition * 420.0), vec3(12.9898,78.233,31.719))) * 43758.5453);
      diffuseColor.rgb *= .94 + foodGrain * .12;`);
  };
  result.customProgramCacheKey = () => 'natural-food-palette-v1';
  return result;
}
