import {withFoodStock,consumeFood} from '../public/food-stock.mjs';
import {createCare,updateCare,receiveWeather,replenish,careAction} from '../public/pet-care.mjs';
import {committedTo} from '../public/activity-commitment.mjs';
import {observeCompanion,rememberInteraction,interactionSensitivity,interactionSummary} from '../public/companion-learning.mjs';
import {validateCompanion,companionSummary} from '../public/companion-identity.mjs';
import {applyGrowthSize,stepGrowth} from '../public/companion-growth.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';
import {createBehaviorFocus,validateBehaviorFocus,updateBehaviorFocus,focusedActivity} from '../public/behavior-focus.mjs';
import {createEscape,validateEscape,updateEscape,escapeAcceleration,moveEscapeBody} from '../public/escape-reflex.mjs';
import {createNavigation,validateNavigation,updateNavigation} from '../public/navigation-attention.mjs';
import {stationaryActivity,createSleep} from '../public/behavior-policy.mjs';
import {navigationBrake} from '../public/navigation-brake.mjs';
import {motorFeedbackInterval} from '../public/neural-cadence.mjs';
import {updateRoute} from '../public/route-planner.mjs';
import {toiletPose,toiletAdjustment} from '../public/toilet-contact.mjs';
import {updateToiletManeuver,toiletManeuverMotion} from '../public/toilet-maneuver.mjs';
import {foodContact} from '../public/food-contact.mjs';
import {resourceIntent} from '../public/resource-contact.mjs';
import {windowObservationAdjustment} from '../public/window-observation.mjs';
import {beijingHour} from '../public/beijing-time.mjs';
import {createHygiene} from '../public/body-needs.mjs';
import {supportedFeet} from '../public/collision-world.mjs';
import { createSurfaceLife } from '../public/surface-life.mjs';
import { applyContactFriction } from '../public/environment-spec.mjs';
import { createRegions } from '../public/region-life.mjs';
import { createLiving, createPhysiology, validateLiving, updateLiving, daylightState, finishGame, BEHAVIOR_LABELS, GAME_ADAPTERS } from './living-world.mjs';
import { LifeSimulation, ValidationError } from './simulation.mjs';
import { FunctionalController as NeuralController, migrateNeural,NEURAL_FRAME_SECONDS } from './functional-controller.mjs';
import {validateSynapticMemory,validateSynapticMemoryMode} from '../public/synaptic-memory-schema.mjs';
import { createArcade } from '../public/arcade.mjs';
import { VERSION, ZONES } from '../public/world-spec.mjs';
import { BODY_RADIUS, resolveContacts, resolveBodyContacts, moveBody, SIGNAL_SOURCES, clamp } from '../public/environment-spec.mjs';

const STEP = .02;
const COOLDOWNS = { feed: 15, mist: 20, chime: 12 };
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const finite = v => typeof v === 'number' && Number.isFinite(v);
const stableFeet=(actor,support)=>Boolean(support)&&actor.supportFeet>=3;
const vector = (v, min, max) => Array.isArray(v) && v.length === 3 && v.every((n, i) => finite(n) && n >= min[i] && n <= max[i]);

function legacyZoneMaps(saved) {
  if (!saved || ![1, 2].includes(saved.schemaVersion)) return saved;
  const copy = structuredClone(saved);
  for (const key of ['perch', 'nook', 'toilet']) {
    if (copy.stats?.zoneVisits && typeof copy.stats.zoneVisits === 'object') copy.stats.zoneVisits[key] ??= 0;
    if (copy.lastVisited && typeof copy.lastVisited === 'object') copy.lastVisited[key] ??= 0;
  }
  return copy;
}

