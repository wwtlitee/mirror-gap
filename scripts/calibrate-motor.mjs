// Offline engineering calibration. No natural sensory/motor cell identity is asserted.
import { readFileSync, writeFileSync } from 'node:fs';
import { Brain } from '../src/neural-core.mjs';
const graph = JSON.parse(readFileSync(new URL('../public/assets/connectome.json', import.meta.url)));
const channels = [[28], [9], [30], [243]];
const rates = [];
for (let channel = 0; channel < 4; channel++) {
  const count = new Float64Array(1024);
  for (const seed of [9123, 7719, 18031]) {
    let rng = seed;
    const brain = new Brain(graph, () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; }, { inputChannels: channels });
    for (let i = 0; i < 40; i++) {
      const result = brain.advance([0, 0, 0, 0].map((_, c) => c === channel ? .6 : 0), 200);
      for (const n of result.spikes) if (!channels.flat().includes(n)) count[n]++;
    }
  }
  rates.push(Array.from(count, v => v / 24000));
}
const groups = rates.map((rate, c) => rate.map((v, n) => ({ n, selectivity: v - Math.max(...rates.filter((_, i) => i !== c).map(r => r[n])) }))
  .filter(o => o.selectivity > .0003).sort((a, b) => b.selectivity - a.selectivity).slice(0, 24).map(o => o.n));
if (groups.some(g => g.length < 10)) throw new Error('No adequate downstream readout');
function measure(inputs) {
  const counts = [0, 0, 0, 0];
  const lookup = new Int8Array(1024).fill(-1); groups.forEach((g,c) => g.forEach(n => lookup[n]=c));
  for (const seed of [91931, 44071, 56123]) {
    let rng=seed;
    const brain=new Brain(graph,()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;},{inputChannels:channels});
    for(let j=0;j<50;j++) {const r=brain.advance(inputs,200);if(j>=10) for(const n of r.spikes)if(lookup[n]>=0)counts[lookup[n]]++;}
  }
  return counts.map(v=>v/24000);
}
const baseline = measure([.34,.34,.34,.34]);
const derivatives = channels.map((_,c)=>{const high=measure(channels.map((_,i)=>i===c?.50:.34));const low=measure(channels.map((_,i)=>i===c?.18:.34));return high.map((v,i)=>(v-low[i])/.32);});
const response = groups.map((_,i)=>derivatives.map(row=>row[i]));
// Inverse of response: rows are measured populations, columns are injected channels.
const a = response.map((row, i) => [...row, ...[0, 0, 0, 0].map((_, j) => +(i === j))]);
for (let c = 0; c < 4; c++) {
  let pivot = c; for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
  [a[c], a[pivot]] = [a[pivot], a[c]];
  const scale = a[c][c]; if (Math.abs(scale) < 1e-9) throw new Error('Singular readout');
  a[c] = a[c].map(v => v / scale);
  for (let r = 0; r < 4; r++) if (r !== c) { const factor = a[r][c]; a[r] = a[r].map((v, j) => v - factor * a[c][j]); }
}
const artifact = { version: '3.0.0', graphHash: graph.sha256, channels, groups, baseline, response, inverse: a.map(row => row.slice(4)), provenance: 'Engineering readout: three-seed single-channel selection, then three-seed mixed-input central differences around 0.34 with +/-0.16 perturbations; 200ms warmup and 800ms sampling per condition. Non-input neurons only; not natural motor-cell labels.' };
writeFileSync(new URL('../src/motor-calibration.json', import.meta.url), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ groups: groups.map(g => g.length), response }));
