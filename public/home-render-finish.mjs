import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

const daylightWhite = new THREE.Color(0xf6f2e8);
const eveningWhite = new THREE.Color(0xffe7c7);

function hdrSamples(renderer) {
  // MAX_SAMPLES describes the device, not the RGBA16F attachment. A device may
  // support 4x MSAA for its default buffer but only 2x (or none) for HDR color.
  const gl=renderer.getContext();
  const supported=gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES);
  return Math.max(0,...Array.from(supported??[]).filter(value=>value<=4&&value<=renderer.capabilities.maxSamples));
}

// Linear HDR color finishing precedes AgX and the single sRGB conversion.
// Avoid depth-based post effects: macro log depth and the city share the scene.
export function createHomeRenderFinish(renderer,scene,camera,{software=false}={}) {
  if(software)return {resize(){},render(){renderer.render(scene,camera);},dispose(){},mode:'direct-software'};
  if(!renderer.extensions.has('EXT_color_buffer_float')&&!renderer.extensions.has('EXT_color_buffer_half_float'))return {resize(){},render(){renderer.render(scene,camera);},dispose(){},mode:'direct-no-hdr'};
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true});
  target.samples=hdrSamples(renderer);
  const composer=new EffectComposer(renderer,target),renderPass=new RenderPass(scene,camera);
  const colorPass=new ShaderPass({
    uniforms:{tDiffuse:{value:null},balance:{value:new THREE.Vector3(1.015,1.005,.99)},saturation:{value:.99}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D tDiffuse;uniform vec3 balance;uniform float saturation;varying vec2 vUv;
      void main(){vec4 source=texture2D(tDiffuse,vUv);vec3 color=max(vec3(0.0),source.rgb*balance);
      float luminance=dot(color,vec3(.2126,.7152,.0722));color=mix(vec3(luminance),color,saturation);
      gl_FragColor=vec4(color,source.a);}`,
  });
  const outputPass=new OutputPass();composer.addPass(renderPass);composer.addPass(colorPass);composer.addPass(outputPass);
  const previousAutoReset=renderer.info.autoReset;
  renderer.info.autoReset=false;
  return {
    mode:'linear-hdr-agx',
    resize(width,height){composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(width,height);},
    render(){renderer.info.reset();composer.render();},
    dispose(){renderPass.dispose();colorPass.dispose();outputPass.dispose();composer.dispose();renderer.info.autoReset=previousAutoReset;},
  };
}

export function updatePhysicalHomeLight({renderer,scene,ambient,sunlight,warm,deskLight,blueFill,frontFill},daylight,hour,shadow=0) {
  const d=THREE.MathUtils.clamp(Number.isFinite(daylight)?daylight:.5,0,1),h=Number.isFinite(hour)?((hour%24)+24)%24:12;
  const occlusion=THREE.MathUtils.clamp(Number.isFinite(shadow)?shadow:0,0,1);
  const evening=Math.max(0,1-Math.abs(h-18)/3);
  sunlight.color.copy(daylightWhite).lerp(eveningWhite,evening*.6);
  sunlight.intensity=(.035+d*2.70)*(1-occlusion*.8);
  // Keep indirect light below the window key. Uniform fill otherwise erases
  // rounded edges, furniture contact and the cool-window / warm-lamp balance.
  ambient.color.setHex(d>.2?0xcddce3:0x8faac7);ambient.groundColor.setHex(0x716454);ambient.intensity=.20+d*.44;
  scene.environmentIntensity=.20+d*.26;
  warm.color.setHex(0xffd19f);warm.intensity=5+(1-d)*17;
  deskLight.color.setHex(0xffdab2);deskLight.intensity=4+(1-d)*10;
  blueFill.color.setHex(0xc1d5e4);blueFill.intensity=2.5+d*5;
  frontFill.color.setHex(0xd6dbe0);frontFill.intensity=.12+d*.26;
  renderer.toneMappingExposure=1.10;
}