function validateBodySave(saved) {
  if (![VERSION,'8.4.0','8.3.0','8.2.0','8.1.2','8.1.1','8.1.0c','8.1.0b','8.1.0a','8.1.0','8.0.2','8.0.1','8.0.0','7.5.0','7.4.0','7.3.2','7.3.1','7.3.0','7.2.0','7.1.0','7.0.0','6.0.1','6.0.0','5.18.0','5.17.2','5.17.1','5.17.0','5.16.1','5.15.0','5.16.0','5.14.3','5.14.2','5.14.1','5.14.0','5.13.0','5.12.2','5.12.1','5.12.0','5.11.0','5.10.1','5.10.0','5.8.1', '5.9.0','5.8.0','5.7.0','5.6.1','5.6.0','5.5.1','5.5.0','5.4.0', '5.3.3', '5.3.2', '5.3.1', '5.3.0', '5.2.1', '5.2.0', '5.1.1', '5.1.0', '5.0.0', '4.5.0', '4.4.0', '4.3.0', '4.2.0', '4.1.0', '4.0.0', '3.0.0', '2.0.0'].includes(saved.version) || !finite(saved.neuralAccumulator) || saved.neuralAccumulator < 0 || saved.neuralAccumulator >= NEURAL_FRAME_SECONDS + .001
    || !saved.actor || !vector(saved.actor.position, [-5.72, .04, -4.12], [5.72, 4.62, 4.2])
    || !vector(saved.actor.velocity, [-3, -3, -3], [3, 3, 3])
    || !['heading', 'pitch', 'bank'].every(k => finite(saved.actor[k]))
    || typeof saved.actor.contact !== 'boolean' || !['travel', 'activity'].includes(saved.actor.mode)
    || !['rest', 'eat', 'observe', 'reflect', 'explore', 'visit'].includes(saved.actor.action)
    || !ZONES.some(z => z.id === saved.actor.zoneId)
    || !saved.activity || typeof saved.activity.title !== 'string' || typeof saved.activity.reason !== 'string') throw new ValidationError('身体存档无效，原始文件保留。');
  // Reuse the mature validation of needs, history, cooldowns, clocks and supplies.
  const fresh = new LifeSimulation().serialize();
  const proxy = { ...saved, version: VERSION, schemaVersion: 2, actor: fresh.actor, activity: fresh.activity };
  delete proxy.neural; delete proxy.neuralAccumulator; delete proxy.living; delete proxy.companion;
  delete proxy.synapticMemory;delete proxy.synapticMemoryMode;delete proxy.synapticForaging;
  for (const z of ZONES) { proxy.stats.zoneVisits[z.id] ??= 0; proxy.lastVisited[z.id] ??= 0; }
  new LifeSimulation(proxy);
  return structuredClone(saved);
}

