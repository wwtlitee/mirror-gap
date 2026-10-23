import * as THREE from 'three';
import {createMirrorGapCharacter} from './character.mjs';
export function createCompanionPreview(canvas,seed) {
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,30);
  camera.position.set(2.1,1.6,3.4);camera.lookAt(0,0,0);
  scene.add(new THREE.HemisphereLight(0xf4efe3,0x38352f,2.2));
  const key=new THREE.DirectionalLight(0xffffff,4);key.position.set(2,4,3);scene.add(key);
  const rim=new THREE.DirectionalLight(0xe1e8ee,.8);rim.position.set(-3,2,-1);scene.add(rim);
  const character=createMirrorGapCharacter(seed);scene.add(character.root);
  let frame=0,last=performance.now(),disposed=false;
  const resize=()=>{const w=canvas.clientWidth||300,h=canvas.clientHeight||260;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  function animate(now){if(disposed)return;const dt=Math.min(.05,(now-last)/1000);last=now;
    if(!document.hidden&&canvas.closest('dialog')?.open){character.root.rotation.y+=dt*.22;character.update({contact:true,behavior:'idle',velocity:[0,0,0],heading:0,position:[0,0,0]},dt);renderer.render(scene,camera);}
    frame=requestAnimationFrame(animate);
  }frame=requestAnimationFrame(animate);
  return {dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();character.dispose();renderer.dispose();}};
}
