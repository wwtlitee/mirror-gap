import {createNightCity} from './night-city.mjs';
import { skyState } from './sky-clock.mjs';
import * as THREE from 'three';
import { drawArcade } from './arcade.mjs';

// Clip every exterior fragment to the physical window opening, by intersecting
// its camera ray with the wall. Distant meshes remain in world space: parallax
// comes from perspective rather than sliding a window texture.
export function throughWindow(material) {
  material.fog = false;
  const originalCompile=material.onBeforeCompile,originalKey=material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    originalCompile.call(material,shader);
    shader.vertexShader = 'varying vec3 exteriorWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 exteriorPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        exteriorPosition = instanceMatrix * exteriorPosition;
      #endif
      exteriorWorld = (modelMatrix * exteriorPosition).xyz;`);
    shader.fragmentShader = 'varying vec3 exteriorWorld;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec3 ray = exteriorWorld - cameraPosition;
      float t = (-4.40 - cameraPosition.z) / ray.z;
      vec3 opening = cameraPosition + ray * t;
      if(t < 0.0 || t > 1.0 || opening.x < .40 || opening.x > 5.69 || opening.y < 1.10 || opening.y > 4.67) discard;`);
  };
  material.customProgramCacheKey = () => 'window-world-ray-v4/'+originalKey;
  return material;
}

const smooth = (a,b,value) => {const t=THREE.MathUtils.clamp((value-a)/(b-a),0,1);return t*t*(3-2*t);};
function cloudAtlasTexture() {
  const cellWidth=256,cellHeight=128,canvas=document.createElement('canvas');
  canvas.width=cellWidth*3;canvas.height=cellHeight*3;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);
  const hash=(x,y,seed)=>{const n=Math.sin(x*127.1+y*311.7+seed*74.7)*43758.5453;return n-Math.floor(n);};
  const noise=(x,y,seed)=>{
    const ix=Math.floor(x),iy=Math.floor(y),u=smooth(0,1,x-ix),v=smooth(0,1,y-iy);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy,seed),hash(ix+1,iy,seed),u),THREE.MathUtils.lerp(hash(ix,iy+1,seed),hash(ix+1,iy+1,seed),u),v);
  };
  for(let tile=0;tile<9;tile++){
    const lobes=Array.from({length:7},(_,i)=>({x:-.64+i*.205,y:-.06-.23*hash(i,4,tile),rx:.26+.13*hash(i,9,tile),ry:.37+.20*hash(i,11,tile)}));
    for(let y=0;y<cellHeight;y++)for(let x=0;x<cellWidth;x++){
      const u=x/(cellWidth-1)*2-1,v=y/(cellHeight-1)*2-1;
      let density=0;
      for(const lobe of lobes)density+=Math.exp(-3*((u-lobe.x)**2/lobe.rx**2+(v-lobe.y)**2/lobe.ry**2));
      const detail=noise(u*8,v*8,tile)*.6+noise(u*19,v*19,tile+13)*.3+noise(u*43,v*43,tile+29)*.1;
      const edge=smooth(.10,.42,density+(detail-.5)*.20)*(1-smooth(.86,1,Math.abs(u)))*(1-smooth(.84,1,Math.abs(v)));
      const shade=THREE.MathUtils.clamp(.77-.10*v+(detail-.5)*.13+Math.min(density,1)*.08,.62,1);
      const offset=((Math.floor(tile/3)*cellHeight+y)*canvas.width+(tile%3*cellWidth+x))*4;
      pixels.data[offset]=Math.round(246*shade);pixels.data[offset+1]=Math.round(249*shade);pixels.data[offset+2]=Math.round(255*shade);
      pixels.data[offset+3]=Math.round(edge*(.74+.26*Math.min(density,1))*255);
    }
  }
  ctx.putImageData(pixels,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  return texture;
}

