import { VERSION, ROOM, ZONES, ZONE_BY_ID } from '../public/world-spec.mjs';

const STEP = 0.1;
const SPEEDS = [1, 3, 10];
const NEEDS = ['energy', 'satiety', 'curiosity', 'comfort'];
const COOLDOWNS = { feed: 15, mist: 20, chime: 12 };
const ACTIONS = ZONES.map(zone => zone.action);
const FLIGHT_PHASES = ['perched', 'takeoff', 'dart', 'turn', 'hover', 'approach', 'landing'];
const LEGACY_HEIGHTS = { rest: [1.05, 1.85], feed: [1.55, 1.95], work: [1.65, 2.25],
  garden: [1.9, 2.35], flight: [2.25], entry: [1, 1.08] };
const LEGACY_XZ = { rest: [-4.3, -2.45], feed: [-4.2, 1.45], work: [-1.25, -3],
  garden: [3.1, -2.4], flight: [0.25, 0.75], entry: [4.5, 2.95] };
const EXPLORATION_BOUNDS = [[-1.45, 1.65], [2.05, 3.15], [-1.45, 1.7]];
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const copy = value => structuredClone(value);
const round = value => Math.round(value * 1e9) / 1e9;
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const motionState = () => ({ elapsed: 0, holdRemaining: 0, explorationSegment: null, explorationCount: 0 });
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function curveSample(segment, elapsed) {
  const t = clamp(elapsed / segment.duration, 0, 1);
  // The time envelope eases each short flight bout in and out. Curved spatial
  // controls, variable bouts and brief holds provide a fly-like visual rhythm.
  const u = t * t * (3 - 2 * t);
  const du = 6 * t * (1 - t) / segment.duration;
  const v = 1 - u;
  return {
    position: segment.start.map((value, i) => v ** 3 * value + 3 * v * v * u * segment.a[i]
      + 3 * v * u * u * segment.b[i] + u ** 3 * segment.end[i]),
    velocity: segment.start.map((value, i) => 3 * (v * v * (segment.a[i] - value)
      + 2 * v * u * (segment.b[i] - segment.a[i]) + u * u * (segment.end[i] - segment.b[i])) * du)
  };
}

export class ValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

function requireCondition(condition, message = '存档内容无效，原始文件需要保留。') {
  if (!condition) throw new ValidationError(message);
}

function number(value, min, max, integer = false) {
  requireCondition(typeof value === 'number' && Number.isFinite(value)
    && value >= min && value <= max && (!integer || Number.isInteger(value)));
}

function object(value, keys) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireCondition(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}

function position(value, legacy = false) {
  requireCondition(Array.isArray(value) && value.length === 3);
  number(value[0], -ROOM.width / 2 + 0.3, ROOM.width / 2 - 0.3);
  number(value[1], legacy ? 0.5 : 0.2, ROOM.height - 0.5);
  number(value[2], -ROOM.depth / 2 + 0.3, ROOM.depth / 2 - 0.3);
}

function legacyAnchor(value, zoneId) {
  const [x, z] = LEGACY_XZ[zoneId];
  return Math.abs(value[0] - x) < 1e-6 && Math.abs(value[2] - z) < 1e-6
    && LEGACY_HEIGHTS[zoneId].some(height => Math.abs(height - value[1]) < 1e-6);
}

function explorationPoint(point) {
  position(point);
  point.forEach((value, index) => number(value, ...EXPLORATION_BOUNDS[index]));
}

function validateSegment(segment, explore = false) {
  object(segment, ['start', 'a', 'b', 'end', 'duration', 'phase', 'holdAfter']);
  const points = [segment.start, segment.a, segment.b, segment.end];
  points.forEach(point => explore ? explorationPoint(point) : position(point));
  number(segment.duration, 0.25, 8);
  number(segment.holdAfter, 0, 0.9);
  requireCondition(['takeoff', 'dart', 'approach', 'landing'].includes(segment.phase));
  if (explore) requireCondition(segment.phase === 'dart');
  else if (['dart', 'approach'].includes(segment.phase)) {
    points.forEach(point => number(point[1], ROOM.cruiseHeight, 3.95));
  } else {
    // Low flight is confined to the vertical takeoff/landing column of a perch.
    points.forEach(point => requireCondition(Math.abs(point[0] - segment.start[0]) < 1e-6
      && Math.abs(point[2] - segment.start[2]) < 1e-6));
    if (segment.phase === 'takeoff') requireCondition(segment.end[1] === ROOM.cruiseHeight);
    else requireCondition(segment.start[1] >= ROOM.cruiseHeight);
  }
}

