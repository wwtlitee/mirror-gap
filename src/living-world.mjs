import {idlePose} from '../public/idle-life.mjs';
import {chooseLearnedGame} from '../public/companion-learning.mjs';
import {updateResourceSession,validateResourceSession,activeResourceSession} from '../public/resource-session.mjs';
import {committedTo,updateCommitment,validateCommitment} from '../public/activity-commitment.mjs';
import {activityPermitted,focusedActivity} from '../public/behavior-focus.mjs';
import {validateCare,updateMaintenance} from '../public/pet-care.mjs';
import {activityAvailable,updateActivityCooldowns,validateActivityCooldowns,validateActivityFull} from '../public/activity-cooldowns.mjs';
import {groomingEligible} from '../public/behavior-policy.mjs';
import {sleepEligible,screenEligible,stationaryActivity,createSleep} from '../public/behavior-policy.mjs';
import {toiletAligned} from '../public/toilet-contact.mjs';
import {toiletManeuverReady,toiletManeuverActive} from '../public/toilet-maneuver.mjs';
import {beijingHour,beijingDate} from '../public/beijing-time.mjs';
import {createHygiene,updateBodyNeeds} from '../public/body-needs.mjs';
import { createSurfaceLife, validateSurfaceLife, contactCue, updateSurfaceLife } from '../public/surface-life.mjs';
import { createRegions, validateRegions, updateRegions } from '../public/region-life.mjs';
import { clamp, waterContact } from '../public/environment-spec.mjs';
import {bodyWaterContact,resourceContact} from '../public/resource-contact.mjs';
import { CARTRIDGES, createArcade, validateArcade, arcadeObservation, stepArcade } from '../public/arcade.mjs';

// The adapter is deliberately small: observations become sensory inputs, and
// only decoded neural motor outputs may move the game cursor. No auto-player.
export const GAME_ADAPTERS = Object.freeze({
  ...Object.fromEntries(['racer','breakout','invaders'].map(id=>[id,{
    title:CARTRIDGES[id],
    observe(game){return arcadeObservation(game.arcade);},
    step(game,motor,dt){
      game.arcade??=createArcade(id);
      stepArcade(game.arcade,motor,dt);
      game.cursor=[(game.arcade.player-80)/80,0];
      game.target=[clamp(game.cursor[0]+arcadeObservation(game.arcade)[0],-1,1),0];
      game.feedback=game.arcade.phase==='running'?1:0;
      game.engaged+=game.feedback*dt;
    },
  }])),
  'light-chase': {
    title: '追一束光',
    observe(game) { return [game.target[0] - game.cursor[0], game.target[1] - game.cursor[1]]; },
    step(game, motor, dt) {
      game.cursor[0] = clamp(game.cursor[0] + motor.local[0] * dt * .45, -1, 1);
      game.cursor[1] = clamp(game.cursor[1] + motor.local[1] * dt * .45, -1, 1);
      game.target = [Math.sin(game.elapsed * .29) * .72, Math.cos(game.elapsed * .21) * .65];
      game.feedback = Math.max(0, 1 - Math.hypot(...this.observe(game)) / .4);
      game.engaged += game.feedback * dt;
    },
  },
});

export const createPhysiology = () => ({ thirst: .28, sleepPressure: .18, dirt: .08, waste:.32 });

export function createLiving(simSeconds = 0, date = new Date()) {
  return {
    clock: { mode: 'local', anchor: simSeconds, hour: beijingHour(date) },
    exposure: { feed: 0, mist: 0, chime: 0 }, alert: 0, wetness: 0, gust: 0, shadow: 0,
    sleep:createSleep(), hygiene:createHygiene(), surface:createSurfaceLife(), regions: createRegions(), physiology: createPhysiology(), contactSeconds: 0, familiar: {}, behavior: 'flight',
    workstation: { enabled: true, phase: 'idle', attention: 0, cooldown: 0,
      gameId: 'racer', arcade:createArcade('racer'), elapsed: 0, cursor: [0, 0], target: [0, .65], feedback: 0, engaged: 0 },
  };
}