function celestialMaterial(color,{moon=false}={}) {
  const material=throughWindow(new THREE.MeshBasicMaterial({color,toneMapped:moon})),compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();
  material.onBeforeCompile=shader=>{
    compile(shader);
    shader.vertexShader='varying vec3 celestialNormal; varying vec3 celestialView; varying vec3 celestialLocal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\ncelestialNormal=normalize(mat3(modelMatrix)*normal);celestialView=normalize(cameraPosition-(modelMatrix*vec4(transformed,1.0)).xyz);celestialLocal=position;');
    shader.fragmentShader='varying vec3 celestialNormal; varying vec3 celestialView; varying vec3 celestialLocal;\n'+shader.fragmentShader;
    const surface=moon?`
      float lunarGrain=fract(sin(dot(floor(celestialLocal*65.0),vec3(12.9898,78.233,39.425)))*43758.5453);
      float maria=smoothstep(.18,.70,.5+.16*(sin(celestialLocal.x*3.0+celestialLocal.y*2.0)+cos(celestialLocal.y*6.0-celestialLocal.x*2.0)+sin(celestialLocal.z*4.0-celestialLocal.x*3.0)));
      float albedo=.85+.12*lunarGrain-.17*maria;
      if(celestialLocal.z>0.0){
        float craterA=length(celestialLocal.xy-vec2(-.42,.35))/.26;
        float craterB=length(celestialLocal.xy-vec2(.38,-.25))/.32;
        float craterC=length(celestialLocal.xy-vec2(-.35,-.5))/.14;
        albedo-=.12*(exp(-craterA*craterA*3.0)+exp(-craterB*craterB*3.0)+exp(-craterC*craterC*3.0));
      }
      vec3 lunarLight=normalize(vec3(-.35,.62,.70));
      float reliefLight=.32+.68*max(dot(normalize(celestialNormal),lunarLight),0.0);
      diffuseColor.rgb*=albedo*reliefLight;
    `:`
      float limb=pow(max(dot(normalize(celestialNormal),normalize(celestialView)),0.0),.45);
      float granulation=fract(sin(dot(floor(celestialLocal*160.0),vec3(12.9898,78.233,39.425)))*43758.5453);
      diffuseColor.rgb*=(.68+.32*limb)*(.97+.03*granulation);
    `;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+surface);
  };
  material.customProgramCacheKey=()=>cacheKey+(moon?'/lunar-relief-v1':'/solar-limb-v1');
  return material;
}

function lunarGeometry() {
  const geometry=new THREE.SphereGeometry(1.4,64,48),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);if(z<=0)continue;
    let depression=0;
    for(const [cx,cy,r]of [[-.42,.35,.26],[.38,-.25,.32],[-.35,-.5,.14]]){
      const q=Math.hypot(x-cx,y-cy)/r;
      if(q<1.55)depression+=Math.min(0,-r*.12*Math.exp(-q*q*3)+r*.018*Math.exp(-(((q-.82)/.15)**2)));
    }
    const scale=(1.4+depression)/1.4;p.setXYZ(i,x*scale,y*scale,z*scale);
  }
  geometry.computeVertexNormals();geometry.userData.detail='three-original-shallow-crater-basins-continuous-sphere';return geometry;
}

