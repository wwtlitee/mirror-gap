import {bodyMetrics} from './body-metrics.mjs';
import {surfaceBelow,supportedFeet} from './collision-world.mjs';
import {moveBody} from './environment-spec.mjs';
import {toiletPose,toiletAligned,toiletRimStations,toiletLandingPoint} from './toilet-contact.mjs';
import {activityPermitted,focusedActivity} from './behavior-focus.mjs';
import {activityAvailable} from './activity-cooldowns.mjs';

const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const planar=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const localPhases=new Set(['land','walk','turn','eliminate','leave']);
const stationFor=s=>toiletRimStations(s.actor).find(p=>p.id===s.living.toiletManeuver?.stationId);
const supported=a=>a.contact&&supportedFeet(a.position,a.heading,a)>=3;
const urgent=s=>s.needs.energy<12||s.needs.satiety<12||s.living.physiology.thirst>.95;

function nearestStation(actor){
 return toiletRimStations(actor).slice().sort((a,b)=>distance(actor.position,a.rendezvous)-distance(actor.position,b.rendezvous))[0]??null;
}
export function toiletNavigationPoint(state){
 if(bodyMetrics(state.actor).scale>=.15)return toiletLandingPoint(state.actor.position,state.actor);
 const station=stationFor(state)??nearestStation(state.actor);
 return station?.rendezvous??null;
}
function enter(s,phase){
 const m=s.living.toiletManeuver;m.phase=phase;m.phaseAt=s.simSeconds;
 m.bestDistance=null;m.bestAngle=null;
}
function fail(s){
 const m=s.living.toiletManeuver;enter(s,'failed');m.retryAt=s.simSeconds+3;
 const n=s.living.navigation;if(n){n.route=null;n.targetId=null;}
}
export function toiletManeuverActive(s){
 const m=s.living.toiletManeuver;
 return Boolean(m&&localPhases.has(m.phase)&&s.living.alert<.3&&s.living.escape?.phase!=='burst'
  &&(m.phase==='leave'?!urgent(s):activityPermitted(s,'toilet')&&activityAvailable(s,'toilet')));
}
export function toiletManeuverReady(s){
 return !s.living.toiletManeuver||s.living.toiletManeuver.phase==='eliminate';
}
export function toiletManeuverProgressing(s){
 const m=s.living.toiletManeuver;
 return toiletManeuverActive(s)&&s.simSeconds-m.lastProgressAt<2;
}

