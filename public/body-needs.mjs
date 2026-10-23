import {committedTo} from './activity-commitment.mjs';
import {toiletPose,toiletAligned} from './toilet-contact.mjs';
import {toiletManeuverReady} from './toilet-maneuver.mjs';
export const NEED_HINTS={
 energy:'飞行、行走会消耗；睡眠与安静休息恢复',satiety:'活动与时间消耗；接触食物后进食恢复',
 curiosity:'闲久了想探索；观景、探查和游戏满足探索欲',comfort:'口渴、污垢、潮湿和惊扰降低；清洁、观景和睡眠改善',
 thirst:'时间和活动引起；实际饮水降低',sleepPressure:'清醒和夜晚积累；安静睡眠降低',
 dirt:'落脚、探索和进食弄脏身体；水边清洁与搓头梳理降低',waste:'消化与饮食积累；在迷你厕所排泄降低',
 alert:'声音、阴影等刺激引起短时警觉；安静后自然恢复',wetness:'接触浅水或喷雾增加；梳理和自然风干降低，零表示干燥'};
export const createHygiene=()=>({toiletElapsed:0,bowelMovements:0,lastToiletAt:null,lastDropPosition:null,bathSeconds:0,groomSeconds:0,groomElapsed:0,groomCooldown:0});
const clamp=(v,low=0,high=1)=>Math.max(low,Math.min(high,v));
const livingHour=state=>state.living.clock.hour;
export function updateBodyNeeds(state,{atWater,drinking,resting,bathing,toileting,hour=livingHour(state)},dt){
 const l=state.living,p=l.physiology,n=state.needs,a=state.actor,h=l.hygiene;
 const drinkingSeconds=drinking?Math.min(dt,state.home.water/.08):0;
 p.thirst=clamp(p.thirst-drinkingSeconds*.018+(dt-drinkingSeconds)*(!a.contact?.001:.0005));
 p.sleepPressure=clamp(p.sleepPressure+dt*(resting?-.003:(!a.contact?.0008:l.workstation.phase==='playing'?.00065:.0004)*(hour<6||hour>21?1.3:1)));
 p.dirt=clamp(p.dirt+dt*(a.action==='eat'?.0015:a.contact?.0006:.00025));
 p.waste=clamp(p.waste+dt*(a.action==='eat'?.006:drinking?.0015:.00055));
 n.energy=clamp(n.energy+dt*(resting?.4:!a.contact?-.12:Math.hypot(a.velocity[0],a.velocity[2])>.025?-.07:l.workstation.phase==='playing'?0:-.015),0,100);
 if(l.workstation.phase!=='playing')n.curiosity=clamp(n.curiosity+dt*(resting?.005:n.energy>45?.04:.02),0,100);
 if(a.contact&&['garden','perch'].includes(a.zoneId)&&l.contactSeconds>1&&l.contactSeconds<30&&l.surface.blocked<1)n.curiosity=clamp(n.curiosity-dt*.19,0,100);
 n.comfort=clamp(n.comfort+dt*((resting?.32:a.contact&&a.zoneId==='garden'?.22:a.contact&&a.zoneId==='perch'?.14:.025)-p.thirst*.10-p.dirt*.07-l.wetness*.09-l.alert*.16-p.waste*.07),0,100);
 if(drinking){n.comfort=clamp(n.comfort+drinkingSeconds*.35,0,100);state.home.water=Math.max(0,state.home.water-drinkingSeconds*.08);}
 if(bathing){p.dirt=clamp(p.dirt-dt*.025);l.wetness=clamp(l.wetness+dt*.06,0,.7);h.bathSeconds+=dt;}
 h.groomCooldown=Math.max(0,h.groomCooldown-dt);
 if(l.behavior==='groom'){p.dirt=clamp(p.dirt-dt*.018);l.wetness*=Math.exp(-dt/5);h.groomSeconds+=dt;h.groomElapsed+=dt;if(h.groomElapsed>=6&&!committedTo(state,'clean'))h.groomCooldown=20;}else h.groomElapsed=0;
 if(toileting&&toiletManeuverReady(state)&&toiletAligned(a)){
  const before=h.toiletElapsed;h.toiletElapsed+=dt;
  if(h.toiletElapsed>=2){p.waste=clamp(p.waste-dt*.055);n.comfort=clamp(n.comfort+dt*.4,0,100);}
  if(before<3&&h.toiletElapsed>=3&&!l.toiletManeuver?.recorded){h.bowelMovements++;h.lastToiletAt=state.simSeconds;h.lastDropPosition=toiletPose(a).drop;if(l.toiletManeuver)l.toiletManeuver.recorded=true;}
 }else h.toiletElapsed=0;
}
