const measured = (value, precision = 0) => Number.isFinite(value) && value >= 0 ? value.toFixed(precision) : '—';

// Presentation only. Trial success and every score are supplied by the session.
export function deriveCoopPresentation(coop = {}, { entered = false, endingDismissed = false } = {}) {
  const trialActive = coop.phase === 'trial';
  const trial = trialActive ? coop.trial : null;
  const trialComplete = trialActive && trial?.status === 'complete';
  const campaignComplete = !trialActive && (coop.campaign?.status === 'complete' || coop.phase === 'complete');
  const cleared = !trialActive && coop.campaign?.status === 'cleared';
  const stats = trial?.stats;
  return {
    trialActive,
    trialComplete,
    campaignComplete,
    cleared,
    trialsUnlocked: coop.campaign?.status === 'complete',
    milestone: entered && (trialComplete || (!endingDismissed && (cleared || campaignComplete))),
    trialTitle: { courier: '搬运试炼', signal: '信号试炼' }[trial?.kind] ?? '自由试炼',
    trialRecord: `用时 ${measured(trial?.elapsed, 1)} 秒 · 耗能 ${measured(stats?.energySpent, 1)}% · 碰撞 ${measured(stats?.collisions)} 次 · 失误 ${measured(stats?.mistakes)} 次`
  };
}

const pairingCountKeys=['qualifiedPulses','interruptedPairs','interruptedOnLoad','interruptedNearB','interruptedFrozen','interruptedRewardDisabled'];
const validCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const validMeasurement=value=>Number.isFinite(value)&&value>=0?value:null;

export function derivePairingPresentation(coop){
  if(coop?.phase==='trial'||coop?.stage?.id!=='paired-scent'||!coop.pairing)return null;
  const pairing=coop.pairing;
  const summary={pairedPulses:validCount(pairing.pairedPulses),pairedConsumption:validMeasurement(pairing.pairedConsumption),
    changedSynapses:validCount(pairing.changedSynapses),elapsed:validMeasurement(pairing.elapsed),ready:pairing.ready===true,
    counts:Object.fromEntries(pairingCountKeys.map(key=>[key,validCount(pairing.counts?.[key])]))};
  const interrupted=summary.counts.interruptedPairs??0;
  const pending=summary.counts.qualifiedPulses!==null&&summary.pairedPulses!==null&&summary.counts.qualifiedPulses>summary.pairedPulses+interrupted;
  const prefix=interrupted>0?`配对曾中断 ${interrupted} 次，已确认配对保留。`:'';
  const hint=summary.ready?'本段配对记录已确认。'
    :pending?'收到实际进食，等待自然学习窗结束。':'靠近室友与食物，留意实际输出 A。';
  return {summary,hint:prefix+hint,text:`配对 ${measured(summary.pairedPulses)} / 2 · 等待 ${measured(summary.elapsed,1)} / 12 秒 · 内部改变 ${measured(summary.changedSynapses)} 处`};
}
