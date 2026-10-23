// Runtime scheduling only: every completed body step still advances exactly 20 ms.
// Debt is deliberately bounded after suspension; it is not part of a saved life.
export class RuntimeClock {
 constructor(simulation,{now=()=>performance.now(),budgetMs=8,maxDebt=.25}={}){
  this.simulation=simulation;this.now=now;this.budgetMs=budgetMs;this.maxDebt=maxDebt;
  this.debt=0;this.droppedSeconds=0;this.lastPumpMs=0;this.maxPumpMs=0;this.steps=0;this.activeElapsedSeconds=0;
 }
 advance(elapsed){
  if(!Number.isFinite(elapsed)||elapsed<0)throw Error('Invalid runtime elapsed time');
  if(this.simulation.state.paused){this.debt=0;this.simulation.tick(Math.min(elapsed,this.maxDebt));return;}
  this.activeElapsedSeconds+=elapsed;
  const total=this.debt+elapsed;this.debt=Math.min(this.maxDebt,total);this.droppedSeconds+=total-this.debt;
  const start=this.now();let steps=0;
  while(this.debt+1e-9>=.02){
   this.simulation.tick(.02);this.debt=Math.max(0,this.debt-.02);steps++;this.steps++;
   if(this.now()-start>=this.budgetMs||steps>=5)break;
  }
  this.lastPumpMs=this.now()-start;this.maxPumpMs=Math.max(this.maxPumpMs,this.lastPumpMs);
 }
 snapshot(){return {pendingSeconds:this.debt,droppedSeconds:this.droppedSeconds,lastPumpMs:this.lastPumpMs,maxPumpMs:this.maxPumpMs,physicsSteps:this.steps,activeElapsedSeconds:this.activeElapsedSeconds};}
}