export class EmbodiedLife extends LifeSimulation {
  constructor(saved = null, { controller, seed = 0x4d495252, learningMode } = {}) {
    super([3, 4, 5].includes(saved?.schemaVersion) ? null : legacyZoneMaps(saved), { seed });
    if ([3, 4, 5].includes(saved?.schemaVersion)) this.state = validateBodySave(structuredClone(saved));
    else {
      const actor = this.state.actor;
      Object.assign(actor, { route: [], routeIndex: 0, targetZoneId: null, contact: false,
        action: 'explore', mode: 'travel', velocity: [0, 0, 0], flightPhase: 'hover' });
      resolveContacts(actor.position, actor.velocity);
      this.state.schemaVersion = 3; this.state.version = VERSION;
      this.state.neuralAccumulator = 0;
      this.state.activity = { title: '正在感受房间', reason: '气味、光线与身体感受正在进入神经网络。', elapsed: 0, duration: 0 };
    }
    if (saved && saved.version !== VERSION && this.state.living && !Object.hasOwn(this.state.living,'physiology')) this.state.living.physiology=createPhysiology();
    if (saved && saved.version !== VERSION && this.state.living && !Object.hasOwn(this.state.living,'regions')) this.state.living.regions=createRegions(this.state.living.familiar);
    if(saved&&saved.version!==VERSION&&this.state.living&&!Object.hasOwn(this.state.living,'surface'))this.state.living.surface=createSurfaceLife();
    if(saved&&saved.version!==VERSION&&this.state.living){
      this.state.living.sleep??=createSleep();
      this.state.living.physiology.waste??=.32;this.state.living.hygiene??=createHygiene();
      for(const z of ZONES){this.state.living.regions[z.id]??=createRegions()[z.id];this.state.living.surface.stats[z.id]??={walked:0,actions:{}};}
      this.state.living.regions.nook.need=0;
    }
    if ([4,5].includes(saved?.schemaVersion)) validateLiving(this.state.living);
    this.state.living ??= createLiving(this.state.simSeconds);
    this.state.living.escape??=createEscape();validateEscape(this.state.living.escape);
    this.state.living.navigation??=createNavigation();validateNavigation(this.state.living.navigation);
    // Local motor programs are rebuilt from live contact, never replayed from
    // an old pose or a stale saved waypoint.
    this.state.living.toiletManeuver=null;
    validateBehaviorFocus(this.state.living.focus);
    this.state.living.focus??=createBehaviorFocus(this.state.simSeconds);
    if(saved?.schemaVersion!==5&&this.state.living.workstation.gameId==='light-chase') {
      Object.assign(this.state.living.workstation,{gameId:'racer',arcade:createArcade('racer'),phase:'idle',attention:0});
    }
    if(this.state.companion)validateCompanion(this.state.companion);
    const brainSave=saved?.schemaVersion===5?this.state.neural:migrateNeural(this.state.neural);
    this.state.version = VERSION; this.state.schemaVersion = 5;
    for (const z of ZONES) { this.state.stats.zoneVisits[z.id] ??= 0; this.state.lastVisited[z.id] ??= 0; }
    if(Object.hasOwn(this.state,'synapticMemory'))validateSynapticMemory(this.state.synapticMemory);
    const savedMode=Object.hasOwn(this.state,'synapticMemory')
      ?validateSynapticMemoryMode(this.state.synapticMemoryMode??'legacy-food')
      :brainSave&&(Object.hasOwn(brainSave,'synapticMemory')||Object.hasOwn(brainSave,'synapticMemoryMode'))
        ?validateSynapticMemoryMode(brainSave.synapticMemoryMode??'legacy-food')
        :Object.hasOwn(this.state,'synapticMemoryMode')?validateSynapticMemoryMode(this.state.synapticMemoryMode):null;
    const mode=validateSynapticMemoryMode(learningMode??savedMode??'neutral');
    if(savedMode&&savedMode!==mode)throw Error('突触记忆模式不一致，不能重新解释旧权重。');
    this.neural = controller ?? new NeuralController({ saved: brainSave, seed, learningMode:mode });
    if(this.neural.learning){
      if(Object.hasOwn(this.state,'synapticMemory'))this.neural.learning.restoreWeights(this.state.synapticMemory);
      this.state.synapticMemory=this.neural.learning.serializeWeights();
      this.state.synapticMemoryMode=validateSynapticMemoryMode(this.neural.learningMode??mode);
      this.state.synapticForaging=this.state.synapticMemoryMode==='legacy-food';
    }
    delete this.state.neural;
  }

  setPaused(paused) {
    const result = super.setPaused(paused);
    this.neural.paused = paused;
    return result;
  }

  tick(seconds) {
    if (!finite(seconds) || seconds < 0 || seconds > 3600) throw new ValidationError('时间增量无效');
    const s = this.state;
    s.realSeconds += seconds;
    if (s.paused) { this.neural.paused = true; return; }
    s.accumulator += seconds * s.speed;
    while (s.accumulator + 1e-9 >= STEP) { s.accumulator = Math.max(0, s.accumulator - STEP); this.step(STEP); }
  }

  step(dt) {return withFoodStock(this.state,()=>this.stepBody(dt));}

