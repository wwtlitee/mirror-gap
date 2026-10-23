import * as THREE from 'three';
import {throughWindow} from './outside-world.mjs';
export function createWeatherView(parent){
  const count=650,positions=new Float32Array(count*6),drops=[];
  for(let i=0;i<count;i++)drops.push(i<250?{x:.45+(i*.371)%5.15,z:-4.48-(i*.731)%2,y:(i*.917)%7,speed:3.5+(i%5)*.2,height:7}:{x:((i*7.137)%32)-13,z:-4.7-(i*3.713)%18,y:(i*1.917)%14,speed:6+(i%5)*.5,height:14});
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const material=throughWindow(new THREE.LineBasicMaterial({color:0xa6c8dc,transparent:true,opacity:0,depthWrite:false}));
  const lines=new THREE.LineSegments(geometry,material);lines.name='exterior-weather-rain';lines.frustumCulled=false;parent.add(lines);
  return {update(weather,dt){const rain=weather?.rain??0;lines.visible=rain>.01;if(!lines.visible)return;
    material.opacity=.22+rain*.33;geometry.setDrawRange(0,Math.floor(count*Math.max(.15,rain))*2);
    for(let i=0;i<count;i++){const d=drops[i];d.y-=Math.min(.05,Math.max(0,dt))*d.speed;if(d.y<-.5)d.y+=d.height;const n=i*6;positions[n]=d.x;positions[n+1]=d.y;positions[n+2]=d.z;positions[n+3]=d.x-.04-weather.wind*.08;positions[n+4]=d.y+.18+rain*.14;positions[n+5]=d.z;}
    geometry.attributes.position.needsUpdate=true;
  },diagnostics:()=>({visible:lines.visible,drops:geometry.drawRange.count/2})};
}