export function validateLiving(life) {
  if(life?.care)validateCare(life.care);
  validateRegions(life?.regions);
  validateActivityCooldowns(life?.activityCooldowns);validateActivityCooldowns(life?.activityRetryUntil);validateResourceSession(life?.resourceSession);validateCommitment(life?.commitment);validateActivityFull(life?.activityFull);
  validateSurfaceLife(life?.surface);
  const number = (v, max = 1e10) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const pair = v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1);
  const h=life?.hygiene;if(!h||!['toiletElapsed','bowelMovements','bathSeconds','groomSeconds','groomElapsed','groomCooldown'].every(k=>number(h[k]))||!(h.lastToiletAt===null||number(h.lastToiletAt))||!(h.lastDropPosition===null||Array.isArray(h.lastDropPosition)&&h.lastDropPosition.length===3&&h.lastDropPosition.every(Number.isFinite)))throw new Error('清洁与排泄存档无效');
  if(!life?.sleep || typeof life.sleep.active!=='boolean' || !number(life.sleep.elapsed) || !number(life.sleep.cooldown))throw new Error('睡眠存档无效');
  const w = life?.workstation, c = life?.clock;
  if (!life?.physiology || !['thirst','sleepPressure','dirt','waste'].every(k=>number(life.physiology[k],1))) throw new Error('身体状态存档无效，原始文件保留');
  if (!c || !['local', 'cycle', 'preview'].includes(c.mode) || !number(c.anchor) || !number(c.hour, 24)
    || !life.exposure || !['feed', 'mist', 'chime'].every(k => number(life.exposure[k], 1))
    || !number(life.gust, 1) || !number(life.shadow, 1) || !number(life.alert, 1) || !number(life.wetness, 1) || !number(life.contactSeconds)
    || !life.familiar || typeof life.familiar !== 'object' || Array.isArray(life.familiar)
    || !Object.values(life.familiar).every(v => number(v, 1))
    || !['idle','idle-groom','flight', 'startle', 'groom', 'drink', 'walk', 'rest', 'eat', 'watch', 'play', 'hide', 'perch', 'inspect', 'orient', 'sample', 'bathe', 'toilet', 'observe'].includes(life.behavior)
    || !w || typeof w.enabled !== 'boolean' || !Object.hasOwn(GAME_ADAPTERS, w.gameId)
    || !['idle', 'attention', 'playing', 'resting'].includes(w.phase)
    || !['attention', 'cooldown', 'elapsed', 'engaged'].every(k => number(w[k]))
    || !number(w.feedback, 1) || !pair(w.cursor) || !pair(w.target)) throw new Error('生活经历存档无效，原始文件保留');
  if(w.gameId!=='light-chase')validateArcade(w.arcade,w.gameId);
  return life;
}

export function daylightState(state, now = new Date()) {
  const c = state.living?.clock;
  const hour = c?.mode === 'local' ? beijingHour(now) : c ? ((c.hour + (state.simSeconds - c.anchor) / (c.mode === 'cycle' ? 60 : c.mode === 'preview' ? Infinity : 3600)) % 24 + 24) % 24 : (9 + state.simSeconds / 60) % 24;
  const daylight = clamp(Math.sin((hour - 6) / 12 * Math.PI) * 1.3, 0, 1);
  return { date:beijingDate(now), timezone:'Asia/Shanghai', hour, minute: Math.floor(hour % 1 * 60), daylight, night: 1 - daylight, mode: c?.mode ?? 'cycle' };
}

export function finishGame(life,completed=false) {
  Object.assign(life.workstation, { phase: 'resting', attention: 0, cooldown: completed?180:20 });
}