export async function createOutsideWorld(parent) {
  const root = new THREE.Group(); root.name = 'Exterior_real_depth'; parent.add(root);
  const skyMaterial = throughWindow(new THREE.MeshBasicMaterial({ color: 0x769fbb }));
  const skyHorizon={value:new THREE.Color(0xb3c4c6)},skyZenith={value:new THREE.Color(0x6d9da5)};
  const baseSkyCompile = skyMaterial.onBeforeCompile,skyKey=skyMaterial.customProgramCacheKey();
  skyMaterial.onBeforeCompile = shader => {
    baseSkyCompile(shader);
    Object.assign(shader.uniforms,{skyHorizon,skyZenith});
    shader.fragmentShader='uniform vec3 skyHorizon; uniform vec3 skyZenith;\n'+shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat atmosphereHeight=pow(clamp((exteriorWorld.y+5.0)/42.0,0.0,1.0),.7);diffuseColor.rgb=mix(skyHorizon,skyZenith,atmosphereHeight);');
  };
  skyMaterial.customProgramCacheKey = () => skyKey+'/atmospheric-gradient-v4';
  // Cover the full cone of rays through the physical aperture, including
  // close-window look-up and lateral views. Gradient uses world height.
  skyMaterial.side=THREE.BackSide;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180,64,32), skyMaterial); root.add(sky);
  const ridgeMaterials=[];
  const transform = new THREE.Object3D();
  function instances(geometry, material, rows) {
    const mesh = new THREE.InstancedMesh(geometry, material, rows.length);
    rows.forEach(([x, y, z, sx, sy, sz], i) => { transform.position.set(x,y,z); transform.scale.set(sx,sy,sz); transform.updateMatrix(); mesh.setMatrixAt(i,transform.matrix); });
    mesh.computeBoundingSphere(); root.add(mesh); return mesh;
  }
  for(let layer=0;layer<3;layer++) {
    const material=throughWindow(new THREE.MeshBasicMaterial({color:0x536e79})),compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();
    material.onBeforeCompile=shader=>{
      compile(shader);Object.assign(shader.uniforms,{ridgeHaze:skyHorizon});
      shader.fragmentShader='uniform vec3 ridgeHaze;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float fold=sin(exteriorWorld.x*.28+sin(exteriorWorld.y*.32)*1.6+${(layer*.9).toFixed(2)});
        float detail=sin(exteriorWorld.x*1.21+exteriorWorld.y*.73)*sin(exteriorWorld.y*1.47-exteriorWorld.x*.44);
        float terrainLight=.87+.10*fold+.035*detail;
        float aerial=${(.08+layer*.11).toFixed(2)}+(1.0-smoothstep(-12.0,4.0,exteriorWorld.y))*.07;
        diffuseColor.rgb=mix(diffuseColor.rgb*terrainLight,ridgeHaze,aerial);`);
    };
    material.customProgramCacheKey=()=>cacheKey+'/mountain-folds-v1/'+layer;ridgeMaterials.push(material);
    const ridge=new THREE.Shape();ridge.moveTo(-75,-20);
    for(let i=0;i<=50;i++){const x=-75+i*3,y=-1+layer*1.1+Math.sin(i*.37+layer)*2.2+Math.sin(i*.79+layer)*.8;ridge.lineTo(x,y);}
    ridge.lineTo(75,-20);ridge.closePath();const mesh=new THREE.Mesh(new THREE.ShapeGeometry(ridge),material);mesh.name=`Distant_ridge_${layer+1}`;mesh.position.z=-55-layer*5;root.add(mesh);
  }
  const nightCity=await createNightCity(root,throughWindow);
  const cloudMap=cloudAtlasTexture(),cloudMaterials=[],clouds=new THREE.Group();clouds.name='Nine_layered_procedural_clouds';root.add(clouds);
  for(let layer=0;layer<3;layer++){
    const material=throughWindow(new THREE.MeshBasicMaterial({map:cloudMap,color:0xb8c8d0,transparent:true,opacity:[.20,.42,.62][layer],alphaTest:.012,depthWrite:false}));
    const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();
    material.onBeforeCompile=shader=>{
      compile(shader);
      shader.vertexShader='attribute float cloudTile; varying float cloudAtlasTile;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncloudAtlasTile=cloudTile;');
      shader.fragmentShader='varying float cloudAtlasTile;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec2 cloudUV=(vec2(mod(cloudAtlasTile,3.0),floor(cloudAtlasTile/3.0))+vMapUv)/3.0;diffuseColor*=texture2D(map,cloudUV);`);
    };
    material.customProgramCacheKey=()=>cacheKey+'/soft-cloud-atlas-v1';cloudMaterials.push(material);
    const geometry=new THREE.PlaneGeometry(2,2);geometry.setAttribute('cloudTile',new THREE.InstancedBufferAttribute(Float32Array.from({length:9},(_,i)=>i),1));
    const mesh=instances(geometry,material,Array.from({length:9},(_,i)=>[-38+i*10,27+Math.sin(i*.8)*3,-49-i%3*3+(layer-1)*.75,4,1.0+i%2*.5,1.3]));
    mesh.name=`Cloud_depth_layer_${layer+1}`;mesh.renderOrder=10+layer;clouds.add(mesh);
  }
  const sunMaterial=celestialMaterial(0xffce65);
  const sun=new THREE.Mesh(new THREE.SphereGeometry(1.55,32,20),sunMaterial);sun.name='Sun_limb_and_granulation';root.add(sun);
  const moonMaterial=celestialMaterial(0xf3dfb7,{moon:true});
  const moon=new THREE.Mesh(lunarGeometry(),moonMaterial);moon.name='Moon_shallow_original_craters';moon.position.set(15,13,-64);root.add(moon);
  let currentSky=skyState(12);
  const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;
  const glowCtx=glowCanvas.getContext('2d'),glow=glowCtx.createRadialGradient(32,32,0,32,32,32);
  glow.addColorStop(0,'rgba(255,255,255,1)');glow.addColorStop(.10,'rgba(255,255,255,.92)');glow.addColorStop(.28,'rgba(255,255,255,.20)');glow.addColorStop(1,'rgba(255,255,255,0)');glowCtx.fillStyle=glow;glowCtx.fillRect(0,0,64,64);
  const starMap=new THREE.CanvasTexture(glowCanvas);starMap.colorSpace=THREE.SRGBColorSpace;
  const starMaterial=throughWindow(new THREE.MeshBasicMaterial({map:starMap,color:0xf3dfb7,transparent:true,depthWrite:false,toneMapped:false,alphaTest:.008}));
  const starCompile=starMaterial.onBeforeCompile,starKey=starMaterial.customProgramCacheKey(),starClock={value:0};
  starMaterial.onBeforeCompile=shader=>{
    starCompile(shader);shader.uniforms.starClock=starClock;
    shader.vertexShader='attribute float starPhase; varying float starTwinklePhase;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstarTwinklePhase=starPhase;');
    shader.fragmentShader='uniform float starClock; varying float starTwinklePhase;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=.86+.12*sin(starClock*.28+starTwinklePhase);');
  };
  starMaterial.customProgramCacheKey=()=>starKey+'/soft-star-twinkle-v1';
  const starGeometry=new THREE.PlaneGeometry(.12,.12);starGeometry.setAttribute('starPhase',new THREE.InstancedBufferAttribute(Float32Array.from({length:70},(_,i)=>i*2.399963),1));
  const stars = instances(starGeometry,starMaterial,Array.from({length: 70},(_,i)=>[-50+(i*17.31%105),6+(i*13.7%27),-70,1,1,1]));stars.name='Seventy_soft_original_stars';
  const night = new THREE.Color(0x101a31), noon = new THREE.Color(0x94becd), dusk = new THREE.Color(0xc78a68);
  return {
    update(hour,daylightHint,dt=0) {
      const cycle=skyState(hour), {daylight,twilight}=cycle;currentSky=cycle;
      sun.position.set(...cycle.sun);moon.position.set(...cycle.moon);
      sun.visible=cycle.sunVisible;moon.visible=cycle.moonVisible;
      sunMaterial.color.setRGB(1,.65+.25*(1-twilight),.28+.35*(1-twilight));
      skyMaterial.color.copy(night).lerp(noon, daylight).lerp(dusk,twilight*.65);
      skyHorizon.value.copy(skyMaterial.color).lerp(new THREE.Color(0xd9ddd2),daylight*.17).lerp(dusk,twilight*.23);
      skyZenith.value.copy(skyMaterial.color).multiplyScalar(.70).lerp(new THREE.Color(0x497da5),daylight*.20);
      ridgeMaterials.forEach((material,layer)=>material.color.setRGB(.018+daylight*(.24+layer*.020),.032+daylight*(.27+layer*.018),.065+daylight*(.28+layer*.016)));
      cloudMaterials.forEach((material,layer)=>{material.color.setRGB(.010+daylight*(.60+layer*.025),.017+daylight*(.64+layer*.020),.031+daylight*(.67+layer*.015));material.color.lerp(dusk,twilight*.22);});
      clouds.position.x = Math.sin(cycle.hour / 24 * Math.PI * 2) * 2;
      starClock.value+=Number.isFinite(dt)?THREE.MathUtils.clamp(dt,0,.1):0;
      starMaterial.opacity=THREE.MathUtils.clamp((.15-daylight)/.15,0,1)*(1-twilight);
      nightCity.update(daylight,dt); stars.visible = daylight < .15 && twilight < .35;
    },
    getState:()=>({...currentSky,city:nightCity.stats}),
    depths: [-8, -28, -57, -75],
  };
}

