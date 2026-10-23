import {bodyMetrics} from './body-metrics.mjs';
import {toiletManeuverProgressing} from './toilet-maneuver.mjs';
import {meshClearance} from './collision-world.mjs';
// Engineering safety reflex: detect confinement, commit to one escape impulse,
// then return control to the neural motor. Zero safety enables a bounded phasing dash.
import {moveBody,topSurfaceApproach,SOLIDS} from './environment-spec.mjs';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const createEscape=()=>({stress:0,phase:'calm',anchor:null,window:0,effort:0,holdTime:0,intentionalTime:0,burstTime:0,clearTime:0,replan:0,direction:[0,1,0],attempts:0,escapes:0});
export function validateEscape(e){
 if(!e||!['calm','trapped','burst','recover'].includes(e.phase)||!['stress','window','effort','holdTime','intentionalTime','burstTime','clearTime','replan','attempts','escapes'].every(k=>Number.isFinite(e[k])&&e[k]>=0)||e.stress>1||!Array.isArray(e.direction)||e.direction.length!==3||!e.direction.every(Number.isFinite)||!(e.anchor===null||Array.isArray(e.anchor)&&e.anchor.length===3&&e.anchor.every(Number.isFinite)))throw Error('Escape checkpoint invalid');
 if(e.target!=null&&(!Array.isArray(e.target)||e.target.length!==3||!e.target.every(Number.isFinite)))throw Error('Escape target invalid');
}
export function updateEscape(s,motor,hold,dt){
 const e=s.living.escape,a=s.actor;
 e.anchor??=[...a.position];
 const productive=['eat','drink','rest','play','watch','groom','bathe','toilet'].includes(s.living.behavior)&&a.contact;
 const intentional=productive||['rest','screen','observe','idle'].includes(hold)||hold==='toilet'&&toiletManeuverProgressing(s);
 e.holdTime=hold&&!intentional?e.holdTime+dt:0;
 const effort=Math.hypot(...(motor.local??[0,0,0]))>.12||(motor.drive??0)>.15||e.holdTime>8;
 if(e.phase==='burst'){
  e.burstTime+=dt;e.replan=Math.max(0,e.replan-dt);
  const clear=distance(a.position,e.anchor)>.65&&escapeClear(a.position,a);
  e.clearTime=clear?e.clearTime+dt:0;
  if(e.clearTime>.65){e.phase='recover';e.escapes++;e.window=0;e.effort=0;e.anchor=[...a.position];e.clearTime=0;e.target=null;return 'escaped';}
  // Reassess a failed burst, with a new direction; never run a permanent override.
  if(e.burstTime>=5){e.burstTime=0;e.target=null;e.replan=0;}
  return null;
 }
 e.intentionalTime=intentional?(e.intentionalTime??0)+dt:0;
 if(intentional&&e.intentionalTime<2&&e.phase!=='recover')return null;
 if(intentional){e.window=0;e.effort=0;e.anchor=[...a.position];e.stress=Math.max(0,e.stress-dt*.07);if(e.stress===0)e.phase='calm';return null;}
 // Only leaving the local sphere counts as progress; trembling in place does not.
 if(distance(a.position,e.anchor)>.35){e.anchor=[...a.position];e.window=0;e.effort=0;if(e.phase!=='calm')e.phase='recover';}
 e.window+=dt;if(effort)e.effort+=dt;
 const trapped=e.window>=6&&(e.effort/e.window>.5||e.phase==='trapped');
 if(trapped){e.phase='trapped';e.stress=clamp(e.stress+dt*.08,0,1);}
 else{e.stress=Math.max(0,e.stress-dt*.07);if(e.stress===0)e.phase='calm';}
 if(e.stress>=1&&trapped){e.phase='burst';e.attempts++;e.burstTime=0;e.clearTime=0;e.replan=0;e.target=null;return 'burst';}
 return null;
}
export function escapeDirection(actor,attempt){
 let best=[0,1,0],score=-Infinity;
 for(let i=0;i<12;i++){
  const angle=actor.heading+i*Math.PI/4+(attempt%3)*.31,y=i<4?.85:i<8?.12:-.45;
  const d=[Math.sin(angle),y,Math.cos(angle)],length=Math.hypot(...d);for(let k=0;k<3;k++)d[k]/=length;
  const p=[...actor.position];let projection=0;
  for(let step=0;step<8;step++){const v=d.map(x=>x*1.1);moveBody(p,v,.06,actor.heading,undefined,undefined,actor);}
  projection=p.reduce((sum,x,k)=>sum+(x-actor.position[k])*d[k],0);
  const rank=projection+y*.012;if(rank>score){score=rank;best=d;}
 }
 return best;
}
// Clearance includes the whole body, not merely the thorax centre.
export function escapeClear(p,actorOrScale=1){
 const m=bodyMetrics(actorOrScale),reach=.23*m.scale;
 if(p[0]<-5.45||p[0]>5.45||p[1]<.45||p[1]>4.35||p[2]<-3.9||p[2]>3.95)return false;
 if(SOLIDS.some(s=>p.every((v,i)=>v>s.min[i]-reach&&v<s.max[i]+reach)))return false;
 return (meshClearance(p,.26*m.scale)?.distance??Infinity)>reach;
}
export function escapeTarget(actor){
 // Prefer the nearest free pocket, biased upward; never pick a point inside furniture.
 for(const radius of [.8,1.2,1.8,2.6,3.6,5,7])for(const y of [.35,.8,0,-.25])for(let i=0;i<16;i++){
  const angle=actor.heading+i*Math.PI/8,d=[Math.sin(angle),y,Math.cos(angle)],n=Math.hypot(...d);
  const p=actor.position.map((v,j)=>v+d[j]/n*radius);if(escapeClear(p,actor))return p;
 }
 return [0,3.4,0];
}
export function moveEscapeBody(position,velocity,dt){
 const limits=[[-5.6,5.6],[.4,4.5],[-4,4.08]];
 for(let i=0;i<3;i++){position[i]=clamp(position[i]+velocity[i]*dt,...limits[i]);if(position[i]===limits[i][0]||position[i]===limits[i][1])velocity[i]=0;}
 return null;
}
export function escapeAcceleration(s,dt){
 const e=s.living.escape;if(e.phase!=='burst')return null;
 if(!e.target)e.target=escapeTarget(s.actor);
 const delta=e.target.map((v,i)=>v-s.actor.position[i]),length=Math.hypot(...delta);
 e.direction=length>.001?delta.map(v=>v/length):[0,0,0];
 const speed=Math.min(2,length*3);
 return e.direction.map((v,i)=>(v*speed-(s.actor.velocity?.[i]??0))*5+(i===1?2:0));
}
