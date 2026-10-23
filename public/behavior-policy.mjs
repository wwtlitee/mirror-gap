import {idlePose} from './idle-life.mjs';
import {committedTo} from './activity-commitment.mjs';
import {activityAvailable} from './activity-cooldowns.mjs';
import {activityPermitted,focusedActivity,emergencyRecoveryNeeded} from './behavior-focus.mjs';
import {resourceIntent} from './resource-contact.mjs';
import {toiletAdjustment} from './toilet-contact.mjs';
import {toiletManeuverActive} from './toilet-maneuver.mjs';
import {windowObservationAdjustment} from './window-observation.mjs';
export const MIN_SLEEP_SECONDS=90;
export const createSleep=()=>({active:false,elapsed:0,cooldown:0});
const continuingActivity=(s,action)=>committedTo(s,action)||focusedActivity(s)===action;
// An exhausted animal must regain enough strength to reach food and water.
// This short recovery stops early when hunger/thirst make a full sleep unsafe.
export function recoveryAvailable(s) {
 if(focusedActivity(s)==='rest'||emergencyRecoveryNeeded(s)&&!focusedActivity(s))return true;
 if(continuingActivity(s,'rest')&&s.needs.satiety>=10&&s.living.physiology.thirst<=.95)return true;
 const depleted=s.needs.satiety<=20||s.living.physiology.thirst>=.8;
 return !depleted || s.needs.energy<(s.living.sleep?.active?35:15);
}
// Shared contact gates keep sensory, metabolism and physical action consistent.
export function sleepEligible(s) {
 if(s.living.escape?.phase==='burst'||!activityAvailable(s,'rest'))return false;
 const {actor:a,living:l,needs:n}=s;
 // Exhaustion permits a short recovery on any supported surface.
 // Otherwise reaching the bed requires the very energy only the bed restores.
 const emergency=emergencyRecoveryNeeded(s);
 if(!activityPermitted(s,'rest'))return false;
 return a.contact && (a.zoneId==='rest'||emergency) && l.alert<.2 && recoveryAvailable(s)
   && (l.sleep?.active ? l.sleep.elapsed<MIN_SLEEP_SECONDS || n.energy<99.5 || l.physiology.sleepPressure>.005 : ((l.sleep?.cooldown??0)<=0||continuingActivity(s,'rest')||n.energy<15||l.physiology.sleepPressure>.9) && (continuingActivity(s,'rest')||n.energy<48 || l.physiology.sleepPressure>.68));
}
export function screenEligible(s) {
 if(s.living.escape?.phase==='burst'||!activityPermitted(s,'play'))return false;
 const {actor:a,living:l,needs:n}=s,p=l.physiology,w=l.workstation;
 const engaged=w.phase==='playing'||w.phase==='attention',committed=continuingActivity(s,'play');
 return a.contact && a.zoneId==='work' && Math.hypot(a.position[0]+1.2,a.position[1]-1.42,a.position[2]+3.15)<.7
  && w.enabled && w.cooldown<=0 && n.curiosity>(engaged||committed?.5:25) && (focusedActivity(s)==='play' || n.energy>(committed?8:engaged?22:35) && n.satiety>(committed?10:engaged?20:30))
  && l.alert<.2 && (focusedActivity(s)==='play' || p.thirst<(committed?.95:engaged?.82:.72) && p.sleepPressure<(committed?.98:engaged?.8:.68) && p.waste<(committed?.98:engaged?.9:.8));
}
export function stationaryActivity(s) {
 const {actor:a,living:l,needs:n}=s,p=l.physiology;
 if(l.alert>=.3)return null;
 if(toiletManeuverActive(s))return 'toilet';
 if(!l.toiletManeuver&&activityPermitted(s,'toilet') && activityAvailable(s,'toilet') && toiletAdjustment(a) && p.waste>(l.hygiene.toiletElapsed>0||continuingActivity(s,'toilet')?.005:.55))return 'toilet';
 if(!a.contact)return null;
 if((l.behavior==='groom'||continuingActivity(s,'clean'))&&groomingEligible(s))return 'groom';
 const resource=resourceIntent(s);if(resource)return resource.kind==='food'?'feed':'drink';
 if(sleepEligible(s))return 'rest';
 if(groomingEligible(s))return 'groom';
 if(screenEligible(s))return 'screen';
 if(activityPermitted(s,'observe') && activityAvailable(s,'observe') && a.zoneId==='garden' && windowObservationAdjustment(a) && (continuingActivity(s,'observe')||((l.regions.garden.observationUntil??0)<=s.simSeconds && (l.regions.garden.observationSeconds??0)<30)) && (continuingActivity(s,'observe')||n.energy>15 && n.satiety>30 && p.thirst<.72 && p.waste<.8 && p.sleepPressure<.68))return 'observe';
 if(idlePose(s))return 'idle';
 return null;
}

// A neural grooming trigger owns a short motor bout; continuing does not require
// a new spike every 100ms. Danger and escape still suspend physical action.
export function groomingEligible(s,drive=s.actor.groomingDrive??0){
 const {actor:a,living:l,needs:n}=s,p=l.physiology,h=l.hygiene;
 const continuing=continuingActivity(s,'clean');
 return activityPermitted(s,'clean')&&activityAvailable(s,'clean')&&a.contact&&l.contactSeconds>.4&&l.alert<.2&&l.escape?.phase!=='burst'
  &&h.groomCooldown<=0&&(continuing||n.energy>15&&n.satiety>15&&p.thirst<.8&&p.waste<.9)
  &&(p.dirt>(l.behavior==='groom'||continuing?.005:.12)||l.wetness>(l.behavior==='groom'||continuing?.005:.08))
  &&(continuing||l.behavior==='groom'&&h.groomElapsed<6||drive>.04&&Math.hypot(a.velocity[0],a.velocity[2])<.2);
}
