import {withFoodStock,foodAmount} from '../public/food-stock.mjs';
import {activityAvailable,signalActivity} from '../public/activity-cooldowns.mjs';
import {signalPreference,cueResponse,toySkill} from '../public/companion-learning.mjs';
import {learnedForagingAvailable} from '../public/learned-foraging.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';
import {focusedActivity,activityPermitted} from '../public/behavior-focus.mjs';
import {toiletNavigationPoint} from '../public/toilet-maneuver.mjs';
import {surfaceBelow} from '../public/collision-world.mjs';
import {resourceLandingTarget} from '../public/resource-landing.mjs';
import {sleepEligible,stationaryActivity} from '../public/behavior-policy.mjs';
import {topSurfaceApproach} from '../public/environment-spec.mjs';
import {bodyWaterContact,nearestResource} from '../public/resource-contact.mjs';
import { contactCue, surfaceRestlessness } from '../public/surface-life.mjs';
import { regionDemand } from '../public/region-life.mjs';
import { daylightState, GAME_ADAPTERS } from './living-world.mjs';
import { readFileSync } from './platform-io.mjs';
import { Brain } from './neural-core.mjs';
import { NeuralObserver } from './neural-observer.mjs';
import { SIGNAL_SOURCES, SOLIDS, BRANCH_SEGMENTS, closestOnBranch, clamp, waterContact, signalOccluded, landingReadiness, senseLocalObstacles } from '../public/environment-spec.mjs';

const calibration = JSON.parse(readFileSync(new URL('./motor-calibration.json', import.meta.url), 'utf8'));
const D = 1 / Math.sqrt(3);
// Four body-relative receptor orientations, a tetrahedron spanning 3D space.
export const RECEPTORS = [[D, D, D], [-D, -D, D], [-D, D, -D], [D, -D, -D]];
const zeroMotor = () => ({ local: [0, 0, 0], drive: 0, populations: [0, 0, 0, 0] });

