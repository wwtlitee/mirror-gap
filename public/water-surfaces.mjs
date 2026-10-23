import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';

const vertexShader=`varying vec3 worldPoint;varying vec4 reflectedPoint;uniform mat4 reflectionMatrix;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){worldPoint=(modelMatrix*vec4(position,1.)).xyz;reflectedPoint=reflectionMatrix*vec4(position,1.);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`;
const fragmentShader=`uniform float time;uniform float daylight;uniform float hasReflection;uniform float density;
uniform vec3 tint;uniform sampler2D reflection;uniform vec4 ripples[8];varying vec3 worldPoint;varying vec4 reflectedPoint;
#include <logdepthbuf_pars_fragment>
void main(){vec2 p=worldPoint.xz;vec2 slope=vec2(cos(p.x*27.+p.y*11.+time*1.3),sin(p.y*31.-p.x*9.-time*.9))*.028;
float rings=0.;for(int i=0;i<8;i++){float age=time-ripples[i].z;if(age>=0.&&age<3.){vec2 d=p-ripples[i].xy;float r=length(d);float wave=exp(-pow((r-age*.23)*42.,2.))*exp(-age*1.2)*ripples[i].w;slope+=d/max(.01,r)*wave*.15;rings+=wave;}}
vec3 n=normalize(vec3(slope.x,1.,slope.y)),v=normalize(cameraPosition-worldPoint);float fresnel=.035+.68*pow(1.-max(0.,dot(n,v)),4.);
vec2 uv=reflectedPoint.xy/max(.00001,reflectedPoint.w)+slope*.018;
float valid=hasReflection*step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
vec3 reflected=texture2D(reflection,clamp(uv,.001,.999)).rgb;
vec3 base=tint*(.36+daylight*.58);vec3 color=mix(base,reflected,(.50+fresnel*.48)*valid);
float glint=pow(max(0.,dot(reflect(normalize(vec3(-.3,-.8,-.5)),n),v)),100.);
color+=vec3(.9,.96,1.)*(glint*.3+min(.25,rings*.22))*(.2+.8*daylight);
gl_FragColor=vec4(color,clamp(density+fresnel*.48+rings*.08,.2,.85));
#include <logdepthbuf_fragment>
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

// Three tiny surfaces share a global capture budget; never render three mirrors per frame.
export function createWaterSurfaces(scene,renderer,{software=false}={}){
 const surfaces=[];let time=0,captureAge=1,captures=0,lastCaptureMs=0,disposed=false;
 scene.updateMatrixWorld(true);
 scene.traverse(mesh=>{if(!mesh.isMesh)return;
  let id=mesh.name==='Toilet_blue_water'?'toilet':null,owner=mesh;
  while(owner&&!id){if(['water-bowl','shallow-pool'].includes(owner.userData.resourceId))id=owner.userData.resourceId;owner=owner.parent;}
  if(!id)return;
  const mirror=software?null:new Reflector(mesh.geometry,{textureWidth:256,textureHeight:256,multisample:0,clipBias:.002});
   const uniforms={time:{value:0},daylight:{value:1},density:{value:id==='toilet'?.24:.25},tint:{value:new THREE.Color(id==='toilet'?0xb4c2b4:id==='water-bowl'?0xb7c7bc:0x829d7a)},
   reflection:{value:mirror?.getRenderTarget().texture??null},reflectionMatrix:{value:mirror?.material.uniforms.textureMatrix.value??new THREE.Matrix4()},hasReflection:{value:0},ripples:{value:Array.from({length:8},()=>new THREE.Vector4(0,0,-10,0))}};
  const material=new THREE.ShaderMaterial({name:'Living_water_'+id,uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,side:THREE.FrontSide});
  // Keep the original material owned by the scene's existing disposal path.
  const previous=mesh.material;mesh.material=material;mesh.castShadow=false;mesh.renderOrder=4;
  surfaces.push({id,mesh,mirror,previous,uniforms,box:new THREE.Box3().setFromObject(mesh),cursor:0,lastRipple:-10,lastTouch:null,lastCapture:-10,rippleCount:0});
 });
 const projected=new THREE.Vector3();
 function update(actor,dt,daylight){
  if(disposed)return;time+=Math.max(0,Math.min(.1,dt));
  for(const s of surfaces){s.uniforms.time.value=time;s.uniforms.daylight.value=daylight;
   const a=actor?.position,tip=actor?.drinkingTarget??actor?.feedingTarget;
   let touch=Array.isArray(tip)&&Math.abs(tip[1]-s.box.min.y)<.025?tip:a;
   const cx=(s.box.min.x+s.box.max.x)/2,cz=(s.box.min.z+s.box.max.z)/2;
   const inOutline=touch&&(s.id==='toilet'||((touch[0]-cx)/((s.box.max.x-s.box.min.x)/2))**2+((touch[2]-cz)/((s.box.max.z-s.box.min.z)/2))**2<=1);
   const inside=inOutline&&actor?.contact&&touch[0]>=s.box.min.x&&touch[0]<=s.box.max.x&&touch[2]>=s.box.min.z&&touch[2]<=s.box.max.z&&Math.abs(touch[1]-s.box.min.y)<.23;
   if(!inside){s.lastTouch=null;continue;}
   const moved=s.lastTouch?Math.hypot(touch[0]-s.lastTouch[0],touch[2]-s.lastTouch[1]):1;
   const drinking=Array.isArray(actor.drinkingTarget),interval=drinking?.65:.25;
   if(dt>0&&time-s.lastRipple>interval&&(moved>.015||drinking)){
    s.uniforms.ripples.value[s.cursor].set(touch[0],touch[2],time,drinking?.55:Math.min(1,.45+moved*5));s.cursor=(s.cursor+1)%8;s.lastRipple=time;s.rippleCount++;s.lastTouch=[touch[0],touch[2]];
   }
  }
 }
 function renderReflection(camera,frameMs=16.7,wallDelta=1/60){
  captureAge+=Math.max(0,Math.min(.5,wallDelta));
  if(disposed||software||captureAge<(frameMs>24?.5:.125))return;
  camera.updateMatrixWorld();let chosen=null,score=0;
  for(const s of surfaces){s.mesh.updateWorldMatrix(true,false);const center=s.box.getCenter(projected);const d=center.distanceToSquared(camera.position);projected.project(camera);
   if(camera.position.y<=s.box.min.y+.015||projected.z<-1||projected.z>1||Math.abs(projected.x)>1.2||Math.abs(projected.y)>1.2)continue;
   const area=(s.box.max.x-s.box.min.x)*(s.box.max.z-s.box.min.z),priority=area/Math.max(.1,d)*Math.min(4,.2+time-s.lastCapture);
   if(priority>score){score=priority;chosen=s;}
  }
  if(!chosen)return;
  const visibility=surfaces.map(s=>s.mesh.visible),start=performance.now();
  try{for(const s of surfaces)s.mesh.visible=false;chosen.mirror.matrixWorld.copy(chosen.mesh.matrixWorld);chosen.mirror.onBeforeRender(renderer,scene,camera);chosen.uniforms.hasReflection.value=1;chosen.lastCapture=time;captures++;captureAge=0;}
  finally{surfaces.forEach((s,i)=>s.mesh.visible=visibility[i]);lastCaptureMs=performance.now()-start;}
 }
 return {update,renderReflection,diagnostics:()=>({surfaces:surfaces.map(s=>({id:s.id,ripples:s.rippleCount,reflection:s.uniforms.hasReflection.value===1})),captures,lastCaptureMs,textureSize:software?0:256,maxCapturesPerSecond:software?0:8}),
  dispose(){if(disposed)return;disposed=true;for(const s of surfaces){s.mirror?.dispose();s.uniforms.reflection.value=null;s.previous.dispose();}}};
}
