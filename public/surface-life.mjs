import {activityAvailable} from './activity-cooldowns.mjs';
import {ZONES} from './world-spec.mjs';
import { FOOD_PROPS, FOOD_TOP } from './habitat-layout.mjs';

// Local receptors complement room-scale cues. These are engineering affordances,
// not identified neurons or destinations. Motor commands still come from the brain.
const cue=(id,zone,kind,position,label,effect)=>({id,zone,kind,position,label,effect,range:.8,scope:'surface'});
export const SURFACE_CUES=[
  cue('nest-cloth','rest','texture',[-4.45,1.13,-2.2],'被面织纹','inspect'),
  cue('nest-shade','rest','shelter',[-4.15,1.13,-2.95],'枕边阴影','rest'),
  cue('nest-seam','rest','contrast',[-3.52,1.13,-2.2],'床沿缝线','inspect'),
  cue('fruit-skin','feed','odor',[FOOD_PROPS.fruit.x,1.325,FOOD_PROPS.fruit.z],'果皮气味','sample'),
  cue('dish-moisture','feed','humidity',[FOOD_PROPS.water.x,FOOD_TOP+.19,FOOD_PROPS.water.z],'水碗湿润边缘','wet'),
  cue('table-grain','feed','texture',[-3.8,1.11,.8],'桌面木纹','inspect'),
  cue('keys','work','texture',[-1.4,1.405,-3.15],'键盘边缘','inspect'),
  cue('screen-glow','work','light',[-.65,1.405,-3.35],'屏幕光斑','orient'),
  cue('paper','work','odor',[-2,1.405,-3.2],'纸张气味','sample'),
  cue('leaf-surface','garden','texture',[2.75,1.365,-3.50],'窗台木纹','inspect'),
  cue('leaf-humidity','garden','airflow',[3.1,1.365,-3.65],'窗边微风','orient'),
  cue('upper-light','garden','light',[3.55,1.365,-3.42],'窗外日光','orient'),
  cue('rug-thread','flight','texture',[.35,.125,.8],'地毯纤维','inspect'),
  cue('rug-light','flight','light',[-.4,.125,.55],'地面光斑','orient'),
  cue('rug-air','flight','airflow',[.5,.125,1.5],'地面微风','orient'),
  cue('wet-stone-touch','entry','texture',[4.8,.405,3.3],'卵石表面','inspect'),
  cue('pool-moisture','entry','humidity',[4.3,.405,3.12],'水边湿气','wet'),
  cue('water-glint','entry','contrast',[4.5,.405,2.7],'水面反光','orient'),
  cue('perch-grain','perch','texture',[4.84,1.94,-.1],'枝台树皮','inspect'),
  cue('perch-air','perch','airflow',[5.03,1.94,-.1],'高处气流','orient'),
  cue('lower-grain','perch','contrast',[4.90,1.32,1.0],'低枝边缘','inspect'),
  cue('toilet-scent','toilet','odor',[4.35,.62,.38],'厕所气味','inspect'),
  cue('toilet-rim','toilet','texture',[4.35,.62,.54],'厕所边缘','inspect'),
  cue('toilet-shade','toilet','shelter',[4.21,.62,.38],'安静角落','orient'),
];
const zones=ZONES.map(z=>z.id);
export function createSurfaceLife(){return {stationary:0,blocked:0,launch:0,contactAge:0,walked:0,
  lastPosition:null,exposure:{},stats:Object.fromEntries(zones.map(z=>[z,{walked:0,actions:{}}]))};}
