import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {applyGrowthSize} from '../public/companion-growth.mjs';
import {bodyMetrics} from '../public/body-metrics.mjs';
import {supportedFeet,surfaceBelow} from '../public/collision-world.mjs';
import {toiletAligned} from '../public/toilet-contact.mjs';

const cases = [
  {name:'newborn from the default window',progress:0,start:'default'},
  {name:'newborn from outside the toilet',progress:0,start:'outside'},
  {name:'mature from the default window',progress:1,start:'default'},
  {name:'mature from outside the toilet',progress:1,start:'outside'},
  {name:'growing from the supported supply table',progress:.25,start:'supply'},
  {name:'newborn from below the toilet rim',progress:0,start:'low'},
];

function createFixture({progress,start}) {
  const sim = new EmbodiedLife(), state = sim.state;
  state.companion = createCompanion({
    id:'12345678-1234-1234-1234-123456789abc',
    seed:'1234567890abcdef1234567890abcdef',now:1,
  });
  adoptCompanion(state.companion,'厕所复现',2);
  if (progress) {
    state.companion.activeSeconds = 21600 * progress;
    Object.assign(state.companion.growth, {
      elapsed:21600 * progress,nutrition:180 * progress,rest:600 * progress,progress,
    });
  }
  applyGrowthSize(state);
  if (start === 'outside' || start === 'low') {
    Object.assign(state.actor, {
      position:start === 'outside' ? [3.7,.70,.40] : [3.7,.32,.9],
      heading:Math.PI / 2,velocity:[0,0,0],contact:false,zoneId:'perch',
    });
  } else if (start === 'supply') {
    const ground = surfaceBelow(-3.35,2,2,2,state.actor), body = bodyMetrics(state.actor);
    assert.equal(ground?.zone,'feed','fixture starts on the real supply table');
    Object.assign(state.actor, {
      position:[-3.35,ground.position[1] + body.radius + body.skin,2],
      heading:0,velocity:[0,0,0],contact:true,zoneId:ground.zone,
    });
    state.actor.supportFeet = supportedFeet(state.actor.position,state.actor.heading,state.actor);
    assert.equal(state.actor.supportFeet,6);
  }
  Object.assign(state.needs,{energy:95,satiety:95,curiosity:0,comfort:100});
  Object.assign(state.living.physiology,{thirst:.05,waste:.95,dirt:.02,sleepPressure:.05});
  state.living.alert = 0;
  state.living.wetness = 0;
  // Fixed daytime avoids ambient clock differences; all needs and neural
  // decisions still evolve normally, with no injected focus or motor output.
  state.living.clock.hour = 14.758055555555556;
  return sim.serialize();
}

function assertSaveRoundtrip(sim) {
  const saved = sim.serialize(), restored = new EmbodiedLife(saved);
  assert.deepEqual(restored.state.companion,saved.companion,'adopted growth and memories survive reload');
  assert.deepEqual(restored.neural.serialize(),saved.neural,'reload retains the actual neural state');
  assert.deepEqual(restored.state.actor.position,saved.actor.position);
  assert.deepEqual(restored.state.living.physiology,saved.living.physiology);
}

for (const scenario of cases) {
  test(scenario.name + ' completes one autonomous toilet visit and leaves without returning', () => {
    const sim = new EmbodiedLife(createFixture(scenario)), state = sim.state;
    assertSaveRoundtrip(sim);
    const phases = [];
    let firstLeave = null, completedAt = null, seenElimination = false;
    const diagnostic = () => JSON.stringify({
      seconds:state.simSeconds,position:state.actor.position,phase:state.living.toiletManeuver,
      focus:state.living.focus.action,route:state.living.navigation.route,
      waste:state.living.physiology.waste,phases,
    });
    for (let step = 0; step < 1800; step++) {
      sim.tick(.1);
      const actor = state.actor, life = state.living, phase = life.toiletManeuver?.phase ?? null;
      if (phases.at(-1) !== phase) phases.push(phase);
      assert.ok(actor.position.every(Number.isFinite) && actor.velocity.every(Number.isFinite));
      assert.equal(life.escape.attempts,0,'must navigate and place feet without escape bursts: ' + diagnostic());
      assert.notEqual(phase,'failed','the local approach must make genuine progress: ' + diagnostic());
      if (firstLeave !== null) {
        assert.ok(!['walk','turn','eliminate'].includes(phase),'completed visit must not restart after leaving: ' + diagnostic());
      }
      if (phase === 'leave' && firstLeave === null) {
        firstLeave = state.simSeconds;
        assert.ok(seenElimination,'must discharge before leaving');
        assert.ok(life.activityCooldowns?.toilet > state.simSeconds,'completion starts a real cooldown');
      }
      if (life.behavior === 'toilet') {
        seenElimination = true;
        assert.equal(phase,'eliminate','no discharge before the maneuver finishes turning');
        assert.ok(toiletAligned(actor),'abdomen must face into the basin');
        assert.ok(actor.contact && supportedFeet(actor.position,actor.heading,actor) >= 3,'discharge needs real foot support');
      }
      assert.ok(life.hygiene.bowelMovements <= 1,'one visit records only one bowel movement');
      if (firstLeave !== null && (phase === null || phase === 'done')) {
        completedAt ??= state.simSeconds;
        assert.equal(life.hygiene.bowelMovements,1);
        assert.ok(life.physiology.waste < .02,'the visit empties the bowel');
        assert.notEqual(life.behavior,'toilet');
      }
      // Keep the real controller running beyond the first exit: this catches
      // stale focus restarting the rim sequence immediately after completion.
      if (completedAt !== null && state.simSeconds - completedAt >= 15) break;
    }
    assert.ok(completedAt !== null,'must finish a full visit within 180 seconds: ' + diagnostic());
    const sequence = phases.filter(Boolean);
    assert.deepEqual(sequence.slice(0,6),['approach','land','walk','turn','eliminate','leave']);
    assert.equal(sequence.filter(phase => phase === 'eliminate').length,1);
    assert.ok(state.living.activityCooldowns.toilet > state.simSeconds);
    assertSaveRoundtrip(sim);
  });
}
