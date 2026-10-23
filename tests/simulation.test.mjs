import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSimulation, ValidationError } from '../src/simulation.mjs';
import { VERSION, ROOM, ZONES, ZONE_BY_ID } from '../public/world-spec.mjs';

test('无人值守会自主进食、休息、补给，并持续访问生活区域', () => {
  const simulation = new LifeSimulation(null, { seed: 128 });
  let leastEnergy = 100, leastSatiety = 100;
  for (let index = 0; index < 3600; index++) {
    simulation.tick(1);
    const state = simulation.snapshot();
    leastEnergy = Math.min(leastEnergy, state.needs.energy);
    leastSatiety = Math.min(leastSatiety, state.needs.satiety);
    for (const value of Object.values(state.needs)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);
    const [x, y, z] = state.actor.position;
    assert.ok(Math.abs(x) < ROOM.width / 2 && Math.abs(z) < ROOM.depth / 2 && y > 0 && y < ROOM.height);
  }
  const state = simulation.snapshot();
  assert.ok(state.stats.restedSeconds > 60 && state.stats.ateSeconds > 60);
  assert.ok(state.stats.refills > 0 && state.stats.activitiesCompleted > 50);
  assert.ok(leastEnergy > 0 && leastSatiety > 0);
  assert.ok(ZONES.filter(z => !['perch', 'nook', 'toilet'].includes(z.id)).every(zone => state.stats.zoneVisits[zone.id] > 0));
  assert.equal(state.history.length, 40);
  assert.ok(state.history.every(event => event.at.startsWith('第') && event.simSeconds <= state.simSeconds));
});

test('疲惫和饥饿会形成有效恢复，生活事件由实际到达产生', () => {
  const initial = new LifeSimulation().serialize();
  initial.needs.energy = 18; initial.needs.satiety = 20;
  const simulation = new LifeSimulation(initial);
  simulation.tick(160);
  const state = simulation.snapshot();
  assert.ok(state.needs.energy > 50 && state.needs.satiety > 50);
  assert.ok(state.stats.zoneVisits.rest > 0 && state.stats.zoneVisits.feed > 0);
  assert.ok(state.history.some(event => event.text.startsWith('到了栖息舱')));
  assert.ok(state.history.some(event => event.text.startsWith('到了补给台')));
});

test('保存途中路线、随机状态与余量，恢复后轨迹及决策完全连续', () => {
  const continuous = new LifeSimulation(null, { seed: 919 });
  continuous.tick(21.37);
  assert.equal(continuous.snapshot().actor.mode, 'travel');
  const restored = new LifeSimulation(JSON.parse(JSON.stringify(continuous.serialize())));
  for (const seconds of [0.03, 0.2, 4.7, 23.12, 95, 370]) {
    continuous.tick(seconds); restored.tick(seconds);
    assert.deepEqual(restored.serialize(), continuous.serialize());
  }
});

test('两个基础需求同时很低时先完成恢复，不在目标间反复折返', () => {
  const initial = new LifeSimulation().serialize();
  initial.needs.energy = 12; initial.needs.satiety = 12;
  const simulation = new LifeSimulation(initial);
  simulation.tick(180);
  const state = simulation.snapshot();
  assert.ok(state.needs.energy > 35 && state.needs.satiety > 35);
  assert.ok(state.stats.decisions < 15);
  assert.ok(state.stats.zoneVisits.rest > 0 && state.stats.zoneVisits.feed > 0);
});

test('曲线路线跨家具时保持高空，低空起降保持垂直安全通道', () => {
  const simulation = new LifeSimulation(null, { seed: 81 });
  let checkedRoutes = 0;
  for (let index = 0; index < 900; index++) {
    simulation.tick(0.5);
    const saved = simulation.serialize();
    if (saved.actor.mode !== 'travel') continue;
    checkedRoutes++;
    const route = saved.actor.route;
    for (const segment of route) {
      const points = [segment.start, segment.a, segment.b, segment.end];
      if (['dart', 'approach'].includes(segment.phase)) {
        assert.ok(points.every(point => point[1] >= ROOM.cruiseHeight));
      } else {
        assert.ok(points.every(point => Math.abs(point[0] - segment.start[0]) < 1e-8
          && Math.abs(point[2] - segment.start[2]) < 1e-8));
      }
    }
    assert.deepEqual(route.at(-1).end, ZONES.find(zone => zone.id === saved.actor.targetZoneId).position);
    assert.doesNotThrow(() => new LifeSimulation(saved));
  }
  assert.ok(checkedRoutes > 20);
});