export function senseEnvironment(state,pulses,sources=SIGNAL_SOURCES,options={}){return withFoodStock(state,()=>senseCurrentEnvironment(state,pulses,sources,options));}
function senseCurrentEnvironment(state, pulses, sources = SIGNAL_SOURCES, {feedbackSeconds=.1,landingCandidateBudget=Infinity,landingSearchCache,foodLearning=null,neutralOdors=[]} = {}) {
  const p = state.actor.position, n = state.needs;
  const hunger = 1 - n.satiety / 100, fatigue = 1 - n.energy / 100;
  const life = state.living, day = daylightState(state), activeFocus=focusedActivity(state);
  const synapticFood=Boolean(foodLearning),foodFocus=activeFocus==='eat'
    &&(synapticFood||learnedForagingAvailable(state,neutralOdors));
  const navigating=activeFocus&&activeFocus!=='explore'&&!foodFocus;
  const searching=navigating&&!life?.navigation?.targetId;
  const route=life?.navigation?.route;
  const foodRoute=synapticFood&&sources.some(source=>source.resourceKind==='food'&&source.id===route?.targetId);
  const followingRoute=!foodFocus&&!foodRoute&&route?.status==='ready'&&route.targetId===life.navigation.targetId;
  const alert = life?.alert ?? 0;
  const thirst=life?.physiology?.thirst??0, sleep=life?.physiology?.sleepPressure??0;
  const restNeed=Math.max(fatigue,sleep);
  const supplyUrgency=Math.max(hunger,thirst);
  const weights = { odor: 6 * hunger ** 3 * (state.home.food>0?1:0) + pulses.feed * .8,
    sanitation:8*(life?.physiology?.waste??0)**3, water: 6 * Math.max(thirst,(life?.physiology?.dirt??0)*.85*(1-supplyUrgency)) ** 3 * (state.home.water>0?1:0),
    shelter: 6 * restNeed ** 3 + day.night * .18 + alert * .7, light: .35 * n.curiosity / 100 * day.daylight * (1 - (life?.shadow ?? 0) * .85),
    humidity: .7 * (1 - n.comfort / 100) + pulses.mist,
    contrast: life?.workstation.enabled === false ? 0 : .45 * n.curiosity / 100,
    texture: .15 * n.curiosity / 100, airflow: .08 * (1 + Math.sin(state.simSeconds * .37)) + (life?.gust ?? 0) * 1.2 + (life?.care?.wind??0)*.025,
    vibration: (life?.care?.stimulus??0) + pulses.chime * 1.3 * (1 - (life?.exposure.chime ?? 0) * .8) };
  const primary=new Set(['fruit','nest','screen','window','water','high-perch','toilet','open-air']);
  const force = [0, 0, 0];
  const signals = [], cues = [];
  for (const source of sources) {
    if(source.resourceKind==='food'&&(state.home.food<=0||foodAmount(source.resourceId)<=0)||source.resourceKind==='water'&&state.home.water<=0)continue;
    const activity=signalActivity(source);if(activity&&!activityAvailable(state,activity)&&!(source.resourceKind==='water'&&activityAvailable(state,'clean')&&(life?.physiology?.dirt??0)>.35))continue;
    if(source.id==='screen'&&(life?.workstation?.cooldown??0)>0)continue;
    if(source.zone==='garden' && (life?.regions?.garden?.observationUntil??0)>state.simSeconds)continue;
    const target = source.id==='toilet'?{position:toiletNavigationPoint(state),arrival:null}:resourceLandingTarget(source,p,state.actor,{candidateBudget:landingCandidateBudget,searchCache:landingSearchCache});
    const position = target?.position;
    if (!position) continue;
    const delta = position.map((v, i) => v - p[i]);
    const distance = Math.hypot(...delta);
    const demand=regionDemand(state,source.zone),main=Boolean(source.resourceKind)||primary.has(source.id);
    const localCue=source.scope==='surface';
    const novelty=1-.92*(life?.surface?.exposure[source.id]??0);
    const learnedFood=synapticFood&&source.resourceKind==='food';
    const foodVariety=source.resourceKind==='food'&&!learnedFood?1-.85*(life?.surface?.exposure['food:'+source.resourceId]??0):1;
    const amplitude=source.resourceKind ? foodVariety*(.12+(weights[source.kind]??0))*(state.actor.contact?.35:1)
      : localCue ? (.45+(weights[source.kind]??.15))*novelty*(state.actor.contact&&source.zone===state.actor.zoneId?2.8:.12)
      : main ? ((.18+2.4*demand.level**2)*demand.novelty+(demand.urgency?3*demand.body**3:0))*(state.actor.contact?.14:1) : (weights[source.kind]??0)*.3;
    const lightScale=source.kind==='light'?.55+.45*day.daylight:1;
    const blocked=!['vibration','airflow'].includes(source.kind)&&signalOccluded(p,position);
    // Optional exploration/cleanliness must not drown out starvation or thirst.
    const optional=!source.resourceKind&&!['nest','toilet'].includes(source.id);
    const priority=optional?1-.9*Math.max(0,(supplyUrgency-.7)/.3):1;
    const intensity = learnedFood
      ? (0.3+6*hunger**3)*Math.exp(-distance/1.2)*(blocked?.15:1)
      : (priority * amplitude * Math.exp(-distance / (main?12:source.range)) * lightScale * (blocked?.06:1)
        + (source.kind==='odor'?pulses.feed*.2*Math.exp(-distance/3):0)) * signalPreference(state,source);
    const neuralOdor=learnedFood?foodLearning[source.resourceId]:null;
    signals.push({ id: source.id, kind: source.kind, resourceId:source.resourceId,resourceKind:source.resourceKind,zone:source.zone, label:source.label, position,scope:source.scope??'room', intensity, distance, occluded:blocked, regionalNeed:source.resourceKind==='food'?hunger:source.resourceKind==='water'?thirst:Math.max(demand.need,demand.body),...(learnedFood?{neuralOdor:neuralOdor??null}:{}),...(source.resourceKind&&target.arrival?{arrival:{via:[...target.arrival.via],heading:target.arrival.heading}}:{}) });
    const familiarCue=source.id==='bell'&&(!activeFocus||activeFocus==='explore')&&!navigating?cueResponse(state):0;
    const polarity = source.kind === 'vibration' ? familiarCue>.2?.25*familiarCue:-1 : source.kind === 'airflow' ? -.5 : !source.resourceKind&&main&&demand.need<.10&&!demand.urgency?-.5:1;
    cues.push({id:source.id,resourceId:source.resourceId,delta,distance,intensity,polarity,main,learnedFood,neuralValence:neuralOdor?.valence??0});
  }
  // Collect competing cues above, but only the chosen need steers the body.
  // Route waypoints are projected into sensation; decoded neurons still move it.
  const strongest=Math.max(.001,...cues.filter(c=>c.main&&c.polarity>0).map(c=>c.intensity));
  for(const c of cues){const nav=life?.navigation,failed=(nav?.failedUntil?.[c.id]??0)>state.simSeconds||(nav?.failedUntil?.['resource:'+c.resourceId]??0)>state.simSeconds;
    if(c.learnedFood){
      // Only simulated MBON firing supplies learned valence. This is a fixed
      // sensory projection; the original 4386-cell brain still decodes motion.
      const allowed=!activeFocus||foodFocus||activeFocus==='explore';
      if(allowed)for(let i=0;i<3;i++)force[i]+=3*c.neuralValence*c.intensity*c.delta[i]/Math.max(.32,c.distance);
      continue;
    }
    const focus=failed?0:activeFocus?(c.id===nav?.targetId?1.4:navigating?0:c.main?.12:1)
      :nav?.targetId&&c.main&&c.polarity>0?(c.id===nav.targetId?1.4:0):1;
    const attention=c.id===nav?.targetId?1:c.main&&c.polarity>0?.08+.92*(c.intensity/strongest)**4:1;
    for(let i=0;i<3;i++)force[i]+=focus*c.polarity*c.intensity*attention*c.delta[i]/Math.max(.32,c.distance);
  }
  // Neutral cues have no food/resource identity and never supply a waypoint.
  // Existing needs/routes keep direction priority; local safety below still wins.
  const neutralAllowed=!activeFocus||activeFocus==='eat'||activeFocus==='explore';
  if(!Array.isArray(neutralOdors)||neutralOdors.length>32)throw Error('中性气味感觉无效');
  for(const cue of neutralOdors){
    if(!cue||typeof cue.id!=='string'||!['A','B'].includes(cue.odor)
      ||!Array.isArray(cue.position)||cue.position.length!==3||!cue.position.every(Number.isFinite)
      ||!Number.isFinite(cue.intensity)||cue.intensity<0
      ||!Number.isFinite(cue.neuralValence)||Math.abs(cue.neuralValence)>1)throw Error('中性气味感觉无效');
    const delta=cue.position.map((value,i)=>value-p[i]),distance=Math.hypot(...delta);
    signals.push({id:cue.id,kind:'neutral-odor',odor:cue.odor,position:[...cue.position],distance,
      intensity:cue.intensity,neuralValence:cue.neuralValence});
    if(!followingRoute&&neutralAllowed)for(let i=0;i<3;i++){
      force[i]+=3*cue.neuralValence*cue.intensity*delta[i]/Math.max(.32,distance);
    }
  }
  const heading = state.actor.heading;
  const recovery = Math.max(hunger, restNeed, thirst);
  // Self-motion/airflow is an internal sensory drive. No positions or future
  // waypoints are generated. Neural shot noise supplies variable flight bouts.
  const explore = ((activeFocus==='eat'&&learnedForagingAvailable(state,neutralOdors))||navigating&&!searching?.04:.45) * (1 - recovery ** 3);
  force[1] += alert * .4;
  force[0] += Math.sin(heading) * explore;
  force[2] += Math.cos(heading) * explore;
  // Room boundary cues remain; no preferred altitude competes with high perches.
  const limits = [[-5.72, 5.72], [.13, 4.62], [-4.12, 4.20]];
  for (let i = 0; i < 3; i++) {
    force[i] += .65 * (Math.exp(-(p[i] - limits[i][0]) / .65) - Math.exp(-(limits[i][1] - p[i]) / .65));
  }
  for (const solid of SOLIDS) {
    const nearest = p.map((v, i) => clamp(v, solid.min[i], solid.max[i]));
    const away = p.map((v, i) => v - nearest[i]);
    const distance = Math.hypot(...away);
    // Top faces are possible landing surfaces; sides give strong looming cues.
    const strength = away[1] > .01 && away[0] === 0 && away[2] === 0 ? .025 : .75;
    if (distance > .001 && distance < 1.2) for (let i = 0; i < 3; i++) force[i] += away[i] / distance * strength * Math.exp(-distance / .35);
    // Local visual edge cue: under a shelf, move toward its closest edge rather
    // than pressing into the underside forever. This enters sensory input only.
    if(p[1]<solid.min[1]&&solid.min[1]-p[1]<.65&&p[0]>solid.min[0]-.18&&p[0]<solid.max[0]+.18&&p[2]>solid.min[2]-.18&&p[2]<solid.max[2]+.18){
      const edges=[[0,-1,p[0]-solid.min[0]],[0,1,solid.max[0]-p[0]],[2,-1,p[2]-solid.min[2]],[2,1,solid.max[2]-p[2]]];
      edges.sort((a,b)=>a[2]-b[2]);const [axis,sign]=edges[0];force[axis]+=sign*.8*Math.exp(-(solid.min[1]-p[1])/.5);
    }

  }
  for (const branch of BRANCH_SEGMENTS) {
    const nearest = closestOnBranch(p, branch), away = p.map((v, i) => v - nearest[i]);
    const distance = Math.hypot(...away);
    if (distance > .001 && distance < .6) for (let i = 0; i < 3; i++) force[i] += away[i] / distance * .30 * Math.exp(-Math.max(0, distance - branch.radius) / .2);
  }
  // Food should quiet movement while hungry or actually eating, not indefinitely
  // at the satiety where the MN9 response has already stopped.
  const feedingHold = stationaryActivity(state)==='feed';
  const recoveryHold = sleepEligible(state);
  const drinkingHold = stationaryActivity(state)==='drink';
  const bathingHold=activityPermitted(state,'clean')&&activityAvailable(state,'clean')&&bodyWaterContact(state.actor)&&(life?.physiology?.dirt??0)>(life?.behavior==='bathe'?.005:.35);
  const toiletHold=stationaryActivity(state)==='toilet';
  const settled = Boolean(stationaryActivity(state)) || bathingHold;
  const watching = activityPermitted(state,'play')&&['attention', 'playing'].includes(life?.workstation.phase) && state.actor.contact;
  const quietPerch = state.actor.contact && (life?.contactSeconds ?? 0) < .6 && alert < .15;
  // Seeing reachable water directly below must be able to START a descent.
  // Requiring negative vertical velocity first creates an orbit above the bowl.
  // This changes sensory arousal only; the real neural motor still supplies thrust.
  const waterBelow=activityPermitted(state,'drink')&&!state.actor.contact&&thirst>.005?nearestResource(p,'water',{visible:true,maxDistance:.95}):null;
  const body=bodyMetrics(state.actor);
  const waterApproach=waterBelow&&p[1]>waterBelow.point[1]+body.radius&&Math.hypot(p[0]-waterBelow.point[0],p[2]-waterBelow.point[2])<Math.max(.008,.06*body.scale);
  const surfaceApproach=!followingRoute&&!settled&&!watching?topSurfaceApproach(state.actor,life?.navigation?.approach):null;
  const landingSurface=!state.actor.contact?surfaceBelow(p[0],p[1]-.035*body.scale,p[2],.65,state.actor):null;
  const jammed=(life?.surface?.blocked??0)>1||life?.escape?.phase==='trapped';
  const nearRouteEnd=!followingRoute||route.remainingDistance<.5;
  const approach = nearRouteEnd&&!jammed&&!surfaceApproach&&!state.actor.contact && (life?.surface?.blocked??0)<=1 && (waterApproach||signals.some(s=>{
    if(!(s.resourceKind||primary.has(s.id))||(navigating&&s.id!==life.navigation.targetId))return false;
    const landingRadius = ['toilet','window'].includes(s.id) || s.resourceKind ? Math.max(.004,.085*body.scale) : .24;
    const closeHorizontally=!navigating||Math.hypot(p[0]-s.position[0],p[2]-s.position[2])<landingRadius;
    return closeHorizontally&&s.distance<(navigating?.42:1.15)&&(s.regionalNeed>.25||navigating)&&!s.occluded&&landingSurface&&landingSurface.position[1]>=s.position[1]-.20;
  }));
  const touch=contactCue(state), habituation=touch?(life?.surface?.exposure[touch.id]??0):0;
  const sampling=!navigating&&state.actor.contact&&touch&&habituation>.2&&habituation<.4;
  const grooming=activityPermitted(state,'clean')&&life?.behavior==='groom'&&(life?.hygiene?.groomCooldown??0)<=0&&((life?.physiology?.dirt??0)>.08||(life?.wetness??0)>.03);
  const restlessness=surfaceRestlessness(state);
  const resting = Boolean(stationaryActivity(state)) || settled || watching || (!surfaceApproach&&(quietPerch || approach || sampling || grooming));
  const takeoffIntent=state.actor.contact&&!resting&&(followingRoute||restlessness>.25||alert>.35||state.actor.zoneId==='nook');
  if(state.actor.contact){
    // Foot contact flattens exploration. Boredom/blocking is a sensory bias,
    // never a direct force or a teleport; actual thrust must still be decoded.
    force[1]=takeoffIntent?.8+restlessness:-.12;
    if(!resting&&(!navigating||searching)){force[0]+=.65*Math.sin(heading+Math.sin(state.simSeconds*.7)*1.4+restlessness*2);force[2]+=.65*Math.cos(heading+Math.sin(state.simSeconds*.7)*1.4+restlessness*2);}
  }
  if(followingRoute&&!settled&&!watching){
    // Desired velocity tapers at every waypoint. Braking enters sensation too;
    // merely scaling a unit direction above one would vanish in normalization.
    const waypoint=route.waypoints[route.index];
    const remaining=waypoint?Math.hypot(...waypoint.map((v,i)=>v-p[i])):0;
    const speed=Math.min(.9,remaining*1.6);
    for(let i=0;i<3;i++){
      const desired=route.direction[i]*speed;
      // Slow feedback cannot safely use a high-gain velocity correction held for
      // a full second. Feed-forward offsets drag; bounded feedback trims drift.
      force[i]=i===1?(desired-state.actor.velocity[i])*1.8
        :desired*.5+(desired-state.actor.velocity[i])*(feedbackSeconds>=.5?.45:.9);
    }
    if(takeoffIntent&&force[1]<.5)force[1]=.8;
  }
  const obstacle = !settled && !watching && jammed ? senseLocalObstacles(state.actor) : null;
  if(obstacle?.blocked){
    force[0]=obstacle.escape[0]*2;force[2]=obstacle.escape[2]*2;
    force[1]=obstacle.blockedAbove?-.10:.8;
    signals.push({id:'local-obstacle',kind:'touch',label:'近处障碍',intensity:obstacle.strength,distance:Math.max(0,obstacle.clearance)});
  }
  if(surfaceApproach&&!obstacle?.blocked){
    force[0]=surfaceApproach.direction[0]*3;force[1]=surfaceApproach.direction[1]*3;force[2]=surfaceApproach.direction[2]*3;
    signals.push({id:'top-surface-approach',kind:'space',label:surfaceApproach.phase==='rise'?'板面外侧上升':'绕向板面外缘',intensity:1,distance:0});
  }
  const gaming=activityPermitted(state,'play')&&life?.workstation.phase==='playing';
  const arousal = gaming ? .34 : approach ? .06 : resting ? .015 : .34 + alert * .07;
  signals.push({ id: 'contact', kind: 'touch', intensity: state.actor.contact ? 1 : 0, distance: 0 });
  signals.push({ id: 'looming', kind: 'threat', intensity: alert, distance: 0 });
  const length = Math.max(1, Math.hypot(...force));
  const local = [(force[0] * Math.cos(heading) - force[2] * Math.sin(heading)) / length,
    force[1] / length, (force[0] * Math.sin(heading) + force[2] * Math.cos(heading)) / length];
  // Gaming changes the sensory context; the same continuous brain produces the response.
  if (gaming) {
    const error = GAME_ADAPTERS[life.workstation.gameId].observe(life.workstation);
    const practice=toySkill(state,life.workstation.gameId);
    local[0] = clamp(error[0]*(.85+.3*practice),-1,1); local[1] = error[1]; local[2] = 0;
    signals.push({ id: 'game-light', kind: 'visual-error', intensity: Math.hypot(...error), distance: 0 });
  }
  const inputs = RECEPTORS.map(dir => clamp(arousal + (gaming ? .28 : resting ? .006 : .28) * dir.reduce((v, d, i) => v + d * local[i], 0), 0, .8));
  const holdReason = approach ? 'approach' : watching ? 'screen' : toiletHold ? 'toilet' : bathingHold ? 'bathing' : drinkingHold ? 'drinking' : feedingHold ? 'feeding' : recoveryHold ? 'recovery' : quietPerch ? 'settling' : grooming ? 'grooming' : sampling ? 'sampling' : 'none';
  return { inputs, signals, context: { synapticFood,neutralCueCount:neutralOdors.length,neutralCueProjected:!followingRoute&&neutralAllowed&&neutralOdors.some(cue=>cue.neuralValence!==0),focus:activeFocus, routeStatus:foodFocus?null:route?.status??null, holdReason, arousal, resting, takeoffIntent:takeoffIntent||Boolean(surfaceApproach?.phase==='rise'), restlessness, obstacle:obstacle?.blocked?obstacle:surfaceApproach?null:obstacle,surfaceApproach:obstacle?.blocked?null:surfaceApproach, contactCue:touch?.label??null, contactSeconds:life?.contactSeconds??0 } };
}