  stepBody(dt) {
    const s = this.state, a = s.actor, n = s.needs;
    applyGrowthSize(s);
    const body=bodyMetrics(a);
    s.simSeconds += dt;
    updateCare(s,dt);
    s.neuralAccumulator += dt;
    const reviewNavigation=s.simSeconds-s.living.focus.lastUpdatedAt>=NEURAL_FRAME_SECONDS-1e-9;
    if(reviewNavigation){
      updateBehaviorFocus(s,this.neural.sensory?.signals,NEURAL_FRAME_SECONDS);
    }
    updateToiletManeuver(s,dt);
    if(reviewNavigation)updateNavigation(s,this.neural.sensory?.signals,NEURAL_FRAME_SECONDS);
    const feedbackInterval=motorFeedbackInterval(s);
    let neuralFrameStarted=false;
    if(!this.neural.pending&&s.neuralAccumulator>=feedbackInterval-1e-9){
      s.neuralAccumulator=Math.max(0,s.neuralAccumulator-feedbackInterval)%feedbackInterval;
      const route=s.living.navigation.route;
      if(route?.status==='ready'&&!stationaryActivity(s))s.living.navigation.route=updateRoute(a,route.targetId,route.goal,route,s.simSeconds);
      neuralFrameStarted=true;
      if(!this.neural.advanceSlice)this.neural.tick(s,feedbackInterval);
    }
    // Compute the same 400 neural steps in five physics slices. Only a complete
    // readout changes motors; pending spikes and RNG state survive saves.
    if(this.neural.advanceSlice&&(neuralFrameStarted||this.neural.pending))this.neural.advanceSlice(s,80,feedbackInterval);
    const motor = this.neural.error ? { local: [0, 0, 0], drive: 0 } : this.neural.motor;
    // At the desk the neural effector context is the game cursor. The perched
    // physical body retains gravity/contact but receives no cursor thrust.
    a.groomingDrive=this.neural.behavior?.grooming??0;
    let hold = stationaryActivity(s);
    const escapeEvent=updateEscape(s,motor,hold,dt);
    if(escapeEvent==='burst'){
      const nav=s.living.navigation;if(nav.targetId)nav.failedUntil[nav.targetId]=s.simSeconds+20;
      nav.targetId=null;nav.approach=null;nav.route=null;
      this.record('持续受困，安心度耗尽，开始短暂加速脱困。');
    }else if(escapeEvent==='escaped')this.record('已离开受困位置，逐渐恢复安心度。');
    const escapeForce=this.neural.error?null:escapeAcceleration(s,dt);
    if(escapeForce){hold=null;a.contact=false;}
    const settlingGrace=!escapeForce&&!a.contact&&s.living.commitment&&s.simSeconds-s.living.commitment.lastProgressAt<.35;
    const bodyMotor = hold||settlingGrace ? { local: [0, 0, 0], drive: 0 } : motor;
    const [side, up, forward] = bodyMotor.local;
    const motorHeading=Number.isFinite(bodyMotor.referenceHeading)?bodyMotor.referenceHeading:a.heading;
    const power = (1-(s.living.care?.weakness??0)*.2) * (.45 + n.energy / 100 * .55) * (1 - s.living.physiology.thirst * .18) * (1 - s.living.wetness * .28);
    const acceleration = [(side * Math.cos(motorHeading) + forward * Math.sin(motorHeading)) * 3.8 * power,
      up * 3.8 * power + 2 * Math.min(1.15, bodyMotor.drive) - 2,
      (-side * Math.sin(motorHeading) + forward * Math.cos(motorHeading)) * 3.8 * power];
    const surface=s.living.surface;
    const launchIntent=this.neural.sensory?.context?.takeoffIntent===true;
    surface.launch=a.contact&&launchIntent&&up>.12&&bodyMotor.drive>.4?surface.launch+dt:0;
    if(a.contact&&surface.launch<.22&&!escapeForce){
      // Grounded effector: feet carry weight instead of converting baseline
      // motor firing directly into lift. Horizontal movement is still neural.
      acceleration[1]=Math.min(0,acceleration[1]);
      acceleration[0]*=.8;acceleration[2]*=.8;
    }
    if(escapeForce){for(let i=0;i<3;i++)acceleration[i]=escapeForce[i];}
    const previous = [...a.position], oldHeading = a.heading;
    // A wedged fly can turn before translating, including just above support.
    const avoidingObstacle=!escapeForce&&!hold&&surface.blocked>1&&this.neural.sensory?.context?.obstacle?.blocked;
    if(avoidingObstacle){
      a.heading+=side*(forward<0?-1:1)*2*dt;
      a.heading=Math.atan2(Math.sin(a.heading),Math.cos(a.heading));
    }
    const drag = a.contact ? 7 : 1.6;
    const brake=feedbackInterval===1&&!hold&&!escapeForce?navigationBrake(a,s.living.navigation.route):{thrust:1,drag:0};
    acceleration[0]*=brake.thrust;acceleration[2]*=brake.thrust;
    for (let i = 0; i < 3; i++) {
      a.velocity[i] = clamp((a.velocity[i] + acceleration[i] * dt) * Math.exp(-(drag+(i===1?0:brake.drag)) * dt), -2.5, 2.5);

    }
    const toiletMotion=hold==='toilet'?toiletManeuverMotion(s):null;
    if(hold){a.velocity[0]=0;a.velocity[2]=0;
      if(hold==='observe')a.velocity[2]=windowObservationAdjustment(a)?.velocity??0;
      if(hold==='toilet'){
        const adjustment=toiletMotion??toiletAdjustment(a);if(adjustment){
          const delta=Math.atan2(Math.sin(adjustment.heading-a.heading),Math.cos(adjustment.heading-a.heading));a.heading+=clamp(delta,-2*dt,2*dt);
          if(toiletMotion){for(let axis=0;axis<3;axis++)a.velocity[axis]=toiletMotion.velocity[axis];}
          else if(adjustment.position){for(const axis of [0,2])a.velocity[axis]=clamp((adjustment.position[axis]-a.position[axis])*2,-.07*body.scale,.07*body.scale);}
        }
      }
      if(hold==='screen'||hold==='observe'||hold==='feed'||hold==='drink'){
        const food=hold==='feed'||hold==='drink'?resourceIntent(s):null;
        const target=food?[food.point[0],food.point[2]]:hold==='screen'?[-1.2,-3.8]:[a.position[0],-5];
        const angle=Math.hypot(target[0]-a.position[0],target[1]-a.position[2])>.005*body.scale?Math.atan2(target[0]-a.position[0],target[1]-a.position[2]):a.heading;
        const facingDelta=Math.atan2(Math.sin(angle-a.heading),Math.cos(angle-a.heading));
        if(Math.abs(facingDelta)>.01)a.heading+=clamp(facingDelta,-2*dt,2*dt);
      }
    }
    // Explicit supported foot placement already specifies its safe walking speed.
    // Static friction must not erase the final sub-millimetre rim adjustment.
    const placingFeet=hold==='toilet'&&(toiletMotion?toiletMotion.moving:Boolean(toiletAdjustment(a)?.position));
    applyContactFriction(a.velocity,acceleration,dt,a.contact&&!placingFeet,a);
    let support = escapeForce?moveEscapeBody(a.position,a.velocity,dt,a):moveBody(a.position, a.velocity, dt, a.heading,undefined,undefined,a);
    a.supportFeet=support?supportedFeet(a.position,a.heading,a):0;
    a.contact = Boolean(support) && a.velocity[1] < .08 && stableFeet(a,support);
    const planarSpeed = Math.hypot(a.velocity[0], a.velocity[2]);
    if (planarSpeed > .06 && !avoidingObstacle && !hold) {
      const direction = Math.atan2(a.velocity[0], a.velocity[2]);
      const delta = Math.atan2(Math.sin(direction - a.heading), Math.cos(direction - a.heading));
      a.heading += clamp(delta*(1-Math.exp(-dt/.45)), -1.8 * dt, 1.8 * dt);
      a.heading = Math.atan2(Math.sin(a.heading), Math.cos(a.heading));
    }
    support = escapeForce?null:resolveBodyContacts(a.position,a.velocity,a.heading,undefined,undefined,a) ?? support;
    a.supportFeet=support?supportedFeet(a.position,a.heading,a):0;
    a.contact = Boolean(support) && a.velocity[1] < .08 && stableFeet(a,support);
    // Suppress sub-millimetre contact-solver drift once the supported stance is settled.
    if(hold && !(hold==='observe'&&!windowObservationAdjustment(a)?.settled) && !placingFeet && a.contact && Math.abs(a.heading-oldHeading)<1e-6 && Math.hypot(a.position[0]-previous[0],a.position[2]-previous[2])<.002*body.scale && supportedFeet(previous,a.heading,a)===6){
      a.position[0]=previous[0];a.position[2]=previous[2];a.velocity[0]=0;a.velocity[2]=0;
    }
    const turn = Math.atan2(Math.sin(a.heading - oldHeading), Math.cos(a.heading - oldHeading));
    a.bank += (clamp(-turn / dt * .13, -.6, .6) - a.bank) * (1 - Math.exp(-dt * 8));
    a.pitch += (clamp(Math.atan2(a.velocity[1], Math.max(.3, planarSpeed)) * .4, -.5, .5) - a.pitch) * (1 - Math.exp(-dt * 8));
    const nearest = ZONES.reduce((best, z) => distance(a.position, z.position) < distance(a.position, best.position) ? z : best);
    const zone = support?.zone ?? nearest.id;
    if (zone !== a.zoneId) { s.stats.zoneVisits[zone]++; s.lastVisited[zone] = s.simSeconds; }
    a.zoneId = zone; a.targetZoneId = null;
    const edibleContact=foodContact(a);
    const feedingContact=hold==='feed'&&planarSpeed<.06&&n.satiety<99.5&&edibleContact&&s.home.food>0;
    // A neural spike initiates a short motor bout, rather than toggling chewing
    // and the entire feeding pose on every 100 ms readout. Contact is still required.
    const feedingSignal=this.neural.behavior?.feeding??0;
    a.feedingActivation=feedingContact?(feedingSignal>.04||committedTo(s,'eat')||focusedActivity(s)==='eat'&&feedingSignal>0)?.35:Math.max(0,(Number.isFinite(a.feedingActivation)?a.feedingActivation:0)-dt):0;
    const feeding = feedingContact&&a.feedingActivation>0;
    a.feedingTarget=feeding?[...edibleContact.point]:null;
    a.consumingResource=feeding?{id:edibleContact.id,label:edibleContact.label,kind:'food'}:null;
    const action = feeding ? 'eat' : a.contact ? (hold === 'rest' ? 'rest' : zone === 'work' ? 'reflect' : 'observe') : 'explore';
    a.mode = a.contact ? 'activity' : 'travel';
    a.flightPhase = a.contact ? 'perched' : Math.abs(turn / dt) > 1.4 ? 'turn' : planarSpeed < .18 ? 'hover' : a.velocity[1] > .3 ? 'takeoff' : a.velocity[1] < -.3 ? 'landing' : 'dart';
    a.neuralDrive = motor.drive;
    if (action !== a.action) {
      if (s.activity.elapsed > 2) s.stats.activitiesCompleted++;
      s.activity.elapsed = 0;
    }
    a.action = action;
    s.activity.elapsed += dt;
    s.activity.title = ({ eat: `正在吃${edibleContact?.label??'食物'}`, rest: '正在歇一会儿', explore: '正在自由飞行', reflect: '正在看工作台', observe: '正在感受身边的光和空气' })[action];
    s.activity.reason = this.neural.error ? '神经信号暂不可用，身体只保留惯性与接触反应。'
      : feeding ? '真正落到食物旁，才会慢慢吃饱。' : a.contact ? '落脚、休息、再起飞，由此刻的身体感受影响。' : '没有预定的下一站。此刻的感受正在改变他的飞行。';
    // Portion depletion reflects the smaller body; keep nutritional recovery
    // readable without making a millimetre-size pet remove a whole pizza slice.
    const consumptionRate=.25*(s.companion?.identity.adoptedAt ? .1+.15*(a.bodyScale/.0483018) : 1);
    const consumedAmount=feeding?consumeFood(s,edibleContact.id,dt*consumptionRate):0;
    const feedingSeconds=consumedAmount/consumptionRate;
    if(this.neural.learning){
      if(consumedAmount>0)this.neural.learning.consume(edibleContact.id,consumedAmount);
      this.neural.learning.advance(s,dt);
      s.synapticMemory=this.neural.learning.serializeWeights();
    }
    n.satiety = clamp(n.satiety + feedingSeconds*.65-(dt-feedingSeconds)*.05, 0, 100);
    if (feeding) { s.stats.ateSeconds += feedingSeconds; }
    if (hold === 'rest') s.stats.restedSeconds += dt;
    s.stats.distanceTravelled += distance(previous, a.position);
    if (!s.companion && (s.home.food < 20 || s.home.water < 20)) { s.home.food = Math.max(86, s.home.food); s.home.water = Math.max(92, s.home.water); s.stats.refills++; this.record('补给装置补充了果实和清水。', 'system'); }
    const oldPhase = s.living.workstation.phase;
    const priorVisits=s.living.regions[a.zoneId].visits,priorBowel=s.living.hygiene.bowelMovements;
    updateLiving(s, { ...motor, behavior:this.neural.behavior, obstacle:this.neural.sensory?.context?.obstacle }, dt);
    if(s.living.hygiene.bowelMovements>priorBowel)this.record('镜隙走进迷你厕所，解决了身体的小需求。');
    if(s.living.regions[a.zoneId].visits>priorVisits&&a.zoneId!=='flight')this.record(`在${ZONES.find(z=>z.id===a.zoneId).name}停了下来。`);
    if (oldPhase !== s.living.workstation.phase && s.living.workstation.phase === 'playing') this.record(`镜隙停在屏幕前，开始玩「${GAME_ADAPTERS[s.living.workstation.gameId].title}」。`);
    if (oldPhase === 'playing' && s.living.workstation.phase !== 'playing') this.record('镜隙暂时放下屏幕，回到屋里的生活。');
    s.activity.title = BEHAVIOR_LABELS[s.living.behavior] ?? s.activity.title;
    if(a.consumingResource)s.activity.title=`正在${a.consumingResource.kind==='food'?'吃':'喝'}${a.consumingResource.label}`;
    if(s.living.behavior==='rest'&&a.zoneId!=='rest')s.activity.title='精力不足，正在原地歇息';
    if(s.living.behavior==='rest')s.activity.reason='收起翅膀趴下来，安静睡一会儿，慢慢恢复精力。';
    if(['walk','inspect','sample','orient'].includes(s.living.behavior)&&a.contactCue)s.activity.title=`${s.living.behavior==='walk'?'沿着':'正在探查'}${a.contactCue}${s.living.behavior==='walk'?'走动':''}`;
    if(s.living.behavior==='perch')s.activity.title=`停在${ZONES.find(z=>z.id===a.zoneId).name}感受周围`;
    if(hold==='feed'&&!feeding){s.activity.title='正在对准食物';s.activity.reason='朝向食物并接触可食表面后才开始进食。';}
    if(hold==='drink'&&!a.drinkingTarget)s.activity.title='正在对准水面';
    if(!hold && s.living.surface.blocked>1 && this.neural.sensory?.context?.obstacle?.blocked){s.activity.title='正在调整姿势绕开障碍';s.activity.reason='前方有阻挡，尝试转身寻找空隙。';}
    if(s.living.behavior==='play')s.activity.title=`正在玩「${GAME_ADAPTERS[s.living.workstation.gameId].title}」`;
    if(toiletMotion&&s.living.behavior!=='toilet'){
      s.activity.title=({land:'正在落到马桶外沿',walk:'正在沿座圈走向内沿',turn:'正在转身对准便池',leave:'排泄完成，正在离开内沿'})[toiletMotion.phase]??s.activity.title;
      s.activity.reason='沿真实座圈落脚、内移并转身；站稳且腹部朝向盆内后才排泄。';
    }
    if(s.living.workstation.phase==='attention')s.activity.title=`正在选择「${GAME_ADAPTERS[s.living.workstation.gameId].title}」`;
    const focus=focusedActivity(s),goalNames={eat:'食物',drink:'水源',rest:'休息处',clean:'清洁位置',toilet:'厕所',play:'游戏屏幕',observe:'窗边'};
    if(!hold&&goalNames[focus]&&['flight','walk','perch','inspect','orient','sample'].includes(s.living.behavior)){
      s.activity.title=`正在${s.living.navigation.targetId?'前往':'寻找'}${goalNames[focus]}`;
      s.activity.reason='先完成当前目标；其他感受持续收集，完成后再决定下一步。';
    }
    if(s.living.escape.phase==='burst'){s.activity.title='正在穿过障碍脱困';s.activity.reason='安心度耗尽，短暂穿过障碍，到达安全空隙后恢复碰撞。';}
    else if(s.living.escape.phase==='trapped'){s.activity.title='受困中，正在尝试离开';s.activity.reason='持续想移动却没有离开小范围，安心度正在下降。';}
    else if(s.living.escape.phase==='recover'){s.activity.reason='已经离开受困位置，安心度正在恢复。';}
    if (s.reaction && s.reaction.until <= s.simSeconds) s.reaction = null;
    observeCompanion(s,dt);
    stepGrowth(s,dt,{nutrition:feedingSeconds,rest:s.living.sleep.active&&a.contact?dt:0});
  }