export function createDeskDisplay(material) {
  const canvas = document.createElement('canvas'); canvas.width=512; canvas.height=288;
  const ctx = canvas.getContext('2d');
  const pixels=document.createElement('canvas');pixels.width=160;pixels.height=120;
  const pixelContext=pixels.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
  material.map = texture; material.color.set(0xffffff); material.needsUpdate=true;
  let previous = -1;
  return (workstation, time) => {
    if (!workstation) return;
    const frameKey=`${Math.floor(time*10)}:${workstation.phase}:${workstation.gameId}:${workstation.enabled}`;
    if(frameKey===previous)return;
    previous=frameKey;
    ctx.fillStyle=workstation.enabled?'#102326':'#080e10';ctx.fillRect(0,0,512,288);
    if (workstation.enabled) {
      if(workstation.phase==='attention'){
        ctx.fillStyle='#a9c5ba';ctx.font='18px sans-serif';ctx.fillText('MIRROR / ARCADE',34,40);
        ['racer','breakout','invaders'].forEach((id,i)=>{const chosen=id===workstation.gameId;ctx.fillStyle=chosen?'#e4b977':'#637e78';ctx.font=chosen?'bold 24px sans-serif':'20px sans-serif';ctx.fillText((chosen?'› ':'  ')+({racer:'PIXEL ROAD',breakout:'BRICK & BOUNCE',invaders:'STAR PATROL'})[id],38,105+i*58);});
        texture.needsUpdate=true;return;
      }
      if(workstation.gameId!=='light-chase'){
        drawArcade(pixelContext,workstation.arcade,{idle:workstation.phase!=='playing',title:({racer:'PIXEL ROAD',breakout:'BRICK & BOUNCE',invaders:'STAR PATROL'})[workstation.gameId]});
        ctx.imageSmoothingEnabled=false;ctx.drawImage(pixels,64,0,384,288);texture.needsUpdate=true;return;
      }
      ctx.strokeStyle='#244044';ctx.lineWidth=1;
      for(let x=0;x<512;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,288);ctx.stroke();}
      for(let y=0;y<288;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(512,y);ctx.stroke();}
      const playing=workstation.phase==='playing';
      const target=playing?workstation.target:[Math.sin(time*.4)*.6,Math.cos(time*.3)*.5];
      const dot=(p,r,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(256+p[0]*210,144-p[1]*100,r,0,Math.PI*2);ctx.fill();};
      dot(target,10,'#e9bc76');
      if(playing) dot(workstation.cursor,7,'#8be5dc');
      ctx.fillStyle='#a5c5bf';ctx.font='16px sans-serif';ctx.fillText(playing?'追一束光 · 镜隙正在探索':'小世界 · 等你发现',20,265);
    }
    texture.needsUpdate=true;
  };
}