function validateMotion(actor) {
  requireCondition(Array.isArray(actor.velocity) && actor.velocity.length === 3);
  actor.velocity.forEach(value => number(value, -20, 20));
  requireCondition(FLIGHT_PHASES.includes(actor.flightPhase));
  number(actor.pitch, -0.65, 0.65); number(actor.bank, -0.65, 0.65);
  object(actor.motion, ['elapsed', 'holdRemaining', 'explorationSegment', 'explorationCount']);
  number(actor.motion.elapsed, 0, 8); number(actor.motion.holdRemaining, 0, 0.9);
  number(actor.motion.explorationCount, 0, 1e9, true);
  const exploring = actor.mode === 'activity' && actor.action === 'explore';
  if (actor.motion.explorationSegment !== null) {
    requireCondition(exploring);
    validateSegment(actor.motion.explorationSegment, true);
  }
  const segment = actor.mode === 'travel' ? actor.route[actor.routeIndex] : actor.motion.explorationSegment;
  if (segment) {
    number(actor.motion.elapsed, 0, segment.duration);
    const expected = curveSample(segment, actor.motion.elapsed);
    requireCondition(distance(actor.position, expected.position) < 1e-6);
    requireCondition(distance(actor.velocity, expected.velocity) < 1e-6);
  } else {
    requireCondition(actor.motion.elapsed === 0 && distance(actor.velocity, [0, 0, 0]) < 1e-6);
    if (exploring) explorationPoint(actor.position);
    else requireCondition(actor.flightPhase === 'perched' && actor.motion.holdRemaining === 0);
  }
}

function zoneMap(value, max = 1e9, integer = false) {
  object(value, ZONES.map(zone => zone.id));
  for (const count of Object.values(value)) number(count, 0, max, integer);
}

