import {stationaryActivity} from './behavior-policy.mjs';
import {topSurfaceApproach} from './environment-spec.mjs';

// Need/target arbitration is always 1 Hz. Only execution feedback changes rate.
export function motorFeedbackInterval(state){
 const {actor:a,living:l}=state;
 if(state.synapticForaging&&l.focus?.action==='eat'&&!stationaryActivity(state))return .1;
 if(l.escape?.phase==='burst'||l.escape?.phase==='trapped'||l.surface.blocked>.5||topSurfaceApproach(a,l.navigation.approach))return .1;
 if(a.contact&&['idle','idle-groom','eat','drink','rest','toilet','groom','bathe','play','observe'].includes(l.behavior))return 1;
 if(stationaryActivity(state))return .1; // Actual contact/alignment handshake.
 const route=l.navigation.route,point=route?.status==='ready'?route.waypoints[route.index]:null;
 if(point&&Math.hypot(...point.map((v,i)=>v-a.position[i]))<1.2)return .1;
 if(route?.status==='unreachable'||route?.status==='stalled')return .1;
 return 1;
}