export class NeuralController extends NeuralObserver {
  constructor({ saved = null, seed = 0x4d495252, ...options } = {}) {
    super({ seed, ...options });
    this.rng = seed >>> 0 || 1;
    this.motor = zeroMotor();
    this.sensory = { inputs: [0, 0, 0, 0], signals: [] };
    this.computeMs = 0;
    if (this.error) return;
    if (calibration.graphHash !== this.graph.sha256) throw new Error('运动读出与连接数据版本不一致');
    this.brain = new Brain(this.graph, () => {
      let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0;
      return this.rng / 4294967296;
    }, { inputChannels: calibration.channels });
    this.readout = new Int8Array(this.brain.n).fill(-1);
    calibration.groups.forEach((group, c) => group.forEach(n => {
      if (this.brain.inputMap[n] >= 0 || this.readout[n] !== -1) throw new Error('运动读出不得包含输入细胞或重复细胞');
      this.readout[n] = c;
    }));
    if (saved) this.restore(saved);
  }

  tick(state, dt = .1) {
    this.paused = state.paused;
    if (!this.brain || this.error || this.paused) return;
    const start = performance.now();
    try {
      this.sensory = senseEnvironment(state, this.pulses);
      const result = this.brain.advance(this.sensory.inputs, 400);
      const counts = [0, 0, 0, 0];
      for (const n of result.spikes) if (this.readout[n] >= 0) counts[this.readout[n]]++;
      const decoded = calibration.inverse.map(row => clamp(counts.every(v => v === 0) ? 0 : .34 + row.reduce((sum, w, i) => sum + w * (counts[i] / 400 - calibration.baseline[i]), 0), 0, 1.2));
      const smoothing = 1 - Math.exp(-dt / .18);
      this.motor.populations = decoded.map((v, i) => this.motor.populations[i] + (v - this.motor.populations[i]) * smoothing);
      const mean = this.motor.populations.reduce((a, b) => a + b, 0) / 4;
      this.motor.local = [0, 1, 2].map(axis => clamp(RECEPTORS.reduce((sum, dir, i) => sum + dir[axis] * this.motor.populations[i], 0) * .75 / .28, -1, 1));
      this.motor.drive = clamp(mean / .34, 0, 1.4);
      this.totalSpikes += result.spikes.length;
      this.frame = { sequence: result.steps / 400, steps: result.steps, neuralMs: result.steps * .1,
        at: Date.now(), inputs: this.sensory.inputs, spikes: [...new Set(result.spikes)],
        spikeCount: result.spikes.length, transmitted: [...new Set(result.transmitted)], totalSpikes: this.totalSpikes };
      for (const type of Object.keys(this.pulses)) this.pulses[type] *= Math.exp(-dt / 4);
    } catch (error) { this.error = error.message; this.motor = zeroMotor(); this.frame = null; }
    this.computeMs = performance.now() - start;
  }

