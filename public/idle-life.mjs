import {focusedActivity} from './behavior-focus.mjs';
import {supportedFeet} from './collision-world.mjs';

// A short, interruptible pause after landing, not another scheduled goal.
// Contact age already survives checkpoints; no random draw or permanent memory.
export function idlePose(state){
 const {actor:a,living:l,needs:n}=state,focus=focusedActivity(state),p=l.physiology;
 if(focus&&focus!=='explore'||l.commitment||!a.contact||l.contactSeconds<.4
   ||l.alert>=.15||l.surface.blocked>.2||['burst','trapped'].includes(l.escape?.phase)
   ||Math.hypot(...a.velocity)>.08||n.energy<30||n.satiety<30
   ||p.thirst>.7||p.waste>.7||p.sleepPressure>.75||l.wetness>.4)return null;
 const age=l.surface.contactAge;
 const arrival=state.lastVisited?.[a.zoneId]??0;
 const seed=Math.abs(Math.sin(arrival*.173+a.zoneId.length*2.31));
 const duration=7+seed*16;
 if(age<.4||age>duration||supportedFeet(a.position,a.heading,a)<4)return null;
 // Some visits contain one small foreleg bout; most of the pause is stillness.
 return seed>.35&&age>duration*.45&&age<duration*.45+1.8?'idle-groom':'idle';
}