  interact(type) {
    if (!Object.hasOwn(COOLDOWNS, type)) throw new ValidationError('互动类型无效');
    const s = this.state, remaining = s.cooldowns[type] - s.realSeconds;
    if (remaining > 1e-9) throw new ValidationError(`请等 ${Math.ceil(remaining)} 秒再互动。`, 429);
    s.cooldowns[type] = s.realSeconds + COOLDOWNS[type]; s.stats.interactions++;
    s.reaction = { type, until: s.simSeconds + 8 };
    if (type === 'feed') replenish(s,'food');
    const life = s.living;
    if (type === 'chime') life.alert = clamp(life.alert + .7 * interactionSensitivity(s,type) * (1 - life.exposure.chime * .8) * Math.exp(-distance(s.actor.position, [4.58, 1.45, 3.48]) / 8), 0, 1);
    if (type === 'mist') life.wetness = clamp(life.wetness + .6 * Math.exp(-distance(s.actor.position, [3.4, .6, 1.0]) / 2), 0, 1);
    this.neural.stimulate(type);
    life.exposure[type] = clamp(life.exposure[type] + .22, 0, 1);
    rememberInteraction(s,type);
    this.record(({ feed: '补给台多了新鲜果实，果香渐渐散开。', mist: '生态林地的叶片间升起细雾。', chime: '房间传来一阵轻轻的振动。' })[type], 'interaction');
    return this.snapshot();
  }

