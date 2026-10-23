import * as THREE from 'three';
import {createMirrorGapCharacter} from './character.mjs';
import {growthSummary} from './companion-growth.mjs';

// Fixed camera and reference bars: the two actual seeded meshes use one scale.
// This is a comparison portrait, not a photograph of an invented past event.
export function createGrowthPortrait(canvas,seed){
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,2));
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe4eee9,0x384840,3));
  const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(0,4,5);scene.add(light);
  const camera=new THREE.OrthographicCamera(-4,4,2,-2,.01,30);camera.position.set(0,2.6,6);camera.lookAt(0,.4,0);
  const born=createMirrorGapCharacter(seed),current=createMirrorGapCharacter(seed);
  const barMaterial=new THREE.MeshBasicMaterial({color:0x65766e});
  for(const x of [-1.9,1.9]){
    const geometry=new THREE.BoxGeometry(2.6,.018,.018),bar=new THREE.Mesh(geometry,barMaterial);bar.position.set(x,-.02,.45);scene.add(bar);
    for(let tick=-1;tick<=1;tick+=.5){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.014,.085,.018),barMaterial);mesh.position.set(x+tick,-.045,.45);scene.add(mesh);}
  }
  for(const model of [born,current]){scene.add(model.root);model.root.rotation.y=.6;}
  let value=1,disposed=false;
  function render(size=null){
    if(disposed)return;
    const width=size?.width??(canvas.clientWidth||480),height=size?.height??(canvas.clientHeight||210);
    renderer.setSize(width,height,false);
    const aspect=width/height;camera.left=-4;camera.right=4;camera.top=4/aspect;camera.bottom=-4/aspect;camera.updateProjectionMatrix();
    [born,current].forEach((model,index)=>{
      const scale=.45*(index?value:1);model.root.scale.setScalar(scale);
      model.root.position.set(index?1.9:-1.9,.32*scale,0);
      model.update({position:[0,0,0],heading:0,contact:false,behavior:'idle',velocity:[0,0,0]},0);
    });
    renderer.render(scene,camera);
  }
  const observer=new ResizeObserver(render);observer.observe(canvas);
  return {update(c){value=growthSummary(c).relativeSize;render();},
    dispose(){disposed=true;observer.disconnect();born.dispose();current.dispose();scene.traverse(o=>{o.geometry?.dispose();});barMaterial.dispose();renderer.dispose();},
    capture(){render({width:1080,height:445});const result=canvas.toDataURL('image/png');render();return result;}};
}
export async function exportGrowthCard(companion,portrait,{english=false}={}){
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=960;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建成长卡');
  ctx.fillStyle='#101918';ctx.fillRect(0,0,1200,960);
  ctx.fillStyle='#a6c8bb';ctx.font='20px sans-serif';ctx.fillText(english?'FRUIT FLY HOUSE · GROWING TOGETHER':'果蝇之家 · 一起长大',64,66);
  ctx.fillStyle='#f0f5f2';ctx.font='bold 48px sans-serif';ctx.fillText(companion.identity.name,64,140,1072);
  const growth=growthSummary(companion);
  ctx.fillStyle='#b4c8be';ctx.font='25px sans-serif';ctx.fillText(english?`Body length: ${growth.relativeSize.toFixed(2)}× at adoption`:`体长是初领时的 ${growth.relativeSize.toFixed(2)} 倍`,64,194);
  const image=new Image();image.src=portrait.capture();await image.decode();ctx.drawImage(image,60,218,1080,445);
  ctx.fillStyle='#bdcfc6';ctx.font='24px sans-serif';ctx.fillText(english?'At adoption':'刚领养',250,660);ctx.fillText(english?'Now':'现在',820,660);
  ctx.font='20px sans-serif';ctx.fillStyle='#93a99e';
  ctx.fillText(english?'Fixed reference · a size comparison portrait':'相同比例参照 · 体型对照档案',64,724);
  const hours=Math.floor(companion.activeSeconds/3600),minutes=Math.floor(companion.activeSeconds/60)%60;
  ctx.fillText(english?`Active life together: ${hours}h ${minutes}m`:`已一起生活 ${hours} 小时 ${minutes} 分钟`,64,767);
  const milestone=companion.developmentSummary?.milestones?.at(-1)??companion.development?.milestones?.at(-1);
  const event=english?(milestone?.textEn??'Every habit begins with real experience.'):(milestone?.text??'让每一次真实经历，慢慢留下自己的习惯。');
  ctx.fillStyle='#c9d7d0';ctx.fillText(event,64,824,1072);
  ctx.font='16px sans-serif';ctx.fillStyle='#71897c';ctx.fillText(`${new Date().toLocaleDateString(english?'en-US':'zh-CN')} · ${companion.identity.id}`,64,905);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('成长卡导出失败');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`fruit-fly-growth-${companion.identity.id}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
