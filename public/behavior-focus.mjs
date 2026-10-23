import {activityAvailable, signalActivity} from './activity-cooldowns.mjs';
import {needScore} from './need-display.mjs';
import {activityPreference} from './companion-learning.mjs';
import {learnedForagingAvailable} from './learned-foraging.mjs';

export const FOCUS_ACTIONS = ['eat', 'drink', 'rest', 'clean', 'toilet', 'play', 'observe', 'explore'];
const METRICS = {eat:['satiety'], drink:['thirst'], rest:['energy','sleepPressure'],
  clean:['dirt','wetness'], toilet:['waste'], play:['curiosity'], observe:['comfort']};
const WEIGHTS = {eat:1.3, drink:1.3, rest:1.15, toilet:1.05, clean:.65, play:.4, observe:.3};

export const createBehaviorFocus = (now = 0) => ({action:null, scores:{}, selectedAt:now,
  candidate:null, candidateSince:now, sampledSeconds:0, lastUpdatedAt:now, changes:0, reason:'collecting'});
export const focusedActivity = state => state.living?.focus?.action ?? null;
export const activityPermitted = (state, action) => !focusedActivity(state) || focusedActivity(state) === action;

// Legacy states without an assigned goal retain local exhaustion recovery.
// Assigned rest may use a nearby supported surface before reaching the bed.
export function emergencyRecoveryNeeded(state) {
  const l = state.living;
  return state.needs.energy < 12 || state.needs.energy < 35 &&
    (l.focus?.action === 'rest' && l.focus.reason === 'emergency-recovery' || l.sleep?.active);
}

export function activityDeficit(state, action) {
  if (action === 'explore') return .1;
  return Math.max(0, ...(METRICS[action] ?? []).map(key => {
    const score = needScore(state, key);
    return score === null ? 0 : (100 - score) / 100;
  }));
}

// An activity owns the goal, not a particular object. Another water source can
// replace an unreachable bowl without turning the intention into a new task.
export function signalSupportsActivity(state, signal, action = focusedActivity(state)) {
  if (!action) return true;
  if (action === 'clean') return state.living.physiology.dirt > .35
    ? signal.resourceKind === 'water' : signal.id === 'nest';
  if (action === 'explore') return ['high-perch','open-air'].includes(signal.id) || signal.scope === 'surface';
  return signalActivity(signal) === action;
}

function available(state, action, signals = []) {
  if (action === 'explore') return true;
  if (!activityAvailable(state, action) || activityDeficit(state, action) === 0) return false;
  if ((state.living.activityRetryUntil?.[action] ?? 0) > state.simSeconds) return false;
  const continuing = focusedActivity(state) === action || state.living.commitment?.action === action;
  const n = state.needs, p = state.living.physiology;
  if (action === 'eat') return (state.home.food > 0 && (continuing || n.satiety < 55))
    || learnedForagingAvailable(state,signals);
  if (action === 'drink') return state.home.water > 0 && (continuing || p.thirst > .22);
  if (action === 'rest') return continuing || n.energy < 48 || p.sleepPressure > .68;
  if (action === 'toilet') return continuing || p.waste > .55;
  if (action === 'clean') return continuing || p.dirt > .35 || state.living.wetness > .3;
  if (action === 'play' || action === 'observe') {
    if (continuing) return action !== 'play' || state.living.workstation.enabled && state.living.workstation.cooldown <= 0;
    if (n.energy <= (continuing ? 15 : 35) || n.satiety <= 30 || p.thirst >= .72 || p.sleepPressure >= .68 || p.waste >= .8) return false;
    if (action === 'play') return state.living.workstation.enabled && state.living.workstation.cooldown <= 0 && (continuing || n.curiosity > 25);
    return (state.living.regions.garden.observationUntil ?? 0) <= state.simSeconds;
  }
  return true;
}