export function updateLiving(state, motor, dt) {
  const l = state.living, a = state.actor, n = state.needs, w = l.workstation;
  const focus=focusedActivity(state);
  l.sleep.cooldown=Math.max(0,l.sleep.cooldown-dt);
  l.gust *= Math.exp(-dt / 3); l.shadow *= Math.exp(-dt / 2);
  l.alert *= Math.exp(-dt / 7); l.wetness *= Math.exp(-dt / 22);
  for (const key of Object.keys(l.exposure)) l.exposure[key] *= Math.exp(-dt / 100);
  for (const key of Object.keys(l.familiar)) l.familiar[key] *= Math.exp(-dt / 180);
  l.familiar[a.zoneId] = clamp((l.familiar[a.zoneId] ?? 0) + dt / 70, 0, 1);
  l.contactSeconds = a.contact ? l.contactSeconds + dt : 0;
  const canWatch = screenEligible(state);
  w.cooldown = Math.max(0, w.cooldown - dt);
  if (w.phase === 'playing') {
    if(!a.contact&&activityPermitted(state,'play')&&committedTo(state,'play')&&state.simSeconds-l.commitment.lastProgressAt<.35){ /* Real contact may settle; no game progress while airborne. */ }
    else if (!w.enabled || !canWatch || w.elapsed > 90&&focus!=='play'&&!committedTo(state,'play') || n.curiosity <= .5) finishGame(l,n.curiosity<=.5);
    else {
      w.elapsed += dt; GAME_ADAPTERS[w.gameId].step(w, motor, dt);
      n.curiosity = clamp(n.curiosity - dt * .50, 0, 100);
      n.energy = clamp(n.energy - dt * .12, 0, 100);
    }
  } else if (w.enabled && canWatch && !w.cooldown && n.curiosity > (focus==='play'||committedTo(state,'play')?.5:25)) {
    if(w.phase!=='attention'){
      w.attention=0;
      const choices=['racer','breakout','invaders'].filter(id=>id!==w.gameId);
      const decision=Math.floor(Math.abs(motor.local?.[0]??0)*997+Math.abs(motor.local?.[2]??0)*389+(motor.drive??0)*97);
      w.gameId=chooseLearnedGame(state,choices,decision);w.arcade=createArcade(w.gameId);
    }
    w.phase = 'attention'; w.attention += dt;
    if (w.attention >= 2.5) Object.assign(w, { phase: 'playing', elapsed: 0, cursor: [0, 0], feedback: 0, engaged: 0,
      arcade:w.gameId==='light-chase'?null:createArcade(w.gameId) });
  } else { w.attention = 0; w.phase = w.cooldown ? 'resting' : 'idle'; }
  const p = l.physiology, water=state.home.water>0?resourceContact(a,'water'):null,atWater=bodyWaterContact(a)&&state.home.water>0;
  const drinking = activityPermitted(state,'drink') && activityAvailable(state,'drink') && Boolean(water) && a.action!=='eat' && l.alert<.3 && Math.hypot(a.velocity[0],a.velocity[2])<.06 && p.thirst > (l.behavior==='drink'||focus==='drink'||committedTo(state,'drink')||activeResourceSession(state,'water')?.005:.22);
  a.drinkingTarget=drinking?[...water.point]:null;
  if(drinking)a.consumingResource={id:water.id,label:water.label,kind:'water'};
  else if(a.action!=='eat')a.consumingResource=null;
  const still=Math.hypot(a.velocity[0],a.velocity[2])<.065;
  const rimWalking=toiletManeuverActive(state)&&['walk','leave'].includes(l.toiletManeuver.phase)&&Math.hypot(a.velocity[0],a.velocity[2])>.00001;
  const resting=sleepEligible(state)&&still;
  const bathing=activityPermitted(state,'clean')&&activityAvailable(state,'clean')&&!drinking&&l.alert<.3&&atWater&&still&&p.dirt>(l.behavior==='bathe'||focus==='clean'?.005:.35);
  const toileting=activityPermitted(state,'toilet')&&activityAvailable(state,'toilet')&&toiletManeuverReady(state)&&l.alert<.3&&still&&toiletAligned(a)&&p.waste>(l.hygiene.toiletElapsed>0||focus==='toilet'||committedTo(state,'toilet')?.005:.55);
  const nearby=contactCue(state);
  l.behavior = l.alert > .35 ? 'startle' : w.phase === 'playing' ? 'play' : w.phase === 'attention' ? 'watch'
    : !a.contact || l.contactSeconds < .16 ? 'flight' : a.action === 'eat' ? 'eat' : toileting ? 'toilet' : drinking ? 'drink' : bathing ? 'bathe'
      : resting ? 'rest' : stationaryActivity(state)==='observe' ? 'observe' : stationaryActivity(state)==='groom' && groomingEligible(state,motor.behavior?.grooming??0) ? 'groom' : rimWalking||Math.hypot(a.velocity[0], a.velocity[2]) > .025 ? 'walk'
        : idlePose(state) ? idlePose(state) : nearby ? (['wet','rest'].includes(nearby.effect)?'inspect':nearby.effect) : 'perch';
  if(resting){l.sleep.active=true;l.sleep.elapsed+=dt;}
  else if(l.sleep.active){l.sleep.active=false;l.sleep.elapsed=0;l.sleep.cooldown=30;}
  updateBodyNeeds(state,{atWater,drinking,resting,bathing,toileting,hour:daylightState(state).hour},dt);
  updateMaintenance(state,dt,{resting,drinking});
  a.behavior = l.behavior;
  updateSurfaceLife(state,motor,dt);
  updateRegions(state,dt);
  updateActivityCooldowns(state);
  updateResourceSession(state);updateCommitment(state);
}

export const BEHAVIOR_LABELS = { idle:'正在发呆，感受四周', 'idle-groom':'闲下来，搓搓头和触角', rest:'正在安静睡眠', observe:'正在望向窗外', flight: '正在自由飞行', startle: '刚感到一阵惊扰', groom: '正在用前足搓头、梳理触角', drink: '正在接触水面饮水',
  bathe:'正在浅水边清洁，再搓头理毛',toilet:'正在迷你厕所排泄', inspect:'正在用足和触角探查表面', sample:'正在探查附近的气味', orient:'正在转头感受光和气流', walk: '正在地面交替迈步探索', hide: '安静感受周围', perch: '停下来感受四周', watch: '正在关注屏幕里的光', play: '正在玩「追一束光」' };