// This bounded local motor program owns only the landing/footfall sequence.
// The neural controller still chooses and approaches the toilet from the room.
// Every commanded movement is resolved against the real collision mesh.
export function updateToiletManeuver(s,dt){
 if(bodyMetrics(s.actor).scale>=.15){s.living.toiletManeuver=null;return;}
 const a=s.actor,l=s.living,now=s.simSeconds;
 let m=l.toiletManeuver;
 const complete=l.physiology.waste<=.005||!activityAvailable(s,'toilet');
 if(m?.phase==='eliminate'&&complete)enter(s,'leave');
 const allowed=activityPermitted(s,'toilet')&&activityAvailable(s,'toilet')&&l.physiology.waste>.005
  &&(focusedActivity(s)==='toilet'||l.physiology.waste>.55);
 if(l.alert>=.3||l.escape?.phase==='burst'||!allowed&&m?.phase!=='leave'||m?.phase==='leave'&&urgent(s)){
  l.toiletManeuver=null;return;
 }
 if(!m){
  const station=nearestStation(a);if(!station)return;
  m=l.toiletManeuver={phase:'approach',stationId:station.id,startedAt:now,phaseAt:now,lastProgressAt:now-10,bestDistance:null,bestAngle:null,recorded:false};
  // A restored/test actor already on a real discharge stance need not leave
  // the seat and repeat its approach; contact and orientation remain required.
  if(toiletAligned(a)){m.direct=true;enter(s,'eliminate');}
 }
 const station=stationFor(s);if(!station){l.toiletManeuver=null;return;}
 if(m.direct&&m.phase==='leave'&&planar(a.position,station.entry)>.05){enter(s,'done');return;}
 const metric=bodyMetrics(a),epsilon=Math.max(.00015,metric.length*.04);
 if(m.phase==='failed'){
  if(now>=m.retryAt){l.toiletManeuver=null;}return;
 }
 if(m.phase==='done'){if(allowed)l.toiletManeuver=null;return;}
 if(m.phase==='approach'){
  if(supported(a)&&a.zoneId==='toilet'&&planar(a.position,station.entry)<.028&&Math.abs(a.position[1]-station.entry[1])<metric.radius*2){enter(s,'walk');}
  else if(!a.contact&&planar(a.position,station.entry)<.07&&a.position[1]>=station.entry[1]-.003&&a.position[1]<station.entry[1]+.22){enter(s,'land');}
 }
 if(!localPhases.has(m.phase))return;
 const target=m.phase==='land'||m.phase==='leave'?station.entry:station.position;
 const remaining=m.phase==='turn'?Math.abs(angle(station.heading,a.heading)):distance(a.position,target);
 const threshold=m.phase==='turn'?.02:epsilon;
 // Starting a phase or retry is not motion. Only a measured reduction in
 // distance/turning error can suppress confinement detection.
 if(m.bestDistance===null)m.bestDistance=remaining;
 else if(remaining<m.bestDistance-threshold){m.bestDistance=remaining;m.lastProgressAt=now;}
 if(['walk','leave','land'].includes(m.phase)){
  const turnError=Math.abs(angle(m.phase==='leave'?station.heading:station.walkHeading,a.heading));
  if(m.bestAngle==null)m.bestAngle=turnError;
  else if(turnError<m.bestAngle-.02){m.bestAngle=turnError;m.lastProgressAt=now;}
 }
 if(m.phase==='land'&&supported(a)&&planar(a.position,station.entry)<.004&&Math.abs(a.position[1]-station.entry[1])<metric.radius*2)enter(s,'walk');
 else if(m.phase==='walk'&&supported(a)&&planar(a.position,station.position)<epsilon)enter(s,'turn');
 else if(m.phase==='turn'&&supported(a)&&toiletAligned(a))enter(s,'eliminate');
 else if(m.phase==='leave'&&supported(a)&&planar(a.position,station.entry)<epsilon){enter(s,'done');return;}
 if(m.phase==='eliminate'){
  if(toiletAligned(a)){m.lastProgressAt=now;return;}
  // A momentary disturbance retains the session's one-discharge flag.
  if(supported(a)&&planar(a.position,station.position)<metric.length)enter(s,'turn');
 }
 if(now-Math.max(m.phaseAt,m.lastProgressAt)>4||now-m.phaseAt>(m.phase==='land'?10:m.phase==='walk'||m.phase==='leave'?12:6))fail(s);
}

export function toiletManeuverMotion(s){
 if(!toiletManeuverActive(s))return null;
 const a=s.actor,m=s.living.toiletManeuver,station=stationFor(s),body=bodyMetrics(a);
 if(!station)return null;
 if(m.phase==='eliminate'||m.phase==='turn')return {phase:m.phase,heading:m.phase==='eliminate'?(toiletPose(a)?.heading??station.heading):station.heading,velocity:[0,-.03*body.scale,0],moving:false};
 const target=m.phase==='walk'?station.position:station.entry;
 const heading=m.phase==='walk'?station.walkHeading:station.heading;
 if(m.phase==='land'){
  const close=planar(a.position,target)<.007;
  return {phase:m.phase,heading:station.walkHeading,velocity:[clamp((target[0]-a.position[0])*3,-.12,.12),close?-.06:clamp((target[1]+.045-a.position[1])*2,-.08,.06),clamp((target[2]-a.position[2])*3,-.12,.12)],moving:true};
 }
 if(!supported(a))return null;
 if(Math.abs(angle(heading,a.heading))>.1)return {phase:m.phase,heading,velocity:[0,-.03*body.scale,0],moving:false};
 const speed=body.length*1.8,velocity=[clamp((target[0]-a.position[0])*3,-speed,speed),-.03*body.scale,clamp((target[2]-a.position[2])*3,-speed,speed)];
 // Check the next physical footfall, including collision corrections. Never
 // walk over a gap or push through a blocked seat to satisfy a waypoint.
 const point=[...a.position],probe=[...velocity];moveBody(point,probe,.04,a.heading,undefined,undefined,a);
 const ground=surfaceBelow(point[0],point[1]+body.radius,point[2],body.radius*3,a);
 if(!ground||supportedFeet(point,a.heading,a)<3||Math.abs(point[1]-a.position[1])>body.radius){velocity[0]=0;velocity[2]=0;}
 return {phase:m.phase,heading,velocity,moving:Math.hypot(velocity[0],velocity[2])>0};
}