  environmentCommand(type, value) {
    const l = this.state.living;
    if(type==='care'){this.record(careAction(this.state,value),'interaction');rememberInteraction(this.state,value);return this.snapshot();}
    if(type==='weather'){receiveWeather(this.state,value);return this.snapshot();}
    if(type==='water'){replenish(this.state,'water');rememberInteraction(this.state,'water');this.record('添上了清水，水源重新充足。','interaction');return this.snapshot();}
    if (type === 'screen') {
      if (typeof value !== 'boolean') throw new ValidationError('屏幕开关无效');
      l.workstation.enabled = value; if (!value) finishGame(l);
    } else if (type === 'game') {
      if(!Object.hasOwn(GAME_ADAPTERS,value))throw new ValidationError('游戏卡带无效');
      if(l.workstation.gameId!==value){
        finishGame(l);Object.assign(l.workstation,{gameId:value,arcade:value==='light-chase'?null:createArcade(value),elapsed:0,cursor:[0,0],target:[0,0],feedback:0,engaged:0,cooldown:0});
      }
    } else if (type === 'leave-game') finishGame(l);
    else if (type === 'disturbance') {
      if (!['breeze', 'shadow'].includes(value)) throw new ValidationError('环境刺激无效');
      if (value === 'breeze') l.gust = 1;
      else { l.shadow = 1; l.alert = Math.max(l.alert, .65); }
    }
    else if (type === 'daytime') {
      if (!['local', 'cycle', 'dawn', 'day', 'dusk', 'night'].includes(value)) throw new ValidationError('时间模式无效');
      const now = new Date();
      l.clock = { mode: value === 'local' ? 'local' : value === 'cycle' ? 'cycle' : 'preview', anchor: this.state.simSeconds,
        hour: ({ dawn: 6, day: 12, dusk: 18, night: 0 })[value] ?? (value === 'local' ? beijingHour(now) : daylightState(this.state).hour) };
    } else throw new ValidationError('环境操作无效');
    return this.snapshot();
  }

  snapshot() {
    applyGrowthSize(this.state);
    const base = super.snapshot();
    if (!this.state.living) return base;
    return { ...base, clock: { ...base.clock, ...daylightState(this.state) }, living: structuredClone(this.state.living), ...(this.state.companion?{companion:companionSummary(this.state.companion),careObservations:interactionSummary(this.state)}:{}) };
  }

  serialize() {
    if (!this.state.actor.position.every(finite) || !this.state.actor.velocity.every(finite) || !Object.values(this.state.needs).every(finite)) throw new ValidationError('拒绝保存非有限身体状态，保留上次有效存档。');
    validateLiving(this.state.living);
    validateBehaviorFocus(this.state.living.focus);validateNavigation(this.state.living.navigation);validateEscape(this.state.living.escape);
    const neural=this.neural.serialize();
    if(this.neural.learning){
      this.state.synapticMemory=this.neural.learning.serializeWeights();
      this.state.synapticMemoryMode=this.neural.learningMode??this.state.synapticMemoryMode;
      // Body/browser saves own the weights; do not create a stale second copy.
      if(neural)delete neural.synapticMemory;
    }
    return { ...structuredClone(this.state), neural };
  }
}