test('飞行具有起飞加速、短促转向、暂停悬停与着陆减速，位置不跳变', () => {
  const simulation = new LifeSimulation(null, { seed: 919 });
  const phases = new Set(), speedByPhase = { takeoff: [], landing: [] };
  let previous = simulation.snapshot(), strongestBank = 0;
  for (let index = 0; index < 1300; index++) {
    simulation.tick(0.1);
    const state = simulation.snapshot();
    phases.add(state.actor.flightPhase);
    const displacement = Math.hypot(...state.actor.position.map((value, axis) => value - previous.actor.position[axis]));
    assert.ok(displacement < 1.1, `单帧移动过大: ${displacement}`);
    const speed = Math.hypot(...state.actor.velocity);
    if (speedByPhase[state.actor.flightPhase]) speedByPhase[state.actor.flightPhase].push(speed);
    strongestBank = Math.max(strongestBank, Math.abs(state.actor.bank));
    if (state.actor.flightPhase === 'hover' || state.actor.flightPhase === 'perched') assert.equal(speed, 0);
    if (Math.hypot(state.actor.velocity[0], state.actor.velocity[2]) > 0.01) {
      assert.ok(Math.abs(state.actor.heading - Math.atan2(state.actor.velocity[0], state.actor.velocity[2])) < 1e-8);
    }
    previous = state;
  }
  for (const phase of ['takeoff', 'dart', 'turn', 'hover', 'approach', 'landing', 'perched']) assert.ok(phases.has(phase), phase);
  assert.ok(strongestBank > 0.08);
  for (const speeds of Object.values(speedByPhase)) assert.ok(Math.max(...speeds) > Math.min(...speeds) * 3);
});

test('自由探索使用变化目标而非固定周期，探索中保存后完全连续', () => {
  const initial = new LifeSimulation(null, { seed: 742 }).serialize();
  Object.assign(initial.actor, { position: [...ZONE_BY_ID.flight.position], zoneId: 'flight',
    targetZoneId: 'flight', action: 'explore', flightPhase: 'hover' });
  initial.activity.elapsed = 0; initial.activity.duration = 40;
  const simulation = new LifeSimulation(initial);
  const targets = new Set();
  for (let index = 0; index < 60; index++) {
    simulation.tick(0.1);
    const saved = simulation.serialize();
    if (saved.actor.motion.explorationSegment) targets.add(JSON.stringify(saved.actor.motion.explorationSegment.end));
    assert.doesNotThrow(() => new LifeSimulation(saved));
  }
  assert.ok(targets.size >= 3);
  const restored = new LifeSimulation(simulation.serialize());
  for (let index = 0; index < 120; index++) {
    simulation.tick(0.1); restored.tick(0.1);
    assert.deepEqual(restored.serialize(), simulation.serialize());
  }
});

function legacyFixture(zoneId = 'garden', originalHeight = false) {
  const state = new LifeSimulation().serialize();
  const anchors = {
    rest: [-4.3, originalHeight ? 1.05 : 1.85, -2.45],
    feed: [-4.2, originalHeight ? 1.55 : 1.95, 1.45],
    work: [-1.25, originalHeight ? 1.65 : 2.25, -3],
    garden: [3.1, originalHeight ? 1.9 : 2.35, -2.4],
    flight: [0.25, 2.25, 0.75], entry: [4.5, originalHeight ? 1 : 1.08, 2.95]
  };
  state.version = '0.0.1'; state.schemaVersion = 1;
  state.simSeconds = 87.3; state.realSeconds = 72.9; state.accumulator = 0.03;
  state.needs = { energy: 58, satiety: 64, curiosity: 37, comfort: 81 };
  state.home = { food: 43, water: 72 };
  state.stats.activitiesCompleted = 3; state.stats.distanceTravelled = 26.37;
  state.actor = { position: anchors[zoneId], heading: 0.4, mode: 'activity', action: ZONE_BY_ID[zoneId].action,
    zoneId, targetZoneId: zoneId, route: [], routeIndex: 0 };
  state.activity.elapsed = 9; state.activity.duration = 27;
  return state;
}

test('两版旧schema1停栖存档迁至新锚点，保留需求、生活记录、时钟和补给', () => {
  for (const originalHeight of [true, false]) {
    for (const zone of ZONES.filter(z => !['perch', 'nook', 'toilet'].includes(z.id))) {
      const old = legacyFixture(zone.id, originalHeight);
      const unchanged = structuredClone(old);
      const migrated = new LifeSimulation(old).serialize();
      assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.version, VERSION);
      for (const key of ['needs', 'history', 'stats', 'simSeconds', 'realSeconds', 'accumulator', 'home', 'activity']) {
        assert.deepEqual(migrated[key], old[key]);
      }
      assert.deepEqual(migrated.actor.position, zone.position);
      assert.deepEqual(old, unchanged, '迁移不能改写调用者的旧存档对象');
      assert.doesNotThrow(() => new LifeSimulation(migrated));
    }
  }
});

