import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCoopPresentation,derivePairingPresentation } from '../public/coop-presentation.mjs';

const completed = { phase: 'complete', campaign: { status: 'complete' } };
const options = { entered: true };

test('campaign completion opens its ending and unlocks trials only from recorded campaign status', () => {
  const ending = deriveCoopPresentation(completed, options);
  assert.equal(ending.milestone, true);
  assert.equal(ending.campaignComplete, true);
  assert.equal(ending.trialsUnlocked, true);
  assert.equal(deriveCoopPresentation({ phase: 'complete', campaign: {} }, options).trialsUnlocked, false);
  assert.equal(deriveCoopPresentation(completed, { entered: false }).milestone, false);
});

test('a playing trial takes priority over preserved campaign completion', () => {
  const input = { ...completed, phase: 'trial', trial: { kind: 'courier', id: 'coop-trial-courier-1', status: 'playing' } };
  const presentation = deriveCoopPresentation(input, options);
  assert.equal(presentation.trialActive, true);
  assert.equal(presentation.trialTitle, '搬运试炼');
  assert.equal(presentation.milestone, false);
  assert.equal(presentation.campaignComplete, false);
  assert.equal(presentation.trialsUnlocked, true);
});

test('a completed trial has its own completion and uses kind instead of unique id', () => {
  const trial = { kind: 'signal', id: 'coop-trial-signal-4', status: 'complete', elapsed: 9.237, stats: { energySpent: 1.056, collisions: 2, mistakes: 0 } };
  const view = deriveCoopPresentation({ ...completed, phase: 'trial', trial }, options);
  assert.equal(view.trialTitle, '信号试炼');
  assert.equal(view.trialComplete, true);
  assert.equal(view.milestone, true);
  assert.equal(view.campaignComplete, false);
  assert.equal(view.trialRecord, '用时 9.2 秒 · 耗能 1.1% · 碰撞 2 次 · 失误 0 次');
});

test('dismissing the campaign ending keeps the shared home available, without suppressing a new completed trial', () => {
  assert.equal(deriveCoopPresentation(completed, { entered: true, endingDismissed: true }).milestone, false);
  const trial = deriveCoopPresentation({ ...completed, phase: 'trial', trial: { kind: 'courier', status: 'complete' } }, { entered: true, endingDismissed: true });
  assert.equal(trial.milestone, true);
});

test('missing trial fields never expose the old ending or invent a successful record', () => {
  const input = Object.freeze({ ...completed, phase: 'trial' });
  const view = deriveCoopPresentation(input, options);
  assert.equal(view.trialActive, true);
  assert.equal(view.milestone, false);
  assert.equal(view.trialTitle, '自由试炼');
  assert.match(view.trialRecord, /—/);
  assert.equal(input.phase, 'trial');
});

test('chapter clear preserves its normal next-step milestone', () => {
  const view = deriveCoopPresentation({ phase: 'campaign', campaign: { status: 'cleared' } }, options);
  assert.equal(view.cleared, true);
  assert.equal(view.milestone, true);
  assert.equal(view.trialsUnlocked, false);
});

const pairingCoop=pairing=>({phase:'campaign',stage:{id:'paired-scent'},pairing});
const counts={qualifiedPulses:1,interruptedPairs:0,interruptedOnLoad:0,interruptedNearB:0,interruptedFrozen:0,interruptedRewardDisabled:0};

test('pairing progress exists only in its real training stage and never during a trial',()=>{
  assert.equal(derivePairingPresentation({phase:'campaign',stage:{id:'first-bite'},pairing:{}}),null);
  assert.equal(derivePairingPresentation({phase:'trial',stage:{id:'paired-scent'},pairing:{}}),null);
  assert.equal(derivePairingPresentation(pairingCoop(null)),null);
});

test('pairing progress uses actual confirmed pulses, elapsed time and current-stage changes',()=>{
  const view=derivePairingPresentation(pairingCoop({pairedPulses:1,pairedConsumption:.004,changedSynapses:12,elapsed:6.25,ready:false,counts}));
  assert.match(view.text,/配对 1 \/ 2/);assert.match(view.text,/6\.3 \/ 12 秒/);assert.match(view.text,/内部改变 12 处/);
  assert.equal(view.summary.pairedPulses,1);assert.equal(view.summary.elapsed,6.25);assert.equal(view.summary.ready,false);
});

test('pending real teaching waits for its natural window and never derives readiness from counters',()=>{
  const pending=derivePairingPresentation(pairingCoop({pairedPulses:0,changedSynapses:0,elapsed:.1,ready:false,counts}));
  assert.match(pending.hint,/自然学习窗/);
  const enough=derivePairingPresentation(pairingCoop({pairedPulses:2,changedSynapses:12,elapsed:15,ready:false,counts:{...counts,qualifiedPulses:2}}));
  assert.equal(enough.summary.ready,false);assert.doesNotMatch(enough.hint,/记录已确认/);
  const confirmed=derivePairingPresentation(pairingCoop({pairedPulses:2,changedSynapses:12,elapsed:15,ready:true,counts:{...counts,qualifiedPulses:2}}));
  assert.match(confirmed.hint,/记录已确认/);
});

test('cumulative interruptions remain honest and identify retained confirmed progress',()=>{
  const view=derivePairingPresentation(pairingCoop({pairedPulses:1,changedSynapses:5,elapsed:4,ready:false,counts:{...counts,qualifiedPulses:3,interruptedPairs:2,interruptedOnLoad:1,interruptedNearB:1}}));
  assert.match(view.hint,/中断 2 次/);assert.match(view.hint,/已确认配对保留/);assert.doesNotMatch(view.hint,/刚刚/);
  assert.equal(view.summary.counts.interruptedOnLoad,1);assert.equal(view.summary.counts.interruptedNearB,1);
});

test('pairing display never exports baseline weights, readouts or unconfirmed concentration',()=>{
  const input=Object.freeze({pairedPulses:0,pairedConsumption:0,changedSynapses:0,elapsed:0,ready:false,counts:Object.freeze({...counts,qualifiedPulses:0}),baselineWeights:[123],lastWeights:[456],readouts:{A:1}});
  const view=derivePairingPresentation(pairingCoop(input)),raw=JSON.stringify(view);
  assert.doesNotMatch(raw,/baselineWeights|lastWeights|readouts|concentration|123|456/);
  assert.match(view.hint,/实际输出 A/);assert.equal(input.pairedPulses,0);
});