  snapshot() {
    return { ...super.snapshot(), bodyControl: 'neural-motor', timeScale: .4,
      interface: 'calibrated-engineering', motor: structuredClone(this.motor),
      sensory: structuredClone(this.sensory), computeMs: this.computeMs };
  }

  serialize() {
    if (!this.brain || this.error) return null;
    const b = this.brain;
    return { fingerprint: this.fingerprint, rng: this.rng, step: b.step,
      v: [...b.v], g: [...b.g], ref: [...b.ref], queue: b.queue.map(q => [...q]),
      count: [...b.count], frames: b.frames, pulses: { ...this.pulses },
      motor: structuredClone(this.motor), totalSpikes: this.totalSpikes };
  }

  restore(saved) {
    const vector = (a, size, check) => Array.isArray(a) && a.length === size && a.every(check);
    const finite = v => typeof v === 'number' && Number.isFinite(v);
    const integer = v => Number.isSafeInteger(v) && v >= 0;
    if (!saved || saved.fingerprint !== this.fingerprint || !integer(saved.rng) || saved.rng < 1 || saved.rng > 0xffffffff
      || !integer(saved.step) || !integer(saved.frames) || !integer(saved.totalSpikes)
      || !vector(saved.v, 1024, finite) || !vector(saved.g, 1024, finite)
      || !vector(saved.ref, 1024, integer) || !vector(saved.count, 16, v => finite(v) && v >= 0)
      || !vector(saved.queue, 19, q => Array.isArray(q) && q.length <= 1024 && q.every(v => integer(v) && v < 1024))
      || !saved.motor || !vector(saved.motor.local, 3, v => finite(v) && Math.abs(v) <= 1)
      || !vector(saved.motor.populations, 4, v => finite(v) && v >= 0 && v <= 1.2)
      || !finite(saved.motor.drive) || saved.motor.drive < 0 || saved.motor.drive > 1.4
      || !saved.pulses || !['feed', 'mist', 'chime'].every(k => finite(saved.pulses[k]) && saved.pulses[k] >= 0 && saved.pulses[k] <= .9)) throw new Error('神经存档无效，原始文件保留');
    this.rng = saved.rng; this.totalSpikes = saved.totalSpikes;
    for (const key of ['v', 'g', 'ref', 'count']) this.brain[key].set(saved[key]);
    this.brain.queue = saved.queue.map(q => [...q]); this.brain.step = saved.step; this.brain.frames = saved.frames;
    this.pulses = { ...saved.pulses }; this.motor = structuredClone(saved.motor);
  }
}