export function demandScores(state, signals = []) {
  const evidence = Object.fromEntries(FOCUS_ACTIONS.map(action => [action, 0]));
  for (const signal of signals) {
    if (!Number.isFinite(signal.intensity) || signal.intensity < 0) continue;
    const action = signalActivity(signal);
    if (Object.hasOwn(evidence, action)) evidence[action] = Math.max(evidence[action], signal.intensity / (1 + signal.intensity));
  }
  return Object.fromEntries(FOCUS_ACTIONS.map(action => {
    if (!available(state, action, signals)) return [action, 0];
    if (action === 'explore') return [action, .12 * activityPreference(state,action)];
    const deficit = activityDeficit(state, action);
    // Bounded urgency gives very low scores priority without amplifying neural
    // channels until they clip. Object count does not multiply a need's vote.
    const urgency = .3 * deficit + 5 * deficit ** 3 + 12 * Math.max(0, deficit - .8) ** 2;
    return [action, (WEIGHTS[action] * urgency + evidence[action] * deficit * .2) * activityPreference(state,action)];
  }));
}

function choose(state, action, reason) {
  const focus = state.living.focus;
  if (focus.action !== action) {
    focus.action = action;
    focus.selectedAt = state.simSeconds;
    focus.changes++;
    // Discard the previous motor bout; it cannot retain a second behaviour vote.
    if (state.living.commitment?.action !== action) state.living.commitment = null;
    state.living.resourceSession = null;
    if (state.living.navigation) {
      Object.assign(state.living.navigation, {targetId:null, resourceId:null, resourceWait:0, approach:null, route:null});
    }
  }
  focus.candidate = null;
  focus.candidateSince = state.simSeconds;
  focus.reason = reason;
}

export function updateBehaviorFocus(state, signals, dt) {
  const focus = state.living.focus ??= createBehaviorFocus(state.simSeconds);
  if (!Number.isFinite(dt) || dt <= 0) return focus;
  const now = state.simSeconds, raw = demandScores(state, signals);
  const alpha = 1 - Math.exp(-dt / 1.4);
  for (const action of FOCUS_ACTIONS) {
    // Completion and unavailable resources invalidate old evidence immediately.
    focus.scores[action] = available(state, action, signals)
      ? (focus.scores[action] ?? raw[action]) + alpha * (raw[action] - (focus.scores[action] ?? raw[action])) : 0;
  }
  focus.sampledSeconds = Math.min(30, focus.sampledSeconds + dt);
  focus.lastUpdatedAt = now;
  const rank = [...FOCUS_ACTIONS].sort((a,b) => focus.scores[b] - focus.scores[a]);
  const current = focus.action;
  // The runner owns one unfinished goal. Other scores remain observable but
  // cannot preempt it. Failure/resource availability is checked separately.
  const continuing = state.living.commitment?.action;
  if (!current || !available(state,current,signals)) {
    if (!current && continuing && available(state,continuing,signals)) choose(state,continuing,'continuing');
    else if (current || focus.sampledSeconds >= 2 || state.needs.energy < 12) {
      const next = state.needs.energy < 12 && available(state,'rest',signals) ? 'rest' : rank[0];
      choose(state,next,current?'completed-or-unavailable':'strongest-need');
    }
    return focus;
  }
  if (current !== 'explore') {
    const secondary=rank.find(action=>action!==current&&action!=='explore'&&focus.scores[action]>0)??null;
    if(focus.candidate!==secondary)focus.candidateSince=now;
    focus.candidate=secondary;
    focus.reason='goal-in-progress';
    return focus;
  }
  // Free flight has no completion meter; a sustained real need can start a goal.
  const challenger=rank[0];
  if(challenger===current){focus.candidate=null;return focus;}
  if(focus.candidate!==challenger){focus.candidate=challenger;focus.candidateSince=now;}
  if(now-focus.candidateSince>=2.4)choose(state,challenger,'strongest-need');
  return focus;
}

export function validateBehaviorFocus(focus) {
  if (focus === undefined) return; // Known old saves acquire an empty accumulator.
  const action = value => value === null || FOCUS_ACTIONS.includes(value);
  const number = value => Number.isFinite(value) && value >= 0;
  if (!focus || !action(focus.action) || !action(focus.candidate)
    || !['selectedAt','candidateSince','sampledSeconds','lastUpdatedAt','changes'].every(key => number(focus[key]))
    || focus.sampledSeconds > 30 || !Number.isSafeInteger(focus.changes)
    || typeof focus.reason !== 'string' || focus.reason.length > 80
    || !focus.scores || Array.isArray(focus.scores) || typeof focus.scores !== 'object'
    || Object.entries(focus.scores).some(([key,value]) => !FOCUS_ACTIONS.includes(key) || !number(value) || value > 20)) {
    throw Error('Invalid behaviour focus checkpoint');
  }
}