function validateSaved(saved) {
  object(saved, ['schemaVersion', 'version', 'rng', 'simSeconds', 'realSeconds', 'accumulator', 'speed',
    'paused', 'actor', 'needs', 'activity', 'history', 'nextEventId', 'stats', 'home', 'lastVisited',
    'cooldowns', 'interests', 'reaction']);
  const legacy = saved.schemaVersion === 1 && saved.version === '0.0.1';
  requireCondition(legacy || (saved.schemaVersion === 2 && [VERSION, '1.0.0', '0.2.0', '0.1.0'].includes(saved.version)), '存档版本不兼容，未覆盖旧存档。');
  number(saved.rng, 1, 0xffffffff, true);
  number(saved.simSeconds, 0, 1e9);
  number(saved.realSeconds, 0, 1e9);
  number(saved.accumulator, 0, STEP - 1e-10);
  requireCondition(SPEEDS.includes(saved.speed) && typeof saved.paused === 'boolean');
  const actorKeys = ['position', 'heading', 'mode', 'action', 'zoneId', 'targetZoneId', 'route', 'routeIndex'];
  object(saved.actor, legacy ? actorKeys : [...actorKeys, 'velocity', 'flightPhase', 'pitch', 'bank', 'motion']);
  position(saved.actor.position, legacy);
  number(saved.actor.heading, -Math.PI, Math.PI);
  requireCondition(['travel', 'activity'].includes(saved.actor.mode));
  requireCondition(ACTIONS.includes(saved.actor.action));
  requireCondition(Object.hasOwn(ZONE_BY_ID, saved.actor.zoneId)
    && Object.hasOwn(ZONE_BY_ID, saved.actor.targetZoneId));
  requireCondition(saved.actor.action === ZONE_BY_ID[saved.actor.targetZoneId].action);
  requireCondition(Array.isArray(saved.actor.route) && saved.actor.route.length <= (legacy ? 4 : 7));
  saved.actor.route.forEach(point => legacy ? position(point, true) : validateSegment(point));
  number(saved.actor.routeIndex, 0, saved.actor.route.length, true);
  if (saved.actor.mode === 'travel') {
    requireCondition(saved.actor.route.length > 0 && saved.actor.routeIndex < saved.actor.route.length);
    if (legacy) {
      requireCondition(legacyAnchor(saved.actor.route.at(-1), saved.actor.targetZoneId));
      saved.actor.route.slice(0, -1).forEach(point => requireCondition(point[1] === ROOM.cruiseHeight));
    } else {
      requireCondition(distance(saved.actor.route.at(-1).end, ZONE_BY_ID[saved.actor.targetZoneId].position) < 1e-6);
      saved.actor.route.forEach((segment, index) => {
        if (index) requireCondition(distance(segment.start, saved.actor.route[index - 1].end) < 1e-6);
      });
    }
  } else {
    requireCondition(saved.actor.zoneId === saved.actor.targetZoneId && saved.actor.route.length === 0);
    if (saved.actor.action !== 'explore') {
      requireCondition(legacy ? legacyAnchor(saved.actor.position, saved.actor.zoneId)
        : distance(saved.actor.position, ZONE_BY_ID[saved.actor.zoneId].position) < 1e-6);
    }
  }
  if (!legacy) validateMotion(saved.actor);
  object(saved.needs, NEEDS);
  for (const value of Object.values(saved.needs)) number(value, 0, 100);
  object(saved.activity, ['title', 'reason', 'elapsed', 'duration']);
  for (const key of ['title', 'reason']) requireCondition(typeof saved.activity[key] === 'string'
    && saved.activity[key].length > 0 && saved.activity[key].length <= 160);
  number(saved.activity.elapsed, 0, 46);
  number(saved.activity.duration, 12, 45);
  requireCondition(Array.isArray(saved.history) && saved.history.length <= 40);
  let previousId = 0;
  for (const event of saved.history) {
    object(event, ['id', 'at', 'simSeconds', 'text', 'kind']);
    number(event.id, 1, 1e9, true);
    requireCondition(event.id > previousId);
    previousId = event.id;
    number(event.simSeconds, 0, saved.simSeconds);
    requireCondition(event.at === timeLabel(event.simSeconds));
    requireCondition(typeof event.text === 'string' && event.text.length > 0 && event.text.length <= 180);
    requireCondition(['life', 'decision', 'interaction', 'system'].includes(event.kind));
  }
  number(saved.nextEventId, previousId + 1, 1e9, true);
  object(saved.stats, ['distanceTravelled', 'activitiesCompleted', 'decisions', 'interactions',
    'restedSeconds', 'ateSeconds', 'zoneVisits', 'refills']);
  for (const key of ['distanceTravelled', 'restedSeconds', 'ateSeconds']) number(saved.stats[key], 0, 1e10);
  for (const key of ['activitiesCompleted', 'decisions', 'interactions', 'refills']) number(saved.stats[key], 0, 1e9, true);
  zoneMap(saved.stats.zoneVisits, 1e9, true);
  zoneMap(saved.lastVisited, saved.simSeconds);
  object(saved.home, ['food', 'water']);
  number(saved.home.food, 0, 100);
  number(saved.home.water, 0, 100);
  object(saved.cooldowns, Object.keys(COOLDOWNS));
  for (const [type, until] of Object.entries(saved.cooldowns)) number(until, 0, saved.realSeconds + COOLDOWNS[type]);
  object(saved.interests, ['chimeUntil', 'mistUntil']);
  number(saved.interests.chimeUntil, 0, saved.simSeconds + 90);
  number(saved.interests.mistUntil, 0, saved.simSeconds + 75);
  if (saved.reaction !== null) {
    object(saved.reaction, ['type', 'until']);
    requireCondition(Object.hasOwn(COOLDOWNS, saved.reaction.type));
    number(saved.reaction.until, 0, saved.simSeconds + 8);
  }
  return copy(saved);
}

