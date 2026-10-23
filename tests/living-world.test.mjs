import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbodiedLife } from '../src/embodied-life.mjs';
import { daylightState, updateLiving, GAME_ADAPTERS } from '../src/living-world.mjs';
import { senseEnvironment } from '../src/neural-controller.mjs';
import { SOLIDS } from '../public/environment-spec.mjs';

test('v2 checkpoint migrates without changing history, needs, position or neural state', () => {
  const previous = new EmbodiedLife(); previous.tick(.3);
  const old = previous.serialize(); old.version = '2.0.0'; old.schemaVersion = 3; delete old.living;
  delete old.stats.zoneVisits.nook; delete old.stats.zoneVisits.perch;
  delete old.lastVisited.nook; delete old.lastVisited.perch;
  const original = structuredClone(old), next = new EmbodiedLife(old);
  for (const key of ['history', 'needs', 'actor', 'simSeconds']) assert.deepEqual(next.state[key], old[key]);
  assert.deepEqual(next.neural.serialize(), old.neural);
  assert.deepEqual(old, original);
  assert.equal(next.state.schemaVersion, 5);
  assert.equal(next.state.stats.zoneVisits.nook, 0);
  assert.equal(SOLIDS.some(s => s.id === 'door'), false);
});

test('daylight changes sensory signals; preview freezes hour, cycle advances and pause freezes life', () => {
  const sim = new EmbodiedLife(), pulses = { feed:0,mist:0,chime:0 };
  sim.environmentCommand('daytime','day');
  const day = senseEnvironment(sim.state,pulses).signals.find(s=>s.id==='window').intensity;
  sim.environmentCommand('daytime','night');
  assert.ok(day > senseEnvironment(sim.state,pulses).signals.find(s=>s.id==='window').intensity);
  sim.tick(.2); assert.equal(daylightState(sim.state).hour,0);
  sim.environmentCommand('daytime','cycle');sim.tick(.1);assert.ok(daylightState(sim.state).hour>0);
  sim.setPaused(true);const before=sim.serialize().living;sim.tick(1);assert.deepEqual(sim.state.living,before);
  assert.throws(()=>sim.environmentCommand('daytime','invalid'));
  assert.throws(()=>sim.environmentCommand('screen','false'));
});

test('repeated bells habituate, quiet restores sensitivity, mist does not directly refill needs', () => {
  const sim = new EmbodiedLife(); sim.interact('chime'); const first=sim.state.living.alert;
  sim.state.realSeconds+=13;sim.state.living.alert=0;sim.interact('chime');assert.ok(sim.state.living.alert<first);
  const before=sim.state.living.exposure.chime;updateLiving(sim.state,{local:[0,0,0]},1);assert.ok(sim.state.living.exposure.chime<before);
  const needs=structuredClone(sim.state.needs);sim.interact('mist');assert.deepEqual(sim.state.needs,needs);
});

test('screen needs sustained contact; flyby cannot enter; hunger and switch off leave game', () => {
  const sim=new EmbodiedLife(),s=sim.state,motor={local:[.2,.1,0]};
  Object.assign(s.actor,{position:[-1.2,1.405,-3.15],zoneId:'work',contact:false});
  for(let i=0;i<40;i++)updateLiving(s,motor,.1);
  assert.equal(s.living.workstation.phase,'idle');
  s.actor.contact=true;for(let i=0;i<30;i++)updateLiving(s,motor,.1);
  assert.equal(s.living.workstation.phase,'playing');
  const inputs=senseEnvironment(s,{feed:0,mist:0,chime:0});assert.ok(inputs.signals.some(s=>s.id==='game-light'));
  s.needs.satiety=10;updateLiving(s,motor,.1);assert.equal(s.living.workstation.phase,'resting');
  s.living.workstation.phase='playing';sim.environmentCommand('screen',false);assert.equal(s.living.workstation.phase,'resting');
});

test('game cursor receives decoded neural output and cannot move with zero output', () => {
  const game=new EmbodiedLife().state.living.workstation,adapter=GAME_ADAPTERS['light-chase'];
  const initial=[...game.cursor];adapter.step(game,{local:[0,0,0]},1);assert.deepEqual(game.cursor,initial);
  adapter.step(game,{local:[1,-1,0]},1);assert.ok(game.cursor[0]>0&&game.cursor[1]<0);
});

test('each autonomous desk visit selects a cartridge before playing, without a user command',()=>{
 const s=new EmbodiedLife().state,motor={local:[.2,.1,.3],drive:.4};
 Object.assign(s.actor,{position:[-1.2,1.405,-3.15],zoneId:'work',contact:true});
 const w=s.living.workstation,previous=w.gameId;
 updateLiving(s,motor,.1);
 assert.equal(w.phase,'attention');assert.notEqual(w.gameId,previous);
 assert.ok(['racer','breakout','invaders'].includes(w.gameId));
 const chosen=w.gameId;for(let i=0;i<30;i++)updateLiving(s,motor,.1);
 assert.equal(w.phase,'playing');assert.equal(w.gameId,chosen);
 w.phase='idle';w.cooldown=0;s.living.contactSeconds=0;
 updateLiving(s,motor,.1);assert.equal(w.phase,'attention');assert.notEqual(w.gameId,chosen);
});

test('a real continuous brain can play while its physical body remains at the desk', () => {
  const sim = new EmbodiedLife();
  Object.assign(sim.state.actor, { position: [-1.2, 1.405, -3.15], velocity: [0,0,0], contact:true, zoneId:'work', action:'reflect', mode:'activity' });
  for(let i=0;i<70;i++)sim.tick(.1);
  assert.equal(sim.state.living.workstation.phase,'playing');
  assert.ok(Math.hypot(...sim.state.living.workstation.cursor)>.01);
  assert.equal(sim.state.actor.zoneId,'work');
  assert.ok(sim.neural.totalSpikes>0);
  const position=[...sim.state.actor.position];sim.environmentCommand('leave-game');
  assert.deepEqual(sim.state.actor.position,position);
  assert.equal(sim.state.living.workstation.phase,'resting');
});

test('gust and passing shadow reach sensation without changing physical pose', () => {
  const sim = new EmbodiedLife(), p = [...sim.state.actor.position];
  const original=senseEnvironment(sim.state,{feed:0,mist:0,chime:0});
  sim.environmentCommand('disturbance','breeze');
  assert.ok(senseEnvironment(sim.state,{feed:0,mist:0,chime:0}).signals.find(s=>s.id==='breeze').intensity>original.signals.find(s=>s.id==='breeze').intensity);
  sim.environmentCommand('disturbance','shadow');assert.ok(sim.state.living.alert>0);
  assert.deepEqual(sim.state.actor.position,p);
});

test('experience checkpoints reject corrupt fields and preserve continuation', () => {
  const sim=new EmbodiedLife();sim.tick(.5);sim.interact('chime');const saved=sim.serialize();
  const copy=new EmbodiedLife(saved);sim.tick(.5);copy.tick(.5);assert.deepEqual(sim.serialize(),copy.serialize());
  saved.living.workstation.cursor=[NaN,0];assert.throws(()=>new EmbodiedLife(saved),/存档无效/);
});