export function validateSurfaceLife(s){
  const finite=n=>Number.isFinite(n)&&n>=0;
  if(!s||!['stationary','blocked','launch','contactAge','walked'].every(k=>finite(s[k]))
    ||!(s.lastPosition===null||Array.isArray(s.lastPosition)&&s.lastPosition.length===3&&s.lastPosition.every(Number.isFinite))
    ||!s.exposure||Array.isArray(s.exposure)||Object.values(s.exposure).some(n=>!finite(n)||n>1)
    ||!s.stats||zones.some(z=>!s.stats[z]||!finite(s.stats[z].walked)||!s.stats[z].actions||Array.isArray(s.stats[z].actions)||Object.values(s.stats[z].actions).some(n=>!finite(n))))throw new Error('地面行为存档无效，原始文件保留');
}
export function contactCue(state){
  if(!state.actor.contact||!activityAvailable(state,'explore:'+state.actor.zoneId))return null;
  const p=state.actor.position;
  return SURFACE_CUES.filter(c=>c.zone===state.actor.zoneId).map(c=>({...c,distance:Math.hypot(...c.position.map((v,i)=>v-p[i]))}))
    .filter(c=>c.distance<.38).sort((a,b)=>a.distance-b.distance)[0]??null;
}
export function surfaceRestlessness(state){
  const s=state.living?.surface;if(!s||!state.actor.contact)return 0;
  const need=state.living.regions[state.actor.zoneId]?.need??.5;
  return Math.min(1,Math.max(s.blocked/5,(s.stationary-5)/12,(s.contactAge-12)/35*(1.1-need)));
}
export function updateSurfaceLife(state,motor,dt){
  const a=state.actor,l=state.living,s=l.surface??=createSurfaceLife(),v=Math.hypot(a.velocity[0],a.velocity[2]);
  const meaningful=['idle','idle-groom','eat','drink','groom','bathe','toilet','play','watch','observe'].includes(l.behavior)||(l.behavior==='rest'&&(state.needs.energy<98||l.physiology.sleepPressure>.05));
  // Brief loss of one foot on curved surfaces is not a new visit. Forget the
  // accumulated urge gradually during genuine flight rather than every bounce.
  s.contactAge=a.contact?s.contactAge+dt:Math.max(0,s.contactAge-dt*2);
  s.stationary=a.contact&&v<.025&&!meaningful?s.stationary+dt:0;
  // Losing foot contact does not mean the body escaped a leaf. Measure actual
  // displacement after collision resolution, including vertical progress.
  const progress=s.lastPosition&&dt>0?Math.hypot(...a.position.map((x,i)=>x-s.lastPosition[i]))/dt:Math.hypot(...a.velocity);
  const tryingToMove=Math.hypot(...(motor.local??[0,0,0]))>.15;
  const stillObstructed=s.blocked>1&&motor.obstacle?.blocked;
  s.blocked=meaningful?0:stillObstructed||(progress<.02&&tryingToMove)?Math.min(6,s.blocked+dt):Math.max(0,Math.min(6,s.blocked)-dt*2);
  const distance=s.lastPosition&&a.contact&&l.contactSeconds>.16?Math.hypot(a.position[0]-s.lastPosition[0],a.position[2]-s.lastPosition[2]):0;
  const travelled=Math.min(distance,dt*.8);s.walked+=travelled;s.stats[a.zoneId].walked+=travelled;s.lastPosition=[...a.position];
  for(const c of SURFACE_CUES){const d=Math.hypot(...c.position.map((x,i)=>x-a.position[i]));
    s.exposure[c.id]=Math.max(0,Math.min(1,(s.exposure[c.id]??0)+dt*(a.contact&&c.zone===a.zoneId&&d<.4?.09:-.004)));
  }
  // Individual food satiation changes attraction, not the ability to eat.
  // Keep the trace in the existing validated, persisted exposure map.
  const foodId=a.consumingResource?.kind==='food'?a.consumingResource.id:null;
  if(foodId)s.exposure['food:'+foodId]=Math.min(1,(s.exposure['food:'+foodId]??0)+dt*.018);
  for(const key of Object.keys(s.exposure))if(key.startsWith('food:')&&key!=='food:'+foodId)s.exposure[key]=Math.max(0,s.exposure[key]-dt*.0008);
  if(a.contact&&l.contactSeconds>.16){const actions=s.stats[a.zoneId].actions;actions[l.behavior]=(actions[l.behavior]??0)+dt;}
  const c=contactCue(state);a.contactCue=c?.label??null;
  if(c&&a.contact&&l.contactSeconds>.16){
    const fresh=1-(s.exposure[c.id]??0);
    if(['inspect','orient','sample'].includes(c.effect))state.needs.curiosity=Math.max(0,state.needs.curiosity-dt*.3*fresh);
    // Humidity is a sensory cue, not liquid contact. Actual bathing/mist wets the body.
    if(c.effect==='hide')l.alert=Math.max(0,l.alert-dt*.04);
  }
}