test('旧schema1途中存档保留高空位置并重规划，新版恢复后继续一致', () => {
  const old = legacyFixture();
  Object.assign(old.actor, { position: [1.55, 3.4, -1.2], mode: 'travel', action: 'eat', targetZoneId: 'feed',
    route: [[3.1, 3.4, -2.4], [0, 3.4, 0], [-4.2, 3.4, 1.45], [-4.2, 1.95, 1.45]], routeIndex: 1 });
  const migrated = new LifeSimulation(old);
  assert.deepEqual(migrated.snapshot().actor.position, old.actor.position);
  assert.deepEqual(migrated.snapshot().stats, old.stats);
  assert.deepEqual(migrated.serialize().actor.route.at(-1).end, ZONE_BY_ID.feed.position);
  const restored = new LifeSimulation(migrated.serialize());
  for (const seconds of [0.07, 1.8, 6, 30, 160]) {
    migrated.tick(seconds); restored.tick(seconds);
    assert.deepEqual(migrated.serialize(), restored.serialize());
  }
  old.actor.position = [-4.2, 2.6, 1.45]; old.actor.routeIndex = 3;
  const low = new LifeSimulation(old).snapshot();
  assert.equal(low.actor.position[0], ZONE_BY_ID.feed.position[0]);
  assert.equal(low.actor.position[2], ZONE_BY_ID.feed.position[2]);
  assert.deepEqual(low.home, old.home);
});

test('损坏的旧存档和新版运动字段会拒绝，不能借迁移绕过核验', () => {
  for (const mutate of [
    state => { state.actor.position = [0, 2, 0]; },
    state => { state.needs.energy = NaN; },
    state => { state.version = '0.0.2'; },
    state => { state.actor.velocity = [0, 0, 0]; }
  ]) {
    const old = legacyFixture(); mutate(old);
    assert.throws(() => new LifeSimulation(old), ValidationError);
  }
  const flight = new LifeSimulation(); flight.tick(20);
  for (const mutate of [
    state => { state.actor.velocity[0] = 100; },
    state => { state.actor.motion.elapsed = NaN; },
    state => { state.actor.route[1].a[1] = 0.3; },
    state => { state.actor.position[0] += 0.7; },
    state => { state.actor.bank = Infinity; }
  ]) {
    const saved = flight.serialize(); mutate(saved);
    assert.throws(() => new LifeSimulation(saved), ValidationError);
  }
});

test('暂停保持生活时间，倍速只改变生活模拟速度，冷却按真实增量推进', () => {
  const simulation = new LifeSimulation();
  simulation.interact('mist'); simulation.setPaused(true); simulation.tick(20);
  assert.equal(simulation.snapshot().simSeconds, 0);
  assert.equal(simulation.snapshot().cooldowns.mist, 0);
  simulation.setPaused(false); simulation.setSpeed(3); simulation.tick(2);
  assert.equal(simulation.snapshot().simSeconds, 6);
  simulation.setSpeed(10); simulation.tick(2);
  assert.equal(simulation.snapshot().simSeconds, 26);
  assert.equal(Math.floor(simulation.snapshot().clock.hour), 9);
});

test('投喂与喷雾修改真实房内状态；门铃不会中断睡眠', () => {
  const simulation = new LifeSimulation();
  const before = simulation.snapshot();
  simulation.interact('feed'); simulation.interact('mist');
  const after = simulation.snapshot();
  assert.ok(after.home.food > before.home.food && after.needs.comfort > before.needs.comfort);
  assert.throws(() => simulation.interact('feed'), error => error instanceof ValidationError && error.statusCode === 429);
  simulation.tick(15); simulation.interact('feed');
  let attempts = 0;
  while (!(simulation.snapshot().actor.action === 'rest' && simulation.snapshot().actor.mode === 'activity')) {
    simulation.tick(1); assert.ok(attempts++ < 1000);
  }
  simulation.interact('chime'); simulation.tick(0.1);
  assert.equal(simulation.snapshot().actor.action, 'rest');
  assert.equal(simulation.snapshot().actor.mode, 'activity');
});

test('非法时间、控制参数与篡改存档均明确失败，返回状态不泄漏可变引用', () => {
  const simulation = new LifeSimulation();
  for (const delta of [-1, NaN, Infinity, '1', 3601]) assert.throws(() => simulation.tick(delta), ValidationError);
  for (const speed of [0, 2, '3', null]) assert.throws(() => simulation.setSpeed(speed), ValidationError);
  assert.throws(() => simulation.setPaused('false'), ValidationError);
  assert.throws(() => simulation.interact('__proto__'), ValidationError);
  for (const mutate of [
    state => { state.actor.position[0] = 900; },
    state => { state.needs.energy = NaN; },
    state => { state.actor.targetZoneId = 'missing'; },
    state => { state.rng = 0; },
    state => { state.version = '9.0.0'; },
    state => { state.extra = true; },
    state => { state.history[0].text = {}; },
    state => { state.actor.action = 'eat'; }
  ]) {
    const state = simulation.serialize(); mutate(state);
    assert.throws(() => new LifeSimulation(state), ValidationError);
  }
  const snapshot = simulation.snapshot(); snapshot.needs.energy = -999; snapshot.actor.position[0] = 900;
  assert.notEqual(simulation.snapshot().needs.energy, -999);
  assert.notEqual(simulation.snapshot().actor.position[0], 900);
});
