import { readFileSync, writeFileSync } from 'node:fs';
import { Brain } from '../src/neural-core.mjs';
const graph = JSON.parse(readFileSync(new URL('../src/functional-connectome.json', import.meta.url)));
const lookup = new Int16Array(graph.neurons).fill(-1);
graph.motorIndices.forEach((n, i) => { lookup[n] = i; });
const baseline = [.34,.34,.34,.34,0,0,0,0,0];
const cases = [baseline, ...Array.from({length:4},(_,c)=>[.10,.65].map(value=>baseline.map((v,i)=>i===c?value:v))).flat(),
  [.55,.15,.25,.45,0,0,0,0,0], [.15,.55,.45,.25,0,0,0,0,0]];
const results = [];
for (const inputs of cases) {
  const counts = new Array(graph.motorIndices.length).fill(0);
  for (const seed of [719,1901]) {
    let rng=seed;
    const brain=new Brain(graph,()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;},{inputChannels:graph.channels});
    for(let j=0;j<20;j++) {
      const r=brain.advance(inputs,200);
      if(j>=5)for(const n of r.spikes)if(lookup[n]>=0)counts[lookup[n]]++;
    }
  }
  results.push({inputs, rates:counts.map(v=>v/6000)});
  console.log('sample',results.length,'output',counts.reduce((a,b)=>a+b,0));
}
writeFileSync(new URL('../runtime/functional-calibration-samples.json',import.meta.url),JSON.stringify({results}));
