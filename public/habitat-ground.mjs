import {bodyMetrics} from './body-metrics.mjs';
// Exact closed ground volumes, shared with the rendered habitat. Triangle
// proximity alone cannot distinguish the interior of a thick slab from air.
export const HABITAT_GROUND = [
 {id:'habitat-base',zone:'perch',size:[2.88,.18,4.90],position:[4.13,.13,1.54],material:'base'},
 {id:'habitat-soil',zone:'perch',size:[2.82,.08,3.18],position:[4.13,.26,.71],material:'soil'},
 {id:'habitat-wet-soil',zone:'entry',size:[2.82,.08,1.66],position:[4.13,.26,3.13],material:'soil'},
].map(s=>({...s,min:s.position.map((v,i)=>v-s.size[i]/2),max:s.position.map((v,i)=>v+s.size[i]/2)}));

export function insideHabitatGround(p){
 return HABITAT_GROUND.find(s=>p.every((v,i)=>v>s.min[i]&&v<s.max[i]))??null;
}

export function resolveHabitatGround(position,velocity,radius){
 const {skin}=bodyMetrics(radius/.085);
 let support=null;
 for(let pass=0;pass<4;pass++){
  let changed=false;
  for(const s of HABITAT_GROUND){
   const near=position.map((v,i)=>Math.max(s.min[i],Math.min(s.max[i],v)));
   let normal=position.map((v,i)=>v-near[i]),distance=Math.hypot(...normal),depth;
   if(distance>=radius)continue;
   if(distance>1e-9){normal=normal.map(v=>v/distance);depth=radius-distance+skin;}
   else{
    // Existing corrupt positions must leave the volume, not be pushed toward
    // an underside that the room floor immediately pushes them back through.
    let best=Infinity,axis=-1,sign=0;
    for(let i=0;i<3;i++)for(const direction of [-1,1]){
     const face=(direction<0?s.min[i]-radius:s.max[i]+radius)+direction*skin;
     if(i===1&&face<radius+.04)continue;
     const amount=Math.abs(face-position[i]);
     if(amount<best){best=amount;axis=i;sign=direction;}
    }
    normal=[0,0,0];normal[axis]=sign;depth=best;
   }
   const incoming=velocity.reduce((sum,v,i)=>sum+v*normal[i],0);
   for(let i=0;i<3;i++){position[i]+=normal[i]*depth;if(incoming<0)velocity[i]-=incoming*normal[i];}
   if(normal[1]>.45)support={id:s.id,zone:s.zone};
   changed=true;
  }
  if(!changed)break;
 }
 return support;
}
