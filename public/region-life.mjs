import { ZONES } from './world-spec.mjs';
import {recoveryAvailable} from './behavior-policy.mjs';
import {focusedActivity} from './behavior-focus.mjs';
export const REGION_PURPOSES={rest:'织纹探索 · 梳理 · 睡眠',feed:'闻果皮 · 进食 · 饮水',work:'纸张键盘 · 屏幕 · 游戏',garden:'窗台行走 · 微风 · 远景',flight:'地毯探查 · 微风 · 飞行',entry:'卵石行走 · 饮水 · 梳理',perch:'树皮行走 · 叶冠 · 气流',nook:'仅作装饰 · 不产生吸引信号',toilet:'走入 · 排泄 · 清洁'};
export const createRegions=(familiar=null)=>Object.fromEntries(ZONES.map(z=>[z.id,{need:z.decorative?0:familiar?Math.max(.15,.9-.75*(familiar[z.id]??0)):.5,presence:0,settled:0,visits:0,active:0}]));
export function validateRegions(regions){
 if(!regions||ZONES.some(z=>!regions[z.id]||!['need','presence','settled','visits','active'].every(k=>Number.isFinite(regions[z.id][k])&&regions[z.id][k]>=0)||regions[z.id].need>1))throw new Error('区域生活存档无效，原始文件保留');
 for(const key of ['observationUntil','observationSeconds'])if(regions.garden[key]!==undefined&&(!Number.isFinite(regions.garden[key])||regions.garden[key]<0))throw new Error('观景计时存档无效');
}
export function updateRegions(state,dt){
 const a=state.actor,life=state.living;
 const view=life.regions.garden;
 if((view.observationUntil??0)>0&&state.simSeconds>=view.observationUntil){view.observationUntil=0;view.observationSeconds=0;}
 if(life.behavior==='observe'&&a.zoneId==='garden'){
  view.observationSeconds=(view.observationSeconds??0)+dt;
  if(view.observationSeconds>=30&&life.commitment?.action!=='observe'&&focusedActivity(state)!=='observe')view.observationUntil=state.simSeconds+20;
 }
 // Brief loss of foot contact must not reset the observation budget.
 for(const zone of ZONES){const r=life.regions[zone.id];if(zone.decorative){r.need=0;continue;}const here=a.zoneId===zone.id;
  const engaging=here&&(zone.id==='flight'?!a.contact:(a.contact&&life.contactSeconds>=.16));
  if(here)r.presence+=dt;
  if(engaging){r.settled+=dt;const before=r.active;r.active+=dt;if(before<1&&r.active>=1)r.visits++;}else r.active=0;
  r.need=Math.max(0,Math.min(1,r.need+dt*(engaging?-.024:.0025)));
 }
}
export function regionDemand(state,zone){
 if(zone==='rest'&&!recoveryAvailable(state))return {need:0,body:0,novelty:1,urgency:false,level:0};
 if(ZONES.find(z=>z.id===zone)?.decorative)return {need:0,body:0,novelty:0,urgency:false,level:0};
 const p=state.living?.physiology??{},n=state.needs;
 const body={rest:Math.max(1-n.energy/100,p.sleepPressure??0),feed:1-n.satiety/100,work:n.curiosity/100,
  garden:1-n.comfort/100,flight:n.energy/100*.4,entry:Math.max(p.thirst??0,p.dirt??0),perch:n.curiosity/100*.7,nook:0,toilet:p.waste??0}[zone]??0;
 const need=state.living?.regions?.[zone]?.need??.5;
 const vital=['rest','feed','entry','toilet'].includes(zone);
 return {need,body,novelty:1+.3*need,urgency:vital&&body>.8,level:Math.min(1,Math.max(.78*need+.22*body,zone==='work'?.85*body:0))};
}