function clock(simSeconds) {
  const totalMinutes = 9 * 60 + Math.floor(simSeconds);
  return { day: Math.floor(totalMinutes / 1440) + 1, hour: (totalMinutes / 60) % 24,
    minute: totalMinutes % 60 };
}

function timeLabel(simSeconds) {
  const time = clock(simSeconds);
  return `第${time.day}天 ${String(Math.floor(time.hour)).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export class LifeSimulation {
  constructor(savedState = null, { seed = 0x4d495252 } = {}) {
    if (savedState !== null) {
      this.state = validateSaved(savedState);
      if (this.state.schemaVersion === 1) this.migrateLegacy();
      this.state.version = VERSION;
      return;
    }
    number(seed, 1, 0xffffffff, true);
    const visits = Object.fromEntries(ZONES.map(zone => [zone.id, 0]));
    this.state = {
      schemaVersion: 2, version: VERSION, rng: seed, simSeconds: 0, realSeconds: 0, accumulator: 0,
      speed: 1, paused: false,
      actor: { position: [...ZONE_BY_ID.garden.position], heading: 0, mode: 'activity', action: 'observe',
        zoneId: 'garden', targetZoneId: 'garden', route: [], routeIndex: 0,
        velocity: [0, 0, 0], flightPhase: 'perched', pitch: 0, bank: 0, motion: motionState() },
      needs: { energy: 78, satiety: 72, curiosity: 48, comfort: 76 },
      activity: { title: '正在看窗外', reason: '早晨的窗边很安静，先看一会儿。', elapsed: 0, duration: 18 },
      history: [], nextEventId: 1,
      stats: { distanceTravelled: 0, activitiesCompleted: 0, decisions: 0, interactions: 0,
        restedSeconds: 0, ateSeconds: 0, zoneVisits: { ...visits, garden: 1 }, refills: 0 },
      home: { food: 86, water: 92 }, lastVisited: { ...visits },
      cooldowns: { feed: 0, mist: 0, chime: 0 }, interests: { chimeUntil: 0, mistUntil: 0 }, reaction: null
    };
    this.record('镜隙来到窗边，开始今天的房内生活。', 'life');
  }

  migrateLegacy() {
    const state = this.state;
    const actor = state.actor;
    Object.assign(actor, { velocity: [0, 0, 0], flightPhase: 'perched', pitch: 0, bank: 0, motion: motionState() });
    state.schemaVersion = 2; state.version = VERSION;
    if (actor.mode === 'travel') {
      if (actor.position[1] < ROOM.cruiseHeight) {
        const columnId = actor.routeIndex === actor.route.length - 1 ? actor.targetZoneId : actor.zoneId;
        const [oldX, oldZ] = LEGACY_XZ[columnId];
        if (Math.hypot(actor.position[0] - oldX, actor.position[2] - oldZ) < 1e-6) {
          const anchor = ZONE_BY_ID[columnId].position;
          actor.position = [anchor[0], Math.max(actor.position[1], anchor[1]), anchor[2]];
        }
      }
      this.planFlight(actor.targetZoneId);
    }
    else if (actor.action === 'explore') {
      explorationPoint(actor.position);
      actor.flightPhase = 'hover';
    } else {
      actor.position = [...ZONE_BY_ID[actor.zoneId].position];
      if (actor.zoneId === 'entry') actor.heading = Math.PI;
      if (actor.zoneId === 'feed') actor.heading = -Math.PI / 2;
    }
    // Replanning old geometry is a format migration, not a new life event.
    // Needs, event history, clocks, supplies and statistics remain untouched.
    validateSaved(state);
  }

  random() {
    let value = this.state.rng;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.state.rng = value >>> 0;
    return this.state.rng / 0x100000000;
  }

  record(text, kind = 'life') {
    const state = this.state;
    const at = timeLabel(state.simSeconds);
    state.history.push({ id: state.nextEventId++, at, simSeconds: state.simSeconds, text, kind });
    if (state.history.length > 40) state.history.shift();
  }

  setSpeed(speed) {
    requireCondition(SPEEDS.includes(speed), '速度只能是 1、3 或 10。');
    this.state.speed = speed;
    return this.snapshot();
  }

  setPaused(paused) {
    requireCondition(typeof paused === 'boolean', '暂停状态必须是布尔值。');
    this.state.paused = paused;
    return this.snapshot();
  }

  tick(seconds) {
    requireCondition(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600,
      '时间增量必须是 0 到 3600 秒之间的有限数值。');
    const state = this.state;
    state.realSeconds = round(state.realSeconds + seconds);
    if (state.paused) return;
    state.accumulator = round(state.accumulator + seconds * state.speed);
    while (state.accumulator + 1e-9 >= STEP) {
      state.accumulator = round(Math.max(0, state.accumulator - STEP));
      this.step(STEP);
    }
  }

  step(dt) {
    const state = this.state;
    state.simSeconds = round(state.simSeconds + dt);
    const { actor, needs, stats, home, activity } = state;
    const action = actor.mode === 'activity' ? actor.action : 'travel';
    needs.energy = clamp(needs.energy - dt * (['travel', 'explore'].includes(action) ? 0.23 : 0.11));
    needs.satiety = clamp(needs.satiety - dt * 0.12);
    needs.curiosity = clamp(needs.curiosity + dt * 0.16);
    needs.comfort = clamp(needs.comfort - dt * 0.065);
    if (action === 'rest') {
      needs.energy = clamp(needs.energy + dt * 1.85);
      needs.comfort = clamp(needs.comfort + dt * 0.28);
      stats.restedSeconds = round(stats.restedSeconds + dt);
    } else if (action === 'eat') {
      needs.satiety = clamp(needs.satiety + dt * 1.95);
      needs.comfort = clamp(needs.comfort + dt * 0.2);
      home.food = clamp(home.food - dt * 0.65);
      home.water = clamp(home.water - dt * 0.25);
      stats.ateSeconds = round(stats.ateSeconds + dt);
    } else if (action === 'observe') {
      needs.curiosity = clamp(needs.curiosity - dt * 0.85);
      needs.comfort = clamp(needs.comfort + dt * 0.85);
    } else if (action === 'reflect') {
      needs.curiosity = clamp(needs.curiosity - dt * 0.55);
      needs.comfort = clamp(needs.comfort + dt * 0.45);
    } else if (action === 'explore') needs.curiosity = clamp(needs.curiosity - dt * 1.05);
    else if (action === 'visit') needs.curiosity = clamp(needs.curiosity - dt * 0.7);
    if (home.food < 20 || home.water < 20) {
      home.food = Math.max(home.food, 86); home.water = Math.max(home.water, 92);
      stats.refills++;
      this.record('补给装置补充了果实和清水。', 'system');
    }
    if (state.reaction && state.reaction.until <= state.simSeconds) state.reaction = null;
    // Commit to essential recovery until it has helped; two low needs must not
    // make the actor reverse course every tick between the bed and food table.
    const finishingMeal = actor.action === 'eat' && needs.satiety < 30 && needs.energy > 8;
    const recoveringEnergy = actor.action === 'rest' && needs.energy < 30;
    const urgent = needs.energy < 15 && actor.action !== 'rest' && !finishingMeal ? 'rest'
      : needs.satiety < 15 && actor.action !== 'eat' && !recoveringEnergy ? 'feed' : null;
    if (urgent && (actor.mode === 'travel' || activity.elapsed >= 4)) {
      this.goTo(urgent, urgent === 'rest' ? '有些累了，先找个安稳的地方休息。' : '肚子空了，先去补充一点食物。');
    }
    if (actor.mode === 'travel') {
      this.travel(dt);
      return;
    }
    activity.elapsed = round(activity.elapsed + dt);
    if (actor.action === 'explore') this.explore(dt);
    if (activity.elapsed >= activity.duration) {
      stats.activitiesCompleted++;
      this.chooseNext();
    }
  }

  chooseNext() {
    const state = this.state;
    const { needs, actor, stats } = state;
    if (needs.energy < 28 && needs.energy <= needs.satiety) {
      this.goTo('rest', '精力低了，回栖息舱休息一会儿。'); return;
    }
    if (needs.satiety < 28) {
      this.goTo('feed', '有些饿了，去补给台吃点东西。'); return;
    }
    const night = clock(state.simSeconds).hour >= 21 || clock(state.simSeconds).hour < 6;
    const scores = {
      rest: (100 - needs.energy) * 1.35 + (night ? 12 : 0),
      feed: (100 - needs.satiety) * 1.4,
      work: needs.curiosity * 0.55 + Math.min(22, (state.simSeconds - state.lastVisited.work) / 18),
      garden: (100 - needs.comfort) * 1.2 + needs.curiosity * 0.55,
      flight: needs.curiosity * 1.15 + (night ? -10 : 4),
      entry: needs.curiosity * 0.55 + Math.min(26, (state.simSeconds - state.lastVisited.entry) / 15)
    };
    if (state.interests.chimeUntil > state.simSeconds) scores.entry += 75;
    if (state.interests.mistUntil > state.simSeconds) scores.garden += 36;
    let winner = null;
    for (const zone of ZONES) {
      const novelty = 15 / (1 + stats.zoneVisits[zone.id]);
      const recentPenalty = zone.id === actor.zoneId ? 24 : 0;
      const score = scores[zone.id] + novelty - recentPenalty + this.random() * 14;
      if (!winner || score > winner.score) winner = { zone, score };
    }
    const reasons = {
      rest: night ? '房间渐渐安静下来，想去歇一会儿。' : '飞了一阵，想把精力慢慢养回来。',
      feed: '想尝一点果实，再喝一口水。',
      work: '想整理一下刚才在房间里的经历。',
      garden: state.interests.mistUntil > state.simSeconds ? '花园刚刚起了细雾，想过去看看。' : '想去窗边看看，让自己舒服一些。',
      flight: '还有些好奇，想在中间的空地自由飞一会儿。',
      entry: state.interests.chimeUntil > state.simSeconds ? '听到了门铃，想去门口看看。' : '有一会儿没去门口了，过去转转。'
    };
    this.goTo(winner.zone.id, reasons[winner.zone.id]);
  }

  goTo(zoneId, reason) {
    const state = this.state;
    const zone = ZONE_BY_ID[zoneId];
    const actor = state.actor;
    actor.mode = 'travel'; actor.targetZoneId = zoneId; actor.action = zone.action;
    this.planFlight(zoneId);
    state.activity = { title: `正在前往${zone.name}`, reason, elapsed: 0, duration: 12 + this.random() * 33 };
    if (zone.action === 'rest') state.activity.duration = clamp((100 - state.needs.energy) / 1.7 + 6, 18, 45);
    if (zone.action === 'eat') state.activity.duration = clamp((100 - state.needs.satiety) / 1.8 + 5, 18, 45);
    state.stats.decisions++;
    this.record(`前往${zone.name}：${reason}`, 'decision');
  }

  flightSegment(start, end, phase, explore = false) {
    const length = distance(start, end);
    const vertical = phase === 'takeoff' || phase === 'landing';
    const pace = phase === 'landing' ? 1.25 : vertical ? 1.8 : 3.3 + this.random() * 1.9;
    const duration = clamp(length / pace, vertical ? 0.6 : 0.35, 8);
    const a = start.map((value, index) => value + (end[index] - value) / 3);
    const b = start.map((value, index) => value + (end[index] - value) * 2 / 3);
    if (!vertical) {
      const horizontal = Math.hypot(end[0] - start[0], end[2] - start[2]) || 1;
      const side = (this.random() - 0.5) * (explore ? 0.6 : 0.42);
      a[0] += (end[2] - start[2]) / horizontal * side;
      a[2] -= (end[0] - start[0]) / horizontal * side;
      b[0] -= (end[2] - start[2]) / horizontal * side * 0.6;
      b[2] += (end[0] - start[0]) / horizontal * side * 0.6;
      a[1] += this.random() * 0.15; b[1] += this.random() * 0.15;
      for (const control of [a, b]) {
        if (explore) control.forEach((value, index) => { control[index] = clamp(value, ...EXPLORATION_BOUNDS[index]); });
        else control[1] = clamp(control[1], ROOM.cruiseHeight, 3.95);
      }
    }
    const holdAfter = phase === 'dart' && this.random() < 0.55 ? 0.16 + this.random() * 0.48 : 0;
    return { start: [...start], a, b, end: [...end], duration, phase, holdAfter };
  }

  planFlight(zoneId) {
    const actor = this.state.actor;
    const origin = [...actor.position];
    const landing = [...ZONE_BY_ID[zoneId].position];
    const lift = [origin[0], ROOM.cruiseHeight, origin[2]];
    const center = [(this.random() - 0.5) * 0.9, ROOM.cruiseHeight + this.random() * 0.28, (this.random() - 0.5) * 0.9];
    const overhead = [landing[0], ROOM.cruiseHeight, landing[2]];
    const mid = (from, to) => [from[0] + (to[0] - from[0]) * 0.5,
      ROOM.cruiseHeight + this.random() * 0.25, from[2] + (to[2] - from[2]) * 0.5];
    const points = [origin, lift, mid(lift, center), center, mid(center, overhead), overhead, landing];
    const phases = ['takeoff', 'dart', 'dart', 'dart', 'approach', 'landing'];
    actor.route = phases.map((phase, index) => this.flightSegment(points[index], points[index + 1], phase));
    actor.routeIndex = 0; actor.motion = motionState();
    actor.velocity = [0, 0, 0]; actor.pitch = 0; actor.bank = 0; actor.flightPhase = 'takeoff';
  }

  updateFlightPose(sample, phase, dt) {
    const actor = this.state.actor;
    this.state.stats.distanceTravelled += distance(actor.position, sample.position);
    actor.position = sample.position; actor.velocity = sample.velocity;
    const horizontal = Math.hypot(sample.velocity[0], sample.velocity[2]);
    const previousHeading = actor.heading;
    if (horizontal > 0.01) actor.heading = Math.atan2(sample.velocity[0], sample.velocity[2]);
    const turn = angleDifference(actor.heading, previousHeading);
    const bankTarget = clamp(-turn / dt * 0.12, -0.58, 0.58);
    const pitchTarget = clamp(Math.atan2(sample.velocity[1], Math.max(0.3, horizontal)) * 0.42, -0.6, 0.6);
    actor.bank += (bankTarget - actor.bank) * (1 - Math.exp(-dt * 10));
    actor.pitch += (pitchTarget - actor.pitch) * (1 - Math.exp(-dt * 8));
    actor.flightPhase = phase === 'dart' && Math.abs(turn) > 0.15 ? 'turn' : phase;
  }

  holdFlight(dt) {
    const actor = this.state.actor;
    if (actor.motion.holdRemaining <= 0) return false;
    actor.motion.holdRemaining = Math.max(0, actor.motion.holdRemaining - dt);
    this.updateFlightPose({ position: [...actor.position], velocity: [0, 0, 0] }, 'hover', dt);
    return true;
  }

  advanceSegment(segment, dt) {
    const actor = this.state.actor;
    actor.motion.elapsed = Math.min(segment.duration, actor.motion.elapsed + dt);
    this.updateFlightPose(curveSample(segment, actor.motion.elapsed), segment.phase, dt);
    return actor.motion.elapsed >= segment.duration;
  }

  travel(dt) {
    const actor = this.state.actor;
    if (this.holdFlight(dt)) return;
    const segment = actor.route[actor.routeIndex];
    if (!this.advanceSegment(segment, dt)) return;
    actor.routeIndex++; actor.motion.elapsed = 0; actor.motion.holdRemaining = segment.holdAfter;
    if (actor.routeIndex === actor.route.length) this.arrive();
  }

  explore(dt) {
    const actor = this.state.actor;
    if (this.holdFlight(dt)) return;
    if (!actor.motion.explorationSegment) {
      let target;
      for (let attempt = 0; attempt < 4; attempt++) {
        target = EXPLORATION_BOUNDS.map(([min, max]) => min + (max - min) * this.random());
        if (distance(actor.position, target) >= 0.7) break;
      }
      actor.motion.explorationSegment = this.flightSegment(actor.position, target, 'dart', true);
      actor.motion.explorationCount++;
    }
    const segment = actor.motion.explorationSegment;
    if (!this.advanceSegment(segment, dt)) return;
    actor.motion.explorationSegment = null;
    actor.motion.elapsed = 0; actor.motion.holdRemaining = segment.holdAfter;
  }

  arrive() {
    const state = this.state;
    const actor = state.actor;
    const zone = ZONE_BY_ID[actor.targetZoneId];
    actor.mode = 'activity'; actor.zoneId = zone.id; actor.route = []; actor.routeIndex = 0;
    actor.velocity = [0, 0, 0]; actor.pitch = 0; actor.bank = 0;
    actor.motion = motionState(); actor.flightPhase = zone.action === 'explore' ? 'hover' : 'perched';
    if (zone.id === 'entry') actor.heading = Math.PI;
    if (zone.id === 'feed') actor.heading = -Math.PI / 2;
    state.activity.title = zone.label; state.activity.elapsed = 0;
    state.stats.zoneVisits[zone.id]++;
    state.lastVisited[zone.id] = state.simSeconds;
    if (zone.id === 'entry') state.interests.chimeUntil = 0;
    if (zone.id === 'garden') state.interests.mistUntil = 0;
    this.record(`到了${zone.name}，${zone.label.replace('正在', '')}。`);
  }

  interact(type) {
    requireCondition(typeof type === 'string' && Object.hasOwn(COOLDOWNS, type), '互动类型无效。');
    const state = this.state;
    const remaining = state.cooldowns[type] - state.realSeconds;
    if (remaining > 1e-9) throw new ValidationError(`请等 ${Math.ceil(remaining)} 秒，再次${{ feed: '投喂', mist: '喷雾', chime: '按门铃' }[type]}。`, 429);
    state.cooldowns[type] = state.realSeconds + COOLDOWNS[type];
    state.stats.interactions++;
    state.reaction = { type, until: state.simSeconds + 8 };
    if (type === 'feed') {
      state.home.food = clamp(state.home.food + 28);
      state.home.water = clamp(state.home.water + 12);
      this.record('有人在补给台留下了果实和清水。', 'interaction');
    } else if (type === 'mist') {
      state.needs.comfort = clamp(state.needs.comfort + (state.actor.zoneId === 'garden' ? 16 : 5));
      state.interests.mistUntil = state.simSeconds + 75;
      this.record('窗边花园升起细雾，空气变得湿润了一些。', 'interaction');
    } else {
      state.interests.chimeUntil = state.simSeconds + 90;
      this.record(state.actor.mode === 'activity' && state.actor.action === 'rest'
        ? '门铃轻轻响起，镜隙仍在休息。' : '来客门廊的门铃轻轻响起。', 'interaction');
    }
    return this.snapshot();
  }

  snapshot() {
    const state = this.state;
    const { route, routeIndex, motion, ...actor } = state.actor;
    return copy({ version: VERSION, simSeconds: state.simSeconds, speed: state.speed, paused: state.paused,
      clock: clock(state.simSeconds), actor, needs: state.needs,
      activity: { title: state.activity.title, reason: state.activity.reason },
      history: state.history, stats: state.stats, home: state.home, reaction: state.reaction,
      cooldowns: Object.fromEntries(Object.entries(state.cooldowns).map(([type, until]) => [type, Math.max(0, Math.ceil(until - state.realSeconds))])) });
  }

  serialize() { return copy(this.state); }
}
