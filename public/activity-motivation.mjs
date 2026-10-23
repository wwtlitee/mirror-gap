import {committedTo} from './activity-commitment.mjs';
import {activityAvailable} from './activity-cooldowns.mjs';
import {focusedActivity} from './behavior-focus.mjs';

// Interest in an object is distinct from readiness to perform its activity.
export function activityMotivated(s,action){
 if(!activityAvailable(s,action))return false;
 if(committedTo(s,action)||focusedActivity(s)===action)return true;
 const n=s.needs,l=s.living,p=l.physiology;
 switch(action){
  case 'eat':return n.satiety<55||n.satiety<99.5&&(s.actor.action==='eat'||l.resourceSession?.kind==='food');
  case 'drink':return p.thirst>.22||p.thirst>.005&&(l.behavior==='drink'||l.resourceSession?.kind==='water');
  case 'rest':return l.sleep.active||n.energy<48||p.sleepPressure>.68;
  case 'toilet':return p.waste>(l.hygiene.toiletElapsed>0?.005:.55);
  case 'play':return l.workstation.enabled&&l.workstation.cooldown<=0&&n.curiosity>25&&n.energy>35&&n.satiety>30&&p.thirst<.72&&p.sleepPressure<.68&&p.waste<.8;
  case 'observe':return (l.regions.garden.observationUntil??0)<=s.simSeconds&&n.energy>15&&n.satiety>30&&p.thirst<.72&&p.waste<.8&&p.sleepPressure<.68;
  case 'clean':return p.dirt>.35||l.wetness>.3;
  default:return true;
 }
}
