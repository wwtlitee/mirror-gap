import {urgentActivity} from './activity-cooldowns.mjs';

/** Read only the simulated MBON response; a cue never becomes a resource or waypoint. */
export function learnedFoodCueStrength(signals=[]){
  if(!Array.isArray(signals))return 0;
  let strength=0;
  for(const signal of signals){
    if(signal?.kind!=='neutral-odor'||!['A','B'].includes(signal.odor)
      ||!Number.isFinite(signal.neuralValence)||signal.neuralValence<=0||signal.neuralValence>1
      ||!Number.isFinite(signal.intensity)||signal.intensity<=0||signal.intensity>1)continue;
    strength=Math.max(strength,signal.intensity*signal.neuralValence);
  }
  return strength;
}

/** Hunger may seek a learned food predictor after the real food has been withdrawn. */
export function learnedForagingAvailable(state,signals=[]){
  return state?.synapticMemoryMode==='neutral'&&state.home.food<=0
    &&Number.isFinite(state.needs.satiety)&&state.needs.satiety<55
    &&!['drink','toilet','rest'].some(action=>urgentActivity(state,action))
    &&learnedFoodCueStrength(signals)>0;
}
