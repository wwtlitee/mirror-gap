import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcade, stepArcade, arcadeObservation, validateArcade } from '../public/arcade.mjs';
import { EmbodiedLife } from '../src/embodied-life.mjs';
import { FunctionalController } from '../src/functional-controller.mjs';
const stopped={local:[0,0,0]}, right={local:[1,0,0]};
const tick=(sim,seconds)=>{for(let i=0;i<seconds*10;i++)sim.tick(.1);};
function desk(id){
  const sim=new EmbodiedLife();sim.environmentCommand('game',id);
  Object.assign(sim.state.actor,{position:[-1.2,1.405,-3.15],velocity:[0,0,0],contact:true,zoneId:'work',action:'reflect',mode:'activity'});
  return sim;
}

test('all cartridges require motor output to move; zero output is never an automatic player',()=>{
  for(const id of ['racer','breakout','invaders']){
    const g=createArcade(id);for(let i=0;i<20;i++)stepArcade(g,stopped,.1);
    assert.equal(g.player,80);stepArcade(g,right,.1);assert.ok(g.player>80);
    validateArcade(g,id);assert.throws(()=>stepArcade(g,right,Infinity));
  }
});
test('racing contrast, collision, score, game over and automatic next round',()=>{
  const g=createArcade();g.objects=[{x:76,y:80,vx:0,vy:25}];assert.ok(arcadeObservation(g)[0]>0);
  g.objects[0].y=99;stepArcade(g,stopped,.02);assert.equal(g.phase,'over');
  for(let i=0;i<80;i++)stepArcade(g,stopped,.02);
  assert.equal(g.round,2);assert.equal(g.phase,'running');
  g.objects=[{x:20,y:135,vx:0,vy:25}];stepArcade(g,stopped,.02);assert.equal(g.score,10);
});
test('breakout hits remove bricks, paddle bounce changes ball, missed ball restarts',()=>{
  const g=createArcade('breakout');g.ball={x:12,y:30,vx:0,vy:-32};stepArcade(g,stopped,.02);
  assert.equal(g.bricks[0],0);assert.equal(g.score,10);
  g.ball={x:80,y:99.9,vx:0,vy:32};stepArcade(g,stopped,.02);assert.ok(g.ball.vy<0);
  g.ball={x:15,y:122,vx:0,vy:32};stepArcade(g,stopped,.02);assert.equal(g.phase,'over');
});
test('space patrol automatic fire can hit enemies; reaching the bottom ends round',()=>{
  const g=createArcade('invaders');g.objects=[{x:80,y:50,vx:0,vy:9}];g.spawn=9;
  g.shots=[{x:80,y:51,vx:0,vy:-75}];stepArcade(g,stopped,.02);assert.equal(g.score,10);assert.equal(g.objects.length,0);
  g.objects=[{x:20,y:99,vx:0,vy:9}];stepArcade(g,stopped,.02);assert.equal(g.phase,'over');
});
test('brain outputs are identified, distinct from injected cells, and input changes reach movement',()=>{
  const controller=new FunctionalController();assert.equal(controller.error,null);
  const input=new Set(controller.graph.channels.flat());
  assert.ok(controller.graph.motorIndices.every(n=>!input.has(n)));
  assert.ok(controller.graph.motorIndices.every(n=>/^(PFL|DN|MDN)/.test(controller.graph.labels[n].type)));
  const sim=desk('racer');tick(sim,8);assert.equal(sim.state.living.workstation.phase,'playing');
  assert.notEqual(sim.state.living.workstation.arcade.player,80);
  assert.ok(sim.neural.frame.spikes.some(n=>!input.has(n)));
});
test('each arcade runs with the same continuous brain; checkpoints resume and switches preserve membrane',t=>{
  // Both continuations must see the same wall-clock daylight. Sequential CPU
  // runs can otherwise straddle a second boundary and change light inputs.
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-22T04:00:00Z')});
  for(const id of ['racer','breakout','invaders']){
    const sim=desk(id);tick(sim,4);assert.equal(sim.state.living.workstation.phase,'playing');
    const copy=new EmbodiedLife(sim.serialize());tick(sim,1);tick(copy,1);
    assert.deepEqual(copy.serialize(),sim.serialize());
    const brain=sim.neural.serialize();sim.environmentCommand('game',id==='racer'?'breakout':'racer');
    assert.deepEqual(sim.neural.serialize(),brain);
    assert.throws(()=>sim.environmentCommand('game','unknown'));
    sim.environmentCommand('screen',false);assert.notEqual(sim.state.living.workstation.phase,'playing');
  }
});
test('game saves reject corrupt arrays and do not silently erase state',()=>{
  const sim=desk('breakout'),saved=sim.serialize();saved.living.workstation.arcade.ball.x=NaN;
  assert.throws(()=>new EmbodiedLife(saved),/游戏存档无效/);
});

test('feeding needs downstream MN9 response as well as physical food contact',()=>{
  const live=new EmbodiedLife(),cut=new EmbodiedLife();
  for(const sim of [live,cut]){Object.assign(sim.state.actor,{position:[-3.01222381526149,1.3590130174789878,1.7106751467150032],heading:-1.7103630065546365,contact:true,zoneId:'feed'});sim.state.needs.satiety=10;}
  cut.neural.brain.disconnect();
  tick(live,5);tick(cut,5);
  assert.ok(live.state.needs.satiety>12);assert.ok(live.neural.behavior.feeding>.04);
  assert.ok(cut.state.needs.satiety<10);assert.equal(cut.neural.behavior.feeding,0);
});


test('breakout gives a returning ball more than two low-frequency feedback windows without slowing paddle',()=>{
 const g=createArcade('breakout');g.bricks.fill(0);g.bricks[0]=1;
 g.ball={x:80,y:64,vx:0,vy:32};let elapsed=0;
 while(g.ball.vy>0&&elapsed<4){stepArcade(g,stopped,.02);elapsed+=.02;}
 assert.ok(elapsed>=2.4&&elapsed<=2.6);assert.ok(g.ball.vy<0);
 const x=g.player;stepArcade(g,right,.1);assert.ok(Math.abs(g.player-x-4.8)<1e-8);
});
