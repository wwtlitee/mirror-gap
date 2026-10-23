export const AD_COUNT=16;
export const AD_HOLD_SECONDS=18;
export const AD_FADE_SECONDS=1.2;
export function billboardFrame(seconds,board=0){
 const time=Math.max(0,Number.isFinite(seconds)?seconds:0)+board*9;
 const period=AD_HOLD_SECONDS+AD_FADE_SECONDS,cycle=Math.floor(time/period),phase=time%period;
 const from=(cycle+board*7)%AD_COUNT,to=(from+1)%AD_COUNT;
 const linear=Math.max(0,Math.min(1,(phase-AD_HOLD_SECONDS)/AD_FADE_SECONDS));
 return {from,to,mix:linear*linear*(3-2*linear)};
}
